import * as Phaser from 'phaser';
import { SoundFX } from './SoundFX';

interface Position {
  x: number;
  y: number;
}

interface RemotePlayer {
  id: string;
  username: string;
  avatar?: string | null;
  segments: Position[];
  angle: number;
  alive: boolean;
  score: number;
  boosted: boolean;
  slowed: boolean;
  skinId?: string | null;
  inZone?: boolean;
  // Bubble power-up effect remaining durations (ms). Undefined = inactive.
  speedBoostMs?: number;
  magnetMs?: number;
  ghostMs?: number;
}

interface FoodItem {
  id: string;
  position: Position;
  size: 'small' | 'large';
  colorIndex: number;
}

// ─── Bubble power-up system (client) ───────────────────────────────────────
type BubbleType = 'speed' | 'magnet' | 'explosion' | 'ghost';

interface BubbleItem {
  id: string;
  type: BubbleType;
  position: Position;
}

interface GameStateMessage {
  type: 'game_state';
  state: {
    players: RemotePlayer[];
    coins: { id: string; position: Position; isTrap: boolean }[];
    food: FoodItem[];
    bubble: BubbleItem | null;
    arena: { centerX: number; centerY: number; radius: number };
    timeRemaining: number;
  };
}

export class GameScene extends Phaser.Scene {
  private ws: WebSocket | null = null;
  private myPlayerId: string = '';
  // ── WebSocket auto-reconnect state ─────────────────────────────────────
  // Without this, a single network blip during matchmaking would silently
  // kill the queue and the user would stare at "Finding Players..." forever.
  private wsUrl: string = '';
  private wsToken: string | undefined = undefined;
  private wsBetAmount: number = 0;
  private wsReconnectAttempts: number = 0;
  private wsMaxReconnects: number = 6;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsManuallyClosed: boolean = false;
  private wsHasJoinedMatch: boolean = false;

  // Visual containers
  private playerGraphics = new Map<string, Phaser.GameObjects.Graphics>();
  private playerLabels = new Map<string, Phaser.GameObjects.Text>();
  private playerScoreLabels = new Map<string, Phaser.GameObjects.Text>();
  private coinSprites = new Map<string, Phaser.GameObjects.Arc>();
  private foodSprites = new Map<string, Phaser.GameObjects.Arc>();
  // Object pools — reusing Arc sprites avoids GC churn from create/destroy
  private coinPool: Phaser.GameObjects.Arc[] = [];
  private foodPool: Phaser.GameObjects.Arc[] = [];

  // Glow overlay for coins and food (drawn every frame, single Graphics object)
  private glowGfx!: Phaser.GameObjects.Graphics;

  // Arena (circular)
  private arenaGfx!: Phaser.GameObjects.Graphics;
  private arenaAnimGfx!: Phaser.GameObjects.Graphics;
  private arenaCenterX = 550;
  private arenaCenterY = 550;
  private arenaRadius = 500;

  // Map theme — randomized per match for variety
  private mapTheme: 'grass' | 'lava' | 'rock' | 'tile' = 'grass';

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private timerCapsule!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private leaderboardText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;
  private killNotificationText!: Phaser.GameObjects.Text;
  private killNotificationTween: Phaser.Tweens.Tween | null = null;
  private muteBtn!: Phaser.GameObjects.Text;
  private qualityBtn!: Phaser.GameObjects.Text;

  // Sound FX (synthesized via Web Audio — no asset files)
  private sfx = new SoundFX();
  private isMuted = false;
  // Track score / length to detect pickups for sound triggers
  private prevMyScore = 0;
  private prevMyLength = 0;

  // Input — mouse/touch pointer for angle-based steering
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private trapKey!: Phaser.Input.Keyboard.Key;
  private lastSentAngle: number | null = null;
  private isDemo = false;

  // Camera offset
  private cameraTarget: Position | null = null;
  // Smoothed camera position (lerped toward cameraTarget) to avoid jitter
  private cameraSmooth: Position | null = null;
  // Frozen final position at the moment the local player died (camera locks here)
  private deathCameraLock: Position | null = null;

  // Snake interpolation: server ticks at 33ms (30Hz) but we render at 60fps.
  // To avoid jitter we keep prev+curr positions per player and lerp each frame.
  // The actual interp duration auto-adapts to the real tick delta (see below).
  private readonly SERVER_TICK_MS = 33;
  private lastServerStateTime = 0;
  private serverInterval = this.SERVER_TICK_MS;
  // For each player: previous server snapshot + latest server snapshot
  private playerInterp = new Map<string, {
    prevSegments: Position[];
    currSegments: Position[];
    prevAngle: number;
    currAngle: number;
    alive: boolean;
    score: number;
    boosted: boolean;
    slowed: boolean;
    skinId?: string | null;
    inZone?: boolean;
    username: string;
    // Bubble effect remaining ms (0 if inactive) — used to drive render visuals
    speedBoostMs?: number;
    magnetMs?: number;
    ghostMs?: number;
  }>();

  // ── Bubble power-up system (client) ──────────────────────────────
  // Currently-active bubble on the map (max 1 at a time, server-authoritative).
  private currentBubble: BubbleItem | null = null;
  // Visual elements for the active bubble (recreated when it changes).
  private bubbleContainer: Phaser.GameObjects.Container | null = null;
  // Bubble spawn time (performance.now) for floating animation
  private bubbleSpawnAt = 0;
  // Expected lifetime of current bubble in ms (from bubble_spawn).
  // Used to pulse faster in the last 2s so players feel the urgency.
  private bubbleLifetimeMs = 8000;
  // Center text banner shown when a bubble is consumed (auto-hides).
  private bubbleNotificationText!: Phaser.GameObjects.Text;
  private bubbleNotificationTween: Phaser.Tweens.Tween | null = null;

  // Zone danger overlay
  private zoneOverlay!: Phaser.GameObjects.Graphics;
  private zoneWarningText!: Phaser.GameObjects.Text;

  // ── Performance tuning ───────────────────────────────────────────
  // Device quality tier — auto-detected once on create().
  // low  : mobile + slow CPU/RAM. Skips shadow pass, no smoothing, no arena anim, no tongue
  // mid  : mobile or modest desktop. Half smoothing, drop shadow on, lighter anim
  // high : desktop with decent GPU. Full quality (default behavior)
  private qualityTier: 'low' | 'mid' | 'high' = 'high';
  // Frame counter used to throttle arena animation on low tier
  private frameCount = 0;
  // Cached camera viewport half-extents (in world units) for frustum culling.
  // Recomputed when zoom/size changes.
  private viewHalfW = 1000;
  private viewHalfH = 1000;

  // ── Adaptive quality (FPS watchdog) ──────────────────────────────
  // Sample FPS over a 2-second rolling window. If sustained FPS drops
  // below threshold, automatically downgrade the quality tier. This
  // catches devices that "look" powerful (8 cores reported) but throttle
  // hard in practice (cheap tablets, old Chromebooks, mobile power save).
  private fpsSamples: number[] = [];
  private fpsLastSampleTime = 0;
  private fpsLastCheckTime = 0;
  private autoDowngradeUsed = false; // only downgrade once automatically
  // User explicitly set a quality — don't auto-downgrade against their choice.
  private qualityIsUserLocked = false;

  // Mobile controls
  private isMobile = false;
  private joystickOrigin: Position | null = null;
  private joystickCurrent: Position | null = null;
  private joystickActive = false;
  private joystickGraphics!: Phaser.GameObjects.Graphics;
  private mobileBoostBtn!: Phaser.GameObjects.Container;
  private mobileTrapBtn!: Phaser.GameObjects.Container;
  private mobileCameraResetBtn!: Phaser.GameObjects.Container;
  private touchId: number | null = null;
  private resetCameraKey!: Phaser.Input.Keyboard.Key;

  // Skin effects
  private playerBoostTrails = new Map<string, Phaser.GameObjects.Graphics[]>();
  private playerCloneSprites = new Map<string, Phaser.GameObjects.Graphics[]>();
  private lastBoostStates = new Map<string, boolean>();

  // Cached canvas dimensions so we only reposition HUD on actual resize
  private lastCanvasW = 0;
  private lastCanvasH = 0;

  // Skin definitions — keep in sync with database/schema.sql skins table.
  // primary = body color, secondary = scale highlight, glow = boost trail tint.
  private readonly SKIN_COLORS: Record<string, { primary: number; secondary: number; glow: number }> = {
    neon_cyber:     { primary: 0x00f0ff, secondary: 0xff00a0, glow: 0x00f0ff },
    inferno_drake:  { primary: 0xff4500, secondary: 0xff8c00, glow: 0xff5210 },
    void_shadow:    { primary: 0x4a2080, secondary: 0x8b00ff, glow: 0x8b00ff },
    venom_serpent:  { primary: 0x39ff14, secondary: 0x0f3d0f, glow: 0x6cff3c },
    frost_wyrm:     { primary: 0xa5f3fc, secondary: 0x0ea5e9, glow: 0xb8e6ff },
    golden_emperor: { primary: 0xffd700, secondary: 0xb8860b, glow: 0xfff48c },
    cyber_samurai:  { primary: 0xe2e8f0, secondary: 0xdc2626, glow: 0xff5466 },
  };

