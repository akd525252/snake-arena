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
}

interface FoodItem {
  id: string;
  position: Position;
  size: 'small' | 'large';
  colorIndex: number;
}

interface GameStateMessage {
  type: 'game_state';
  state: {
    players: RemotePlayer[];
    coins: { id: string; position: Position; isTrap: boolean }[];
    food: FoodItem[];
    arena: { centerX: number; centerY: number; radius: number };
    timeRemaining: number;
  };
}

export class GameScene extends Phaser.Scene {
  private ws: WebSocket | null = null;
  private myPlayerId: string = '';

  // Visual containers
  private playerGraphics = new Map<string, Phaser.GameObjects.Graphics>();
  private playerLabels = new Map<string, Phaser.GameObjects.Text>();
  private playerScoreLabels = new Map<string, Phaser.GameObjects.Text>();
  private coinSprites = new Map<string, Phaser.GameObjects.Arc>();
  private foodSprites = new Map<string, Phaser.GameObjects.Arc>();

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

  // Snake interpolation: server ticks at 50ms (20Hz) but we render at 60fps.
  // To avoid jitter we keep prev+curr positions per player and lerp each frame.
  private readonly SERVER_TICK_MS = 50;
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
  }>();

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

  // Mobile controls
  private isMobile = false;
  private joystickOrigin: Position | null = null;
  private joystickCurrent: Position | null = null;
  private joystickActive = false;
  private joystickGraphics!: Phaser.GameObjects.Graphics;
  private mobileBoostBtn!: Phaser.GameObjects.Container;
  private mobileTrapBtn!: Phaser.GameObjects.Container;
  private touchId: number | null = null;

  // Skin effects
  private playerBoostTrails = new Map<string, Phaser.GameObjects.Graphics[]>();
  private playerCloneSprites = new Map<string, Phaser.GameObjects.Graphics[]>();
  private lastBoostStates = new Map<string, boolean>();

  // Skin definitions
  private readonly SKIN_COLORS: Record<string, { primary: number; secondary: number; glow: number }> = {
    neon_cyber: { primary: 0x00f0ff, secondary: 0xff00a0, glow: 0x00f0ff },
    inferno_drake: { primary: 0xff4500, secondary: 0xff8c00, glow: 0xff4500 },
    void_shadow: { primary: 0x4a2080, secondary: 0x8b00ff, glow: 0x8b00ff },
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
  }) {
    if (!data || !data.wsUrl) return;

    this.onGameEnd = data.onGameEnd || null;
    this.onConnectionStatus = data.onConnectionStatus || null;
    this.onMyDeath = data.onMyDeath || null;
    this.onScoreChange = data.onScoreChange || null;
    this.onTimeUpdate = data.onTimeUpdate || null;
    this.onQueueState = data.onQueueState || null;
    this.onMatchStart = data.onMatchStart || null;
    this.onGameBegin = data.onGameBegin || null;

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
      // Phaser auto-uses devicePixelRatio; clamp it on low-end
      const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
      if (renderer && 'resolution' in renderer) {
        // Best effort — reduce internal canvas resolution
        const targetDPR = this.qualityTier === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
        try { (renderer as unknown as { resolution: number }).resolution = targetDPR; } catch { /* noop */ }
      }
    }

    // Arena background — random map theme each match
    const themes: ('grass' | 'lava' | 'rock' | 'tile')[] = ['grass', 'lava', 'rock', 'tile'];
    this.mapTheme = themes[Math.floor(Math.random() * themes.length)];
    this.arenaGfx = this.add.graphics();
    this.arenaGfx.setDepth(-10);
    this.arenaAnimGfx = this.add.graphics();
    this.arenaAnimGfx.setDepth(-9);
    this.drawArena();
    this.applyThemeCameraBg();

    // Zone danger overlay (full-screen red tint when outside arena)
    this.zoneOverlay = this.add.graphics();
    this.zoneOverlay.setScrollFactor(0).setDepth(99);
    this.zoneWarningText = this.add.text(this.scale.width / 2, this.scale.height * 0.15, 'DANGER ZONE — RETURN!', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '14px' : '18px',
      color: '#ef4444',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setVisible(false);

    // HUD
    this.scoreText = this.add.text(16, 16, 'Score: $0.00', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '16px' : '20px',
      color: this.isDemo ? '#f59e0b' : '#10b981',
      fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(100);

    // Timer capsule at top center
    const screenCenterX = this.scale.width / 2;
    this.timerCapsule = this.add.graphics();
    this.timerCapsule.fillStyle(0x27272a, 0.95); // zinc-800
    this.timerCapsule.fillRoundedRect(screenCenterX - 60, 12, 120, 36, 18);
    this.timerCapsule.lineStyle(2, 0x3f3f46, 1); // zinc-700 border
    this.timerCapsule.strokeRoundedRect(screenCenterX - 60, 12, 120, 36, 18);
    this.timerCapsule.setScrollFactor(0).setDepth(100);

    this.timeText = this.add.text(screenCenterX, 30, '3:00', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(101);

    this.statusText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Connecting...', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#a1a1aa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100);

    this.leaderboardText = this.add.text(this.scale.width - 16, 16, '', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '11px' : '13px',
      color: '#a1a1aa',
      align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    this.aliveText = this.add.text(16, 72, 'Alive: 0', {
      fontFamily: 'monospace',
      fontSize: this.isMobile ? '12px' : '14px',
      color: '#71717a',
    }).setScrollFactor(0).setDepth(100);

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

    // Camera — zoom in so snake is larger on screen.
    // Lower zoom on low-tier so fewer pixels need to be re-rendered each frame.
    this.cameras.main.setBackgroundColor('#0a0a0a');
    const baseZoom = this.isMobile ? 1.2 : 1.6;
    const zoomScale = this.qualityTier === 'low' ? 0.85 : this.qualityTier === 'mid' ? 0.95 : 1;
    this.cameras.main.setZoom(baseZoom * zoomScale);
    // Pixel-perfect rendering kills sub-pixel shimmer when camera moves
    this.cameras.main.setRoundPixels(true);
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

    // Heuristic: low-end mobile = ≤4 cores OR ≤2GB RAM
    // mid: any mobile, or low-spec desktop (≤4 cores)
    // high: desktop ≥6 cores
    if (isMobile && (cores <= 4 || mem <= 2)) {
      this.qualityTier = 'low';
    } else if (isMobile || cores <= 4) {
      this.qualityTier = 'mid';
    } else {
      this.qualityTier = 'high';
    }

    // Allow URL override for testing: ?quality=low|mid|high
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('quality');
      if (q === 'low' || q === 'mid' || q === 'high') {
        this.qualityTier = q;
      }
    } catch { /* noop */ }

    // eslint-disable-next-line no-console
    console.info(`[GameScene] Quality tier: ${this.qualityTier} (cores=${cores}, mem=${mem}GB, dpr=${dpr.toFixed(1)}, mobile=${isMobile})`);
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
      if (pointer.x > w * 0.5) return; // right half reserved for buttons
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

    // Boost button (right side bottom)
    const btnRadius = 36;
    const boostX = w - btnRadius * 2.5;
    const boostY = h - btnRadius * 2;
    this.mobileBoostBtn = this.createMobileButton(
      boostX, boostY, btnRadius, 'BOOST', 0x00f0ff,
      () => this.send({ type: 'boost_start' }),
      () => this.send({ type: 'boost_end' }),
    );

    // Trap button (right side above boost)
    const trapX = w - btnRadius * 2.5;
    const trapY = h - btnRadius * 5;
    this.mobileTrapBtn = this.createMobileButton(trapX, trapY, btnRadius, 'TRAP', 0xff2e63, () => {
      this.send({ type: 'skill_use', skill: 'trap' });
    });
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
    const text = this.add.text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
    }).setOrigin(0.5);
    container.add([circle, text]);

    // Hit area for touch
    const zone = this.add.zone(x, y, r * 2, r * 2).setScrollFactor(0).setDepth(201);
    zone.setInteractive();
    zone.on('pointerdown', () => {
      circle.clear();
      circle.fillStyle(color, 0.5);
      circle.fillCircle(0, 0, r);
      circle.lineStyle(2, color, 1);
      circle.strokeCircle(0, 0, r);
      onDown();
    });
    zone.on('pointerup', () => {
      circle.clear();
      circle.fillStyle(color, 0.25);
      circle.fillCircle(0, 0, r);
      circle.lineStyle(2, color, 0.8);
      circle.strokeCircle(0, 0, r);
      if (onUp) onUp();
    });
    zone.on('pointerout', () => {
      circle.clear();
      circle.fillStyle(color, 0.25);
      circle.fillCircle(0, 0, r);
      circle.lineStyle(2, color, 0.8);
      circle.strokeCircle(0, 0, r);
      if (onUp) onUp();
    });

    return container;
  }

  update() {
    this.frameCount++;

    // Animated arena overlay — expensive on low-end. Skip entirely on low tier;
    // throttle to every 2nd frame on mid tier; full 60fps on high.
    if (this.qualityTier === 'high') {
      this.drawArenaAnim(performance.now());
    } else if (this.qualityTier === 'mid' && (this.frameCount & 1) === 0) {
      this.drawArenaAnim(performance.now());
    }
    // low: no arena animation

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
    let t = 1;
    if (this.lastServerStateTime > 0) {
      t = (performance.now() - this.lastServerStateTime) / this.serverInterval;
      t = Math.max(0, Math.min(1, t));
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
        // Smaller lerp factor + sub-pixel rounding for jitter-free camera
        this.cameraSmooth.x += (camTarget.x - this.cameraSmooth.x) * 0.18;
        this.cameraSmooth.y += (camTarget.y - this.cameraSmooth.y) * 0.18;
      }
      // Round to integer pixels to eliminate sub-pixel shimmering
      this.cameras.main.centerOn(
        Math.round(this.cameraSmooth.x),
        Math.round(this.cameraSmooth.y),
      );
    }
  }

  /** Set Phaser camera background to a darker variant of the current theme. */
  private applyThemeCameraBg() {
    const themeBgs = {
      grass: '#0a1f10',
      lava: '#150300',
      rock: '#0f1012',
      tile: '#02080d',
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
    // Server is authoritative for demo vs pro (reads user.game_mode from DB).
    // We only need to authenticate via token.
    const params = new URLSearchParams();
    if (token) params.set('token', token);

    const fullUrl = `${wsUrl}?${params.toString()}`;
    this.ws = new WebSocket(fullUrl);

    this.ws.onopen = () => {
      this.onConnectionStatus?.('connected');
      this.statusText.setText('Joining queue...');
      this.send({ type: 'join_queue', betAmount });
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
      this.onConnectionStatus?.('error');
      this.statusText.setText('Connection error');
    };

    this.ws.onclose = () => {
      this.onConnectionStatus?.('disconnected');
    };
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
        this.statusText.setText(`In queue (${msg.position} / ${msg.minPlayers ?? 2} needed)`);
        break;

      case 'queue_state': {
        const data = msg as unknown as {
          players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[];
          minPlayers: number;
          maxPlayers: number;
          elapsedSeconds?: number;
        };
        this.statusText.setText(`Finding match... ${data.players.length}/${data.minPlayers}`);
        this.onQueueState?.(data);
        break;
      }

      case 'match_starting': {
        const data = msg as unknown as {
          matchId: string;
          players: { id: string; username: string; avatar: string | null; skinId: string | null }[];
        };
        this.statusText.setText('Match starting...');
        this.onMatchStart?.(data);
        break;
      }

      case 'game_start':
        this.statusText.setText('');
        this.onGameBegin?.();
        break;

      case 'game_state':
        this.renderGameState((msg as unknown as GameStateMessage).state);
        break;

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
          const victimName = (this.playerInterp.get(msg.playerId as string)?.username) || 'Enemy';
          const lost = (msg.lostAmount as number) ?? 0;
          this.showKillNotification(victimName, lost);
          this.sfx.kill();
        }
        break;

      case 'game_end': {
        const results = (msg as unknown as { results: { username: string; score: number; placement: number }[] }).results;
        this.statusText.setText('Game Over');
        this.onGameEnd?.(results);
        if (this.ws) this.ws.close();
        break;
      }

      case 'error':
        this.statusText.setText(`Error: ${msg.message}`);
        break;
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
      this.arenaCenterX = state.arena.centerX;
      this.arenaCenterY = state.arena.centerY;
      this.arenaRadius = state.arena.radius;
      this.drawArena();
    }

    // Track real server tick interval — adapt interp duration if server lags
    const now = performance.now();
    if (this.lastServerStateTime > 0) {
      const delta = now - this.lastServerStateTime;
      // Smooth between bursts; clamp to a sane range
      this.serverInterval = Math.max(40, Math.min(120, delta));
    }
    this.lastServerStateTime = now;

    // Update timer
    const seconds = Math.ceil(state.timeRemaining / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    this.timeText.setText(`${m}:${s.toString().padStart(2, '0')}`);
    if (seconds <= 10 && seconds > 0) {
      this.timeText.setColor('#ef4444');
    } else {
      this.timeText.setColor('#ffffff');
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

    // Reposition mute button in case of resize
    this.muteBtn.setPosition(this.scale.width - 16, this.scale.height - 16);

    const aliveCount = state.players.filter(p => p.alive).length;
    this.aliveText.setText(`Alive: ${aliveCount}/${state.players.length}`);

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
      this.scoreText.setText(`Score: $${me.score.toFixed(2)}`);
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

    // Update coins
    const seenCoins = new Set<string>();
    for (const c of state.coins) {
      seenCoins.add(c.id);
      if (!this.coinSprites.has(c.id)) {
        const coin = this.add.circle(c.position.x, c.position.y, 8, 0xfbbf24)
          .setStrokeStyle(2, 0xf59e0b)
          .setDepth(5);
        this.coinSprites.set(c.id, coin);
      } else {
        this.coinSprites.get(c.id)!.setPosition(c.position.x, c.position.y);
      }
    }
    for (const id of this.coinSprites.keys()) {
      if (!seenCoins.has(id)) {
        this.coinSprites.get(id)?.destroy();
        this.coinSprites.delete(id);
      }
    }

    // Update food pellets
    const seenFood = new Set<string>();
    const foodColors = [0x22c55e, 0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0xf97316]; // green, red, blue, yellow, purple, orange
    for (const f of state.food) {
      seenFood.add(f.id);
      const radius = f.size === 'large' ? 5 : 3;
      const color = foodColors[f.colorIndex % foodColors.length];
      if (!this.foodSprites.has(f.id)) {
        const pellet = this.add.circle(f.position.x, f.position.y, radius, color)
          .setDepth(4);
        this.foodSprites.set(f.id, pellet);
      } else {
        const sp = this.foodSprites.get(f.id)!;
        sp.setPosition(f.position.x, f.position.y);
        sp.setRadius(radius);
        sp.fillColor = color;
      }
    }
    for (const id of this.foodSprites.keys()) {
      if (!seenFood.has(id)) {
        this.foodSprites.get(id)?.destroy();
        this.foodSprites.delete(id);
      }
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

    // ── Build path through segments. On low/mid tier we use fewer subdivisions
    //    to massively cut the number of fillCircle calls per frame.
    //    high: 4 steps (smoothest), mid: 2 steps, low: 0 steps (raw segments).
    const subdivSteps = this.qualityTier === 'high' ? 4 : this.qualityTier === 'mid' ? 2 : 0;
    const dense = subdivSteps > 0
      ? this.buildSmoothPath(p.segments, subdivSteps)
      : p.segments;
    const len = dense.length;

    // Body radius tapers from head (large) to tail (small) — snake.io style
    const HEAD_RADIUS = 11;
    const TAIL_RADIUS = 5;

    // Pass 0: drop shadow under body for depth — SKIP on low tier (saves 1 fillCircle per segment)
    if (this.qualityTier !== 'low') {
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

    // ── Eyes ──
    const a = p.angle;
    const perpX = -Math.sin(a);
    const perpY = Math.cos(a);
    const fwdX = Math.cos(a);
    const fwdY = Math.sin(a);

    // Eye whites
    g.fillStyle(0xffffff, 1);
    g.fillCircle(head.x + fwdX * 3.5 + perpX * 4, head.y + fwdY * 3.5 + perpY * 4, 3);
    g.fillCircle(head.x + fwdX * 3.5 - perpX * 4, head.y + fwdY * 3.5 - perpY * 4, 3);
    // Pupils — black, look slightly forward
    g.fillStyle(0x000000, 1);
    g.fillCircle(head.x + fwdX * 4.5 + perpX * 4, head.y + fwdY * 4.5 + perpY * 4, 1.4);
    g.fillCircle(head.x + fwdX * 4.5 - perpX * 4, head.y + fwdY * 4.5 - perpY * 4, 1.4);

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

    // Labels: score above username above head
    scoreLabel.setText(`$${p.score.toFixed(2)}`);
    scoreLabel.setPosition(head.x, head.y - 38);
    label.setPosition(head.x, head.y - 26);
  }

  private showKillNotification(victimName: string, lostAmount: number) {
    const safeName = victimName.length > 18 ? victimName.slice(0, 18) + '…' : victimName;
    const bonus = lostAmount > 0 ? ` · +$${lostAmount.toFixed(2)} dropped` : '';
    this.killNotificationText.setText(`☠  ELIMINATED ${safeName}${bonus}`);
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

  private handleSkinEffects(p: RemotePlayer, skin: { primary: number; secondary: number; glow: number } | null): void {
    if (!skin || !p.alive) return;

    const wasBoosting = this.lastBoostStates.get(p.id) || false;
    const isBoosting = p.boosted;

    // Neon Cyber: Longer neon trail when boosting
    if (p.skinId === 'neon_cyber' && isBoosting) {
      this.updateBoostTrails(p, skin.glow, 5); // 5 trail segments
    }

    // Inferno Drake: Fire particles when boosting
    if (p.skinId === 'inferno_drake' && isBoosting) {
      this.updateBoostTrails(p, 0xff4500, 6); // Bigger fire trail
    }

    // Void Shadow: Shadow clones when boosting starts
    if (p.skinId === 'void_shadow' && isBoosting && !wasBoosting && p.segments.length > 0) {
      this.spawnShadowClones(p);
    }

    // Update boost state for next frame
    this.lastBoostStates.set(p.id, isBoosting);

    // Clean up trails when not boosting (except inferno which fades naturally)
    if (!isBoosting && p.skinId !== 'inferno_drake') {
      this.clearBoostTrails(p.id);
    }
  }

  private updateBoostTrails(p: RemotePlayer, color: number, count: number): void {
    const trails = this.playerBoostTrails.get(p.id) || [];
    if (p.segments.length === 0) return;

    // Trails ride along the snake's actual body so they curve with it.
    for (let i = 0; i < count; i++) {
      let trail = trails[i];
      if (!trail) {
        trail = this.add.graphics().setDepth(9); // just behind snake body
        trails[i] = trail;
      }
      trail.clear();

      // Pick a body segment proportional to trail index (skipping the head)
      const segIdx = Math.min(
        p.segments.length - 1,
        Math.max(1, Math.floor(1 + i * 1.4)),
      );
      const seg = p.segments[segIdx];
      const alpha = 1 - i / count;
      trail.fillStyle(color, alpha * 0.7);
      trail.fillCircle(seg.x, seg.y, 9 - i * 0.6);
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

  private drawArena() {
    this.arenaGfx.clear();

    const cx = this.arenaCenterX;
    const cy = this.arenaCenterY;
    const r = this.arenaRadius;

    // Theme palettes — brightened for clear visibility against dark camera bg
    const palettes = {
      grass: {
        bg: 0x1f5a2c,        // brighter forest green
        gridA: 0x2f8040,     // grass clump highlight
        gridB: 0x4cb364,     // lighter grass
        border: 0x88ee88,    // vivid green border
        danger: 0xef4444,
      },
      lava: {
        bg: 0x4a0a00,        // deep red lava base
        gridA: 0x822000,     // crack lines
        gridB: 0xff6010,     // hot ember color
        border: 0xff8030,    // glowing border
        danger: 0xffd000,
      },
      rock: {
        bg: 0x2c2d31,        // medium gray stone
        gridA: 0x4a4d52,     // tile grout
        gridB: 0x6a6d72,     // highlight
        border: 0xa8aab0,    // bright stone edge
        danger: 0xef4444,
      },
      tile: {
        bg: 0x0a2030,        // deeper navy
        gridA: 0x144a6a,     // visible grid
        gridB: 0x2cc8ff,     // bright cyan dots
        border: 0x33eaff,    // luminous border
        danger: 0xff2e63,
      },
    } as const;
    const pal = palettes[this.mapTheme];

    // Background fill
    this.arenaGfx.fillStyle(pal.bg, 1);
    this.arenaGfx.fillCircle(cx, cy, r);

    // Theme-specific pattern
    if (this.mapTheme === 'grass') {
      // Soft dotted/cell pattern resembling tall grass clumps
      this.arenaGfx.fillStyle(pal.gridA, 0.55);
      const step = 28;
      for (let x = cx - r; x <= cx + r; x += step) {
        for (let y = cy - r; y <= cy + r; y += step) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > r * r) continue;
          // Tiny pseudo-random offset
          const ox = ((x * 13 + y * 7) % 9) - 4;
          const oy = ((x * 5 + y * 17) % 9) - 4;
          this.arenaGfx.fillCircle(x + ox, y + oy, 2.2);
        }
      }
    } else if (this.mapTheme === 'lava') {
      // Cracked floor — irregular polygonal cells
      this.arenaGfx.lineStyle(1, pal.gridA, 0.5);
      const step = 60;
      for (let x = cx - r; x <= cx + r; x += step) {
        const dx = x - cx;
        const halfH = Math.sqrt(Math.max(0, r * r - dx * dx));
        if (halfH > 0) this.arenaGfx.lineBetween(x, cy - halfH, x, cy + halfH);
      }
      for (let y = cy - r; y <= cy + r; y += step) {
        const dy = y - cy;
        const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
        if (halfW > 0) this.arenaGfx.lineBetween(cx - halfW, y, cx + halfW, y);
      }
      // Hot ember dots
      this.arenaGfx.fillStyle(pal.gridB, 0.7);
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * (r - 12);
        this.arenaGfx.fillCircle(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 1.8);
      }
    } else if (this.mapTheme === 'rock') {
      // Stone tile grid
      this.arenaGfx.lineStyle(1, pal.gridA, 0.5);
      const step = 50;
      for (let x = cx - r; x <= cx + r; x += step) {
        const dx = x - cx;
        const halfH = Math.sqrt(Math.max(0, r * r - dx * dx));
        if (halfH > 0) this.arenaGfx.lineBetween(x, cy - halfH, x, cy + halfH);
      }
      for (let y = cy - r; y <= cy + r; y += step) {
        const dy = y - cy;
        const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
        if (halfW > 0) this.arenaGfx.lineBetween(cx - halfW, y, cx + halfW, y);
      }
      // Cracked highlights
      this.arenaGfx.lineStyle(1, pal.gridB, 0.4);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * (r - 30);
        const x0 = cx + Math.cos(a) * rad;
        const y0 = cy + Math.sin(a) * rad;
        const len = 8 + Math.random() * 18;
        const ang2 = a + (Math.random() - 0.5) * 1.2;
        this.arenaGfx.lineBetween(x0, y0, x0 + Math.cos(ang2) * len, y0 + Math.sin(ang2) * len);
      }
    } else {
      // tile theme — futuristic hex/grid
      this.arenaGfx.lineStyle(1, pal.gridA, 0.6);
      const step = 40;
      for (let x = cx - r; x <= cx + r; x += step) {
        const dx = x - cx;
        const halfH = Math.sqrt(Math.max(0, r * r - dx * dx));
        if (halfH > 0) this.arenaGfx.lineBetween(x, cy - halfH, x, cy + halfH);
      }
      for (let y = cy - r; y <= cy + r; y += step) {
        const dy = y - cy;
        const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
        if (halfW > 0) this.arenaGfx.lineBetween(cx - halfW, y, cx + halfW, y);
      }
      // Cyan accent dots at intersections
      this.arenaGfx.fillStyle(pal.gridB, 0.5);
      for (let x = cx - r; x <= cx + r; x += step * 2) {
        for (let y = cy - r; y <= cy + r; y += step * 2) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > r * r) continue;
          this.arenaGfx.fillCircle(x, y, 1.5);
        }
      }
    }

    // Arena border (theme-tinted)
    this.arenaGfx.lineStyle(4, pal.border, 0.85);
    this.arenaGfx.strokeCircle(cx, cy, r);

    // Inner danger ring (always shows, ramps up via animation overlay)
    this.arenaGfx.lineStyle(1, pal.danger, 0.18);
    this.arenaGfx.strokeCircle(cx, cy, r - 2);
  }

  /** Animated overlay drawn every frame on top of the static arena. */
  private drawArenaAnim(now: number) {
    if (!this.arenaAnimGfx) return;
    this.arenaAnimGfx.clear();
    const cx = this.arenaCenterX;
    const cy = this.arenaCenterY;
    const r = this.arenaRadius;
    const tSec = now / 1000;

    if (this.mapTheme === 'lava') {
      // Pulsing red glow on inner ring
      const pulse = 0.4 + 0.35 * Math.sin(tSec * 2);
      this.arenaAnimGfx.lineStyle(6, 0xff5510, pulse * 0.5);
      this.arenaAnimGfx.strokeCircle(cx, cy, r - 4);
    } else if (this.mapTheme === 'tile') {
      // Sweeping cyan ring
      const ringR = (r * 0.4) + (r * 0.5) * (0.5 + 0.5 * Math.sin(tSec * 0.7));
      this.arenaAnimGfx.lineStyle(1.5, 0x00d8ff, 0.3);
      this.arenaAnimGfx.strokeCircle(cx, cy, ringR);
    } else if (this.mapTheme === 'grass') {
      // Slow soft pulse on border
      const pulse = 0.5 + 0.3 * Math.sin(tSec * 1.2);
      this.arenaAnimGfx.lineStyle(2, 0x3fbe5c, pulse * 0.4);
      this.arenaAnimGfx.strokeCircle(cx, cy, r - 1);
    } else {
      // rock — minimal: subtle dust shimmer (very faint pulse)
      const pulse = 0.4 + 0.2 * Math.sin(tSec * 0.8);
      this.arenaAnimGfx.lineStyle(1, 0x808389, pulse * 0.25);
      this.arenaAnimGfx.strokeCircle(cx, cy, r - 1);
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
