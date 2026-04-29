import * as Phaser from 'phaser';

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
}

interface GameStateMessage {
  type: 'game_state';
  state: {
    players: RemotePlayer[];
    coins: { id: string; position: Position; isTrap: boolean }[];
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

  // Arena (circular)
  private arenaGfx!: Phaser.GameObjects.Graphics;
  private arenaCenterX = 550;
  private arenaCenterY = 550;
  private arenaRadius = 500;

  // HUD
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private timerCapsule!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private leaderboardText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;

  // Input — mouse/touch pointer for angle-based steering
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private trapKey!: Phaser.Input.Keyboard.Key;
  private lastSentAngle: number | null = null;
  private isDemo = false;

  // Camera offset
  private cameraTarget: Position | null = null;

  // Skin effects
  private playerBoostTrails = new Map<string, Phaser.GameObjects.Graphics[]>();
  private playerCloneSprites = new Map<string, Phaser.GameObjects.Graphics[]>();
  private lastBoostStates = new Map<string, boolean>();

  // Skin definitions
  private readonly SKIN_COLORS: Record<string, { primary: number; secondary: number; glow: number }> = {
    neon_cyber: { primary: 0x00f0ff, secondary: 0xff00a0, glow: 0x00f0ff },
    inferno_drake: { primary: 0xff4500, secondary: 0xff8c00, glow: 0xff4500 },
    void_shadow: { primary: 0x1a0a2e, secondary: 0x8b00ff, glow: 0x8b00ff },
  };

  // Callbacks
  private onGameEnd: ((results: { username: string; score: number; placement: number }[]) => void) | null = null;
  private onConnectionStatus: ((status: string) => void) | null = null;
  private onMyDeath: ((info: { lostAmount: number; killerName?: string; killerId?: string }) => void) | null = null;
  private onScoreChange: ((score: number) => void) | null = null;
  private onTimeUpdate: ((timeRemaining: number) => void) | null = null;
  private onQueueState: ((data: { players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[]; minPlayers: number; maxPlayers: number }) => void) | null = null;
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
    onQueueState?: (data: { players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[]; minPlayers: number; maxPlayers: number }) => void;
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
    // Arena background
    this.arenaGfx = this.add.graphics();
    this.drawArena();

    // HUD
    this.scoreText = this.add.text(16, 16, 'Score: $0.00', {
      fontFamily: 'monospace',
      fontSize: '20px',
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
      fontSize: '13px',
      color: '#a1a1aa',
      align: 'right',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(100);

    this.aliveText = this.add.text(16, 72, 'Alive: 0', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#71717a',
    }).setScrollFactor(0).setDepth(100);

    // Input — keyboard for boost/trap, mouse/touch for steering
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.trapKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    this.spaceKey.on('down', () => this.send({ type: 'boost' }));
    this.trapKey.on('down', () => this.send({ type: 'skill_use', skill: 'trap' }));

    // Camera — zoom in so snake is larger on screen
    this.cameras.main.setBackgroundColor('#0a0a0a');
    this.cameras.main.setZoom(1.6);
  }

  update() {
    // Mouse / touch steering: compute angle from my snake head to the pointer
    if (this.cameraTarget && this.input.activePointer) {
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

    // Camera follow
    if (this.cameraTarget) {
      this.cameras.main.centerOn(this.cameraTarget.x, this.cameraTarget.y);
    }
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
        this.statusText.setText(`In queue (${msg.position} / 3 needed)`);
        break;

      case 'queue_state': {
        const data = msg as unknown as {
          players: { id: string; username: string; avatar: string | null; skinId: string | null; betAmount: number }[];
          minPlayers: number;
          maxPlayers: number;
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
          this.onMyDeath?.({
            lostAmount: (msg.lostAmount as number) ?? 0,
            killerName: msg.killerName as string | undefined,
            killerId: msg.killerId as string | undefined,
          });
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

    // Update timer
    const seconds = Math.ceil(state.timeRemaining / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    this.timeText.setText(`${m}:${s.toString().padStart(2, '0')}`);
    // Turn red when under 10 seconds
    if (seconds <= 10 && seconds > 0) {
      this.timeText.setColor('#ef4444'); // red-500
    } else {
      this.timeText.setColor('#ffffff');
    }

    // Update players
    const seenPlayers = new Set<string>();
    let aliveCount = 0;
    for (const p of state.players) {
      seenPlayers.add(p.id);
      this.renderSnake(p);
      if (p.alive) aliveCount++;

      if (p.id === this.myPlayerId) {
        this.scoreText.setText(`Score: $${p.score.toFixed(2)}`);
        this.onScoreChange?.(p.score);
        if (p.alive && p.segments.length > 0) {
          this.cameraTarget = p.segments[0];
        }
      }
    }

    // Send time update to React overlay
    this.onTimeUpdate?.(state.timeRemaining);

    // Mini-leaderboard (top 5 by score)
    const sorted = [...state.players]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const lbLines = sorted.map((p, i) => {
      const me = p.id === this.myPlayerId ? ' ◀' : '';
      const dead = p.alive ? '' : ' ✗';
      const name = p.username.length > 12 ? p.username.slice(0, 12) + '..' : p.username;
      return `#${i + 1} ${name}  $${p.score.toFixed(2)}${dead}${me}`;
    });
    this.leaderboardText.setText(lbLines.join('\n'));
    this.leaderboardText.setX(this.scale.width - 16);

    this.aliveText.setText(`Alive: ${aliveCount}/${state.players.length}`);

    // Remove disconnected players
    for (const id of this.playerGraphics.keys()) {
      if (!seenPlayers.has(id)) {
        this.playerGraphics.get(id)?.destroy();
        this.playerLabels.get(id)?.destroy();
        this.playerScoreLabels.get(id)?.destroy();
        this.playerGraphics.delete(id);
        this.playerLabels.delete(id);
        this.playerScoreLabels.delete(id);

        // Clean up skin effects
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
      g.lineStyle(2, 0x444444);
      label.setAlpha(0.3);
      scoreLabel.setAlpha(0);
      return;
    }
    label.setAlpha(1);
    scoreLabel.setAlpha(1);

    const isMe = p.id === this.myPlayerId;
    const skin = p.skinId ? this.SKIN_COLORS[p.skinId] : null;

    // Determine body color based on skin or default
    let bodyColor: number;
    let glowColor: number | null = null;

    if (skin) {
      bodyColor = skin.primary;
      glowColor = skin.glow;
    } else {
      bodyColor = isMe ? 0x10b981 : this.colorFromId(p.id);
    }

    // Boost/slow overrides for non-skinned snakes
    if (!skin) {
      if (p.boosted) bodyColor = 0xfbbf24;
      if (p.slowed) bodyColor = 0x6366f1;
    }

    // Draw glow effect for skins
    if (glowColor && p.alive) {
      g.lineStyle(4, glowColor, 0.3);
      if (p.segments.length > 0) {
        const head = p.segments[0];
        g.strokeCircle(head.x, head.y, 12);
      }
    }

    // Draw segments (tail to head)
    for (let i = p.segments.length - 1; i >= 0; i--) {
      const seg = p.segments[i];
      const radius = i === 0 ? 9 : 7;

      // Skin gradient effect
      if (skin && p.skinId === 'neon_cyber') {
        // Neon Cyber: gradient from cyan to magenta along body
        const ratio = i / Math.max(1, p.segments.length - 1);
        const r = Math.round(0 + (255 - 0) * ratio);
        const gVal = Math.round(240 + (0 - 240) * ratio);
        const b = Math.round(255 + (160 - 255) * ratio);
        bodyColor = (r << 16) | (gVal << 8) | b;
      } else if (skin && p.skinId === 'inferno_drake') {
        // Inferno Drake: gradient from orange to red
        const ratio = i / Math.max(1, p.segments.length - 1);
        const r = Math.round(255);
        const gVal = Math.round(140 + (69 - 140) * ratio);
        const b = Math.round(0);
        bodyColor = (r << 16) | (gVal << 8) | b;
      }

      g.fillStyle(bodyColor, 1);
      g.fillCircle(seg.x, seg.y, radius);

      // Skin-specific outline
      if (skin) {
        g.lineStyle(2, skin.secondary, 0.8);
      } else {
        g.lineStyle(2, 0x000000, 0.3);
      }
      g.strokeCircle(seg.x, seg.y, radius);
    }

    // Skin skill effects
    this.handleSkinEffects(p, skin);

    // Eyes on head — positioned based on facing angle
    if (p.segments.length > 0) {
      const head = p.segments[0];
      const a = p.angle;
      // Perpendicular offsets for left/right eye
      const perpX = -Math.sin(a);
      const perpY = Math.cos(a);
      const fwdX = Math.cos(a);
      const fwdY = Math.sin(a);

      g.fillStyle(0xffffff, 1);
      g.fillCircle(head.x + fwdX * 4 + perpX * 3, head.y + fwdY * 4 + perpY * 3, 2.5);
      g.fillCircle(head.x + fwdX * 4 - perpX * 3, head.y + fwdY * 4 - perpY * 3, 2.5);
      // Pupils
      g.fillStyle(0x000000, 1);
      g.fillCircle(head.x + fwdX * 5 + perpX * 3, head.y + fwdY * 5 + perpY * 3, 1);
      g.fillCircle(head.x + fwdX * 5 - perpX * 3, head.y + fwdY * 5 - perpY * 3, 1);

      // Position labels: score above username above head
      scoreLabel.setText(`$${p.score.toFixed(2)}`);
      scoreLabel.setPosition(head.x, head.y - 34);
      label.setPosition(head.x, head.y - 22);
    }
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
      this.updateBoostTrails(p, 0xff4500, 3); // Fire trail
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
    const head = p.segments[0];
    if (!head) return;

    // Create or update trail graphics
    for (let i = 0; i < count; i++) {
      let trail = trails[i];
      if (!trail) {
        trail = this.add.graphics();
        trails[i] = trail;
      }
      trail.clear();

      // Trail follows behind head
      const offset = (i + 1) * 15;
      const angle = p.angle + Math.PI; // Opposite direction
      const tx = head.x + Math.cos(angle) * offset;
      const ty = head.y + Math.sin(angle) * offset;

      const alpha = 1 - (i / count);
      trail.fillStyle(color, alpha * 0.5);
      trail.fillCircle(tx, ty, 6 - i);
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

  private drawArena() {
    this.arenaGfx.clear();

    // Dark fill behind the circle
    this.arenaGfx.fillStyle(0x0f0f0f, 1);
    this.arenaGfx.fillCircle(this.arenaCenterX, this.arenaCenterY, this.arenaRadius);

    // Subtle grid lines (clipped to circle via thin segments)
    this.arenaGfx.lineStyle(1, 0x1f2937, 0.25);
    const step = 50;
    const cx = this.arenaCenterX;
    const cy = this.arenaCenterY;
    const r = this.arenaRadius;

    // Vertical grid lines
    for (let x = cx - r; x <= cx + r; x += step) {
      const dx = x - cx;
      const halfH = Math.sqrt(Math.max(0, r * r - dx * dx));
      if (halfH > 0) this.arenaGfx.lineBetween(x, cy - halfH, x, cy + halfH);
    }
    // Horizontal grid lines
    for (let y = cy - r; y <= cy + r; y += step) {
      const dy = y - cy;
      const halfW = Math.sqrt(Math.max(0, r * r - dy * dy));
      if (halfW > 0) this.arenaGfx.lineBetween(cx - halfW, y, cx + halfW, y);
    }

    // Arena border
    this.arenaGfx.lineStyle(3, 0x10b981, 0.6);
    this.arenaGfx.strokeCircle(this.arenaCenterX, this.arenaCenterY, this.arenaRadius);

    // Danger zone ring (inner glow when shrinking)
    this.arenaGfx.lineStyle(1, 0xef4444, 0.15);
    this.arenaGfx.strokeCircle(this.arenaCenterX, this.arenaCenterY, this.arenaRadius - 2);
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