  // Callbacks
  private onGameEnd: ((results: { username: string; score: number; placement: number }[]) => void) | null = null;
  private onConnectionStatus: ((status: string) => void) | null = null;
  private onMyDeath: ((info: { lostAmount: number; killerName?: string; killerId?: string }) => void) | null = null;
  private onScoreChange: ((score: number) => void) | null = null;
  private onTimeUpdate: ((timeRemaining: number) => void) | null = null;
  private onQueueState: ((data: { players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[]; minPlayers: number; maxPlayers: number; elapsedSeconds?: number }) => void) | null = null;
  private onMatchStart: ((data: { matchId: string; players: { id: string; username: string; avatar: string | null; skinId: string | null }[] }) => void) | null = null;
  private onGameBegin: (() => void) | null = null;
  private onError: ((data: { message: string; code?: string }) => void) | null = null;
  private translations: Record<string, string> = {};

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data?: {
    wsUrl?: string;
    token?: string;
    isDemo?: boolean;
    betAmount?: number;
    onGameEnd?: (results: { username: string; score: number; placement: number }[]) => void;
    onConnectionStatus?: (status: string) => void;
    onMyDeath?: (info: { lostAmount: number; killerName?: string; killerId?: string }) => void;
    onScoreChange?: (score: number) => void;
    onTimeUpdate?: (timeRemaining: number) => void;
    onQueueState?: (data: { players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[]; minPlayers: number; maxPlayers: number; elapsedSeconds?: number }) => void;
    onMatchStart?: (data: { matchId: string; players: { id: string; username: string; avatar: string | null; skinId: string | null }[] }) => void;
    onGameBegin?: () => void;
    onError?: (data: { message: string; code?: string }) => void;
    translations?: Record<string, string>;
  }) {
    if (!data || !data.wsUrl) return;

    this.translations = data.translations || {};
    this.onGameEnd = data.onGameEnd || null;
    this.onConnectionStatus = data.onConnectionStatus || null;
    this.onMyDeath = data.onMyDeath || null;
    this.onScoreChange = data.onScoreChange || null;
    this.onTimeUpdate = data.onTimeUpdate || null;
    this.onQueueState = data.onQueueState || null;
    this.onMatchStart = data.onMatchStart || null;
    this.onGameBegin = data.onGameBegin || null;
    this.onError = data.onError || null;

    if (data.token) {
      try {
        const payload = JSON.parse(atob(data.token.split('.')[1]));
        this.myPlayerId = payload.id;
      } catch {
        this.myPlayerId = 'unknown';
      }
    }

    this.isDemo = !!data.isDemo;
    this.connectWebSocket(data.wsUrl, data.token, !!data.isDemo, data.betAmount ?? 0);
  }

  preload() {}

  create() {
    // Detect mobile
    this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Auto-detect quality tier based on device capability — runs ONCE on scene create
    this.detectQualityTier();

    // Cap renderer DPR on low/mid tiers to avoid GPU overdraw on hi-DPI mobiles
    if (this.qualityTier !== 'high') {
      this.scale.setZoom(1); // no extra scale stacking
      const targetDPR = this.qualityTier === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
      const renderer = this.game.renderer;
      if (renderer) {
        // WebGL: lower internal resolution to reduce fragment shader workload
        if ('resolution' in renderer) {
          try { (renderer as unknown as { resolution: number }).resolution = targetDPR; } catch { /* noop */ }
        }
        // Canvas: the canvas backing store is scaled by CSS size. We can't
        // change backing-store ratio directly, but Phaser's parent container
        // will respect the game config resolution. As a fallback we shrink
        // the game canvas CSS size by the inverse factor so fewer physical
        // pixels are rendered (browser upscales, saving GPU fill).
        if ((renderer as unknown as { type?: number }).type === Phaser.CANVAS) {
          try {
            const canvas = (renderer as unknown as { canvas: HTMLCanvasElement }).canvas;
            if (canvas && canvas.style) {
              canvas.style.width = `${canvas.width / targetDPR}px`;
              canvas.style.height = `${canvas.height / targetDPR}px`;
            }
          } catch { /* noop */ }
        }
      }
    }

    // Arena background — random map theme each match
    const themes: ('grass' | 'lava' | 'rock' | 'tile')[] = ['grass', 'lava', 'rock', 'tile'];
    this.mapTheme = themes[Math.floor(Math.random() * themes.length)];
    this.arenaGfx = this.add.graphics();
    this.arenaGfx.setDepth(-10);
    this.arenaAnimGfx = this.add.graphics();
    this.arenaAnimGfx.setDepth(-9);
    this.glowGfx = this.add.graphics();
    this.glowGfx.setDepth(3); // below coins (5) and food (4) for underglow
    this.drawArena();
    this.applyThemeCameraBg();

    // Zone danger overlay (full-screen red tint when outside arena)
    this.zoneOverlay = this.add.graphics();
    this.zoneOverlay.setScrollFactor(0).setDepth(99);
    this.zoneWarningText = this.add.text(this.scale.width / 2, this.scale.height * 0.15, this.translations.dangerZone || 'DANGER ZONE — RETURN!', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '14px' : '18px',
      color: '#ef4444',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setVisible(false);

    // HUD — heavily simplified on mobile to avoid clutter/overlap
    const hudTop = this.isMobile ? 44 : 16;
    this.scoreText = this.add.text(10, hudTop, `${this.translations.score || 'Score'}: $0.00`, {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '14px' : '20px',
      color: this.isDemo ? '#f59e0b' : '#10b981',
      fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(100);

    // Timer capsule at top center — lower on mobile to avoid React HUD overlap
    const screenCenterX = this.scale.width / 2;
    const timerY = this.isMobile ? 50 : 12;
    this.timerCapsule = this.add.graphics();
    this.timerCapsule.fillStyle(0x27272a, 0.95);
    this.timerCapsule.fillRoundedRect(screenCenterX - 60, timerY, 120, 36, 18);
    this.timerCapsule.lineStyle(2, 0x3f3f46, 1);
    this.timerCapsule.strokeRoundedRect(screenCenterX - 60, timerY, 120, 36, 18);
    this.timerCapsule.setScrollFactor(0).setDepth(100);

    this.timeText = this.add.text(screenCenterX, timerY + 18, '3:00', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    this.statusText = this.add.text(this.scale.width / 2, this.scale.height / 2, this.translations.connecting || 'Connecting...', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '18px' : '24px',
      color: '#a1a1aa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    this.leaderboardText = this.add.text(this.scale.width - 16, 16, '', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '11px' : '13px',
      color: '#a1a1aa',
      align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);
    if (this.isMobile) this.leaderboardText.setVisible(false);

    this.aliveText = this.add.text(16, 72, `${this.translations.alive || 'Alive'}: 0`, {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '12px' : '14px',
      color: '#71717a',
    }).setScrollFactor(0).setDepth(100);
    if (this.isMobile) this.aliveText.setVisible(false);

    // Kill notification — floats in the upper third when you eliminate someone
    this.killNotificationText = this.add.text(this.scale.width / 2, this.scale.height * 0.28, '', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '20px' : '28px',
      color: '#ffd700',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(102).setAlpha(0);

    // Bubble power-up notification — appears a bit higher than kill notification
    // so both can show simultaneously without overlapping.
    this.bubbleNotificationText = this.add.text(this.scale.width / 2, this.scale.height * 0.18, '', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '22px' : '32px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 5,
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(103).setAlpha(0);

    // Sound mute toggle button (top right, under leaderboard)
    const savedMute = typeof localStorage !== 'undefined' && localStorage.getItem('snake_muted') === '1';
    if (savedMute) {
      this.isMuted = true;
      this.sfx.setMuted(true);
    }
    this.muteBtn = this.add.text(this.scale.width - 16, this.scale.height - 16, this.isMuted ? '🔇' : '🔊', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '18px' : '22px',
      color: '#a1a1aa',
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(102).setInteractive({ useHandCursor: true });
    if (this.isMobile) this.muteBtn.setVisible(false);

    this.muteBtn.on('pointerdown', () => {
      this.isMuted = !this.isMuted;
      this.sfx.setMuted(this.isMuted);
      this.muteBtn.setText(this.isMuted ? '🔇' : '🔊');
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('snake_muted', this.isMuted ? '1' : '0');
      }
      // Small visual feedback
      this.tweens.add({
        targets: this.muteBtn,
        scale: { from: 1.2, to: 1 },
        duration: 150,
        ease: 'Sine.out',
      });
    });

    // Quality toggle button — click to cycle low/mid/high.
    // Positioned to the LEFT of the mute button (bottom-right corner area).
    // Persists choice in localStorage; auto-applied on next match via ?quality=
    // override path OR the saved setting is checked by detectQualityTier().
    const qualityLabel = (t: 'low' | 'mid' | 'high') =>
      t === 'low' ? (this.translations.qualityLow || '◐ LOW') : t === 'mid' ? (this.translations.qualityMid || '◑ MID') : (this.translations.qualityHigh || '◉ HIGH');
    this.qualityBtn = this.add.text(this.scale.width - 54, this.scale.height - 16, qualityLabel(this.qualityTier), {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '11px' : '13px',
      color: '#d4a04a',
      backgroundColor: '#1a1410cc',
      padding: { x: 6, y: 3 },
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(102).setInteractive({ useHandCursor: true });
    if (this.isMobile) this.qualityBtn.setVisible(false);

    this.qualityBtn.on('pointerdown', () => {
      // Cycle: high → mid → low → high
      this.qualityTier = this.qualityTier === 'high' ? 'mid' : this.qualityTier === 'mid' ? 'low' : 'high';
      this.qualityBtn.setText(qualityLabel(this.qualityTier));
      // User took explicit control — disable auto-downgrade
      this.qualityIsUserLocked = true;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('snake_quality', this.qualityTier);
      }
      // Instantly clear all boost trails and clone sprites if downshifting to low
      if (this.qualityTier === 'low') {
        for (const id of this.playerBoostTrails.keys()) this.clearBoostTrails(id);
        for (const id of this.playerCloneSprites.keys()) this.clearShadowClones(id);
      }
      // Visual feedback
      this.tweens.add({
        targets: this.qualityBtn,
        scale: { from: 1.15, to: 1 },
        duration: 150,
        ease: 'Sine.out',
      });
    });

    // Input — keyboard for boost/trap, mouse/touch for steering
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.trapKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // Hold-to-boost: $0.01/sec while spacebar held. Auto-stops on release/death.
    this.spaceKey.on('down', () => {
      this.send({ type: 'boost_start' });
      this.sfx.boostStart();
    });
    this.spaceKey.on('up', () => this.send({ type: 'boost_end' }));
    this.trapKey.on('down', () => {
      this.send({ type: 'skill_use', skill: 'trap' });
      this.sfx.trap();
    });

    // Camera reset hotkey — 'R' snaps camera to player's current position
    this.resetCameraKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.resetCameraKey.on('down', () => this.resetCamera());

    // Camera — zoom in so snake is larger on screen.
    // (Camera background is set by applyThemeCameraBg() above — DO NOT override
    // here, otherwise the themed ground gets painted over with dark gray.)
    const baseZoom = this.isMobile ? 0.9 : 1.6;
    const zoomScale = this.qualityTier === 'low' ? 0.85 : this.qualityTier === 'mid' ? 0.95 : 1;
    this.cameras.main.setZoom(baseZoom * zoomScale);
    // Sub-pixel rendering keeps interpolated movement smooth while the camera lerps
    this.cameras.main.setRoundPixels(false);
    // Pre-position camera at arena center so the first frame doesn't snap from (0,0)
    this.cameras.main.centerOn(this.arenaCenterX, this.arenaCenterY);
    this.cameraSmooth = { x: this.arenaCenterX, y: this.arenaCenterY };
    this.recomputeViewExtents();

    // Recompute viewport extents whenever the canvas resizes (orientation change etc.)
    this.scale.on('resize', () => this.recomputeViewExtents());

    // Mobile touch controls
    if (this.isMobile) {
      this.setupMobileControls();
    }
  }

  /** Detect device capability tier exactly once. Stored in this.qualityTier. */
  private detectQualityTier() {
    // Browser-reported capabilities
    const cores = (navigator.hardwareConcurrency as number | undefined) || 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;
    const dpr = window.devicePixelRatio || 1;
    const isMobile = this.isMobile;

    // Network type hint — 'slow-2g'/'2g'/'3g' often correlates with budget devices
    const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
    const slowNet = conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g' || conn?.effectiveType === '3g';
    const saveData = conn?.saveData === true;

    // Screen size heuristic: small phones (< 380px) are almost always budget devices
    const screenW = Math.min(window.screen.width, window.screen.height);
    const smallScreen = screenW < 380;

    // Battery saver / data saver → respect user preference by going lighter
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // More aggressive heuristic (covers budget/mid-range Android):
    //   low  : mobile + (≤6 cores OR ≤3GB RAM OR small screen OR slow net OR save-data OR reduced-motion)
    //   mid  : any mobile, or low-spec desktop (≤4 cores, ≤4GB RAM)
    //   high : desktop ≥6 cores AND ≥6GB RAM
    if (isMobile && (cores <= 6 || mem <= 3 || smallScreen || slowNet || saveData || prefersReducedMotion)) {
      this.qualityTier = 'low';
    } else if (isMobile || cores <= 4 || mem <= 4) {
      this.qualityTier = 'mid';
    } else {
      this.qualityTier = 'high';
    }

    // User's saved preference from the in-game quality button wins over auto-detect.
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('snake_quality') : null;
      if (saved === 'low' || saved === 'mid' || saved === 'high') {
        this.qualityTier = saved;
        this.qualityIsUserLocked = true;
      }
    } catch { /* noop */ }

    // URL override (highest priority, for testing): ?quality=low|mid|high
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('quality');
      if (q === 'low' || q === 'mid' || q === 'high') {
        this.qualityTier = q;
        this.qualityIsUserLocked = true;
      }
    } catch { /* noop */ }

    // eslint-disable-next-line no-console
    console.info(`[GameScene] Quality tier: ${this.qualityTier} (cores=${cores}, mem=${mem}GB, dpr=${dpr.toFixed(1)}, mobile=${isMobile}, screenW=${screenW}, slowNet=${slowNet})`);
  }

  /**
   * Rolling FPS watchdog. Call once per frame from update(). If sustained FPS
   * falls below 40 for 3+ seconds, auto-downgrade ONE tier (high→mid or mid→low).
   * Runs only once per session and is skipped if the user has manually selected
   * a quality tier (respects their choice).
   */
  private monitorFps(now: number, delta: number) {
    if (this.autoDowngradeUsed || this.qualityIsUserLocked) return;
    if (this.qualityTier === 'low') return; // already at the floor

    // Sample once per frame — delta is ms since last frame
    if (delta > 0 && delta < 500) {
      this.fpsSamples.push(1000 / delta);
    }

    // Check every 1 second
    if (now - this.fpsLastCheckTime < 1000) return;
    this.fpsLastCheckTime = now;

    // Need at least 30 samples (≈0.5s @ 60fps) to make a decision
    if (this.fpsSamples.length < 30) return;

    // Use the 20th-percentile (not mean) — this catches sustained bad frames,
    // not single stutters. Sort ascending, pick element at 20% position.
    const sorted = [...this.fpsSamples].sort((a, b) => a - b);
    const p20 = sorted[Math.floor(sorted.length * 0.2)];

    // Keep the last ~3 seconds of samples (trim old ones)
    if (this.fpsSamples.length > 180) {
      this.fpsSamples = this.fpsSamples.slice(-180);
    }

    // Trigger: p20 FPS below 38 for 3+ seconds of samples
    if (p20 < 38 && this.fpsSamples.length >= 100) {
      const before = this.qualityTier;
      this.qualityTier = this.qualityTier === 'high' ? 'mid' : 'low';
      this.autoDowngradeUsed = true;

      // Clear expensive effects on downgrade
      if (this.qualityTier === 'low') {
        for (const id of this.playerBoostTrails.keys()) this.clearBoostTrails(id);
        for (const id of this.playerCloneSprites.keys()) this.clearShadowClones(id);
      }

      // Update the visible quality button label so the user sees the change
      if (this.qualityBtn) {
        const tr = this.translations;
        const label = this.qualityTier === 'low' ? (tr?.qualityLow || '◐ LOW')
          : this.qualityTier === 'mid' ? (tr?.qualityMid || '◑ MID')
          : (tr?.qualityHigh || '◉ HIGH');
        this.qualityBtn.setText(label);
      }

      // eslint-disable-next-line no-console
      console.info(`[GameScene] FPS watchdog: auto-downgraded ${before} → ${this.qualityTier} (p20=${p20.toFixed(1)}fps)`);
      this.fpsSamples = [];
    }
  }

  /** Cache half-extents of the visible camera viewport in WORLD coordinates.
   *  Used by isOnScreen() for fast frustum culling without per-frame math. */
  private recomputeViewExtents() {
    const cam = this.cameras.main;
    if (!cam) return;
    const zoom = cam.zoom || 1;
    this.viewHalfW = (cam.width / zoom) / 2;
    this.viewHalfH = (cam.height / zoom) / 2;
  }

  /** Fast AABB test: is (x,y) within the camera view (plus padding)? */
  private isOnScreen(x: number, y: number, padding = 60): boolean {
    if (!this.cameraSmooth) return true;
    const dx = Math.abs(x - this.cameraSmooth.x);
    const dy = Math.abs(y - this.cameraSmooth.y);
    return dx < this.viewHalfW + padding && dy < this.viewHalfH + padding;
  }

  /** Remove segments that are closer than `minDist` px to the previous kept
   *  segment. Overlapping circles waste GPU fill-rate with zero visual gain.
   *  Always keeps head and tail so the snake doesn't appear truncated. */
  private cullDenseSegments(segments: Position[], minDist: number): Position[] {
    if (segments.length <= 2) return segments;
    const out: Position[] = [segments[0]];
    const minSq = minDist * minDist;
    for (let i = 1; i < segments.length; i++) {
      const prev = out[out.length - 1];
      const dx = segments[i].x - prev.x;
      const dy = segments[i].y - prev.y;
      if (dx * dx + dy * dy >= minSq) {
        out.push(segments[i]);
      }
    }
    // Ensure tail is present so the snake doesn't look cut off
    if (out[out.length - 1] !== segments[segments.length - 1]) {
      out.push(segments[segments.length - 1]);
    }
    return out;
  }

  /** Resample a polyline to uniform arc-length spacing. This guarantees that
   *  consecutive render circles always overlap (no "broken balls" on long
   *  snakes) regardless of server-side segment spacing or snake length.
   *
   *  - `desiredSpacing`: target distance between output points. We pick the
   *    LARGER of this and (total / (maxPoints - 1)) so we never exceed the
   *    point cap on very long snakes. As long as the result is < 2 * tail
   *    radius, circles still overlap and the body reads as a solid tube.
   *  - `maxPoints`: hard cap on output length to bound render cost. */
  private resamplePath(segments: Position[], desiredSpacing: number, maxPoints: number): Position[] {
    if (segments.length < 2) return segments.slice();

    // Cumulative arc length for each control point
    const cumLen: number[] = [0];
    for (let i = 1; i < segments.length; i++) {
      const dx = segments[i].x - segments[i - 1].x;
      const dy = segments[i].y - segments[i - 1].y;
      cumLen.push(cumLen[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const total = cumLen[cumLen.length - 1];
    if (total === 0) return [{ x: segments[0].x, y: segments[0].y }];

    // Enforce the point cap by increasing spacing when the snake is very long
    const spacing = Math.max(desiredSpacing, total / Math.max(1, maxPoints - 1));

    const out: Position[] = [{ x: segments[0].x, y: segments[0].y }];
    let d = spacing;
    let idx = 0;
    while (d < total) {
      // Advance idx to the segment containing the running distance d
      while (idx + 1 < cumLen.length && cumLen[idx + 1] < d) idx++;
      const segStart = cumLen[idx];
      const segLen = cumLen[idx + 1] - segStart;
      const t = segLen > 0 ? (d - segStart) / segLen : 0;
      out.push({
        x: segments[idx].x + (segments[idx + 1].x - segments[idx].x) * t,
        y: segments[idx].y + (segments[idx + 1].y - segments[idx].y) * t,
      });
      d += spacing;
    }
    // Always terminate at the exact tail so the body doesn't look cut short
    const tail = segments[segments.length - 1];
    const lastOut = out[out.length - 1];
    if (lastOut.x !== tail.x || lastOut.y !== tail.y) {
      out.push({ x: tail.x, y: tail.y });
    }
    return out;
  }

  /** Hide all visuals belonging to a player (used for off-screen culling). */
  private hidePlayerVisuals(id: string) {
    const g = this.playerGraphics.get(id);
    if (g && g.visible) g.setVisible(false);
    const lbl = this.playerLabels.get(id);
    if (lbl && lbl.visible) lbl.setVisible(false);
    const sl = this.playerScoreLabels.get(id);
    if (sl && sl.visible) sl.setVisible(false);
  }

  private showPlayerVisuals(id: string) {
    const g = this.playerGraphics.get(id);
    if (g && !g.visible) g.setVisible(true);
    const lbl = this.playerLabels.get(id);
    if (lbl && !lbl.visible) lbl.setVisible(true);
    const sl = this.playerScoreLabels.get(id);
    if (sl && !sl.visible) sl.setVisible(true);
  }

  private setupMobileControls() {
    const w = this.scale.width;
    const h = this.scale.height;

    // Joystick graphics
    this.joystickGraphics = this.add.graphics().setScrollFactor(0).setDepth(200);

    // Touch steering via joystick
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x > w * 0.55) return; // right side reserved for buttons
      this.joystickActive = true;
      this.touchId = pointer.id;
      this.joystickOrigin = { x: pointer.x, y: pointer.y };
      this.joystickCurrent = { x: pointer.x, y: pointer.y };
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.joystickActive || pointer.id !== this.touchId) return;
      this.joystickCurrent = { x: pointer.x, y: pointer.y };
      const dx = pointer.x - this.joystickOrigin!.x;
      const dy = pointer.y - this.joystickOrigin!.y;
      const angle = Math.atan2(dy, dx);
      if (this.lastSentAngle === null || Math.abs(angle - this.lastSentAngle) > 0.035) {
        this.send({ type: 'turn', angle });
        this.lastSentAngle = angle;
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.touchId) return;
      this.joystickActive = false;
      this.touchId = null;
      this.joystickGraphics.clear();
    });

    // Boost button (right side bottom) — minimum 44px radius for reliable touch
    const btnRadius = Math.max(44, Math.min(56, w * 0.11));
    const edgePad = 16;
    const boostX = w - btnRadius - edgePad;
    const boostY = h - btnRadius - edgePad - 20;
    this.mobileBoostBtn = this.createMobileButton(
      boostX, boostY, btnRadius, this.translations.boost || 'BOOST', 0x00f0ff,
      () => this.send({ type: 'boost_start' }),
      () => this.send({ type: 'boost_end' }),
    );

    // Trap button (right side above boost)
    const trapX = w - btnRadius - edgePad;
    const trapY = boostY - btnRadius * 2.4;
    this.mobileTrapBtn = this.createMobileButton(trapX, trapY, btnRadius, this.translations.trap || 'TRAP', 0xff2e63, () => {
      this.send({ type: 'skill_use', skill: 'trap' });
    });

    // Camera reset button (left side, above joystick area)
    const resetBtnRadius = Math.max(32, Math.min(40, w * 0.08));
    const resetX = resetBtnRadius + edgePad;
    const resetY = h - resetBtnRadius - edgePad - 20;
    this.mobileCameraResetBtn = this.createMobileButton(
      resetX, resetY, resetBtnRadius, '⊕', 0xfbbf24,
      () => this.resetCamera(),
    );
  }

  private createMobileButton(
    x: number,
    y: number,
    r: number,
    label: string,
    color: number,
    onDown: () => void,
    onUp?: () => void,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y).setScrollFactor(0).setDepth(200);
    const circle = this.add.graphics();
    circle.fillStyle(color, 0.25);
    circle.fillCircle(0, 0, r);
    circle.lineStyle(2, color, 0.8);
    circle.strokeCircle(0, 0, r);

    const fontSize = Math.max(14, Math.round(r * 0.38));
    const text = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: `${fontSize}px`,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add([circle, text]);

    // Container-level hit area — more reliable than zones inside containers on mobile
    container.setSize(r * 2, r * 2);
    const hitArea = new Phaser.Geom.Circle(0, 0, r);
    container.setInteractive(hitArea, Phaser.Geom.Circle.Contains);

    container.on('pointerdown', () => {
      circle.clear();
      circle.fillStyle(color, 0.5);
      circle.fillCircle(0, 0, r);
      circle.lineStyle(2, color, 1);
      circle.strokeCircle(0, 0, r);
      onDown();
    });
    container.on('pointerup', () => {
      circle.clear();
      circle.fillStyle(color, 0.25);
      circle.fillCircle(0, 0, r);
      circle.lineStyle(2, color, 0.8);
      circle.strokeCircle(0, 0, r);
      if (onUp) onUp();
    });
    container.on('pointerout', () => {
      circle.clear();
      circle.fillStyle(color, 0.25);
      circle.fillCircle(0, 0, r);
      circle.lineStyle(2, color, 0.8);
      circle.strokeCircle(0, 0, r);
      if (onUp) onUp();
    });

    return container;
  }

  update(_time: number, delta: number) {
    this.frameCount++;

    // FPS watchdog: auto-downgrade quality if frames are dropping badly
    this.monitorFps(performance.now(), delta);

    // Animated arena overlay — vivid theme particles. Throttled aggressively
    // so low-end devices never waste cycles on decorative effects.
    // high=every frame, mid=every 3rd frame, low=never (static arena only).
    if (this.qualityTier === 'high') {
      this.drawArenaAnim(performance.now());
    } else if (this.qualityTier === 'mid' && (this.frameCount % 3) === 0) {
      this.drawArenaAnim(performance.now());
    }
    // low tier: intentionally skipped — decorative particles are a luxury

    // Bubble float animation: tiny vertical bob + urgency flicker near expiry.
    // Skip entirely if offscreen: no visual impact, small perf win.
    if (this.bubbleContainer && this.currentBubble) {
      const b = this.currentBubble.position;
      if (this.isOnScreen(b.x, b.y, 60)) {
        const elapsedMs = performance.now() - this.bubbleSpawnAt;
        const remainMs = this.bubbleLifetimeMs - elapsedMs;
        const t = elapsedMs / 1000;
        const bob = Math.sin(t * 2.8) * 3; // ~±3px bob
        this.bubbleContainer.setY(b.y + bob);
        // Urgency flicker: last 2s, alpha pulses fast to tell players it's about to vanish.
        if (remainMs < 2000 && remainMs > 0) {
          const flicker = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 90));
          this.bubbleContainer.setAlpha(flicker);
        } else if (this.bubbleContainer.alpha < 1 && remainMs > 2000) {
          this.bubbleContainer.setAlpha(1);
        }
      }
    }

    // Mouse steering (desktop only — mobile uses joystick)
    if (!this.isMobile && this.cameraTarget && this.input.activePointer) {
      const pointer = this.input.activePointer;
      // Convert screen-space pointer to world-space
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const dx = worldPoint.x - this.cameraTarget.x;
      const dy = worldPoint.y - this.cameraTarget.y;
      const angle = Math.atan2(dy, dx);

      // Only send if angle changed meaningfully (> ~2 degrees)
      if (this.lastSentAngle === null || Math.abs(angle - this.lastSentAngle) > 0.035) {
        this.send({ type: 'turn', angle });
        this.lastSentAngle = angle;
      }
    }

    // Draw joystick visual
    if (this.isMobile && this.joystickActive && this.joystickOrigin && this.joystickCurrent) {
      this.joystickGraphics.clear();
      const ox = this.joystickOrigin.x;
      const oy = this.joystickOrigin.y;
      const cx = this.joystickCurrent.x;
      const cy = this.joystickCurrent.y;
      // Base
      this.joystickGraphics.fillStyle(0xffffff, 0.15);
      this.joystickGraphics.fillCircle(ox, oy, 40);
      this.joystickGraphics.lineStyle(2, 0xffffff, 0.3);
      this.joystickGraphics.strokeCircle(ox, oy, 40);
      // Stick
      this.joystickGraphics.fillStyle(0x00f0ff, 0.6);
      this.joystickGraphics.fillCircle(cx, cy, 18);
    }

    // ─── Frame-by-frame snake interpolation + render ────────────────
    // Compute interp factor t in [0,1] based on time elapsed since last server tick.
    // No extrapolation — limiting t to 1.0 prevents overshoot snap-backs that
    // cause visible camera jitter when a new server state arrives.
    //
    // Smoothstep easing: t*t*(3 - 2t). Same endpoints (0 and 1), same average
    // speed, but with a gentle ease-in/ease-out curve. Visually this removes
    // the subtle "hitch" when a new state lands — motion blends silkier.
    let t = 1;
    if (this.lastServerStateTime > 0) {
      const raw = (performance.now() - this.lastServerStateTime) / this.serverInterval;
      const clamped = Math.max(0, Math.min(1, raw));
      t = clamped * clamped * (3 - 2 * clamped);
    }

    let myInterpHead: Position | null = null;
    let myAlive = false;
    let myInZone = true;

    for (const [id, data] of this.playerInterp) {
      // Build interpolated snapshot
      const interpSegments: Position[] = [];
      const segCount = Math.min(data.prevSegments.length, data.currSegments.length);
      for (let i = 0; i < segCount; i++) {
        const a = data.prevSegments[i];
        const b = data.currSegments[i];
        interpSegments.push({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        });
      }
      // If curr has more segments (snake grew), append the extras
      for (let i = segCount; i < data.currSegments.length; i++) {
        interpSegments.push({ ...data.currSegments[i] });
      }

      const interpAngle = data.prevAngle + this.shortestAngleDelta(data.prevAngle, data.currAngle) * t;

      const interpPlayer: RemotePlayer = {
        id,
        username: data.username,
        segments: interpSegments,
        angle: interpAngle,
        alive: data.alive,
        score: data.score,
        boosted: data.boosted,
        slowed: data.slowed,
        skinId: data.skinId,
        inZone: data.inZone,
        speedBoostMs: data.speedBoostMs,
        magnetMs: data.magnetMs,
        ghostMs: data.ghostMs,
      };

      // Frustum culling: skip drawing snakes that are fully off-screen.
      // We always render our own snake (id === myPlayerId).
      // For others, sample head + tail + middle segment; if all are off-screen
      // with generous padding, hide and skip the expensive renderSnake() call.
      let onScreen = id === this.myPlayerId;
      if (!onScreen && interpSegments.length > 0) {
        const head = interpSegments[0];
        const tail = interpSegments[interpSegments.length - 1];
        const mid = interpSegments[(interpSegments.length / 2) | 0];
        const pad = 80;
        onScreen =
          this.isOnScreen(head.x, head.y, pad) ||
          this.isOnScreen(tail.x, tail.y, pad) ||
          this.isOnScreen(mid.x, mid.y, pad);
      }

      if (onScreen) {
        this.showPlayerVisuals(id);
        this.renderSnake(interpPlayer);
      } else {
        this.hidePlayerVisuals(id);
        // Also clear any boost trails for hidden snakes
        this.clearBoostTrails(id);
      }

      if (id === this.myPlayerId) {
        myAlive = data.alive;
        myInZone = data.inZone !== false;
        if (data.alive && interpSegments.length > 0) {
          myInterpHead = interpSegments[0];
        }
      }
    }

    // Pick camera target — each player follows ONLY their own snake.
    // No spectating; on death the camera locks at the moment of death.
    let camTarget: Position | null = null;
    if (myAlive && myInterpHead) {
      camTarget = myInterpHead;
      this.deathCameraLock = { x: myInterpHead.x, y: myInterpHead.y };
      this.drawZoneOverlay(!myInZone);
    } else {
      // Dead — lock camera at last known head position
      camTarget = this.deathCameraLock;
      this.drawZoneOverlay(false);
    }

    if (camTarget) {
      this.cameraTarget = camTarget;
      if (!this.cameraSmooth) {
        this.cameraSmooth = { x: camTarget.x, y: camTarget.y };
      } else {
        // Frame-rate-independent lerp: at 60fps with delta=16.67ms, factor ≈ 0.18.
        // Without this, high-Hz monitors (120/144Hz) make the camera "snap" too
        // fast and feel jittery; low-FPS makes it laggy. Math: 1-(1-k)^(delta/16.67)
        // where k is the per-frame lerp at 60fps.
        const baseLerp = 0.18;
        const dt = Math.max(1, Math.min(50, delta));
        const factor = 1 - Math.pow(1 - baseLerp, dt / 16.67);
        this.cameraSmooth.x += (camTarget.x - this.cameraSmooth.x) * factor;
        this.cameraSmooth.y += (camTarget.y - this.cameraSmooth.y) * factor;
      }
      // DO NOT Math.round() — sub-pixel camera centers preserve interpolation
      // smoothness. Manual rounding here makes the camera oscillate between
      // integer values when moving slowly, producing visible 1-pixel shake.
      // Trust Phaser's renderer.
      this.cameras.main.centerOn(this.cameraSmooth.x, this.cameraSmooth.y);
    }
  }

  /** Instantly snap camera to the player's current head position.
   *  Useful when camera drifts due to slow server load or lag. */
  private resetCamera(): void {
    const data = this.myPlayerId ? this.playerInterp.get(this.myPlayerId) : null;
    if (data && data.alive && data.currSegments.length > 0) {
      const head = data.currSegments[0];
      this.cameraSmooth = { x: head.x, y: head.y };
      this.cameraTarget = { x: head.x, y: head.y };
      this.cameras.main.centerOn(head.x, head.y);
    }
  }

  /** Set Phaser camera background to a darker variant of the current theme.
   *  Tuned so the area outside the arena is clearly the same biome (just
   *  dimmer) rather than looking like a black void. */
  private applyThemeCameraBg() {
    const themeBgs = {
      grass: '#143a1c',  // dark forest green (was nearly black)
      lava: '#3a0a02',   // dark ember red
      rock: '#1d1e22',   // dim slate gray
      tile: '#0a1828',   // dark navy with hint of cyan
    };
    this.cameras.main.setBackgroundColor(themeBgs[this.mapTheme]);
  }

  /** Returns shortest signed delta between two angles, handling wrap-around. */
  private shortestAngleDelta(a: number, b: number): number {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  // ============================================
  // WebSocket
  // ============================================
  private connectWebSocket(wsUrl: string, token: string | undefined, _isDemo: boolean, betAmount: number) {
    // Save params so we can transparently reconnect on a dropped socket.
    this.wsUrl = wsUrl;
    this.wsToken = token;
    this.wsBetAmount = betAmount;
    this.wsReconnectAttempts = 0;
    this.wsManuallyClosed = false;
    this.wsHasJoinedMatch = false;
    this.openWebSocket();
  }

  /** Internal: actually open the socket, separate so we can call it again on reconnect. */
  private openWebSocket() {
    // Server is authoritative for demo vs pro (reads user.game_mode from DB).
    // We only need to authenticate via token.
    const params = new URLSearchParams();
    if (this.wsToken) params.set('token', this.wsToken);

    const fullUrl = `${this.wsUrl}?${params.toString()}`;
    this.ws = new WebSocket(fullUrl);

    this.ws.onopen = () => {
      // Successful connection — reset backoff counter.
      this.wsReconnectAttempts = 0;
      this.onConnectionStatus?.('connected');
      this.statusText.setText(this.translations.joiningQueue || 'Joining queue...');
      // Re-join queue (works for first connect AND reconnect mid-queue)
      this.send({ type: 'join_queue', betAmount: this.wsBetAmount });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleServerMessage(msg);
      } catch (err) {
        console.error('Bad WS message:', err);
      }
    };

    this.ws.onerror = () => {
      // Don't surface 'error' to UI yet — onclose will fire next and trigger
      // the reconnect dance. Only after retries exhaust do we report failure.
      console.warn('[WS] socket error — will attempt reconnect');
    };

    this.ws.onclose = () => {
      // Decide whether to reconnect:
      //   - User manually closed → don't reconnect.
      //   - Game ended → don't reconnect (the server closes our socket after
      //     game_end is delivered).
      //   - Otherwise: try to reconnect transparently up to wsMaxReconnects.
      if (this.wsManuallyClosed) return;
      if (this.wsHasJoinedMatch) {
        // Mid-match disconnect — server treats us as dead. Surface as
        // disconnected so the UI can show appropriate state. Don't reconnect
        // because a re-join would trigger ALREADY_IN_MATCH or ghost cleanup.
        this.onConnectionStatus?.('disconnected');
        return;
      }

      this.wsReconnectAttempts++;
      if (this.wsReconnectAttempts > this.wsMaxReconnects) {
        console.error(`[WS] giving up after ${this.wsMaxReconnects} reconnect attempts`);
        this.onConnectionStatus?.('disconnected');
        this.onError?.({
          message: this.translations.lostConnection || 'Lost connection to game server. Please check your internet and try again.',
          code: 'WS_RECONNECT_FAILED',
        });
        return;
      }

      // Exponential backoff: 200ms, 400ms, 800ms, 1.6s, 3.2s, 6.4s
      const delay = Math.min(6400, 200 * Math.pow(2, this.wsReconnectAttempts - 1));
      console.log(`[WS] reconnect attempt ${this.wsReconnectAttempts}/${this.wsMaxReconnects} in ${delay}ms`);
      this.statusText.setText(`${this.translations.reconnecting || 'Reconnecting...'} (${this.wsReconnectAttempts}/${this.wsMaxReconnects})`);
      // Hint to the lobby UI that we're reconnecting (not a hard failure).
      this.onConnectionStatus?.('reconnecting');

      if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = setTimeout(() => {
        this.wsReconnectTimer = null;
        this.openWebSocket();
      }, delay);
    };
  }

  /** Cleanly close the socket without triggering auto-reconnect. */
  private closeWebSocketCleanly() {
    this.wsManuallyClosed = true;
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closed */ }
    }
  }

  private send(payload: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  // ============================================
  // Server message handlers
  // ============================================
  private handleServerMessage(msg: Record<string, unknown> & { type: string }) {
    switch (msg.type) {
      case 'welcome':
        this.myPlayerId = msg.playerId as string;
        console.log('[GameScene] My player ID:', this.myPlayerId);
        break;

      case 'queue_status':
        this.statusText.setText(`${this.translations.inQueue || 'In queue'} (${msg.position} / ${msg.minPlayers ?? 2} ${this.translations.needed || 'needed'})`);
        break;

      case 'queue_state': {
        const data = msg as unknown as {
          players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[];
          minPlayers: number;
          maxPlayers: number;
          elapsedSeconds?: number;
        };
        this.statusText.setText(`${this.translations.findingMatch || 'Finding match...'} ${data.players.length}/${data.minPlayers}`);
        this.onQueueState?.(data);
        break;
      }

      case 'match_starting': {
        const data = msg as unknown as {
          matchId: string;
          players: { id: string; username: string; avatar: string | null; skinId: string | null }[];
        };
        this.statusText.setText(this.translations.matchStarting || 'Match starting...');
        this.onMatchStart?.(data);
        break;
      }

      case 'game_start':
        this.statusText.setText('');
        // From this moment forward, any WS disconnect is mid-match and
        // should NOT trigger auto-reconnect/re-queue.
        this.wsHasJoinedMatch = true;
        this.onGameBegin?.();
        break;

      case 'game_state':
        this.renderGameState((msg as unknown as GameStateMessage).state);
        break;

      case 'bubble_spawn': {
        // Server tells us the bubble lifetime explicitly. Cache it so we can
        // render an urgency pulse as the bubble nears expiration.
        const data = msg as unknown as {
          bubble: { id: string; type: BubbleType; position: Position; expiresInMs: number };
        };
        this.bubbleLifetimeMs = data.bubble.expiresInMs || 8000;
        // (The actual visuals are created by syncBubble on the next game_state.)
        break;
      }

      case 'bubble_consumed': {
        // Server says someone ate the bubble. Play the burst at the LAST known
        // position (currentBubble, before renderGameState clears it).
        const data = msg as unknown as {
          bubbleId: string;
          bubbleType: BubbleType;
          playerId: string;
          username: string;
        };
        const lastBubble = this.currentBubble;
        if (lastBubble && lastBubble.id === data.bubbleId) {
          this.onBubbleConsumed(lastBubble, data.playerId, data.username);
        }
        break;
      }

      case 'player_death':
        if (msg.playerId === this.myPlayerId) {
          this.statusText.setText('');
          this.sfx.death();
          this.onMyDeath?.({
            lostAmount: (msg.lostAmount as number) ?? 0,
            killerName: msg.killerName as string | undefined,
            killerId: msg.killerId as string | undefined,
          });
        } else if (msg.killerId === this.myPlayerId) {
          // We killed someone — show a satisfying notification
          const victimName = (this.playerInterp.get(msg.playerId as string)?.username) || (this.translations.enemy || 'Enemy');
          const lost = (msg.lostAmount as number) ?? 0;
          this.showKillNotification(victimName, lost);
          this.sfx.kill();
        }
        break;

      case 'game_end': {
        const results = (msg as unknown as { results: { username: string; score: number; placement: number }[] }).results;
        this.statusText.setText(this.translations.gameOver || 'Game Over');
        this.onGameEnd?.(results);
        // Close cleanly — disable auto-reconnect since the match is legitimately over.
        this.closeWebSocketCleanly();
        break;
      }

      case 'error': {
        const errMsg = (msg as { message?: string }).message || (this.translations.serverError || 'Server error');
        const errCode = (msg as { code?: string }).code;
        this.statusText.setText(`${this.translations.errorPrefix || 'Error'}: ${errMsg}`);
        // Propagate to React so the matchmaking UI can react (e.g. exit lobby,
        // show toast, redirect to dashboard) instead of staying stuck on
        // "Still Searching...".
        this.onError?.({ message: errMsg, code: errCode });
        break;
      }
    }
  }

  // ============================================
  // Rendering
  // ============================================
  /**
   * Called when a server game_state arrives. We DON'T render directly here;
   * instead we update the interpolation buffer. The actual snake drawing happens
   * every frame in update() using interpolated positions.
   */
  private renderGameState(state: GameStateMessage['state']) {
    // Update circular arena if changed
    if (
      state.arena.centerX !== this.arenaCenterX ||
      state.arena.centerY !== this.arenaCenterY ||
      state.arena.radius !== this.arenaRadius
    ) {
      const wasFirst = this.arenaRadius === 500; // default before first server update
      this.arenaCenterX = state.arena.centerX;
      this.arenaCenterY = state.arena.centerY;
      this.arenaRadius = state.arena.radius;
      this.drawArena();

      // Scale camera zoom inversely with arena radius on the FIRST arena
      // update (= match start). Smaller arena (3p) gets a tighter, more
      // intimate camera; bigger arena (10p) zooms out so the player can
      // see more of the action. Avoid retroactively zooming when the
      // shrink interval steps the arena down mid-match.
      if (wasFirst) {
        const baseZoom = this.isMobile ? 0.9 : 1.6;
        const tierFactor = this.qualityTier === 'low' ? 0.85 : this.qualityTier === 'mid' ? 0.95 : 1;
        // Reference radius = 500 → factor 1.0; smaller → tighter zoom (>1), bigger → wider zoom (<1).
        const sizeFactor = Math.max(0.85, Math.min(1.20, 500 / Math.max(1, this.arenaRadius)));
        this.cameras.main.setZoom(baseZoom * tierFactor * sizeFactor);
      }
    }

    // Track real server tick interval — adapt interp duration if server lags.
    // Clamp lower bound to 25ms so the client supports server tick rates up to
    // 40Hz without artificially holding the interp window open. The previous
    // 40ms floor was fine for 20Hz servers but caused permanent ~7ms staleness
    // when we bumped the server to 30Hz (33ms ticks).
    const now = performance.now();
    if (this.lastServerStateTime > 0) {
      const delta = now - this.lastServerStateTime;
      this.serverInterval = Math.max(25, Math.min(120, delta));
    }
    this.lastServerStateTime = now;

    // Update timer — only rebuild texture when displayed value changes
    const seconds = Math.ceil(state.timeRemaining / 1000);
    const timeStr = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
    if (this.timeText.text !== timeStr) {
      this.timeText.setText(timeStr);
    }
    const timerColor = seconds <= 10 && seconds > 0 ? '#ef4444' : '#ffffff';
    if (this.timeText.style.color !== timerColor) {
      this.timeText.setColor(timerColor);
    }

    // Update interp buffer for each player (rotate curr → prev, set new curr)
    const seenPlayers = new Set<string>();
    for (const p of state.players) {
      seenPlayers.add(p.id);
      const existing = this.playerInterp.get(p.id);
      if (existing) {
        // Rotate: previous curr becomes prev
        existing.prevSegments = existing.currSegments;
        existing.prevAngle = existing.currAngle;
        existing.currSegments = p.segments.map(s => ({ x: s.x, y: s.y }));
        existing.currAngle = p.angle;
        existing.alive = p.alive;
        existing.score = p.score;
        existing.boosted = p.boosted;
        existing.slowed = p.slowed;
        existing.skinId = p.skinId;
        existing.inZone = p.inZone;
        existing.username = p.username;
        existing.speedBoostMs = p.speedBoostMs;
        existing.magnetMs = p.magnetMs;
        existing.ghostMs = p.ghostMs;
      } else {
        // First snapshot — duplicate so prev=curr (no jump)
        const segCopy = p.segments.map(s => ({ x: s.x, y: s.y }));
        this.playerInterp.set(p.id, {
          prevSegments: segCopy.map(s => ({ ...s })),
          currSegments: segCopy,
          prevAngle: p.angle,
          currAngle: p.angle,
          alive: p.alive,
          score: p.score,
          boosted: p.boosted,
          slowed: p.slowed,
          skinId: p.skinId,
          inZone: p.inZone,
          username: p.username,
          speedBoostMs: p.speedBoostMs,
          magnetMs: p.magnetMs,
          ghostMs: p.ghostMs,
        });
      }
    }

    // Send time update to React overlay
    this.onTimeUpdate?.(state.timeRemaining);

    // Mini-leaderboard with medals + boost/dead markers + own-rank fallback
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const top5 = sorted.slice(0, 5);
    const myIdx = sorted.findIndex(p => p.id === this.myPlayerId);
    const inTop5 = myIdx >= 0 && myIdx < 5;
    const medals = ['🥇', '🥈', '🥉', '#4', '#5'];

    const formatLine = (p: typeof sorted[number], idx: number): string => {
      const rank = medals[idx] || `#${idx + 1}`;
      const me = p.id === this.myPlayerId ? ' ◀' : '';
      const dead = p.alive ? '' : ' ✗';
      const fire = p.boosted ? ' 🔥' : '';
      const name = p.username.length > 11 ? p.username.slice(0, 11) + '..' : p.username;
      return `${rank} ${name}  $${p.score.toFixed(2)}${fire}${dead}${me}`;
    };

    const lbLines = top5.map(formatLine);
    if (!inTop5 && myIdx >= 0) {
      lbLines.push('  ⋯');
      lbLines.push(formatLine(sorted[myIdx], myIdx));
    }

    this.leaderboardText.setText(lbLines.join('\n'));
    this.leaderboardText.setX(this.scale.width - 16);

    // Reposition HUD only when canvas dimensions actually changed (resize/orientation)
    const cw = this.scale.width;
    const ch = this.scale.height;
    if (cw !== this.lastCanvasW || ch !== this.lastCanvasH) {
      this.lastCanvasW = cw;
      this.lastCanvasH = ch;
      const hudYOffset = this.isMobile ? 130 : 16;
      this.muteBtn.setPosition(cw - 16, ch - hudYOffset);
      this.qualityBtn.setPosition(cw - 54, ch - hudYOffset);

      const mobileHudTop = this.isMobile ? 44 : 16;
      this.scoreText.setPosition(10, mobileHudTop);
      const mobileTimerY = this.isMobile ? 50 : 12;
      const scx = cw / 2;
      this.timerCapsule.clear();
      this.timerCapsule.fillStyle(0x27272a, 0.95);
      this.timerCapsule.fillRoundedRect(scx - 60, mobileTimerY, 120, 36, 18);
      this.timerCapsule.lineStyle(2, 0x3f3f46, 1);
      this.timerCapsule.strokeRoundedRect(scx - 60, mobileTimerY, 120, 36, 18);
      this.timeText.setPosition(scx, mobileTimerY + 18);
      this.killNotificationText.setPosition(cw / 2, ch * 0.28);

      if (this.isMobile) {
        const btnR = Math.max(44, Math.min(56, cw * 0.11));
        const edgeP = 16;
        const bY = ch - btnR - edgeP - 20;
        if (this.mobileBoostBtn) {
          this.mobileBoostBtn.setPosition(cw - btnR - edgeP, bY);
        }
        if (this.mobileTrapBtn) {
          this.mobileTrapBtn.setPosition(cw - btnR - edgeP, bY - btnR * 2.4);
        }
        if (this.mobileCameraResetBtn) {
          const resetR = Math.max(32, Math.min(40, cw * 0.08));
          this.mobileCameraResetBtn.setPosition(resetR + edgeP, ch - resetR - edgeP - 20);
        }
      }
    }

    const aliveCount = state.players.filter(p => p.alive).length;
    const aliveLabel = this.translations.alive || 'Alive';
    const aliveStr = `${aliveLabel}: ${aliveCount}/${state.players.length}`;
    if (this.aliveText.text !== aliveStr) {
      this.aliveText.setText(aliveStr);
    }

    // Update score for me (uses authoritative score, not interpolated)
    const me = state.players.find(p => p.id === this.myPlayerId);
    if (me) {
      // Pickup detection — score up = coin, length up without score change = food.
      // We compare to last tick's values (snapshot just before this update).
      if (me.alive) {
        const scoreDelta = me.score - this.prevMyScore;
        const lengthDelta = me.segments.length - this.prevMyLength;
        if (scoreDelta > 0.005) {
          this.sfx.coinPickup();
        } else if (lengthDelta > 0) {
          this.sfx.foodPickup();
        }
      }
      this.prevMyScore = me.score;
      this.prevMyLength = me.segments.length;
      const scoreLabel = this.translations.score || 'Score';
      const scoreStr = `${scoreLabel}: $${me.score.toFixed(2)}`;
      if (this.scoreText.text !== scoreStr) {
        this.scoreText.setText(scoreStr);
      }
      this.onScoreChange?.(me.score);
    }

    // Remove disconnected players
    for (const id of this.playerGraphics.keys()) {
      if (!seenPlayers.has(id)) {
        this.playerGraphics.get(id)?.destroy();
        this.playerLabels.get(id)?.destroy();
        this.playerScoreLabels.get(id)?.destroy();
        this.playerGraphics.delete(id);
        this.playerLabels.delete(id);
        this.playerScoreLabels.delete(id);
        this.playerInterp.delete(id);
        this.clearBoostTrails(id);
        this.lastBoostStates.delete(id);
        const clones = this.playerCloneSprites.get(id);
        if (clones) {
          clones.forEach(c => c.destroy());
          this.playerCloneSprites.delete(id);
        }
      }
    }

    // Update coins — object pooled to avoid Phaser create/destroy churn
    const seenCoins = new Set<string>();
    for (const c of state.coins) {
      seenCoins.add(c.id);
      let coin = this.coinSprites.get(c.id);
      if (!coin) {
        const pooled = this.coinPool.pop();
        if (pooled) {
          pooled.setPosition(c.position.x, c.position.y);
          pooled.setVisible(true);
          pooled.setRadius(8);
          pooled.fillColor = 0xfbbf24;
          pooled.strokeColor = 0xf59e0b;
          pooled.lineWidth = 2;
          coin = pooled;
        } else {
          coin = this.add.circle(c.position.x, c.position.y, 8, 0xfbbf24)
            .setStrokeStyle(2, 0xf59e0b)
            .setDepth(5);
        }
        this.coinSprites.set(c.id, coin);
      } else {
        coin.setPosition(c.position.x, c.position.y);
      }
    }
    for (const id of this.coinSprites.keys()) {
      if (!seenCoins.has(id)) {
        const sp = this.coinSprites.get(id)!;
        sp.setVisible(false);
        this.coinPool.push(sp);
        this.coinSprites.delete(id);
      }
    }

    // Update food pellets — object pooled to avoid Phaser create/destroy churn
    const seenFood = new Set<string>();
    const foodColors = [0x22c55e, 0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0xf97316]; // green, red, blue, yellow, purple, orange
    for (const f of state.food) {
      seenFood.add(f.id);
      const radius = f.size === 'large' ? 5 : 3;
      const color = foodColors[f.colorIndex % foodColors.length];
      let pellet = this.foodSprites.get(f.id);
      if (!pellet) {
        const pooled = this.foodPool.pop();
        if (pooled) {
          pooled.setPosition(f.position.x, f.position.y);
          pooled.setVisible(true);
          pooled.setRadius(radius);
          pooled.fillColor = color;
          pooled.setStrokeStyle(0);
          pellet = pooled;
        } else {
          pellet = this.add.circle(f.position.x, f.position.y, radius, color)
            .setDepth(4);
        }
        this.foodSprites.set(f.id, pellet);
      } else {
        pellet.setPosition(f.position.x, f.position.y);
        pellet.setRadius(radius);
        pellet.fillColor = color;
      }
    }
    for (const id of this.foodSprites.keys()) {
      if (!seenFood.has(id)) {
        const sp = this.foodSprites.get(id)!;
        sp.setVisible(false);
        this.foodPool.push(sp);
        this.foodSprites.delete(id);
      }
    }

    // ── Glow / attractive effects on coins & food ───────────────────
    // Single Graphics clear + redraw per tick is cheaper than individual tweens.
    // Skipped on low tier for performance. On mid tier, run every 2nd frame —
    // the pulse period is ~1s so a 2x framerate on glow is imperceptible.
    const shouldDrawGlow =
      (this.qualityTier === 'high') ||
      (this.qualityTier === 'mid' && (this.frameCount & 1) === 0);
    if (shouldDrawGlow) {
      this.glowGfx.clear();
      const pulse = 0.35 + 0.25 * Math.sin(performance.now() / 400);
      const pulse2 = 0.3 + 0.2 * Math.sin(performance.now() / 500 + 1);

      // Coin glow — golden halo
      for (const c of state.coins) {
        if (!this.isOnScreen(c.position.x, c.position.y, 30)) continue;
        this.glowGfx.fillStyle(0xfbbf24, pulse * 0.4);
        this.glowGfx.fillCircle(c.position.x, c.position.y, 16);
        this.glowGfx.fillStyle(0xfde68a, pulse * 0.2);
        this.glowGfx.fillCircle(c.position.x, c.position.y, 22);
      }

      // Food glow — only large food gets a halo. Small food halos were
      // drawn at 0.15 alpha which is essentially invisible on top of the
      // arena texture, but the per-pellet fillCircle still adds up to
      // 30–50 ops/frame in dense lobbies. Cheaper to skip them entirely.
      for (const f of state.food) {
        if (f.size !== 'large') continue;
        if (!this.isOnScreen(f.position.x, f.position.y, 20)) continue;
        const fColor = foodColors[f.colorIndex % foodColors.length];
        this.glowGfx.fillStyle(fColor, pulse2 * 0.3);
        this.glowGfx.fillCircle(f.position.x, f.position.y, 10);
      }
    }

    // ── Bubble power-up: sync with server state ────────────────────
    this.syncBubble(state.bubble);
  }

  // ─── Bubble power-up rendering ─────────────────────────────────────────
  /** Sync the active bubble with the server state. Called each game_state. */
  private syncBubble(next: BubbleItem | null): void {
    const curr = this.currentBubble;
    // Same bubble still active — just refresh position (server may have moved it)
    if (curr && next && curr.id === next.id) {
      if (this.bubbleContainer) {
        this.bubbleContainer.setPosition(next.position.x, next.position.y);
      }
      return;
    }
    // Bubble changed or disappeared — fade out old visuals smoothly instead
    // of popping them out instantly. This feels way nicer when a bubble
    // expires or gets consumed.
    if (this.bubbleContainer) {
      const dying = this.bubbleContainer;
      this.bubbleContainer = null;
      this.tweens.add({
        targets: dying,
        scale: 0,
        alpha: 0,
        duration: 220,
        ease: 'Back.in',
        onComplete: () => dying.destroy(),
      });
    }
    this.currentBubble = next;
    if (next) {
      this.createBubbleVisuals(next);
      this.bubbleSpawnAt = performance.now();
    }
  }

  /** Build the Phaser container with glow + body + icon for the bubble. */
  private createBubbleVisuals(bubble: BubbleItem): void {
    const style = this.bubbleStyle(bubble.type);
    const container = this.add.container(bubble.position.x, bubble.position.y).setDepth(7);

    // Outer glow halo (large, translucent)
    const outerGlow = this.add.graphics();
    outerGlow.fillStyle(style.color, 0.22);
    outerGlow.fillCircle(0, 0, 30);
    outerGlow.fillStyle(style.color, 0.12);
    outerGlow.fillCircle(0, 0, 44);
    container.add(outerGlow);

    // Bubble body — filled circle with a slightly lighter inner highlight
    const body = this.add.graphics();
    body.fillStyle(style.color, 0.85);
    body.fillCircle(0, 0, 16);
    body.lineStyle(2, style.ring, 1);
    body.strokeCircle(0, 0, 16);
    // Inner gloss highlight (upper-left) for a 3D bubble feel
    body.fillStyle(0xffffff, 0.35);
    body.fillCircle(-5, -5, 5);
    container.add(body);

    // Icon character centered inside the bubble
    const icon = this.add.text(0, 0, style.icon, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(icon);

    this.bubbleContainer = container;

    // Spawn animation: pop in with a bounce, then enter the infinite pulse.
    // Starting at scale 0 + alpha 0 feels much smoother than instant appearance.
    container.setScale(0);
    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: 260,
      ease: 'Back.out',
      onComplete: () => {
        // Only start the infinite pulse if this bubble wasn't already removed mid-spawn
        if (this.bubbleContainer !== container) return;
        this.tweens.add({
          targets: container,
          scale: { from: 0.92, to: 1.08 },
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
      },
    });
  }

  /** Color + ring + icon for each bubble type per spec. */
  private bubbleStyle(type: BubbleType): { color: number; ring: number; icon: string } {
    switch (type) {
      case 'speed':     return { color: 0xff2e4d, ring: 0xffffff, icon: '⚡' }; // red + lightning
      case 'magnet':    return { color: 0x3b82f6, ring: 0xbfdbfe, icon: '🧲' }; // blue + magnet
      case 'explosion': return { color: 0xf97316, ring: 0xffedd5, icon: '💥' }; // orange + explosion
      case 'ghost':     return { color: 0x8b5cf6, ring: 0xddd6fe, icon: '👻' }; // purple + ghost
    }
  }

  /** Kick off a short celebratory burst + banner when a bubble is consumed. */
  private onBubbleConsumed(bubble: BubbleItem, playerId: string, username: string): void {
    const style = this.bubbleStyle(bubble.type);
    const isMe = playerId === this.myPlayerId;

    // Particle-like burst: 12 radial dots expanding + fading
    const burst = this.add.graphics().setDepth(9);
    const cx = bubble.position.x;
    const cy = bubble.position.y;
    const steps = 12;
    const state = { t: 0 };
    this.tweens.add({
      targets: state,
      t: 1,
      duration: 550,
      ease: 'Cubic.out',
      onUpdate: () => {
        burst.clear();
        const radius = 10 + state.t * 60;
        const alpha = 1 - state.t;
        burst.fillStyle(style.color, alpha);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const px = cx + Math.cos(a) * radius;
          const py = cy + Math.sin(a) * radius;
          burst.fillCircle(px, py, 4 * (1 - state.t) + 1);
        }
      },
      onComplete: () => burst.destroy(),
    });

    // Screen banner
    const label = this.bubbleLabel(bubble.type);
    const msg = isMe
      ? `${style.icon} ${label} ${this.translations.activated || 'Activated!'}`
      : `${style.icon} ${username}: ${label}`;

    this.bubbleNotificationText.setText(msg);
    this.bubbleNotificationText.setAlpha(1);
    this.bubbleNotificationText.setScale(0.85);
    // Colour the banner to match the bubble so the message feels cohesive
    const hex = '#' + style.color.toString(16).padStart(6, '0');
    this.bubbleNotificationText.setColor(hex);

    if (this.bubbleNotificationTween) this.bubbleNotificationTween.stop();
    this.bubbleNotificationTween = this.tweens.add({
      targets: this.bubbleNotificationText,
      scale: { from: 1.2, to: 1 },
      duration: 280,
      ease: 'Back.out',
      onComplete: () => {
        this.tweens.add({
          targets: this.bubbleNotificationText,
          alpha: 0,
          duration: 700,
          delay: 1400,
        });
      },
    });

    // SFX: reuse coin pickup for a "ding" — cheap but readable feedback
    if (isMe) this.sfx.coinPickup();
  }

  /** Translated display label for each bubble type. */
  private bubbleLabel(type: BubbleType): string {
    const tr = this.translations;
    switch (type) {
      case 'speed':     return tr?.bubbleSpeedLabel     || 'Speed Boost';
      case 'magnet':    return tr?.bubbleMagnetLabel    || 'Magnet';
      case 'explosion': return tr?.bubbleExplosionLabel || 'Mass Explosion';
      case 'ghost':     return tr?.bubbleGhostLabel     || 'Ghost';
    }
  }

  private renderSnake(p: RemotePlayer) {
    let g = this.playerGraphics.get(p.id);
    let label = this.playerLabels.get(p.id);
    let scoreLabel = this.playerScoreLabels.get(p.id);

    if (!g) {
      g = this.add.graphics().setDepth(10);
      this.playerGraphics.set(p.id, g);
    }
    if (!label) {
      label = this.add.text(0, 0, p.username, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
      }).setOrigin(0.5).setDepth(11);
      this.playerLabels.set(p.id, label);
    }
    if (!scoreLabel) {
      scoreLabel = this.add.text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#fbbf24', // amber for money visibility
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12);
      this.playerScoreLabels.set(p.id, scoreLabel);
    }

    g.clear();

    if (!p.alive) {
      label.setAlpha(0.3);
      scoreLabel.setAlpha(0);
      g.setAlpha(1); // reset in case ghost was active
      // Clear all skin effects (trails, clones) when dead so they don't linger
      this.clearBoostTrails(p.id);
      this.clearShadowClones(p.id);
      this.lastBoostStates.set(p.id, false);
      return;
    }
    label.setAlpha(1);
    scoreLabel.setAlpha(1);

    if (p.segments.length === 0) return;

    const isMe = p.id === this.myPlayerId;
    const skin = p.skinId ? this.SKIN_COLORS[p.skinId] : null;

    // ── Bubble power-up visual state ──────────────────────────────────
    // Ghost: snake renders semi-transparent (can pass through bodies).
    // Speed boost: we draw an extra outer ring at the head (later below).
    // Magnet: we draw a pulsing halo at the head (later below).
    const hasGhost = (p.ghostMs || 0) > 0;
    const hasSpeedBubble = (p.speedBoostMs || 0) > 0;
    const hasMagnet = (p.magnetMs || 0) > 0;
    // Blink the snake at ~4Hz during the last 1.5s of ghost to warn of expiry
    let ghostAlpha = 1;
    if (hasGhost) {
      const ms = p.ghostMs || 0;
      ghostAlpha = ms < 1500
        ? 0.45 + 0.25 * Math.sin(performance.now() / 80)
        : 0.55;
    }
    g.setAlpha(ghostAlpha);

    // Resolve body & outline colors (skin overrides default)
    let bodyColor: number;
    let outlineColor: number;
    let glowColor: number | null = null;

    if (skin) {
      bodyColor = skin.primary;
      outlineColor = skin.secondary;
      glowColor = skin.glow;
    } else {
      bodyColor = isMe ? 0x10b981 : this.colorFromId(p.id);
      outlineColor = this.darkenColor(bodyColor, 0.55);
    }

    // Boost / slow overrides for non-skinned snakes
    if (!skin) {
      if (p.boosted) {
        bodyColor = 0xfbbf24;
        outlineColor = 0xb45309;
      }
      if (p.slowed) {
        bodyColor = 0x6366f1;
        outlineColor = 0x312e81;
      }
    }

    // Body radius tapers from head (large) to tail (small) — snake.io style
    const HEAD_RADIUS = 11;
    const TAIL_RADIUS = 5;

    // ── Build a uniformly-spaced render path through the snake's body.
    //
    // The server places control segments exactly SNAKE_SEGMENT_SIZE (15px)
    // apart. Since our tail circles are only 5px radius (10px diameter), two
    // raw segments at the tail leave a 5px gap between circles — the snake
    // looks like a string of disconnected balls. We fix this by resampling
    // the polyline at a small uniform spacing so adjacent circles always
    // overlap, regardless of snake length.
    //
    // `spacing` must be < 2 * TAIL_RADIUS for the body to read as solid.
    // `maxPoints` caps total fillCircle calls per snake for performance.
    const spacing = this.qualityTier === 'low' ? 6 : this.qualityTier === 'mid' ? 4.5 : 3.5;
    const maxPoints = this.qualityTier === 'low' ? 70 : this.qualityTier === 'mid' ? 130 : 190;
    const dense = this.resamplePath(p.segments, spacing, maxPoints);
    const len = dense.length;

    // Pass 0: drop shadow under body for depth — only on high tier
    // (saves 1 fillCircle per segment for mid/low).
    if (this.qualityTier === 'high') {
      g.fillStyle(0x000000, 0.35);
      for (let i = len - 1; i >= 0; i--) {
        const t = i / Math.max(1, len - 1);
        const r = HEAD_RADIUS - (HEAD_RADIUS - TAIL_RADIUS) * t;
        const seg = dense[i];
        g.fillCircle(seg.x + 3, seg.y + 4, r + 1);
      }
    }

    // Pass 1: outline circles (darker, slightly larger) — gives body a clean edge
    g.fillStyle(outlineColor, 1);
    for (let i = len - 1; i >= 0; i--) {
      const t = i / Math.max(1, len - 1); // 0 = head, 1 = tail
      const r = HEAD_RADIUS - (HEAD_RADIUS - TAIL_RADIUS) * t;
      const seg = dense[i];
      g.fillCircle(seg.x, seg.y, r + 1.5);
    }

    // Pass 2: filled body circles (the snake itself)
    g.fillStyle(bodyColor, 1);
    for (let i = len - 1; i >= 0; i--) {
      const t = i / Math.max(1, len - 1);
      const r = HEAD_RADIUS - (HEAD_RADIUS - TAIL_RADIUS) * t;
      const seg = dense[i];
      g.fillCircle(seg.x, seg.y, r);
    }

    // Pass 2b: SCALE BANDS — a darker overlay every ~30px of arc-length so
    // the snake reads as a banded/scaled creature, not a flat tube. Stride
    // scales with render spacing so band density stays visually consistent
    // across quality tiers. Skipped on low tier to keep render cost minimal.
    if (this.qualityTier !== 'low') {
      const bandStride = Math.max(2, Math.round(30 / spacing));
      const scaleColor = this.darkenColor(bodyColor, 0.65);
      g.fillStyle(scaleColor, 0.55);
      for (let i = 2; i < len; i += bandStride) {
        const t = i / Math.max(1, len - 1);
        const r = HEAD_RADIUS - (HEAD_RADIUS - TAIL_RADIUS) * t;
        const seg = dense[i];
        g.fillCircle(seg.x, seg.y, r * 0.78);
      }
    }

    // Pass 2c: TOP-SIDE SHEEN — smaller lighter circles offset toward the
    // upper-left for a 3D reptile-like glossy highlight. Skipped on low tier.
    if (this.qualityTier !== 'low') {
      const sheenColor = this.lightenColor(bodyColor, 0.45);
      g.fillStyle(sheenColor, 0.55);
      for (let i = len - 1; i >= 0; i--) {
        const t = i / Math.max(1, len - 1);
        const r = HEAD_RADIUS - (HEAD_RADIUS - TAIL_RADIUS) * t;
        const seg = dense[i];
        // Offset the highlight toward upper-left so the body looks rounded.
        g.fillCircle(seg.x - r * 0.30, seg.y - r * 0.40, r * 0.45);
      }
    }

    // Boost / glow ring on head
    const head = dense[0];
    if (p.boosted) {
      const ringColor = glowColor ?? 0xfde047;
      g.lineStyle(3, ringColor, 0.85);
      g.strokeCircle(head.x, head.y, HEAD_RADIUS + 4);
    } else if (glowColor) {
      // Subtle skin glow always
      g.lineStyle(2, glowColor, 0.3);
      g.strokeCircle(head.x, head.y, HEAD_RADIUS + 2);
    }

    // ── Bubble power-up head effects ──────────────────────────────────
    // Speed bubble (red lightning ring, pulsing strongly)
    if (hasSpeedBubble) {
      const t = performance.now() / 250;
      const pulse = 0.7 + 0.3 * Math.sin(t);
      g.lineStyle(3, 0xff2e4d, pulse);
      g.strokeCircle(head.x, head.y, HEAD_RADIUS + 8);
      g.lineStyle(2, 0xffffff, pulse * 0.7);
      g.strokeCircle(head.x, head.y, HEAD_RADIUS + 12);
    }
    // Magnet bubble (blue halo with rotating arc sparkles)
    if (hasMagnet) {
      const t = performance.now() / 400;
      const pulse = 0.5 + 0.3 * Math.sin(t * 2);
      g.lineStyle(2, 0x3b82f6, pulse);
      g.strokeCircle(head.x, head.y, HEAD_RADIUS + 14);
      // Rotating orbital dots to sell the "attraction" metaphor
      g.fillStyle(0x93c5fd, 0.85);
      for (let i = 0; i < 4; i++) {
        const a = t + (i / 4) * Math.PI * 2;
        g.fillCircle(head.x + Math.cos(a) * 22, head.y + Math.sin(a) * 22, 2.2);
      }
    }
    // Ghost bubble: faint purple aura so others can see the ghost state
    if (hasGhost) {
      g.lineStyle(2, 0x8b5cf6, 0.55);
      g.strokeCircle(head.x, head.y, HEAD_RADIUS + 5);
    }

    // ── Eyes ──
    const a = p.angle;
    const perpX = -Math.sin(a);
    const perpY = Math.cos(a);
    const fwdX = Math.cos(a);
    const fwdY = Math.sin(a);

    // Eye whites
    g.fillStyle(0xffffff, 1);
    const eyeLX = head.x + fwdX * 3.5 + perpX * 4;
    const eyeLY = head.y + fwdY * 3.5 + perpY * 4;
    const eyeRX = head.x + fwdX * 3.5 - perpX * 4;
    const eyeRY = head.y + fwdY * 3.5 - perpY * 4;
    g.fillCircle(eyeLX, eyeLY, 3);
    g.fillCircle(eyeRX, eyeRY, 3);
    // Pupils — black, look slightly forward (slit-style for snake feel)
    g.fillStyle(0x000000, 1);
    const pupLX = head.x + fwdX * 4.5 + perpX * 4;
    const pupLY = head.y + fwdY * 4.5 + perpY * 4;
    const pupRX = head.x + fwdX * 4.5 - perpX * 4;
    const pupRY = head.y + fwdY * 4.5 - perpY * 4;
    g.fillCircle(pupLX, pupLY, 1.6);
    g.fillCircle(pupRX, pupRY, 1.6);
    // Catchlight — tiny white dot in upper-left of pupil for 'alive' feel.
    // Skipped on low tier to keep low-end perf snappy.
    if (this.qualityTier !== 'low') {
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(pupLX - 0.6, pupLY - 0.6, 0.55);
      g.fillCircle(pupRX - 0.6, pupRY - 0.6, 0.55);
      // Nostrils — two tiny dark dots near the front of the snout.
      g.fillStyle(this.darkenColor(bodyColor, 0.45), 0.85);
      const nostrilFwd = HEAD_RADIUS - 1.5;
      g.fillCircle(head.x + fwdX * nostrilFwd + perpX * 2, head.y + fwdY * nostrilFwd + perpY * 2, 0.9);
      g.fillCircle(head.x + fwdX * nostrilFwd - perpX * 2, head.y + fwdY * nostrilFwd - perpY * 2, 0.9);
    }

    // Tongue flicker — small red forked tongue that pulses on a cycle.
    // Cycle every ~1.6s, visible for 250ms. Uses player id for phase offset
    // so different snakes don't all flick simultaneously.
    // SKIPPED on low tier to save the strokePath() call per snake per frame.
    if (this.qualityTier !== 'low') {
      const phase = (p.id.charCodeAt(0) * 137) % 1600;
      const cyclePos = (performance.now() + phase) % 1600;
      if (cyclePos < 250) {
        const tongueLen = 9 + (cyclePos / 250) * 4; // extends as it flicks
        const tipX = head.x + fwdX * (HEAD_RADIUS + tongueLen);
        const tipY = head.y + fwdY * (HEAD_RADIUS + tongueLen);
        const baseX = head.x + fwdX * (HEAD_RADIUS + 2);
        const baseY = head.y + fwdY * (HEAD_RADIUS + 2);
        g.lineStyle(2, 0xd83a3a, 1);
        g.beginPath();
        g.moveTo(baseX, baseY);
        g.lineTo(tipX, tipY);
        // Forked tip
        g.moveTo(tipX, tipY);
        g.lineTo(tipX + perpX * 2.5 - fwdX * 2, tipY + perpY * 2.5 - fwdY * 2);
        g.moveTo(tipX, tipY);
        g.lineTo(tipX - perpX * 2.5 - fwdX * 2, tipY - perpY * 2.5 - fwdY * 2);
        g.strokePath();
      }
    }

    // Skin skill effects (boost trails, etc.) — disabled on low tier
    if (this.qualityTier !== 'low') {
      this.handleSkinEffects(p, skin);
    }

    // Labels: score above username above head.
    // Cull offscreen labels entirely — no point positioning/rendering text
    // that isn't visible. This saves a lot on crowded lobbies.
    const labelVisible = isMe || this.isOnScreen(head.x, head.y, 80);
    if (labelVisible) {
      const scoreStr = `$${p.score.toFixed(2)}`;
      if (scoreLabel.text !== scoreStr) {
        scoreLabel.setText(scoreStr);
      }
      scoreLabel.setPosition(head.x, head.y - 38);
      label.setPosition(head.x, head.y - 26);
      scoreLabel.setVisible(true);
      // Hide other players' name labels on mobile OR low tier — text clutter + perf cost.
      // Always show our own label.
      if (!isMe && (this.isMobile || this.qualityTier === 'low')) {
        label.setVisible(false);
      } else {
        label.setVisible(true);
      }
    } else {
      scoreLabel.setVisible(false);
      label.setVisible(false);
    }
  }

  private showKillNotification(victimName: string, lostAmount: number) {
    const safeName = victimName.length > 18 ? victimName.slice(0, 18) + '…' : victimName;
    const droppedLabel = this.translations.dropped || 'dropped';
    const bonus = lostAmount > 0 ? ` · +$${lostAmount.toFixed(2)} ${droppedLabel}` : '';
    const eliminatedLabel = this.translations.eliminated || 'ELIMINATED';
    this.killNotificationText.setText(`☠  ${eliminatedLabel} ${safeName}${bonus}`);
    this.killNotificationText.setX(this.scale.width / 2);
    this.killNotificationText.setAlpha(1);
    this.killNotificationText.setScale(0.85);

    if (this.killNotificationTween) this.killNotificationTween.stop();
    this.killNotificationTween = this.tweens.add({
      targets: this.killNotificationText,
      scale: { from: 1.15, to: 1 },
      duration: 300,
      ease: 'Back.out',
      onComplete: () => {
        this.tweens.add({
          targets: this.killNotificationText,
          alpha: 0,
          duration: 800,
          delay: 1400,
        });
      },
    });
  }

  /** Catmull-Rom spline interpolation through segment control points. */
  private buildSmoothPath(segments: Position[], steps: number): Position[] {
    if (segments.length === 0) return [];
    if (segments.length === 1) return [{ x: segments[0].x, y: segments[0].y }];

    const out: Position[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const p0 = segments[i - 1] || segments[i];
      const p1 = segments[i];
      const p2 = segments[i + 1];
      const p3 = segments[i + 2] || segments[i + 1];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (
          (2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        );
        const y = 0.5 * (
          (2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        );
        out.push({ x, y });
      }
    }
    const last = segments[segments.length - 1];
    out.push({ x: last.x, y: last.y });
    return out;
  }

  /** Multiply RGB color channels by a factor (< 1 darkens, > 1 brightens). */
  private darkenColor(color: number, factor: number): number {
    const r = Math.max(0, Math.min(255, Math.floor(((color >> 16) & 0xff) * factor)));
    const gC = Math.max(0, Math.min(255, Math.floor(((color >> 8) & 0xff) * factor)));
    const b = Math.max(0, Math.min(255, Math.floor((color & 0xff) * factor)));
    return (r << 16) | (gC << 8) | b;
  }

  /** Blend color toward white by `amount` in [0..1]. Used for sheen highlights. */
  private lightenColor(color: number, amount: number): number {
    const r = (color >> 16) & 0xff;
    const gC = (color >> 8) & 0xff;
    const b = color & 0xff;
    const lr = Math.min(255, Math.floor(r + (255 - r) * amount));
    const lg = Math.min(255, Math.floor(gC + (255 - gC) * amount));
    const lb = Math.min(255, Math.floor(b + (255 - b) * amount));
    return (lr << 16) | (lg << 8) | lb;
  }

  private handleSkinEffects(p: RemotePlayer, skin: { primary: number; secondary: number; glow: number } | null): void {
    if (!skin || !p.alive) return;

    const wasBoosting = this.lastBoostStates.get(p.id) || false;
    const isBoosting = p.boosted;

    // Per-skin signature boost effect. Each skin uses the same trail engine
    // but with its own color, particle count, size, and blend mode for a
    // distinct visual identity. Trails are drawn BEHIND the tail (in motion-
    // opposite direction) at depth 11 (above body) so they're always visible.
    if (isBoosting) {
      switch (p.skinId) {
        case 'inferno_drake':
          // Fiery embers: large additive orange/red puffs
          this.updateBoostTrails(p, 0xff5210, 0xffaa20, 8, 14, true);
          break;
        case 'neon_cyber':
          // Cyan ribbon trail
          this.updateBoostTrails(p, 0x00f0ff, 0x80ffff, 7, 12, true);
          break;
        case 'venom_serpent':
          // Toxic green poison drops
          this.updateBoostTrails(p, 0x39ff14, 0x0f3d0f, 6, 12, true);
          break;
        case 'frost_wyrm':
          // Icy crystal shards
          this.updateBoostTrails(p, 0xb8e6ff, 0x0ea5e9, 7, 11, true);
          break;
        case 'golden_emperor':
          // Gold sparkles
          this.updateBoostTrails(p, 0xffd700, 0xfff48c, 7, 12, true);
          break;
        case 'cyber_samurai':
          // Crimson slash streaks
          this.updateBoostTrails(p, 0xff5466, 0xffd6da, 6, 11, true);
          break;
        case 'void_shadow':
          // Purple smoke (shadow clones spawn separately on boost start)
          this.updateBoostTrails(p, 0x8b00ff, 0xc080ff, 7, 12, true);
          if (!wasBoosting && p.segments.length > 0) this.spawnShadowClones(p);
          break;
        default:
          // Generic glow trail for any unknown / un-styled skin
          this.updateBoostTrails(p, skin.glow, skin.primary, 5, 10, false);
      }
    }

    // Update boost state tracker
    this.lastBoostStates.set(p.id, isBoosting);

    // Clean up trails as soon as boost ends (no stale particles)
    if (!isBoosting && wasBoosting) {
      this.clearBoostTrails(p.id);
    }
  }

  /**
   * Render a visible particle trail BEHIND the snake's tail in the opposite
   * direction of motion. Trails are at depth 11 (above body, depth 10) so
   * they're always visible. Each particle fades with index. When `additive`
   * is true the trail uses additive blend for a glowy fire/neon look.
   *
   * @param p          remote player snapshot
   * @param colorCore  inner (smaller) particle color
   * @param colorGlow  outer (larger) glow color
   * @param count      number of particles in the trail
   * @param baseSize   radius of the largest particle in the trail (px)
   * @param additive   use ADD blend mode (good for fire/neon, bad for solid)
   */
  private updateBoostTrails(
    p: RemotePlayer,
    colorCore: number,
    colorGlow: number,
    count: number,
    baseSize: number,
    additive: boolean,
  ): void {
    const trails = this.playerBoostTrails.get(p.id) || [];
    if (p.segments.length < 2) return;

    // Compute the motion-opposite unit vector from the last two body segments.
    // This tells us which way is "behind" the tail right now.
    const tail = p.segments[p.segments.length - 1];
    const beforeTail = p.segments[p.segments.length - 2];
    let bx = tail.x - beforeTail.x;
    let by = tail.y - beforeTail.y;
    const blen = Math.hypot(bx, by) || 1;
    bx /= blen;
    by /= blen;

    // Slight perpendicular wobble so the trail looks lively, not rigid.
    const tNow = performance.now() / 1000;
    const wobble = Math.sin(tNow * 18 + (p.segments.length * 0.3)) * 4;
    const px = -by; // perpendicular
    const py = bx;

    for (let i = 0; i < count; i++) {
      let trail = trails[i];
      if (!trail) {
        trail = this.add.graphics().setDepth(11); // ABOVE snake body
        if (additive) trail.setBlendMode(Phaser.BlendModes.ADD);
        trails[i] = trail;
      }
      trail.clear();

      // Each particle steps further behind the tail.
      const step = 9 + i * 6;
      const wob = (i & 1) === 0 ? wobble : -wobble;
      const cx = tail.x + bx * step + px * wob * 0.3;
      const cy = tail.y + by * step + py * wob * 0.3;

      const fade = 1 - i / count; // 1 → 0
      const r = Math.max(2, baseSize - i * 1.3);

      // Outer glow
      trail.fillStyle(colorGlow, fade * 0.45);
      trail.fillCircle(cx, cy, r * 1.5);
      // Inner core
      trail.fillStyle(colorCore, fade * 0.85);
      trail.fillCircle(cx, cy, r);
    }

    this.playerBoostTrails.set(p.id, trails);
  }

  private clearBoostTrails(playerId: string): void {
    const trails = this.playerBoostTrails.get(playerId);
    if (trails) {
      trails.forEach(t => t.destroy());
      this.playerBoostTrails.delete(playerId);
    }
  }

  private clearShadowClones(playerId: string): void {
    const clones = this.playerCloneSprites.get(playerId);
    if (clones) {
      clones.forEach(c => { if (c.active) c.destroy(); });
      this.playerCloneSprites.delete(playerId);
    }
  }

  private spawnShadowClones(p: RemotePlayer): void {
    // Void Shadow: Spawn 2 ghost clones that fade away
    if (p.segments.length < 2) return;

    const clones = this.playerCloneSprites.get(p.id) || [];

    for (let i = 0; i < 2; i++) {
      const clone = this.add.graphics();
      const offset = (i + 1) * 20;
      const angle = p.angle + Math.PI;

      // Draw ghost snake
      clone.fillStyle(0x8b00ff, 0.3);
      p.segments.forEach((seg, idx) => {
        const cx = seg.x + Math.cos(angle) * offset + (Math.random() - 0.5) * 10;
        const cy = seg.y + Math.sin(angle) * offset + (Math.random() - 0.5) * 10;
        const radius = idx === 0 ? 9 : 7;
        clone.fillCircle(cx, cy, radius);
      });

      // Fade out and destroy
      this.tweens.add({
        targets: clone,
        alpha: 0,
        duration: 1500,
        onComplete: () => clone.destroy(),
      });

      clones.push(clone);
    }

    // Clean up old clones after delay
    setTimeout(() => {
      clones.forEach(c => { if (c.active) c.destroy(); });
      this.playerCloneSprites.delete(p.id);
    }, 1600);

    this.playerCloneSprites.set(p.id, clones);
  }

  private drawZoneOverlay(active: boolean) {
    this.zoneOverlay.clear();
    this.zoneWarningText.setVisible(active);
    if (!active) return;
    const w = this.scale.width;
    const h = this.scale.height;
    this.zoneOverlay.fillStyle(0x7f1d1d, 0.25); // red-900 at 25% opacity
    this.zoneOverlay.fillRect(0, 0, w, h);
    // Pulsing vignette border
    const pulse = 0.3 + Math.sin(Date.now() / 300) * 0.1;
    this.zoneOverlay.lineStyle(8, 0xef4444, pulse);
    this.zoneOverlay.strokeRect(0, 0, w, h);
  }

  /** Simple deterministic pseudo-random number from two integer seeds.
   *  Returns 0..1. Used for static ground texture placement so the arena
   *  looks the same every frame without storing random positions. */
  private seededRand(a: number, b: number): number {
    let h = (a * 2654435761 ^ b * 2246822519) >>> 0;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = ((h >> 16) ^ h) * 0x45d9f3b;
    h = (h >> 16) ^ h;
    return (h >>> 0) / 4294967296;
  }

  private drawArenaHexGround(
    g: Phaser.GameObjects.Graphics,
    pal: { bgDark: number; bgLight: number; detail: number },
    cx: number,
    cy: number,
    r: number,
  ): void {
    const hexR = this.qualityTier === 'low' ? 30 : this.qualityTier === 'mid' ? 26 : 23;
    const xStep = Math.sqrt(3) * hexR;
    const yStep = hexR * 1.5;
    const safeR = r - hexR * 0.9;
    const safeRSq = safeR * safeR;
    const lineAlpha = this.qualityTier === 'low' ? 0.22 : 0.34;

    g.lineStyle(1, pal.bgDark, lineAlpha);

    let row = 0;
    for (let y = cy - r - hexR; y <= cy + r + hexR; y += yStep) {
      const offsetX = (row & 1) ? xStep / 2 : 0;
      let col = 0;
      for (let x = cx - r - xStep; x <= cx + r + xStep; x += xStep) {
        const hx = x + offsetX;
        const hy = y;
        const dx = hx - cx;
        const dy = hy - cy;
        if (dx * dx + dy * dy > safeRSq) {
          col++;
          continue;
        }

        const shade = this.seededRand(row + 401, col + 709);
        const fillColor = shade > 0.56 ? pal.bgLight : pal.bgDark;
        const fillAlpha = shade > 0.56 ? 0.075 : 0.055;

        g.fillStyle(fillColor, fillAlpha);
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          const vx = hx + Math.cos(a) * hexR;
          const vy = hy + Math.sin(a) * hexR;
          if (i === 0) {
            g.moveTo(vx, vy);
          } else {
            g.lineTo(vx, vy);
          }
        }
        g.closePath();
        g.fillPath();
        g.strokePath();

        if (this.qualityTier !== 'low' && shade > 0.72) {
          g.fillStyle(pal.detail, 0.12);
          g.fillCircle(hx, hy, 1.6);
        }

        col++;
      }
      row++;
    }
  }

  private drawArena() {
    this.arenaGfx.clear();

    const cx = this.arenaCenterX;
    const cy = this.arenaCenterY;
    const r = this.arenaRadius;
    const rSq = r * r;
    const g = this.arenaGfx;

    // Theme palettes — rich colors for each biome
    const palettes = {
      grass: {
        bg: 0x2d7a3a,        // saturated meadow green
        bgDark: 0x1f5a28,    // dark grass for patches
        bgLight: 0x4ea85a,   // light grass highlight
        detail: 0x7ecf86,    // grass tuft highlight
        border: 0xa8f5b0,    // vivid green border
        danger: 0xef4444,
        rocks: 0x6b705c,     // small stone color
      },
      lava: {
        bg: 0x7a1a05,        // glowing molten rock
        bgDark: 0x4a0803,    // cooled rock
        bgLight: 0xb83a08,   // warm cracks
        detail: 0xff8a30,    // hot ember
        border: 0xffb050,    // glowing border
        danger: 0xffe040,
        rocks: 0x2a1205,
      },
      rock: {
        bg: 0x4a4d52,        // mid-tone stone
        bgDark: 0x35383c,    // dark stone
        bgLight: 0x62666c,   // lighter stone
        detail: 0x8a8d92,    // highlight
        border: 0xc8cad0,    // bright stone edge
        danger: 0xef4444,
        rocks: 0x72757a,
      },
      tile: {
        bg: 0x18465c,        // bright tech navy
        bgDark: 0x0e2e3e,    // dark panel
        bgLight: 0x2a7090,   // grid accent
        detail: 0x4ce0ff,    // bright cyan
        border: 0x66f0ff,    // luminous border
        danger: 0xff2e63,
        rocks: 0x14384a,
      },
    } as const;
    const pal = palettes[this.mapTheme];

    // ── Layer 0: Base fill ──────────────────────────────────────────
    g.fillStyle(pal.bg, 1);
    g.fillCircle(cx, cy, r);
    this.drawArenaHexGround(g, pal, cx, cy, r);

    // ── Layer 1: Large terrain patches (darker/lighter zones) ──────
    // Creates natural-looking variation across the ground
    const patchCount = 18;
    for (let i = 0; i < patchCount; i++) {
      const ang = this.seededRand(i, 7) * Math.PI * 2;
      const dist = this.seededRand(i, 13) * (r - 40);
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist;
      const patchR = 30 + this.seededRand(i, 19) * 50;
      const isDark = i % 3 === 0;
      g.fillStyle(isDark ? pal.bgDark : pal.bgLight, isDark ? 0.35 : 0.25);
      g.fillCircle(px, py, patchR);
    }

    // ── Layer 2: Theme-specific detail texture ─────────────────────
    if (this.mapTheme === 'grass') {
      // Dense grass tufts — scattered small circles with random sizes
      const step = 16;
      for (let x = cx - r; x <= cx + r; x += step) {
        for (let y = cy - r; y <= cy + r; y += step) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > rSq) continue;
          const s = this.seededRand(x, y);
          const ox = (s * 8) - 4;
          const oy = (this.seededRand(y, x) * 8) - 4;
          // Grass tuft — slightly lighter circles
          g.fillStyle(pal.bgLight, 0.3 + s * 0.3);
          g.fillCircle(x + ox, y + oy, 1.5 + s * 2);
        }
      }
      // Scattered rocks/pebbles on the grass
      for (let i = 0; i < 30; i++) {
        const a = this.seededRand(i, 41) * Math.PI * 2;
        const d = this.seededRand(i, 43) * (r - 20);
        const rx = cx + Math.cos(a) * d;
        const ry = cy + Math.sin(a) * d;
        g.fillStyle(pal.rocks, 0.5);
        g.fillCircle(rx, ry, 2 + this.seededRand(i, 47) * 3);
      }
      // Darker grass patches (shadows/thicker grass)
      for (let i = 0; i < 40; i++) {
        const a = this.seededRand(i, 53) * Math.PI * 2;
        const d = this.seededRand(i, 59) * (r - 15);
        const gx = cx + Math.cos(a) * d;
        const gy = cy + Math.sin(a) * d;
        g.fillStyle(pal.bgDark, 0.4);
        g.fillCircle(gx, gy, 4 + this.seededRand(i, 61) * 8);
      }
    } else if (this.mapTheme === 'lava') {
      // Cracked floor grid
      g.lineStyle(1.5, pal.bgLight, 0.4);
      const step = 55;
      for (let x = cx - r; x <= cx + r; x += step) {
        const dx = x - cx;
        const halfH = Math.sqrt(Math.max(0, rSq - dx * dx));
        if (halfH > 0) g.lineBetween(x, cy - halfH, x, cy + halfH);
      }
      for (let y = cy - r; y <= cy + r; y += step) {
        const dy = y - cy;
        const halfW = Math.sqrt(Math.max(0, rSq - dy * dy));
        if (halfW > 0) g.lineBetween(cx - halfW, y, cx + halfW, y);
      }
      // Hot cracks — irregular glowing lines
      for (let i = 0; i < 24; i++) {
        const a = this.seededRand(i, 71) * Math.PI * 2;
        const d = this.seededRand(i, 73) * (r - 20);
        const x0 = cx + Math.cos(a) * d;
        const y0 = cy + Math.sin(a) * d;
        const len = 10 + this.seededRand(i, 77) * 25;
        const ang2 = a + (this.seededRand(i, 79) - 0.5) * 1.5;
        g.lineStyle(2, pal.detail, 0.5);
        g.lineBetween(x0, y0, x0 + Math.cos(ang2) * len, y0 + Math.sin(ang2) * len);
      }
      // Ember dots
      for (let i = 0; i < 60; i++) {
        const a = this.seededRand(i, 81) * Math.PI * 2;
        const d = this.seededRand(i, 83) * (r - 10);
        g.fillStyle(pal.detail, 0.4 + this.seededRand(i, 85) * 0.4);
        g.fillCircle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + this.seededRand(i, 87) * 2);
      }
    } else if (this.mapTheme === 'rock') {
      // Stone tile grid with offset rows
      const step = 45;
      g.lineStyle(1.5, pal.bgDark, 0.6);
      for (let x = cx - r; x <= cx + r; x += step) {
        const dx = x - cx;
        const halfH = Math.sqrt(Math.max(0, rSq - dx * dx));
        if (halfH > 0) g.lineBetween(x, cy - halfH, x, cy + halfH);
      }
      for (let y = cy - r; y <= cy + r; y += step) {
        const dy = y - cy;
        const halfW = Math.sqrt(Math.max(0, rSq - dy * dy));
        if (halfW > 0) g.lineBetween(cx - halfW, y, cx + halfW, y);
      }
      // Stone surface variation — lighter patches within tiles
      for (let i = 0; i < 50; i++) {
        const a = this.seededRand(i, 91) * Math.PI * 2;
        const d = this.seededRand(i, 93) * (r - 15);
        g.fillStyle(pal.bgLight, 0.25);
        g.fillCircle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 6 + this.seededRand(i, 95) * 12);
      }
      // Crack lines
      for (let i = 0; i < 20; i++) {
        const a = this.seededRand(i, 97) * Math.PI * 2;
        const d = this.seededRand(i, 99) * (r - 25);
        const x0 = cx + Math.cos(a) * d;
        const y0 = cy + Math.sin(a) * d;
        const len = 8 + this.seededRand(i, 101) * 20;
        const ang2 = a + (this.seededRand(i, 103) - 0.5);
        g.lineStyle(1, pal.detail, 0.3);
        g.lineBetween(x0, y0, x0 + Math.cos(ang2) * len, y0 + Math.sin(ang2) * len);
      }
    } else {
      // tile / tech theme — hex grid pattern
      const step = 36;
      g.lineStyle(1, pal.bgLight, 0.5);
      for (let x = cx - r; x <= cx + r; x += step) {
        const dx = x - cx;
        const halfH = Math.sqrt(Math.max(0, rSq - dx * dx));
        if (halfH > 0) g.lineBetween(x, cy - halfH, x, cy + halfH);
      }
      for (let y = cy - r; y <= cy + r; y += step) {
        const dy = y - cy;
        const halfW = Math.sqrt(Math.max(0, rSq - dy * dy));
        if (halfW > 0) g.lineBetween(cx - halfW, y, cx + halfW, y);
      }
      // Glowing accent dots at grid intersections
      g.fillStyle(pal.detail, 0.4);
      for (let x = cx - r; x <= cx + r; x += step) {
        for (let y = cy - r; y <= cy + r; y += step) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > rSq) continue;
          g.fillCircle(x, y, 2);
          // Larger glow halo at every other intersection
          if (((x + y) | 0) % (step * 2) < step) {
            g.fillStyle(pal.detail, 0.15);
            g.fillCircle(x, y, 5);
            g.fillStyle(pal.detail, 0.4);
          }
        }
      }
      // Panel highlights
      for (let i = 0; i < 20; i++) {
        const a = this.seededRand(i, 111) * Math.PI * 2;
        const d = this.seededRand(i, 113) * (r - 20);
        g.fillStyle(pal.bgLight, 0.2);
        g.fillCircle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 8 + this.seededRand(i, 115) * 15);
      }
    }

    // ── Layer 3: Radial vignette — edges of arena appear slightly darker ──
    // Draw concentric rings with increasing opacity near the border
    for (let band = 0; band < 5; band++) {
      const bandR = r - band * 4;
      const alpha = 0.03 + band * 0.04;
      g.lineStyle(8, 0x000000, alpha);
      g.strokeCircle(cx, cy, bandR);
    }

    // ── Arena border (theme-tinted, thick double-ring) ─────────────
    g.lineStyle(5, pal.border, 0.7);
    g.strokeCircle(cx, cy, r);
    g.lineStyle(2, pal.border, 0.4);
    g.strokeCircle(cx, cy, r - 6);

    // Inner danger ring
    g.lineStyle(1, pal.danger, 0.18);
    g.strokeCircle(cx, cy, r - 2);
  }

  /**
   * Rich per-theme animated overlay drawn every frame on top of the static
   * arena. Each theme has distinct moving elements (lava flow, fireflies,
   * dust motes, circuit pulses) so the ground always feels alive. Particle
   * counts and wave-frequencies are tuned for visibility without GPU strain.
   * Skipped on low-tier; throttled to every 2nd frame on mid-tier (handled
   * upstream in update()).
   */
  private drawArenaAnim(now: number) {
    if (!this.arenaAnimGfx) return;
    this.arenaAnimGfx.clear();
    const cx = this.arenaCenterX;
    const cy = this.arenaCenterY;
    const r = this.arenaRadius;
    const tSec = now / 1000;
    const g = this.arenaAnimGfx;

    // Particle counts scale with quality tier: high=full, mid=50%.
    // Low tier never calls this function (skipped in update()).
    const tierFactor = this.qualityTier === 'high' ? 1 : 0.5;

    if (this.mapTheme === 'lava') {
      // ── LAVA: flowing molten cells + rising embers + pulsing glow ──────
      // Two pulsing inner rings — outer slow, inner fast
      const pulseOuter = 0.5 + 0.4 * Math.sin(tSec * 1.4);
      g.lineStyle(8, 0xff3010, pulseOuter * 0.45);
      g.strokeCircle(cx, cy, r - 4);
      const pulseInner = 0.5 + 0.4 * Math.sin(tSec * 2.6);
      g.lineStyle(4, 0xff8030, pulseInner * 0.35);
      g.strokeCircle(cx, cy, r - 14);

      // Rising ember particles — deterministic so they're stable across frames
      const emberCount = Math.floor(28 * tierFactor);
      for (let i = 0; i < emberCount; i++) {
        // Each ember has its own seed: angle, radius, vertical offset, speed
        const seed = i * 137.508; // golden-angle distribution
        const ang = seed % (Math.PI * 2);
        const baseRad = (i % 7) / 7 * (r - 30);
        const lifeT = ((tSec * 0.6 + i * 0.3) % 2.5) / 2.5; // 0..1 loop
        const rise = lifeT * 60; // upward motion in pixels
        const emberR = baseRad + rise * 0.2;
        if (emberR > r - 5) continue;
        const ex = cx + Math.cos(ang) * emberR;
        const ey = cy + Math.sin(ang) * emberR - rise;
        const fade = (1 - lifeT) * 0.85;
        const size = 2 + (1 - lifeT) * 2;
        g.fillStyle(0xffaa20, fade * 0.6);
        g.fillCircle(ex, ey, size * 1.6);
        g.fillStyle(0xff5010, fade);
        g.fillCircle(ex, ey, size);
      }

      // Animated cracked-floor flow: faint glowing arcs that sweep slowly
      const arcAng = (tSec * 0.3) % (Math.PI * 2);
      g.lineStyle(2, 0xff6020, 0.35);
      g.beginPath();
      g.arc(cx, cy, r * 0.55, arcAng, arcAng + Math.PI * 0.4, false);
      g.strokePath();
      g.lineStyle(1.5, 0xff9040, 0.25);
      g.beginPath();
      g.arc(cx, cy, r * 0.78, arcAng + Math.PI, arcAng + Math.PI + Math.PI * 0.3, false);
      g.strokePath();

    } else if (this.mapTheme === 'grass') {
      // ── GRASS: drifting fireflies + wind ripple + soft pulse ────────────
      // Border breathing pulse
      const pulseBorder = 0.5 + 0.35 * Math.sin(tSec * 1.2);
      g.lineStyle(3, 0x6cff8c, pulseBorder * 0.4);
      g.strokeCircle(cx, cy, r - 2);

      // Wind ripple — expanding ring that loops
      const rippleT = (tSec * 0.5) % 1;
      const rippleR = rippleT * r;
      g.lineStyle(2, 0x88ee88, (1 - rippleT) * 0.35);
      g.strokeCircle(cx, cy, rippleR);

      // Fireflies — drifting glowing dots
      const flyCount = Math.floor(22 * tierFactor);
      for (let i = 0; i < flyCount; i++) {
        const seed = i * 73.91;
        const baseAng = (seed % (Math.PI * 2));
        const baseRad = ((i * 41) % 100) / 100 * (r - 30);
        // Drift in a slow circular orbit + small wave
        const driftAng = baseAng + tSec * 0.15 * (i % 2 === 0 ? 1 : -1);
        const wobble = Math.sin(tSec * 1.8 + i) * 4;
        const fx = cx + Math.cos(driftAng) * baseRad + wobble;
        const fy = cy + Math.sin(driftAng) * baseRad + Math.cos(tSec * 1.5 + i) * 4;
        // Twinkle
        const blink = 0.5 + 0.5 * Math.sin(tSec * 3 + i * 0.7);
        g.fillStyle(0xfff58a, blink * 0.55);
        g.fillCircle(fx, fy, 3.2);
        g.fillStyle(0xffff60, blink * 0.85);
        g.fillCircle(fx, fy, 1.4);
      }

    } else if (this.mapTheme === 'rock') {
      // ── ROCK: drifting dust motes + occasional sparkles + shimmer ──────
      // Subtle border pulse
      const pulse = 0.4 + 0.25 * Math.sin(tSec * 0.7);
      g.lineStyle(2, 0xa8aab0, pulse * 0.35);
      g.strokeCircle(cx, cy, r - 2);

      // Drifting dust motes
      const dustCount = Math.floor(30 * tierFactor);
      for (let i = 0; i < dustCount; i++) {
        const seed = i * 91.7;
        const baseAng = (seed % (Math.PI * 2));
        const baseRad = ((i * 23) % 100) / 100 * (r - 30);
        const drift = tSec * 0.25 * (i % 2 === 0 ? 1 : -1);
        const ang = baseAng + drift;
        const wob = Math.sin(tSec * 0.8 + i * 0.5) * 3;
        const dx = cx + Math.cos(ang) * baseRad;
        const dy = cy + Math.sin(ang) * baseRad + wob;
        const fade = 0.3 + 0.2 * Math.sin(tSec * 1.2 + i);
        g.fillStyle(0xc8cad0, fade);
        g.fillCircle(dx, dy, 1.3);
      }

      // Occasional sparkle stars (twinkle in/out)
      const sparkleCount = Math.floor(8 * tierFactor);
      for (let i = 0; i < sparkleCount; i++) {
        const seed = i * 211.4;
        const ang = seed % (Math.PI * 2);
        const rad = ((i * 53) % 100) / 100 * (r - 40);
        const blink = Math.max(0, Math.sin(tSec * 1.5 + i * 0.9));
        if (blink < 0.6) continue;
        const sx = cx + Math.cos(ang) * rad;
        const sy = cy + Math.sin(ang) * rad;
        const intensity = (blink - 0.6) * 2.5;
        g.fillStyle(0xfff8e0, intensity * 0.7);
        g.fillCircle(sx, sy, 2.5);
        g.lineStyle(1, 0xfff8e0, intensity * 0.5);
        g.lineBetween(sx - 5, sy, sx + 5, sy);
        g.lineBetween(sx, sy - 5, sx, sy + 5);
      }

    } else {
      // ── TILE (cyber): circuit pulses + energy ring + accent dots ───────
      // Sweeping cyan ring
      const ringR = (r * 0.35) + (r * 0.55) * (0.5 + 0.5 * Math.sin(tSec * 0.7));
      g.lineStyle(2, 0x00d8ff, 0.4);
      g.strokeCircle(cx, cy, ringR);

      // Counter-rotating accent ring
      const ring2R = (r * 0.25) + (r * 0.45) * (0.5 + 0.5 * Math.cos(tSec * 0.5));
      g.lineStyle(1.5, 0x33eaff, 0.3);
      g.strokeCircle(cx, cy, ring2R);

      // Pulsing accent dots at orbital positions
      const dotCount = Math.floor(12 * tierFactor);
      for (let i = 0; i < dotCount; i++) {
        const ang = (i / dotCount) * Math.PI * 2 + tSec * 0.2;
        const rad = r * 0.85;
        const dx = cx + Math.cos(ang) * rad;
        const dy = cy + Math.sin(ang) * rad;
        const blink = 0.5 + 0.5 * Math.sin(tSec * 4 + i * 0.5);
        g.fillStyle(0x2cc8ff, blink * 0.7);
        g.fillCircle(dx, dy, 2.5);
      }

      // Border breathing
      const borderPulse = 0.6 + 0.3 * Math.sin(tSec * 2);
      g.lineStyle(2, 0x33eaff, borderPulse * 0.4);
      g.strokeCircle(cx, cy, r);
    }
  }

  private colorFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [0xef4444, 0xf97316, 0xeab308, 0x14b8a6, 0x3b82f6, 0xa855f7, 0xec4899, 0x06b6d4];
    return colors[Math.abs(hash) % colors.length];
  }

  shutdown() {
    if (this.ws) this.ws.close();
  }
}
