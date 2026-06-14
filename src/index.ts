import {
  World, createSystem, PanelUI, PanelDocument, UIKitDocument, UIKit, eq,
  Follower, InputComponent,
  Mesh, Group, SphereGeometry, CylinderGeometry, TorusGeometry, OctahedronGeometry,
  IcosahedronGeometry, RingGeometry, BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial, PointsMaterial, ShaderMaterial,
  Points, LineSegments, Line, Color, Vector3, Quaternion,
  AmbientLight, PointLight, DirectionalLight, Fog, AdditiveBlending, DoubleSide, Object3D,
  type Entity,
} from '@iwsdk/core';

// ---- Constants ----
const G_CONSTANT = 6.0;
const MAX_PROBES = 20;
const PROBE_RADIUS = 0.08;
const TARGET_RADIUS = 0.15;
const TRAIL_LENGTH = 120;
const MAX_DISTANCE = 30;
const LAUNCH_MIN_SPEED = 2;
const LAUNCH_MAX_SPEED = 12;
const CHARGE_RATE = 1.5;
const PREDICTION_STEPS = 200;
const PREDICTION_DT = 0.03;
const SLOW_MO_FACTOR = 0.25;
const COMBO_WINDOW = 3.0;
const PLANET_COLORS = [0x00ffff, 0xff44ff, 0xffaa00, 0x00ff88, 0xff4444, 0x8888ff, 0xffff00, 0x44aaff];
const POWERUP_DURATION = 8;
const MAGNET_RANGE = 3.0;
const MAGNET_FORCE = 2.0;
const WORMHOLE_RADIUS = 0.4;
const SHAKE_DECAY = 5.0;
// R3: Proximity danger constants
const DANGER_ZONE_MULT = 3.0; // danger zone = well.radius * this
const DANGER_WARNING_INTERVAL = 0.5; // seconds between warning beeps
const DANGER_FLASH_SPEED = 8.0; // flash speed when in danger
// R3: Gravity interaction line constants
const GRAV_LINE_MAX_DIST = 8.0;
const GRAV_LINE_COUNT = 3; // max lines shown from probe to nearest wells
// R3: Level celebration constants
const CELEBRATION_DURATION = 2.0;
// R3: Asteroid constants
const ASTEROID_MIN_RADIUS = 0.15;
const ASTEROID_MAX_RADIUS = 0.4;
const ASTEROID_ROTATION_SPEED = 0.5;
// R3: Graze scoring
const GRAZE_ZONE_MULT = 2.5; // graze zone = well.radius * this
const GRAZE_BONUS_BASE = 50;
const GRAZE_COOLDOWN = 1.0; // seconds between graze bonuses per well
// R3: Orbit scoring
const ORBIT_BONUS_BASE = 200;
const ORBIT_BONUS_SCALE = 1.5; // multiplier per subsequent orbit
// R3: Tutorial hints
const TUTORIAL_HINTS = [
  'Hold trigger/SPACE to charge, release to launch your probe',
  'Green gems are targets -- fly your probe close to collect them',
  'Use slow-motion (squeeze/SHIFT) to plan tricky shots',
  'Trajectory preview shows where your probe will travel',
  'Gravity wells bend your path -- use them for slingshots!',
  'Power-ups give special abilities -- shield, magnet, multi-shot, time-freeze',
  'Press F to follow your probe with the camera',
  'Pass close to wells for graze bonus points!',
  'Watch out for asteroids -- they block your path',
  'Orbiting a well earns orbit bonus points',
];
// R2: Shooting star constants
const SHOOTING_STAR_INTERVAL_MIN = 3;
const SHOOTING_STAR_INTERVAL_MAX = 8;
const SHOOTING_STAR_SPEED = 40;
const SHOOTING_STAR_LIFETIME = 1.5;
// R2: Energy beam constants
const ENERGY_BEAM_RANGE = 12;

// ---- Types ----
type GameMode = 'classic' | 'slingshot' | 'time-trial' | 'precision' | 'chaos' | 'zen' | 'survival' | 'daily';
type GameState = 'menu' | 'playing' | 'paused' | 'level-complete' | 'game-over';
type ThemeName = 'deep-space' | 'nebula' | 'solar' | 'ice' | 'void';
type PowerUpType = 'shield' | 'magnet' | 'multi-shot' | 'time-freeze';
type WellMotion = 'static' | 'orbit' | 'oscillate' | 'pulse-mass';

interface ThemeColors { bg: number; fog: number; ambient: number; grid: number; nebula: number; }
const THEMES: Record<ThemeName, ThemeColors> = {
  'deep-space': { bg: 0x020210, fog: 0x020210, ambient: 0x111133, grid: 0x1a1a4a, nebula: 0x1122aa },
  'nebula': { bg: 0x0d0020, fog: 0x0d0020, ambient: 0x221133, grid: 0x331155, nebula: 0x6622aa },
  'solar': { bg: 0x100800, fog: 0x100800, ambient: 0x332200, grid: 0x443311, nebula: 0xaa4400 },
  'ice': { bg: 0x001020, fog: 0x001020, ambient: 0x112233, grid: 0x224466, nebula: 0x2266aa },
  'void': { bg: 0x000800, fog: 0x000800, ambient: 0x002200, grid: 0x003300, nebula: 0x006622 },
};

interface GravityWell {
  group: Group; position: Vector3; mass: number; baseMass: number; radius: number; color: number;
  glowMesh: Mesh; ringMesh: Mesh; fieldLines: Line[]; pulsePhase: number;
  motion: WellMotion; orbitCenter: Vector3; orbitRadius: number; orbitSpeed: number; orbitAngle: number;
  oscillateAxis: Vector3; oscillateAmplitude: number; oscillatePhase: number;
}
interface Probe {
  mesh: Mesh; trailLine: Line; trailPositions: Vector3[]; position: Vector3; velocity: Vector3;
  alive: boolean; age: number; orbitCount: number; lastWellIdx: number; closestApproach: number;
  shielded: boolean; targetsHitThisProbe: number; slingshotNotified: boolean;
  shieldMesh: Mesh; glowLight: PointLight;
}
interface Target { group: Group; position: Vector3; collected: boolean; pulsePhase: number; points: number; }
interface PowerUp {
  group: Group; position: Vector3; type: PowerUpType; collected: boolean; pulsePhase: number;
  innerMesh: Mesh; outerMesh: Mesh;
}
interface WormholePortal {
  groupA: Group; groupB: Group; posA: Vector3; posB: Vector3;
  ringA: Mesh; ringB: Mesh; phase: number; active: boolean;
}
interface LevelConfig {
  wells: { x: number; y: number; z: number; mass: number; radius: number; color: number; motion: WellMotion; orbitRadius?: number; orbitSpeed?: number; oscillateAmp?: number }[];
  targets: { x: number; y: number; z: number; points: number }[];
  powerUps: { x: number; y: number; z: number; type: PowerUpType }[];
  wormholes: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }[];
  asteroids: { x: number; y: number; z: number; radius: number }[];
  probeLimit: number; timeLimit: number; name: string;
}
interface Achievement { id: string; name: string; desc: string; unlocked: boolean; }
// R2: Shooting star data
interface ShootingStar { line: Line; position: Vector3; velocity: Vector3; life: number; maxLife: number; active: boolean; }
// R2: Energy beam data
interface EnergyBeam { line: Line; wellA: number; wellB: number; phase: number; }
// R3: Gravity interaction lines (probe-to-well)
interface GravInteractionLine { line: Line; active: boolean; }
// R3: Level celebration state
interface CelebrationState { active: boolean; timer: number; threeStars: boolean; }
// R3: Asteroid data
interface Asteroid { mesh: Mesh; position: Vector3; radius: number; rotAxis: Vector3; rotSpeed: number; }
// R3: Tutorial state
interface TutorialState { hintIndex: number; shown: boolean; hintsCompleted: boolean; dismissTimer: number; }
// R3: Graze tracking per-well
interface GrazeTracker { wellIdx: number; lastGrazeTime: number; }

// ---- Keyboard State (browser fallback) ----
class KeyState {
  private pressed = new Set<string>();
  private justDown = new Set<string>();
  private justUp = new Set<string>();
  constructor() {
    document.addEventListener('keydown', (e) => { if (!this.pressed.has(e.code)) this.justDown.add(e.code); this.pressed.add(e.code); });
    document.addEventListener('keyup', (e) => { this.pressed.delete(e.code); this.justUp.add(e.code); });
  }
  isPressed(code: string) { return this.pressed.has(code); }
  isDown(code: string) { return this.justDown.has(code); }
  isUp(code: string) { return this.justUp.has(code); }
  endFrame() { this.justDown.clear(); this.justUp.clear(); }
}

// ---- Screen Shake ----
class ScreenShake {
  intensity = 0;
  private offset = new Vector3();
  trigger(amount: number) { this.intensity = Math.max(this.intensity, amount); }
  update(delta: number, camera: Object3D) {
    if (this.intensity < 0.001) { this.intensity = 0; return; }
    this.offset.set(
      (Math.random() - 0.5) * this.intensity * 0.05,
      (Math.random() - 0.5) * this.intensity * 0.05,
      (Math.random() - 0.5) * this.intensity * 0.02,
    );
    camera.position.add(this.offset);
    this.intensity *= Math.exp(-SHAKE_DECAY * delta);
  }
}

// ---- R2: High Score Manager ----
class HighScoreManager {
  private data: Record<string, { score: number; stars: number; accuracy: number }> = {};

  constructor() { this.load(); }

  private key(mode: GameMode, level: number) { return `${mode}-${level}`; }

  save() {
    try { localStorage.setItem('neon-orbit-scores', JSON.stringify(this.data)); } catch (_e) { /* no-op */ }
  }

  load() {
    try {
      const raw = localStorage.getItem('neon-orbit-scores');
      if (raw) this.data = JSON.parse(raw);
    } catch (_e) { this.data = {}; }
  }

  record(mode: GameMode, level: number, score: number, stars: number, accuracy: number) {
    const k = this.key(mode, level);
    const prev = this.data[k];
    if (!prev || score > prev.score) {
      this.data[k] = { score, stars: Math.max(stars, prev?.stars ?? 0), accuracy: Math.max(accuracy, prev?.accuracy ?? 0) };
      this.save();
      return true; // new high score
    }
    if (stars > prev.stars || accuracy > prev.accuracy) {
      this.data[k] = { score: prev.score, stars: Math.max(stars, prev.stars), accuracy: Math.max(accuracy, prev.accuracy) };
      this.save();
    }
    return false;
  }

  get(mode: GameMode, level: number) { return this.data[this.key(mode, level)] ?? null; }

  getMaxLevel(mode: GameMode): number {
    let max = 0;
    for (const k of Object.keys(this.data)) {
      if (k.startsWith(mode + '-')) {
        const lvl = parseInt(k.split('-').pop() || '0', 10);
        if (lvl > max) max = lvl;
      }
    }
    return max;
  }

  getTotalStars(mode: GameMode): number {
    let total = 0;
    for (const [k, v] of Object.entries(this.data)) {
      if (k.startsWith(mode + '-')) total += v.stars;
    }
    return total;
  }
}

// ---- R2: Full Game Save Manager ----
class GameSaveManager {
  private static KEY = 'neon-orbit-save';

  static save(game: GameManager) {
    try {
      const data = {
        totalScore: game.totalScore, gamesPlayed: game.gamesPlayed,
        totalProbesLaunched: game.totalProbesLaunched, totalTargetsCollected: game.totalTargetsCollected,
        allTimeBestCombo: game.allTimeBestCombo, planetsCrashedInto: game.planetsCrashedInto,
        perfectLevels: game.perfectLevels, longestOrbit: game.longestOrbit,
        totalPlayTime: game.totalPlayTime, dailyStreak: game.dailyStreak,
        xp: game.xp, playerLevel: game.playerLevel, xpToNext: game.xpToNext,
        levelsCompleted: game.levelsCompleted, tripleStarCount: game.tripleStarCount,
        slowMoCount: game.slowMoCount, totalPowerUpsCollected: game.totalPowerUpsCollected,
        wormholeUses: game.wormholeUses,
        modesPlayed: Array.from(game.modesPlayed),
        achievements: game.achievements.filter(a => a.unlocked).map(a => a.id),
        theme: game.theme, showTrajectory: game.showTrajectory, trailLen: game.trailLen,
        showGravityLines: game.showGravityLines,
        lastDailyDate: game.lastDailyDate,
        // R3: Tutorial and survival
        tutorialComplete: game.tutorialComplete,
        tutorialHintsShown: game.tutorialHintsShown,
        // R3: Graze/orbit/asteroid stats
        grazeCount: game.grazeCount, totalGrazeBonus: game.totalGrazeBonus,
        orbitBonusCount: game.orbitBonusCount, asteroidsDodged: game.asteroidsDodged,
        asteroidsHit: game.asteroidsHit,
      };
      localStorage.setItem(GameSaveManager.KEY, JSON.stringify(data));
    } catch (_e) { /* no-op */ }
  }

  static load(game: GameManager) {
    try {
      const raw = localStorage.getItem(GameSaveManager.KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (typeof d.totalScore === 'number') game.totalScore = d.totalScore;
      if (typeof d.gamesPlayed === 'number') game.gamesPlayed = d.gamesPlayed;
      if (typeof d.totalProbesLaunched === 'number') game.totalProbesLaunched = d.totalProbesLaunched;
      if (typeof d.totalTargetsCollected === 'number') game.totalTargetsCollected = d.totalTargetsCollected;
      if (typeof d.allTimeBestCombo === 'number') game.allTimeBestCombo = d.allTimeBestCombo;
      if (typeof d.planetsCrashedInto === 'number') game.planetsCrashedInto = d.planetsCrashedInto;
      if (typeof d.perfectLevels === 'number') game.perfectLevels = d.perfectLevels;
      if (typeof d.longestOrbit === 'number') game.longestOrbit = d.longestOrbit;
      if (typeof d.totalPlayTime === 'number') game.totalPlayTime = d.totalPlayTime;
      if (typeof d.dailyStreak === 'number') game.dailyStreak = d.dailyStreak;
      if (typeof d.xp === 'number') game.xp = d.xp;
      if (typeof d.playerLevel === 'number') game.playerLevel = d.playerLevel;
      if (typeof d.xpToNext === 'number') game.xpToNext = d.xpToNext;
      if (typeof d.levelsCompleted === 'number') game.levelsCompleted = d.levelsCompleted;
      if (typeof d.tripleStarCount === 'number') game.tripleStarCount = d.tripleStarCount;
      if (typeof d.slowMoCount === 'number') game.slowMoCount = d.slowMoCount;
      if (typeof d.totalPowerUpsCollected === 'number') game.totalPowerUpsCollected = d.totalPowerUpsCollected;
      if (typeof d.wormholeUses === 'number') game.wormholeUses = d.wormholeUses;
      if (Array.isArray(d.modesPlayed)) game.modesPlayed = new Set(d.modesPlayed as GameMode[]);
      if (Array.isArray(d.achievements)) {
        for (const id of d.achievements as string[]) {
          const a = game.achievements.find(a => a.id === id);
          if (a) a.unlocked = true;
        }
      }
      if (typeof d.theme === 'string' && d.theme in THEMES) game.theme = d.theme as ThemeName;
      if (typeof d.showTrajectory === 'boolean') game.showTrajectory = d.showTrajectory;
      if (typeof d.trailLen === 'string') game.trailLen = d.trailLen as 'short' | 'medium' | 'long';
      if (typeof d.showGravityLines === 'boolean') game.showGravityLines = d.showGravityLines;
      if (typeof d.lastDailyDate === 'string') game.lastDailyDate = d.lastDailyDate;
      // R3: Tutorial state
      if (typeof d.tutorialComplete === 'boolean') game.tutorialComplete = d.tutorialComplete;
      if (typeof d.tutorialHintsShown === 'number') game.tutorialHintsShown = d.tutorialHintsShown;
      // R3: Graze/orbit/asteroid stats
      if (typeof d.grazeCount === 'number') game.grazeCount = d.grazeCount;
      if (typeof d.totalGrazeBonus === 'number') game.totalGrazeBonus = d.totalGrazeBonus;
      if (typeof d.orbitBonusCount === 'number') game.orbitBonusCount = d.orbitBonusCount;
      if (typeof d.asteroidsDodged === 'number') game.asteroidsDodged = d.asteroidsDodged;
      if (typeof d.asteroidsHit === 'number') game.asteroidsHit = d.asteroidsHit;
    } catch (_e) { /* no-op */ }
  }
}

// ---- R2: Score Popup Pool ----
class ScorePopupPool {
  private popups: { mesh: Mesh; velocity: Vector3; life: number; }[] = [];
  private scene: Object3D;
  // We use simple sphere "markers" that float up and fade; the combo multiplier flash is handled by particles

  constructor(scene: Object3D) { this.scene = scene; }

  spawn(pos: Vector3, _score: number, combo: number) {
    // Ring burst at collection point that scales with combo
    const ringGeo = new TorusGeometry(0.2 + combo * 0.05, 0.015, 8, 24);
    const ringMat = new MeshBasicMaterial({
      color: combo >= 5 ? 0xffaa00 : combo >= 3 ? 0xffff00 : 0x00ff88,
      transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false,
    });
    const ring = new Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(pos.x, pos.y + 1, pos.z);
    this.scene.add(ring);
    this.popups.push({ mesh: ring, velocity: new Vector3(0, 0.8, 0), life: 0.6 + combo * 0.05 });
  }

  update(delta: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= delta;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as MeshBasicMaterial).dispose(); this.popups.splice(i, 1); continue; }
      p.mesh.position.addScaledVector(p.velocity, delta);
      const s = 1 + (1 - p.life / 0.6) * 0.5;
      p.mesh.scale.setScalar(s);
      (p.mesh.material as MeshBasicMaterial).opacity = p.life * 1.2;
    }
  }
}

// ---- R2: Shooting Star Manager ----
class ShootingStarManager {
  private stars: ShootingStar[] = [];
  private nextSpawn = 0;
  private scene: Object3D;
  private themeColor: Color;

  constructor(scene: Object3D, maxStars = 5) {
    this.scene = scene;
    this.themeColor = new Color(0x88aaff);
    for (let i = 0; i < maxStars; i++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
      const line = new Line(geo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      line.frustumCulled = false;
      scene.add(line);
      this.stars.push({ line, position: new Vector3(), velocity: new Vector3(), life: 0, maxLife: 0, active: false });
    }
    this.nextSpawn = SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
  }

  setThemeColor(color: number) { this.themeColor.set(color); }

  update(delta: number) {
    this.nextSpawn -= delta;
    if (this.nextSpawn <= 0) {
      this.spawn();
      this.nextSpawn = SHOOTING_STAR_INTERVAL_MIN + Math.random() * (SHOOTING_STAR_INTERVAL_MAX - SHOOTING_STAR_INTERVAL_MIN);
    }
    for (const s of this.stars) {
      if (!s.active) continue;
      s.life -= delta;
      if (s.life <= 0) { s.active = false; (s.line.material as LineBasicMaterial).opacity = 0; continue; }
      const tail = s.position.clone();
      s.position.addScaledVector(s.velocity, delta);
      const pa = s.line.geometry.attributes.position.array as Float32Array;
      pa[0] = s.position.x; pa[1] = s.position.y; pa[2] = s.position.z;
      pa[3] = tail.x; pa[4] = tail.y; pa[5] = tail.z;
      s.line.geometry.attributes.position.needsUpdate = true;
      const t = s.life / s.maxLife;
      (s.line.material as LineBasicMaterial).opacity = t * 0.7;
      (s.line.material as LineBasicMaterial).color.lerpColors(this.themeColor, new Color(0xffffff), t);
    }
  }

  private spawn() {
    const s = this.stars.find(ss => !ss.active);
    if (!s) return;
    const angle = Math.random() * Math.PI * 2;
    const elev = Math.random() * 0.6 + 0.2;
    const r = 30 + Math.random() * 20;
    s.position.set(Math.cos(angle) * r, elev * r * 0.5 + 5, Math.sin(angle) * r);
    const dir = new Vector3(-Math.cos(angle + 0.3), -0.2 - Math.random() * 0.3, -Math.sin(angle + 0.3)).normalize();
    s.velocity.copy(dir).multiplyScalar(SHOOTING_STAR_SPEED);
    s.life = SHOOTING_STAR_LIFETIME * (0.5 + Math.random() * 0.5);
    s.maxLife = s.life;
    s.active = true;
  }
}

// ---- Audio Manager ----
class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private melodyOsc: OscillatorNode | null = null;
  private melodyGain: GainNode | null = null;
  private harmonyOsc: OscillatorNode | null = null;
  private harmonyGain: GainNode | null = null;
  private padOsc: OscillatorNode | null = null;
  private padGain: GainNode | null = null;
  private arpTimer = 0;
  private arpNoteIdx = 0;
  musicVolume = 0.8;
  sfxVolume = 1.0;
  private musicIntensity = 0;

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain(); this.masterGain.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.musicVolume * 0.3; this.musicGain.connect(this.masterGain);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = this.sfxVolume; this.sfxGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  startDrone() {
    const ctx = this.ensureCtx(); if (this.droneOsc) return;
    this.droneOsc = ctx.createOscillator(); this.droneOsc.type = 'sine'; this.droneOsc.frequency.value = 55;
    const g = ctx.createGain(); g.gain.value = 0.08; this.droneOsc.connect(g); g.connect(this.musicGain!); this.droneOsc.start();
    const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = 82.5;
    const hg = ctx.createGain(); hg.gain.value = 0.04; h.connect(hg); hg.connect(this.musicGain!); h.start();
    this.melodyOsc = ctx.createOscillator(); this.melodyOsc.type = 'triangle'; this.melodyOsc.frequency.value = 220;
    this.melodyGain = ctx.createGain(); this.melodyGain.gain.value = 0;
    this.melodyOsc.connect(this.melodyGain); this.melodyGain.connect(this.musicGain!); this.melodyOsc.start();
    this.harmonyOsc = ctx.createOscillator(); this.harmonyOsc.type = 'sine'; this.harmonyOsc.frequency.value = 330;
    this.harmonyGain = ctx.createGain(); this.harmonyGain.gain.value = 0;
    this.harmonyOsc.connect(this.harmonyGain); this.harmonyGain.connect(this.musicGain!); this.harmonyOsc.start();
    // R2: Pad layer — warm background chords
    this.padOsc = ctx.createOscillator(); this.padOsc.type = 'sine'; this.padOsc.frequency.value = 165;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0;
    this.padOsc.connect(this.padGain); this.padGain.connect(this.musicGain!); this.padOsc.start();
  }

  setIntensity(level: number) { this.musicIntensity = level; }

  updateMusic(delta: number) {
    if (!this.melodyGain || !this.harmonyGain || !this.melodyOsc || !this.harmonyOsc || !this.ctx) return;
    const melTarget = this.musicIntensity >= 1 ? 0.04 : 0;
    const harTarget = this.musicIntensity >= 2 ? 0.03 : 0;
    const padTarget = this.musicIntensity >= 1 ? 0.02 : 0;
    this.melodyGain.gain.value += (melTarget - this.melodyGain.gain.value) * delta * 2;
    this.harmonyGain.gain.value += (harTarget - this.harmonyGain.gain.value) * delta * 2;
    if (this.padGain) this.padGain.gain.value += (padTarget - this.padGain.gain.value) * delta * 1.5;
    this.arpTimer += delta;
    const arpSpeed = this.musicIntensity >= 3 ? 0.25 : this.musicIntensity >= 2 ? 0.5 : 1.0;
    if (this.arpTimer > arpSpeed) {
      this.arpTimer = 0;
      const scale = [220, 261.6, 293.7, 349.2, 392, 440, 523.3];
      this.arpNoteIdx = (this.arpNoteIdx + 1) % scale.length;
      const t = this.ctx.currentTime;
      this.melodyOsc.frequency.setTargetAtTime(scale[this.arpNoteIdx], t, 0.05);
      this.harmonyOsc.frequency.setTargetAtTime(scale[(this.arpNoteIdx + 2) % scale.length] * 1.5, t, 0.05);
      if (this.padOsc) this.padOsc.frequency.setTargetAtTime(scale[(this.arpNoteIdx + 4) % scale.length] * 0.5, t, 0.15);
    }
  }

  playLaunch(power: number) {
    const ctx = this.ensureCtx(); const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 200 + power * 400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.3);
  }

  playCollect(combo: number) {
    const ctx = this.ensureCtx(); const base = 440 * Math.pow(2, combo / 12);
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * (1 + i * 0.5);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.05); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 0.3);
      o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.05); o.stop(ctx.currentTime + i * 0.05 + 0.3);
    }
  }

  playCrash() {
    const ctx = this.ensureCtx(); const n = ctx.sampleRate * 0.2; const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain(); g.gain.setValueAtTime(0.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    src.connect(g); g.connect(this.sfxGain!); src.start();
  }

  playCharge(progress: number) {
    const ctx = this.ensureCtx(); const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 200 + progress * 600;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.08);
  }

  playSuccess() {
    const ctx = this.ensureCtx();
    [523, 659, 784, 1047].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.1); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.4); o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.1); o.stop(ctx.currentTime + i * 0.1 + 0.4); });
  }

  playFail() {
    const ctx = this.ensureCtx(); const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(200, ctx.currentTime); o.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.1, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4); o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.4);
  }

  playClick() {
    const ctx = this.ensureCtx(); const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 800;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05); o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.05);
  }

  playAchievement() {
    const ctx = this.ensureCtx();
    [659, 784, 880, 1047, 1319].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.08); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.5); o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.08); o.stop(ctx.currentTime + i * 0.08 + 0.5); });
  }

  playPowerUp() {
    const ctx = this.ensureCtx();
    [440, 554, 659, 880].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.06); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.06 + 0.3); o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.06); o.stop(ctx.currentTime + i * 0.06 + 0.3); });
  }

  playWormhole() {
    const ctx = this.ensureCtx(); const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(800, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.4);
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(600, ctx.currentTime + 0.15); o2.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.5);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.06, ctx.currentTime + 0.15); g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o2.connect(g2); g2.connect(this.sfxGain!); o2.start(ctx.currentTime + 0.15); o2.stop(ctx.currentTime + 0.5);
  }

  playShieldBreak() {
    const ctx = this.ensureCtx();
    const n = ctx.sampleRate * 0.15; const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2) * 0.5;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    src.connect(g); g.connect(this.sfxGain!); src.start();
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1200;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.08, ctx.currentTime); g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    o.connect(g2); g2.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.2);
  }

  // R2: Slingshot sound
  playSlingshot() {
    const ctx = this.ensureCtx();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(300, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.3);
  }

  // R2: High score sound
  playHighScore() {
    const ctx = this.ensureCtx();
    [784, 988, 1175, 1319, 1568].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.12); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.6);
      o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + i * 0.12 + 0.6);
    });
  }

  // R3: Proximity warning beep
  playDangerWarning(proximity: number) {
    const ctx = this.ensureCtx();
    const freq = 400 + proximity * 800; // higher pitch = closer
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.04 + proximity * 0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.06);
  }

  // R3: Celebration fanfare
  playCelebration(threeStars: boolean) {
    const ctx = this.ensureCtx();
    const notes = threeStars ? [523, 659, 784, 880, 1047, 1175, 1319, 1568] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = threeStars ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.6);
      o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.1); o.stop(ctx.currentTime + i * 0.1 + 0.6);
    });
  }

  // R3: Wave start sound
  playWaveStart() {
    const ctx = this.ensureCtx();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(220, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.3);
  }

  // R3: Asteroid collision sound
  playAsteroidHit() {
    const ctx = this.ensureCtx();
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(60, ctx.currentTime + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.3);
    // Crunch noise layer
    const n = ctx.sampleRate * 0.1; const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) * 0.3;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.1, ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    src.connect(g2); g2.connect(this.sfxGain!); src.start();
  }

  // R3: Graze bonus sound (satisfying near-miss ping)
  playGraze(proximity: number) {
    const ctx = this.ensureCtx();
    const freq = 600 + proximity * 600;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06 + proximity * 0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    o.connect(g); g.connect(this.sfxGain!); o.start(); o.stop(ctx.currentTime + 0.15);
    // Harmonic
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 1.5;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.03, ctx.currentTime + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    o2.connect(g2); g2.connect(this.sfxGain!); o2.start(ctx.currentTime + 0.03); o2.stop(ctx.currentTime + 0.12);
  }

  // R3: Orbit bonus sound
  playOrbitBonus() {
    const ctx = this.ensureCtx();
    [392, 494, 587, 784].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.07 + 0.3);
      o.connect(g); g.connect(this.sfxGain!); o.start(ctx.currentTime + i * 0.07); o.stop(ctx.currentTime + i * 0.07 + 0.3);
    });
  }

  // R3: Theme-reactive audio tuning
  setThemeTuning(theme: ThemeName) {
    if (!this.droneOsc) return;
    const tunings: Record<ThemeName, number> = {
      'deep-space': 55, 'nebula': 49, 'solar': 65, 'ice': 58, 'void': 41,
    };
    const t = this.ctx!.currentTime;
    this.droneOsc.frequency.setTargetAtTime(tunings[theme], t, 0.5);
  }

  setMusicVolume(v: number) { this.musicVolume = v; if (this.musicGain) this.musicGain.gain.value = v * 0.3; }
  setSfxVolume(v: number) { this.sfxVolume = v; if (this.sfxGain) this.sfxGain.gain.value = v; }
}


// ---- Particle Pool ----
class ParticlePool {
  private geometry: BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private velocities: Vector3[] = [];
  private lifetimes: number[] = [];
  private maxLifetimes: number[] = [];
  private activeCount = 0;
  private maxP: number;

  constructor(scene: Object3D, maxP = 500) {
    this.maxP = maxP; this.positions = new Float32Array(maxP * 3); this.colors = new Float32Array(maxP * 4);
    for (let i = 0; i < maxP; i++) { this.velocities.push(new Vector3()); this.lifetimes.push(0); this.maxLifetimes.push(0); }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 4));
    const mat = new PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const pts = new Points(this.geometry, mat); pts.frustumCulled = false; scene.add(pts);
  }

  emit(pos: Vector3, color: Color, count: number, speed = 2, lifetime = 0.8) {
    for (let i = 0; i < count; i++) {
      const idx = this.findFree(); if (idx < 0) break;
      this.positions[idx * 3] = pos.x; this.positions[idx * 3 + 1] = pos.y; this.positions[idx * 3 + 2] = pos.z;
      this.velocities[idx].set((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed);
      this.colors[idx * 4] = color.r; this.colors[idx * 4 + 1] = color.g; this.colors[idx * 4 + 2] = color.b; this.colors[idx * 4 + 3] = 1;
      this.lifetimes[idx] = lifetime; this.maxLifetimes[idx] = lifetime;
      this.activeCount = Math.max(this.activeCount, idx + 1);
    }
  }

  emitRing(center: Vector3, color: Color, count: number, radius: number, lifetime = 1.0) {
    for (let i = 0; i < count; i++) {
      const idx = this.findFree(); if (idx < 0) break;
      const angle = (i / count) * Math.PI * 2;
      this.positions[idx * 3] = center.x + Math.cos(angle) * radius;
      this.positions[idx * 3 + 1] = center.y;
      this.positions[idx * 3 + 2] = center.z + Math.sin(angle) * radius;
      this.velocities[idx].set(Math.cos(angle) * 1.5, (Math.random() - 0.5) * 0.5, Math.sin(angle) * 1.5);
      this.colors[idx * 4] = color.r; this.colors[idx * 4 + 1] = color.g; this.colors[idx * 4 + 2] = color.b; this.colors[idx * 4 + 3] = 1;
      this.lifetimes[idx] = lifetime; this.maxLifetimes[idx] = lifetime;
      this.activeCount = Math.max(this.activeCount, idx + 1);
    }
  }

  // R2: Directional burst (for slingshots)
  emitDirectional(pos: Vector3, dir: Vector3, color: Color, count: number, spread = 0.3, speed = 3, lifetime = 0.5) {
    for (let i = 0; i < count; i++) {
      const idx = this.findFree(); if (idx < 0) break;
      this.positions[idx * 3] = pos.x; this.positions[idx * 3 + 1] = pos.y; this.positions[idx * 3 + 2] = pos.z;
      this.velocities[idx].copy(dir).multiplyScalar(speed).add(
        new Vector3((Math.random() - 0.5) * spread * speed, (Math.random() - 0.5) * spread * speed, (Math.random() - 0.5) * spread * speed)
      );
      this.colors[idx * 4] = color.r; this.colors[idx * 4 + 1] = color.g; this.colors[idx * 4 + 2] = color.b; this.colors[idx * 4 + 3] = 1;
      this.lifetimes[idx] = lifetime; this.maxLifetimes[idx] = lifetime;
      this.activeCount = Math.max(this.activeCount, idx + 1);
    }
  }

  update(delta: number) {
    let ma = 0;
    for (let i = 0; i < this.activeCount; i++) {
      if (this.lifetimes[i] <= 0) continue; this.lifetimes[i] -= delta;
      if (this.lifetimes[i] <= 0) continue; ma = i + 1;
      const t = this.lifetimes[i] / this.maxLifetimes[i];
      this.positions[i * 3] += this.velocities[i].x * delta; this.positions[i * 3 + 1] += this.velocities[i].y * delta; this.positions[i * 3 + 2] += this.velocities[i].z * delta;
      this.colors[i * 4 + 3] = t; this.velocities[i].multiplyScalar(0.98);
    }
    this.activeCount = ma; this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.color.needsUpdate = true;
  }

  private findFree(): number { for (let i = 0; i < this.maxP; i++) { if (this.lifetimes[i] <= 0) return i; } return -1; }
}


// ---- Level Generator ----
function seededRandom(seed: number): () => number { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
function dateSeed(): number { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

function generateLevel(levelNum: number, mode: GameMode): LevelConfig {
  const rng = seededRandom(levelNum * 137 + (mode === 'daily' ? dateSeed() : 0));
  const fieldSize = 6 + Math.min(levelNum * 0.5, 6);
  let wc: number, tc: number, pl: number, tl: number;
  switch (mode) {
    case 'classic': wc = 2 + Math.min(Math.floor(levelNum / 3), 4); tc = 3 + Math.min(levelNum, 7); pl = tc + 3; tl = 0; break;
    case 'slingshot': wc = 3 + Math.min(Math.floor(levelNum / 2), 5); tc = 2 + Math.min(Math.floor(levelNum / 2), 5); pl = tc; tl = 0; break;
    case 'time-trial': wc = 2 + Math.min(Math.floor(levelNum / 3), 3); tc = 5 + Math.min(levelNum, 10); pl = 99; tl = 30 + levelNum * 5; break;
    case 'precision': wc = 1 + Math.min(Math.floor(levelNum / 2), 3); tc = 2 + Math.min(Math.floor(levelNum / 2), 4); pl = tc; tl = 0; break;
    case 'chaos': wc = 5 + Math.min(levelNum, 8); tc = 4 + Math.min(levelNum, 6); pl = tc + 5; tl = 0; break;
    case 'zen': wc = 3 + Math.min(Math.floor(levelNum / 2), 5); tc = 0; pl = 99; tl = 0; break;
    case 'survival': wc = 2 + Math.min(Math.floor(levelNum / 2), 6); tc = 3 + levelNum; pl = Math.max(tc - levelNum, 3); tl = 60; break;
    case 'daily': wc = 3 + Math.floor(rng() * 4); tc = 5 + Math.floor(rng() * 5); pl = tc + 2; tl = 90; break;
    default: wc = 3; tc = 5; pl = 8; tl = 0;
  }

  const wells: LevelConfig['wells'] = [];
  const motions: WellMotion[] = ['static', 'orbit', 'oscillate', 'pulse-mass'];
  for (let i = 0; i < wc; i++) {
    const angle = (i / wc) * Math.PI * 2 + rng() * 0.5;
    const dist = 3 + rng() * fieldSize * 0.5;
    let motion: WellMotion = 'static';
    if (levelNum >= 3 && rng() < 0.3 + levelNum * 0.03) motion = motions[1 + Math.floor(rng() * 3)];
    if (mode === 'chaos') motion = motions[Math.floor(rng() * 4)];
    if (mode === 'zen') motion = rng() < 0.5 ? 'orbit' : 'oscillate';
    wells.push({
      x: Math.cos(angle) * dist, y: (rng() - 0.5) * 3, z: -3 - Math.sin(angle) * dist,
      mass: 1 + rng() * 3, radius: 0.3 + rng() * 0.5, color: PLANET_COLORS[i % PLANET_COLORS.length],
      motion, orbitRadius: 1 + rng() * 2, orbitSpeed: 0.3 + rng() * 0.5, oscillateAmp: 1 + rng() * 2,
    });
  }

  const targets: LevelConfig['targets'] = [];
  for (let i = 0; i < tc; i++) {
    let x: number, y: number, z: number, at = 0;
    do { const a = rng() * Math.PI * 2; const d = 2 + rng() * fieldSize; x = Math.cos(a) * d; y = (rng() - 0.5) * 4; z = -3 - Math.sin(a) * d; at++; }
    while (at < 20 && wells.some(w => Math.sqrt((x - w.x) ** 2 + (y - w.y) ** 2 + (z - w.z) ** 2) < w.radius + 0.5));
    targets.push({ x, y, z, points: 100 + Math.floor(rng() * 5) * 50 });
  }

  const powerUps: LevelConfig['powerUps'] = [];
  const puTypes: PowerUpType[] = ['shield', 'magnet', 'multi-shot', 'time-freeze'];
  if (levelNum >= 2 && mode !== 'zen') {
    const puCount = Math.min(1 + Math.floor(levelNum / 4), 3);
    for (let i = 0; i < puCount; i++) {
      const a = rng() * Math.PI * 2; const d = 2 + rng() * fieldSize * 0.7;
      powerUps.push({ x: Math.cos(a) * d, y: (rng() - 0.5) * 3, z: -3 - Math.sin(a) * d, type: puTypes[Math.floor(rng() * puTypes.length)] });
    }
  }

  const wormholes: LevelConfig['wormholes'] = [];
  if (levelNum >= 5 && mode !== 'zen' && mode !== 'precision' && rng() < 0.5 + levelNum * 0.02) {
    const a1 = rng() * Math.PI * 2; const d1 = 3 + rng() * fieldSize * 0.4;
    const a2 = a1 + Math.PI * (0.5 + rng() * 1.0); const d2 = 3 + rng() * fieldSize * 0.4;
    wormholes.push({
      ax: Math.cos(a1) * d1, ay: (rng() - 0.5) * 2, az: -3 - Math.sin(a1) * d1,
      bx: Math.cos(a2) * d2, by: (rng() - 0.5) * 2, bz: -3 - Math.sin(a2) * d2,
    });
  }

  // R3: Asteroid obstacles — appear from level 3+, more in chaos/survival
  const asteroids: LevelConfig['asteroids'] = [];
  if (levelNum >= 3 && mode !== 'zen') {
    let astCount = Math.min(Math.floor(levelNum / 2), 5);
    if (mode === 'chaos') astCount = Math.min(levelNum, 8);
    if (mode === 'survival') astCount = Math.min(2 + Math.floor(levelNum / 3), 6);
    for (let i = 0; i < astCount; i++) {
      const a = rng() * Math.PI * 2; const d = 2 + rng() * fieldSize * 0.6;
      const radius = ASTEROID_MIN_RADIUS + rng() * (ASTEROID_MAX_RADIUS - ASTEROID_MIN_RADIUS);
      asteroids.push({ x: Math.cos(a) * d, y: (rng() - 0.5) * 3, z: -3 - Math.sin(a) * d, radius });
    }
  }

  const names: Record<GameMode, string> = { classic: 'Classic', slingshot: 'Slingshot', 'time-trial': 'Time Trial', precision: 'Precision', chaos: 'Chaos', zen: 'Zen', survival: 'Survival', daily: 'Daily' };
  return { wells, targets, powerUps, wormholes, asteroids, probeLimit: pl, timeLimit: tl, name: `${names[mode]} ${mode === 'daily' ? '' : `Level ${levelNum}`}` };
}


// ---- Game Manager ----
class GameManager {
  state: GameState = 'menu'; mode: GameMode = 'classic'; level = 1;
  score = 0; probesUsed = 0; probesRemaining = 10; targetsCollected = 0; targetsTotal = 0;
  elapsedTime = 0; combo = 0; bestCombo = 0; lastCollectTime = 0;
  slowMo = false; timeScale = 1; charging = false; chargeAmount = 0;
  theme: ThemeName = 'deep-space'; showTrajectory = true;
  trailLen: 'short' | 'medium' | 'long' = 'long';
  showGravityLines = true;
  activePowerUp: PowerUpType | null = null; powerUpTimer = 0;
  shieldActive = false; magnetActive = false; multiShotActive = false; timeFreezeActive = false;
  totalPowerUpsCollected = 0;
  totalScore = 0; gamesPlayed = 0; totalProbesLaunched = 0; totalTargetsCollected = 0;
  allTimeBestCombo = 0; planetsCrashedInto = 0; perfectLevels = 0; longestOrbit = 0; totalPlayTime = 0;
  dailyStreak = 0; xp = 0; playerLevel = 1; xpToNext = 100;
  wormholeUses = 0; lastDailyDate = '';
  currentLevel: LevelConfig | null = null; wells: GravityWell[] = []; probes: Probe[] = [];
  targets: Target[] = []; powerUps: PowerUp[] = []; wormholes: WormholePortal[] = [];
  // R2: Camera follow
  cameraFollow = false; cameraFollowTarget: Probe | null = null;
  // R2: New high score flag
  newHighScore = false;
  // R2: Slingshot notification
  slingshotNotif = false; slingshotNotifTimer = 0;

  achievements: Achievement[] = [
    { id: 'first-contact', name: 'First Contact', desc: 'Collect your first target', unlocked: false },
    { id: 'orbital-5', name: 'Orbital Mechanic', desc: 'Complete 5 levels', unlocked: false },
    { id: 'slingshot-3', name: 'Slingshot Master', desc: '3 gravity assists in one probe', unlocked: false },
    { id: 'sharp-100', name: 'Sharp Shooter', desc: '100% accuracy on a level', unlocked: false },
    { id: 'speed-30', name: 'Speed Runner', desc: 'Clear level under 30s', unlocked: false },
    { id: 'combo-5', name: 'Combo King', desc: 'Reach x5 combo', unlocked: false },
    { id: 'efficient-3', name: 'Efficient Pilot', desc: 'Hit 3 targets with 1 probe', unlocked: false },
    { id: 'marathon-30', name: 'Marathon', desc: 'Play for 30 minutes', unlocked: false },
    { id: 'collect-100', name: 'Collector', desc: 'Gather 100 total targets', unlocked: false },
    { id: 'orbit-3', name: 'Planet Hugger', desc: 'Orbit a planet 3 times', unlocked: false },
    { id: 'zen-1', name: 'Zero G', desc: 'Complete a Zen session', unlocked: false },
    { id: 'daily-7', name: 'Daily Driver', desc: '7 daily challenges', unlocked: false },
    { id: 'chaos-1', name: 'Chaos Theory', desc: 'Clear a Chaos level', unlocked: false },
    { id: 'survive-10', name: 'Survivor', desc: 'Reach wave 10 in Survival', unlocked: false },
    { id: 'slowmo-50', name: 'Time Warp', desc: 'Use slow-mo 50 times', unlocked: false },
    { id: 'graze-05', name: 'Gravity Surfer', desc: 'Pass within 0.5m of a planet', unlocked: false },
    { id: 'multi-5', name: 'Multi-orbit', desc: '5 probes alive at once', unlocked: false },
    { id: 'score-10k', name: 'Score Hunter', desc: 'Reach 10,000 total score', unlocked: false },
    { id: 'star-10', name: 'Triple Star', desc: '3-star on 10 levels', unlocked: false },
    { id: 'minimalist', name: 'Minimalist', desc: 'Clear a level with 1 probe', unlocked: false },
    { id: 'collect-500', name: 'Hoarder', desc: 'Collect 500 total targets', unlocked: false },
    { id: 'combo-10', name: 'Combo Legend', desc: 'Reach x10 combo', unlocked: false },
    { id: 'score-50k', name: 'High Scorer', desc: 'Reach 50,000 total score', unlocked: false },
    { id: 'perfect-5', name: 'Perfectionist', desc: '5 perfect levels', unlocked: false },
    { id: 'graze-02', name: 'Daredevil', desc: 'Pass within 0.2m of a planet', unlocked: false },
    { id: 'orbit-10', name: 'Orbital Master', desc: 'One probe orbits 10 times', unlocked: false },
    { id: 'slingshot-5', name: 'Gravity Wizard', desc: '5 gravity assists one probe', unlocked: false },
    { id: 'crash-20', name: 'Crash Test', desc: 'Crash into 20 planets total', unlocked: false },
    { id: 'probes-200', name: 'Probe Master', desc: 'Launch 200 total probes', unlocked: false },
    { id: 'games-50', name: 'Veteran', desc: 'Play 50 games', unlocked: false },
    { id: 'speed-15', name: 'Warp Speed', desc: 'Clear level under 15s', unlocked: false },
    { id: 'precision-1', name: 'Laser Focus', desc: 'Clear a Precision level', unlocked: false },
    { id: 'all-modes', name: 'Explorer', desc: 'Play every game mode', unlocked: false },
    { id: 'time-trial-1', name: 'Against the Clock', desc: 'Clear a Time Trial level', unlocked: false },
    { id: 'lvl-10', name: 'Journeyman', desc: 'Reach level 10', unlocked: false },
    { id: 'lvl-25', name: 'Expert', desc: 'Reach level 25', unlocked: false },
    { id: 'slowmo-100', name: 'Time Lord', desc: 'Use slow-mo 100 times', unlocked: false },
    { id: 'survive-20', name: 'Iron Will', desc: 'Reach wave 20 in Survival', unlocked: false },
    { id: 'streak-14', name: 'Dedicated', desc: '14-day daily streak', unlocked: false },
    { id: 'score-100k', name: 'Legend', desc: 'Reach 100,000 total score', unlocked: false },
    { id: 'powerup-first', name: 'Powered Up', desc: 'Collect your first power-up', unlocked: false },
    { id: 'powerup-10', name: 'Power Hoarder', desc: 'Collect 10 power-ups total', unlocked: false },
    { id: 'shield-save', name: 'Close Call', desc: 'Shield saves you from a crash', unlocked: false },
    { id: 'wormhole-1', name: 'Warp Jump', desc: 'Send a probe through a wormhole', unlocked: false },
    { id: 'wormhole-10', name: 'Portal Master', desc: 'Use wormholes 10 times', unlocked: false },
    { id: 'magnet-3', name: 'Magnetic Personality', desc: 'Attract 3 targets with magnet', unlocked: false },
    { id: 'multi-shot-1', name: 'Scatter Shot', desc: 'Launch a multi-shot volley', unlocked: false },
    { id: 'freeze-collect', name: 'Frozen in Time', desc: 'Collect 3 targets during time-freeze', unlocked: false },
    { id: 'asteroid-dodge-10', name: 'Rock Dodger', desc: 'Dodge 10 asteroids', unlocked: false },
    { id: 'asteroid-dodge-50', name: 'Asteroid Ace', desc: 'Dodge 50 asteroids', unlocked: false },
    { id: 'graze-master', name: 'Graze Master', desc: 'Get 20 graze bonuses', unlocked: false },
    { id: 'orbit-score', name: 'Orbital Scorer', desc: 'Score 5 orbit bonuses', unlocked: false },
    { id: 'close-shave', name: 'Close Shave', desc: 'Graze 3 wells in a single probe', unlocked: false },
  ];
  modesPlayed = new Set<GameMode>(); slowMoCount = 0; tripleStarCount = 0; levelsCompleted = 0;
  pendingAchievements: Achievement[] = [];
  magnetCollects = 0; freezeCollects = 0;
  // R3: Graze and orbit scoring
  totalGrazeBonus = 0; grazeCount = 0; orbitBonusCount = 0;
  grazeCooldowns: Map<number, number> = new Map();
  // R3: Asteroid tracking
  asteroidsDodged = 0; asteroidsHit = 0;
  // R3: Survival wave tracking
  survivalWave = 1; survivalTargetsThisWave = 0; survivalWaveBannerTimer = 0;
  // R3: Tutorial
  tutorialHintsShown = 0; tutorialComplete = false;
  // R3: Celebration
  celebration: CelebrationState = { active: false, timer: 0, threeStars: false };
  // R3: Proximity danger
  dangerWarningTimer = 0; maxProximity = 0;

  getTrailLen(): number { return this.trailLen === 'short' ? 40 : this.trailLen === 'medium' ? 80 : 120; }
  getPlayerTitle(): string {
    const t = ['Cadet','Pilot','Navigator','Commander','Captain','Admiral','Voyager','Explorer','Astronaut','Cosmonaut','Star Pilot','Orbital Engineer','Gravity Master','Void Walker','Space Legend','Cosmic Sage','Nebula Lord','Galaxy Commander','Universe Traveler','Ascended'];
    return t[Math.min(this.playerLevel - 1, t.length - 1)];
  }
  addXP(amount: number) { this.xp += amount; while (this.xp >= this.xpToNext) { this.xp -= this.xpToNext; this.playerLevel++; this.xpToNext = 100 + (this.playerLevel - 1) * 50; } }
  getStars(): number {
    if (!this.currentLevel || this.currentLevel.targets.length === 0) return 0;
    const acc = this.probesUsed > 0 ? this.targetsCollected / this.probesUsed : 0;
    const comp = this.targetsCollected / this.targetsTotal;
    if (comp >= 1 && acc >= 0.8) return 3; if (comp >= 0.8) return 2; if (comp >= 0.5) return 1; return 0;
  }
  getRating(): string { const s = this.getStars(); return s === 3 ? '***' : s === 2 ? '**' : s === 1 ? '*' : '--'; }

  activatePowerUp(type: PowerUpType) {
    this.activePowerUp = type; this.powerUpTimer = POWERUP_DURATION;
    this.totalPowerUpsCollected++;
    switch (type) {
      case 'shield': this.shieldActive = true; break;
      case 'magnet': this.magnetActive = true; this.magnetCollects = 0; break;
      case 'multi-shot': this.multiShotActive = true; break;
      case 'time-freeze': this.timeFreezeActive = true; this.freezeCollects = 0; break;
    }
  }

  deactivatePowerUp() {
    if (this.activePowerUp === 'magnet') this.magnetActive = false;
    if (this.activePowerUp === 'multi-shot') this.multiShotActive = false;
    if (this.activePowerUp === 'time-freeze') this.timeFreezeActive = false;
    if (this.activePowerUp !== 'shield') this.activePowerUp = null;
    this.powerUpTimer = 0;
  }

  checkAchievements() {
    const ck = (id: string, cond: boolean) => {
      const a = this.achievements.find(a => a.id === id);
      if (a && !a.unlocked && cond) { a.unlocked = true; this.pendingAchievements.push(a); }
    };
    ck('first-contact', this.totalTargetsCollected >= 1); ck('orbital-5', this.levelsCompleted >= 5);
    ck('sharp-100', this.probesUsed > 0 && this.targetsCollected === this.targetsTotal && this.targetsCollected === this.probesUsed);
    ck('speed-30', this.elapsedTime < 30 && this.targetsCollected === this.targetsTotal && this.targetsTotal > 0);
    ck('combo-5', this.bestCombo >= 5); ck('marathon-30', this.totalPlayTime >= 1800);
    ck('collect-100', this.totalTargetsCollected >= 100); ck('zen-1', this.mode === 'zen');
    ck('chaos-1', this.mode === 'chaos' && this.targetsCollected === this.targetsTotal);
    ck('survive-10', this.mode === 'survival' && this.level >= 10);
    ck('slowmo-50', this.slowMoCount >= 50); ck('multi-5', this.probes.filter(p => p.alive).length >= 5);
    ck('score-10k', this.totalScore >= 10000); ck('star-10', this.tripleStarCount >= 10);
    ck('minimalist', this.probesUsed === 1 && this.targetsCollected === this.targetsTotal && this.targetsTotal > 0);
    ck('collect-500', this.totalTargetsCollected >= 500); ck('combo-10', this.bestCombo >= 10);
    ck('score-50k', this.totalScore >= 50000); ck('perfect-5', this.perfectLevels >= 5);
    ck('crash-20', this.planetsCrashedInto >= 20); ck('probes-200', this.totalProbesLaunched >= 200);
    ck('games-50', this.gamesPlayed >= 50); ck('speed-15', this.elapsedTime < 15 && this.targetsCollected === this.targetsTotal && this.targetsTotal > 0);
    ck('precision-1', this.mode === 'precision' && this.targetsCollected === this.targetsTotal);
    ck('all-modes', this.modesPlayed.size >= 8); ck('time-trial-1', this.mode === 'time-trial' && this.targetsCollected === this.targetsTotal);
    ck('lvl-10', this.level >= 10); ck('lvl-25', this.level >= 25);
    ck('slowmo-100', this.slowMoCount >= 100); ck('survive-20', this.mode === 'survival' && this.level >= 20);
    ck('streak-14', this.dailyStreak >= 14); ck('score-100k', this.totalScore >= 100000);
    ck('powerup-first', this.totalPowerUpsCollected >= 1); ck('powerup-10', this.totalPowerUpsCollected >= 10);
    ck('wormhole-1', this.wormholeUses >= 1); ck('wormhole-10', this.wormholeUses >= 10);
    ck('magnet-3', this.magnetCollects >= 3); ck('freeze-collect', this.freezeCollects >= 3);
    ck('asteroid-dodge-10', this.asteroidsDodged >= 10); ck('asteroid-dodge-50', this.asteroidsDodged >= 50);
    ck('graze-master', this.grazeCount >= 20); ck('orbit-score', this.orbitBonusCount >= 5);
  }
}


// ---- Scene Builders ----
function createStarField(scene: Object3D, count = 1200): { points: Points; twinkle: (time: number) => void } {
  const pos = new Float32Array(count * 3); const col = new Float32Array(count * 3);
  const baseBright = new Float32Array(count); const twinkleSpeed = new Float32Array(count);
  const twinklePhase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2; const phi = Math.acos(2 * Math.random() - 1); const r = 40 + Math.random() * 60;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta); pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta); pos[i * 3 + 2] = r * Math.cos(phi);
    const b = 0.3 + Math.random() * 0.7;
    baseBright[i] = b; twinkleSpeed[i] = 0.5 + Math.random() * 3; twinklePhase[i] = Math.random() * Math.PI * 2;
    // R2: Color variation — some stars are warm, some cool
    const warmth = Math.random();
    col[i * 3] = b * (warmth > 0.7 ? 1.2 : 0.9); col[i * 3 + 1] = b; col[i * 3 + 2] = b * (warmth < 0.3 ? 1.2 : 0.9);
  }
  const geo = new BufferGeometry(); geo.setAttribute('position', new Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const mat = new PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, sizeAttenuation: true });
  const stars = new Points(geo, mat); scene.add(stars);

  const twinkle = (time: number) => {
    const colAttr = geo.attributes.color;
    const arr = colAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const t = Math.sin(time * twinkleSpeed[i] + twinklePhase[i]) * 0.3 + 0.7;
      const b = baseBright[i] * t;
      arr[i * 3] *= t; arr[i * 3 + 1] = b; arr[i * 3 + 2] *= t;
    }
    colAttr.needsUpdate = true;
  };
  return { points: stars, twinkle };
}

// R2: Nebula clouds — large semi-transparent spheres in the background
function createNebulaClouds(scene: Object3D, color: number, count = 6): Mesh[] {
  const clouds: Mesh[] = [];
  const baseColor = new Color(color);
  for (let i = 0; i < count; i++) {
    const size = 8 + Math.random() * 15;
    const geo = new SphereGeometry(size, 16, 16);
    const mat = new MeshBasicMaterial({
      color: baseColor.clone().offsetHSL(Math.random() * 0.1 - 0.05, 0, Math.random() * 0.1),
      transparent: true, opacity: 0.03 + Math.random() * 0.02,
      blending: AdditiveBlending, depthWrite: false,
    });
    const mesh = new Mesh(geo, mat);
    const angle = Math.random() * Math.PI * 2;
    const elev = (Math.random() - 0.5) * 20;
    const dist = 25 + Math.random() * 35;
    mesh.position.set(Math.cos(angle) * dist, elev, Math.sin(angle) * dist);
    scene.add(mesh);
    clouds.push(mesh);
  }
  return clouds;
}

// R2: Ambient dust — slowly drifting particles in the play area
function createAmbientDust(scene: Object3D, count = 200): { points: Points; update: (delta: number) => void } {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
    positions[i * 3 + 2] = -15 + (Math.random() - 0.5) * 30;
    velocities[i * 3] = (Math.random() - 0.5) * 0.2;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mat = new PointsMaterial({ size: 0.03, color: 0x446688, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const pts = new Points(geo, mat); pts.frustumCulled = false; scene.add(pts);

  const update = (delta: number) => {
    for (let i = 0; i < count; i++) {
      positions[i * 3] += velocities[i * 3] * delta;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;
      // Wrap around
      if (positions[i * 3] > 15) positions[i * 3] = -15;
      if (positions[i * 3] < -15) positions[i * 3] = 15;
      if (positions[i * 3 + 1] > 7.5) positions[i * 3 + 1] = -7.5;
      if (positions[i * 3 + 1] < -7.5) positions[i * 3 + 1] = 7.5;
      if (positions[i * 3 + 2] > 0) positions[i * 3 + 2] = -30;
      if (positions[i * 3 + 2] < -30) positions[i * 3 + 2] = 0;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return { points: pts, update };
}

// R2: Energy beams between nearby gravity wells
function createEnergyBeams(scene: Object3D, wells: GravityWell[]): EnergyBeam[] {
  const beams: EnergyBeam[] = [];
  for (let i = 0; i < wells.length; i++) {
    for (let j = i + 1; j < wells.length; j++) {
      const dist = wells[i].position.distanceTo(wells[j].position);
      if (dist < ENERGY_BEAM_RANGE) {
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
        const avgColor = new Color(wells[i].color).lerp(new Color(wells[j].color), 0.5);
        const line = new Line(geo, new LineBasicMaterial({ color: avgColor, transparent: true, opacity: 0.08, blending: AdditiveBlending }));
        line.frustumCulled = false;
        scene.add(line);
        beams.push({ line, wellA: i, wellB: j, phase: Math.random() * Math.PI * 2 });
      }
    }
  }
  return beams;
}

function createGridFloor(scene: Object3D, color: number): Group {
  const g = new Group(); const sz = 40; const step = 2;
  const mat = new LineBasicMaterial({ color, transparent: true, opacity: 0.15 });
  for (let i = -sz; i <= sz; i += step) {
    const gx = new BufferGeometry(); gx.setAttribute('position', new Float32BufferAttribute([i, -2, -sz, i, -2, sz], 3)); g.add(new LineSegments(gx, mat));
    const gz = new BufferGeometry(); gz.setAttribute('position', new Float32BufferAttribute([-sz, -2, i, sz, -2, i], 3)); g.add(new LineSegments(gz, mat));
  }
  scene.add(g); return g;
}

function createGravityWell(scene: Object3D, cfg: LevelConfig['wells'][0]): GravityWell {
  const group = new Group(); group.position.set(cfg.x, cfg.y, cfg.z);
  const core = new Mesh(new SphereGeometry(cfg.radius, 32, 32), new MeshStandardMaterial({ color: cfg.color, emissive: cfg.color, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.7 }));
  group.add(core);
  const glowMesh = new Mesh(new SphereGeometry(cfg.radius * 1.3, 24, 24), new MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.15, blending: AdditiveBlending, depthWrite: false }));
  group.add(glowMesh);
  const ringThickness = cfg.motion !== 'static' ? 0.04 : 0.02;
  const ringMesh = new Mesh(new TorusGeometry(cfg.radius * 2, ringThickness, 8, 64), new MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: cfg.motion !== 'static' ? 0.5 : 0.3 }));
  ringMesh.rotation.x = Math.PI * 0.5; group.add(ringMesh);
  if (cfg.motion === 'orbit') {
    const orbitRing = new Mesh(new TorusGeometry(cfg.orbitRadius || 2, 0.01, 8, 64), new MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.15 }));
    orbitRing.rotation.x = Math.PI * 0.5; group.add(orbitRing);
  }
  const fieldLines: Line[] = [];
  for (let i = 0; i < 3; i++) {
    const r = cfg.radius * (2.5 + i * 1.5); const pts: number[] = []; const segs = 48;
    for (let j = 0; j <= segs; j++) { const a = (j / segs) * Math.PI * 2; pts.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    const lg = new BufferGeometry(); lg.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const line = new Line(lg, new LineBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.08 - i * 0.02 }));
    group.add(line); fieldLines.push(line);
  }
  group.add(new PointLight(cfg.color, 0.5, cfg.radius * 8));
  scene.add(group);
  const pos = new Vector3(cfg.x, cfg.y, cfg.z);
  return {
    group, position: pos.clone(), mass: cfg.mass, baseMass: cfg.mass, radius: cfg.radius, color: cfg.color,
    glowMesh, ringMesh, fieldLines, pulsePhase: Math.random() * Math.PI * 2,
    motion: cfg.motion, orbitCenter: pos.clone(), orbitRadius: cfg.orbitRadius || 2,
    orbitSpeed: cfg.orbitSpeed || 0.4, orbitAngle: Math.random() * Math.PI * 2,
    oscillateAxis: new Vector3(0, 1, 0), oscillateAmplitude: cfg.oscillateAmp || 1.5, oscillatePhase: Math.random() * Math.PI * 2,
  };
}

function createTarget(scene: Object3D, cfg: LevelConfig['targets'][0]): Target {
  const group = new Group(); group.position.set(cfg.x, cfg.y, cfg.z);
  group.add(new Mesh(new OctahedronGeometry(TARGET_RADIUS, 0), new MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.8 })));
  group.add(new Mesh(new OctahedronGeometry(TARGET_RADIUS * 1.2, 0), new MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.4 })));
  group.add(new Mesh(new SphereGeometry(TARGET_RADIUS * 2, 12, 12), new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false })));
  scene.add(group);
  return { group, position: new Vector3(cfg.x, cfg.y, cfg.z), collected: false, pulsePhase: Math.random() * Math.PI * 2, points: cfg.points };
}

function createPowerUp(scene: Object3D, cfg: LevelConfig['powerUps'][0]): PowerUp {
  const group = new Group(); group.position.set(cfg.x, cfg.y, cfg.z);
  const colors: Record<PowerUpType, number> = { shield: 0x44aaff, magnet: 0xff44ff, 'multi-shot': 0xffaa00, 'time-freeze': 0x88ffff };
  const color = colors[cfg.type];
  const innerMesh = new Mesh(new IcosahedronGeometry(0.12, 1), new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.1, metalness: 0.9 }));
  group.add(innerMesh);
  const outerMesh = new Mesh(new IcosahedronGeometry(0.2, 0), new MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.4 }));
  group.add(outerMesh);
  group.add(new Mesh(new SphereGeometry(0.3, 12, 12), new MeshBasicMaterial({ color, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false })));
  scene.add(group);
  return { group, position: new Vector3(cfg.x, cfg.y, cfg.z), type: cfg.type, collected: false, pulsePhase: Math.random() * Math.PI * 2, innerMesh, outerMesh };
}

// R3: Asteroid obstacle
function createAsteroid(scene: Object3D, cfg: LevelConfig['asteroids'][0]): Asteroid {
  const geo = new IcosahedronGeometry(cfg.radius, 0);
  const posArr = geo.attributes.position.array as Float32Array;
  for (let i = 0; i < posArr.length; i += 3) {
    const jitter = 0.7 + Math.random() * 0.6;
    posArr[i] *= jitter; posArr[i + 1] *= jitter; posArr[i + 2] *= jitter;
  }
  geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
  const mat = new MeshStandardMaterial({ color: 0x665544, emissive: 0x221100, emissiveIntensity: 0.2, roughness: 0.9, metalness: 0.3 });
  const mesh = new Mesh(geo, mat); mesh.position.set(cfg.x, cfg.y, cfg.z); scene.add(mesh);
  const ring = new Mesh(new TorusGeometry(cfg.radius * 1.5, 0.008, 8, 24), new MeshBasicMaterial({ color: 0x886644, transparent: true, opacity: 0.2, blending: AdditiveBlending }));
  ring.rotation.x = Math.PI * 0.5; mesh.add(ring);
  return { mesh, position: new Vector3(cfg.x, cfg.y, cfg.z), radius: cfg.radius,
    rotAxis: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    rotSpeed: (0.3 + Math.random() * ASTEROID_ROTATION_SPEED) * (Math.random() > 0.5 ? 1 : -1) };
}

function createWormhole(scene: Object3D, cfg: LevelConfig['wormholes'][0]): WormholePortal {
  const makePortal = (x: number, y: number, z: number, color: number): { group: Group; ring: Mesh } => {
    const group = new Group(); group.position.set(x, y, z);
    const ring = new Mesh(new TorusGeometry(WORMHOLE_RADIUS, 0.03, 16, 32), new MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: AdditiveBlending }));
    group.add(ring);
    const disc = new Mesh(new RingGeometry(0, WORMHOLE_RADIUS * 0.8, 24), new MeshBasicMaterial({ color, transparent: true, opacity: 0.15, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }));
    group.add(disc);
    for (let i = 1; i <= 2; i++) {
      const outer = new Mesh(new TorusGeometry(WORMHOLE_RADIUS + i * 0.15, 0.01, 8, 32), new MeshBasicMaterial({ color, transparent: true, opacity: 0.2 / i, blending: AdditiveBlending }));
      group.add(outer);
    }
    scene.add(group);
    return { group, ring };
  };
  const a = makePortal(cfg.ax, cfg.ay, cfg.az, 0x8844ff);
  const b = makePortal(cfg.bx, cfg.by, cfg.bz, 0xff8844);
  return {
    groupA: a.group, groupB: b.group,
    posA: new Vector3(cfg.ax, cfg.ay, cfg.az), posB: new Vector3(cfg.bx, cfg.by, cfg.bz),
    ringA: a.ring, ringB: b.ring, phase: 0, active: true,
  };
}

function createProbe(scene: Object3D): Probe {
  const mesh = new Mesh(new SphereGeometry(PROBE_RADIUS, 16, 16), new MeshStandardMaterial({ color: 0xff8844, emissive: 0xff8844, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.9 }));
  mesh.visible = false; scene.add(mesh);
  // R2: Shield bubble
  const shieldMesh = new Mesh(
    new SphereGeometry(PROBE_RADIUS * 2.5, 16, 16),
    new MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.15, blending: AdditiveBlending, depthWrite: false, wireframe: true }),
  );
  shieldMesh.visible = false; scene.add(shieldMesh);
  // R2: Probe glow light
  const glowLight = new PointLight(0xff8844, 0, 3);
  scene.add(glowLight);
  const trailPositions: Vector3[] = []; for (let i = 0; i < TRAIL_LENGTH; i++) trailPositions.push(new Vector3());
  const tg = new BufferGeometry(); tg.setAttribute('position', new Float32BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3));
  const trailLine = new Line(tg, new LineBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.6 }));
  trailLine.visible = false; trailLine.frustumCulled = false; scene.add(trailLine);
  return { mesh, trailLine, trailPositions, position: new Vector3(), velocity: new Vector3(), alive: false, age: 0, orbitCount: 0, lastWellIdx: -1, closestApproach: Infinity, shielded: false, targetsHitThisProbe: 0, slingshotNotified: false, shieldMesh, glowLight };
}

function createPredictionLine(scene: Object3D): Line {
  const geo = new BufferGeometry(); geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(PREDICTION_STEPS * 3), 3));
  const line = new Line(geo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
  line.visible = false; line.frustumCulled = false; scene.add(line); return line;
}

function createLaunchIndicator(scene: Object3D): Group {
  const g = new Group();
  const arrow = new Mesh(new CylinderGeometry(0.01, 0.01, 0.5, 8), new MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.6 }));
  arrow.rotation.x = Math.PI / 2; arrow.position.z = -0.3; g.add(arrow);
  const tip = new Mesh(new CylinderGeometry(0, 0.03, 0.08, 8), new MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.8 }));
  tip.rotation.x = Math.PI / 2; tip.position.z = -0.55; g.add(tip);
  g.visible = false; scene.add(g); return g;
}



// ---- Gravity ----
const _tv = new Vector3();
function computeGravity(pos: Vector3, wells: GravityWell[], out: Vector3): void {
  out.set(0, 0, 0);
  for (const w of wells) {
    _tv.subVectors(w.position, pos); const dSq = _tv.lengthSq(); const d = Math.sqrt(dSq);
    if (d < w.radius * 0.5) continue;
    _tv.normalize().multiplyScalar(G_CONSTANT * w.mass / Math.max(dSq, 0.1));
    out.add(_tv);
  }
}

function simulateTrajectory(startPos: Vector3, startVel: Vector3, wells: GravityWell[], steps: number, dt: number, outPos: Float32Array): number {
  const p = startPos.clone(); const v = startVel.clone(); const a = new Vector3();
  let valid = 0;
  for (let i = 0; i < steps; i++) {
    computeGravity(p, wells, a); v.addScaledVector(a, dt); p.addScaledVector(v, dt);
    outPos[i * 3] = p.x; outPos[i * 3 + 1] = p.y; outPos[i * 3 + 2] = p.z; valid++;
    for (const w of wells) { if (p.distanceTo(w.position) < w.radius) return valid; }
    if (p.length() > MAX_DISTANCE * 1.5) return valid;
  }
  return valid;
}


// R3: Create gravity interaction lines (show pull direction from probes to wells)
function createGravInteractionLines(scene: Object3D, count: number): GravInteractionLine[] {
  const lines: GravInteractionLine[] = [];
  for (let i = 0; i < count; i++) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    const line = new Line(geo, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending }));
    line.frustumCulled = false;
    scene.add(line);
    lines.push({ line, active: false });
  }
  return lines;
}


// ---- Orbit Physics System ----
class OrbitPhysicsSystem extends createSystem({}) {
  private game!: GameManager; private audio!: AudioManager; private particles!: ParticlePool;
  private shake!: ScreenShake; private shootingStars!: ShootingStarManager;
  private scorePopups!: ScorePopupPool;
  private probes: Probe[] = []; private wells: GravityWell[] = [];
  private targets: Target[] = []; private powerUps: PowerUp[] = []; private wormholes: WormholePortal[] = [];
  private energyBeams: EnergyBeam[] = [];
  private gravLines: GravInteractionLine[] = [];
  private asteroids: Asteroid[] = [];
  private dustUpdate: ((delta: number) => void) | null = null;
  private accel = new Vector3();
  private starTwinkle: ((time: number) => void) | null = null;
  private globalTime = 0;
  // R2: Time freeze visual refs
  private ambient: AmbientLight | null = null;
  private fog: Fog | null = null;
  private savedAmbientColor = new Color();
  private savedFogColor = new Color();
  private timeFreezeVisualActive = false;
  // R2: Speed color interpolation
  private speedColorSlow = new Color(0x4488ff);
  private speedColorFast = new Color(0xff4444);

  setRefs(refs: {
    game: GameManager; audio: AudioManager; particles: ParticlePool; shake: ScreenShake;
    shootingStars: ShootingStarManager; scorePopups: ScorePopupPool;
    probes: Probe[]; wells: GravityWell[]; targets: Target[];
    powerUps: PowerUp[]; wormholes: WormholePortal[];
    energyBeams: EnergyBeam[]; gravLines?: GravInteractionLine[]; asteroids?: Asteroid[];
    dustUpdate?: (delta: number) => void;
    starTwinkle?: (time: number) => void;
    ambient?: AmbientLight; fog?: Fog;
  }) {
    this.game = refs.game; this.audio = refs.audio; this.particles = refs.particles;
    this.shake = refs.shake; this.shootingStars = refs.shootingStars;
    this.scorePopups = refs.scorePopups;
    this.probes = refs.probes; this.wells = refs.wells;
    this.targets = refs.targets; this.powerUps = refs.powerUps; this.wormholes = refs.wormholes;
    this.energyBeams = refs.energyBeams;
    if (refs.gravLines) this.gravLines = refs.gravLines;
    if (refs.asteroids) this.asteroids = refs.asteroids;
    if (refs.dustUpdate) this.dustUpdate = refs.dustUpdate;
    if (refs.starTwinkle) this.starTwinkle = refs.starTwinkle;
    if (refs.ambient) { this.ambient = refs.ambient; this.savedAmbientColor.copy(refs.ambient.color); }
    if (refs.fog) { this.fog = refs.fog; this.savedFogColor.copy(refs.fog.color); }
  }

  update(delta: number, _time: number) {
    this.globalTime += delta;
    // Star twinkling
    if (this.starTwinkle && Math.floor(this.globalTime * 4) !== Math.floor((this.globalTime - delta) * 4)) {
      this.starTwinkle(this.globalTime);
    }
    // R2: Shooting stars
    this.shootingStars.update(delta);
    // R2: Ambient dust
    if (this.dustUpdate) this.dustUpdate(delta);
    // Screen shake
    this.shake.update(delta, this.camera);
    // Music reactivity
    if (this.game.state === 'playing') {
      const alive = this.probes.filter(p => p.alive).length;
      const intensity = alive >= 3 ? 3 : alive >= 1 ? 2 : 1;
      this.audio.setIntensity(intensity);
    } else if (this.game.state === 'menu') {
      this.audio.setIntensity(0);
    }
    this.audio.updateMusic(delta);

    // R2: Energy beam animation
    for (const beam of this.energyBeams) {
      beam.phase += delta * 2;
      const wA = this.wells[beam.wellA]; const wB = this.wells[beam.wellB];
      if (!wA || !wB) continue;
      const pa = beam.line.geometry.attributes.position.array as Float32Array;
      pa[0] = wA.position.x; pa[1] = wA.position.y; pa[2] = wA.position.z;
      pa[3] = wB.position.x; pa[4] = wB.position.y; pa[5] = wB.position.z;
      beam.line.geometry.attributes.position.needsUpdate = true;
      (beam.line.material as LineBasicMaterial).opacity = 0.04 + Math.sin(beam.phase) * 0.03;
    }

    // R2: Slingshot notification timer
    if (this.game.slingshotNotif) {
      this.game.slingshotNotifTimer -= delta;
      if (this.game.slingshotNotifTimer <= 0) this.game.slingshotNotif = false;
    }

    if (this.game.state !== 'playing') return;
    const dt = delta * this.game.timeScale;
    this.game.elapsedTime += dt; this.game.totalPlayTime += delta;

    // R2: Time freeze visual effect
    if (this.game.timeFreezeActive && !this.timeFreezeVisualActive) {
      this.timeFreezeVisualActive = true;
      if (this.ambient) this.ambient.color.set(0x224488);
      if (this.fog) this.fog.color.set(0x001133);
    } else if (!this.game.timeFreezeActive && this.timeFreezeVisualActive) {
      this.timeFreezeVisualActive = false;
      if (this.ambient) this.ambient.color.copy(this.savedAmbientColor);
      if (this.fog) this.fog.color.copy(this.savedFogColor);
    }

    // Power-up timer
    if (this.game.activePowerUp && this.game.activePowerUp !== 'shield') {
      this.game.powerUpTimer -= dt;
      if (this.game.powerUpTimer <= 0) this.game.deactivatePowerUp();
    }

    // Time limit
    if (this.game.currentLevel && this.game.currentLevel.timeLimit > 0 && this.game.elapsedTime >= this.game.currentLevel.timeLimit) { this.endLevel(); return; }

    // Update moving wells
    for (const w of this.wells) {
      if (this.game.timeFreezeActive && w.motion !== 'static') continue;
      switch (w.motion) {
        case 'orbit':
          w.orbitAngle += w.orbitSpeed * dt;
          w.position.x = w.orbitCenter.x + Math.cos(w.orbitAngle) * w.orbitRadius;
          w.position.z = w.orbitCenter.z + Math.sin(w.orbitAngle) * w.orbitRadius;
          w.group.position.copy(w.position);
          break;
        case 'oscillate':
          w.oscillatePhase += dt * 1.5;
          const osc = Math.sin(w.oscillatePhase) * w.oscillateAmplitude;
          w.position.y = w.orbitCenter.y + osc;
          w.group.position.copy(w.position);
          break;
        case 'pulse-mass':
          w.mass = w.baseMass * (1 + Math.sin(this.globalTime * 2 + w.pulsePhase) * 0.4);
          const scale = 0.85 + (w.mass / w.baseMass) * 0.15;
          w.group.scale.setScalar(scale);
          break;
      }
    }

    // Probe physics
    for (const pr of this.probes) {
      if (!pr.alive) continue;
      pr.age += dt;
      computeGravity(pr.position, this.wells, this.accel);

      // Magnet
      if (this.game.magnetActive) {
        let nearest: Target | null = null; let nearDist = MAGNET_RANGE;
        for (const tgt of this.targets) {
          if (tgt.collected) continue;
          const d = pr.position.distanceTo(tgt.position);
          if (d < nearDist) { nearest = tgt; nearDist = d; }
        }
        if (nearest) {
          const dir = new Vector3().subVectors(nearest.position, pr.position).normalize();
          this.accel.addScaledVector(dir, MAGNET_FORCE * (1 - nearDist / MAGNET_RANGE));
        }
      }

      pr.velocity.addScaledVector(this.accel, dt);
      pr.position.addScaledVector(pr.velocity, dt);
      pr.mesh.position.copy(pr.position);
      // R2: Shield bubble follows probe
      pr.shieldMesh.position.copy(pr.position);
      pr.shieldMesh.visible = pr.shielded;
      pr.shieldMesh.rotation.y += dt * 2;
      pr.shieldMesh.rotation.x += dt * 1.5;
      // R2: Probe glow light follows probe, intensity based on speed
      const spd = pr.velocity.length();
      pr.glowLight.position.copy(pr.position);
      pr.glowLight.intensity = Math.min(spd * 0.1, 0.8);
      // R2: Speed-based trail color
      const spdNorm = Math.min(spd / LAUNCH_MAX_SPEED, 1);
      const trailColor = new Color().lerpColors(this.speedColorSlow, this.speedColorFast, spdNorm);
      (pr.trailLine.material as LineBasicMaterial).color.copy(trailColor);
      // R2: Probe emissive intensity based on speed
      (pr.mesh.material as MeshStandardMaterial).emissiveIntensity = 0.5 + spdNorm * 0.8;
      // Trail
      pr.trailPositions.pop(); pr.trailPositions.unshift(pr.position.clone());
      const tl = this.game.getTrailLen();
      const pa = pr.trailLine.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        const tp = i < tl ? pr.trailPositions[i] : pr.trailPositions[Math.min(i, tl - 1)];
        pa[i * 3] = tp.x; pa[i * 3 + 1] = tp.y; pa[i * 3 + 2] = tp.z;
      }
      pr.trailLine.geometry.attributes.position.needsUpdate = true;
      // Orbit tracking
      for (let wi = 0; wi < this.wells.length; wi++) {
        const dist = pr.position.distanceTo(this.wells[wi].position);
        if (dist < pr.closestApproach) pr.closestApproach = dist;
        if (dist < this.wells[wi].radius * 4 && wi !== pr.lastWellIdx) {
          if (pr.lastWellIdx >= 0) pr.orbitCount++;
          pr.lastWellIdx = wi;
          // R2: Slingshot detection — gravity assist feedback
          if (pr.orbitCount >= 1 && !pr.slingshotNotified) {
            pr.slingshotNotified = true;
            this.game.slingshotNotif = true; this.game.slingshotNotifTimer = 1.5;
            this.audio.playSlingshot();
            const dir = pr.velocity.clone().normalize();
            this.particles.emitDirectional(pr.position, dir, new Color(0xffaa44), 12, 0.4, 4, 0.4);
          }
        }
      }
      // Collision with wells
      let crashed = false;
      for (const w of this.wells) {
        if (pr.position.distanceTo(w.position) < w.radius) {
          if (pr.shielded) {
            pr.shielded = false; this.game.shieldActive = false;
            if (this.game.activePowerUp === 'shield') { this.game.activePowerUp = null; this.game.powerUpTimer = 0; }
            this.audio.playShieldBreak();
            this.particles.emitRing(pr.position, new Color(0x44aaff), 20, 0.5, 0.8);
            this.shake.trigger(0.3);
            const normal = new Vector3().subVectors(pr.position, w.position).normalize();
            pr.velocity.reflect(normal).multiplyScalar(0.7);
            pr.position.addScaledVector(normal, w.radius + 0.1 - pr.position.distanceTo(w.position));
            const ach = this.game.achievements.find(a => a.id === 'shield-save');
            if (ach && !ach.unlocked) { ach.unlocked = true; this.game.pendingAchievements.push(ach); }
          } else {
            crashed = true; this.audio.playCrash(); this.particles.emit(pr.position, new Color(w.color), 30, 3, 0.6);
            this.game.planetsCrashedInto++; this.shake.trigger(0.6); break;
          }
        }
      }
      if (pr.position.length() > MAX_DISTANCE) crashed = true;
      if (crashed) { this.killProbe(pr); continue; }

      // Wormhole
      for (const wh of this.wormholes) {
        if (!wh.active) continue;
        const dA = pr.position.distanceTo(wh.posA);
        const dB = pr.position.distanceTo(wh.posB);
        if (dA < WORMHOLE_RADIUS) {
          pr.position.copy(wh.posB).addScaledVector(pr.velocity.clone().normalize(), WORMHOLE_RADIUS + 0.1);
          pr.velocity.multiplyScalar(1.2);
          this.audio.playWormhole(); this.particles.emitRing(wh.posA, new Color(0x8844ff), 16, WORMHOLE_RADIUS);
          this.particles.emitRing(wh.posB, new Color(0xff8844), 16, WORMHOLE_RADIUS);
          this.game.wormholeUses++; wh.active = false; setTimeout(() => { wh.active = true; }, 1500);
          this.shake.trigger(0.2);
        } else if (dB < WORMHOLE_RADIUS) {
          pr.position.copy(wh.posA).addScaledVector(pr.velocity.clone().normalize(), WORMHOLE_RADIUS + 0.1);
          pr.velocity.multiplyScalar(1.2);
          this.audio.playWormhole(); this.particles.emitRing(wh.posB, new Color(0xff8844), 16, WORMHOLE_RADIUS);
          this.particles.emitRing(wh.posA, new Color(0x8844ff), 16, WORMHOLE_RADIUS);
          this.game.wormholeUses++; wh.active = false; setTimeout(() => { wh.active = true; }, 1500);
          this.shake.trigger(0.2);
        }
      }

      // Target collection
      for (const tgt of this.targets) {
        if (tgt.collected) continue;
        if (pr.position.distanceTo(tgt.position) < TARGET_RADIUS + PROBE_RADIUS + 0.15) this.collectTarget(tgt, pr);
      }
      // Power-up collection
      for (const pu of this.powerUps) {
        if (pu.collected) continue;
        if (pr.position.distanceTo(pu.position) < 0.25) this.collectPowerUp(pu, pr);
      }
      // R3: Asteroid collision
      for (const ast of this.asteroids) {
        if (pr.position.distanceTo(ast.position) < ast.radius + PROBE_RADIUS) {
          if (pr.shielded) {
            pr.shielded = false; this.game.shieldActive = false;
            if (this.game.activePowerUp === 'shield') { this.game.activePowerUp = null; this.game.powerUpTimer = 0; }
            this.audio.playShieldBreak();
            this.particles.emit(ast.position, new Color(0x886644), 15, 2, 0.5);
            const normal = new Vector3().subVectors(pr.position, ast.position).normalize();
            pr.velocity.reflect(normal).multiplyScalar(0.5);
            pr.position.addScaledVector(normal, ast.radius + PROBE_RADIUS + 0.05 - pr.position.distanceTo(ast.position));
            this.shake.trigger(0.2);
          } else {
            this.audio.playAsteroidHit();
            this.particles.emit(ast.position, new Color(0x886644), 20, 3, 0.6);
            this.game.asteroidsHit++; this.shake.trigger(0.4);
            this.killProbe(pr); crashed = true; break;
          }
        }
      }
      if (crashed) continue;
      // R3: Graze bonus scoring — near-miss reward for passing close to wells
      for (let wi = 0; wi < this.wells.length; wi++) {
        const w = this.wells[wi];
        const dist = pr.position.distanceTo(w.position);
        const grazeZone = w.radius * GRAZE_ZONE_MULT;
        if (dist > w.radius && dist < grazeZone) {
          const lastTime = this.game.grazeCooldowns.get(wi) ?? -999;
          if (this.game.elapsedTime - lastTime > GRAZE_COOLDOWN) {
            this.game.grazeCooldowns.set(wi, this.game.elapsedTime);
            const proximity = 1 - (dist - w.radius) / (grazeZone - w.radius);
            const bonus = Math.round(GRAZE_BONUS_BASE * (1 + proximity * 2));
            this.game.score += bonus; this.game.totalScore += bonus;
            this.game.grazeCount++; this.game.totalGrazeBonus += bonus;
            this.audio.playGraze(proximity);
            // Visual: small golden spark trail
            this.particles.emitDirectional(pr.position, pr.velocity.clone().normalize(), new Color(0xffdd44), 6, 0.3, 2, 0.3);
            this.scorePopups.spawn(pr.position, bonus, 1);
            // Track graze per probe for close-shave achievement
            if (!('_grazeWells' in pr)) (pr as any)._grazeWells = new Set();
            (pr as any)._grazeWells.add(wi);
            if ((pr as any)._grazeWells.size >= 3) {
              const a = this.game.achievements.find(a => a.id === 'close-shave');
              if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); }
            }
            this.game.asteroidsDodged++; // counts as "dodging" near the well
          }
        }
      }
      // R3: Orbit bonus scoring — reward for completing orbits around wells
      if (pr.orbitCount > 0 && pr.orbitCount !== (pr as any)._lastBonusOrbit) {
        (pr as any)._lastBonusOrbit = pr.orbitCount;
        const bonus = Math.round(ORBIT_BONUS_BASE * Math.pow(ORBIT_BONUS_SCALE, pr.orbitCount - 1));
        this.game.score += bonus; this.game.totalScore += bonus;
        this.game.orbitBonusCount++;
        this.audio.playOrbitBonus();
        this.particles.emitRing(pr.position, new Color(0x88aaff), 12, 0.4, 0.5);
        this.scorePopups.spawn(pr.position, bonus, pr.orbitCount);
      }
      // Per-probe achievements
      if (pr.orbitCount >= 3) { const a = this.game.achievements.find(a => a.id === 'orbit-3'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }
      if (pr.closestApproach < 0.5) { const a = this.game.achievements.find(a => a.id === 'graze-05'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }
      if (pr.closestApproach < 0.2) { const a = this.game.achievements.find(a => a.id === 'graze-02'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }
      if (pr.orbitCount >= 10) { const a = this.game.achievements.find(a => a.id === 'orbit-10'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }
      if (pr.targetsHitThisProbe >= 3) { const a = this.game.achievements.find(a => a.id === 'efficient-3'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }

      // R3: Proximity danger tracking
      for (const w of this.wells) {
        const dist = pr.position.distanceTo(w.position);
        const dangerZone = w.radius * DANGER_ZONE_MULT;
        if (dist < dangerZone && dist > w.radius) {
          const proximity = 1 - (dist - w.radius) / (dangerZone - w.radius);
          if (proximity > this.game.maxProximity) this.game.maxProximity = proximity;
        }
      }
    }

    // R3: Proximity danger warning system
    {
      const aliveProbes = this.probes.filter(p => p.alive);
      this.game.maxProximity = 0;
      for (const pr of aliveProbes) {
        for (const w of this.wells) {
          const dist = pr.position.distanceTo(w.position);
          const dangerZone = w.radius * DANGER_ZONE_MULT;
          if (dist < dangerZone && dist > w.radius) {
            const proximity = 1 - (dist - w.radius) / (dangerZone - w.radius);
            if (proximity > this.game.maxProximity) this.game.maxProximity = proximity;
            // Flash the well's glow
            const flashIntensity = 0.15 + Math.sin(this.globalTime * DANGER_FLASH_SPEED) * 0.2 * proximity;
            (w.glowMesh.material as MeshBasicMaterial).opacity = flashIntensity;
            if (proximity > 0.7) {
              const dangerColor = new Color(w.color).lerp(new Color(0xff0000), proximity * 0.5);
              (w.glowMesh.material as MeshBasicMaterial).color.copy(dangerColor);
            }
          }
        }
      }
      // Warning beep
      this.game.dangerWarningTimer -= dt;
      if (this.game.maxProximity > 0.5 && this.game.dangerWarningTimer <= 0) {
        this.audio.playDangerWarning(this.game.maxProximity);
        this.game.dangerWarningTimer = DANGER_WARNING_INTERVAL * (1 - this.game.maxProximity * 0.6);
      }
    }

    // R3: Update gravity interaction lines
    {
      // Reset all
      for (const gl of this.gravLines) {
        gl.active = false;
        (gl.line.material as LineBasicMaterial).opacity = 0;
      }
      // Find the most recent alive probe
      const aliveProbes = this.probes.filter(p => p.alive);
      if (aliveProbes.length > 0) {
        const pr = aliveProbes[aliveProbes.length - 1];
        // Sort wells by distance from probe
        const sortedWells = this.wells
          .map((w, i) => ({ well: w, idx: i, dist: pr.position.distanceTo(w.position) }))
          .filter(w => w.dist < GRAV_LINE_MAX_DIST)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, GRAV_LINE_COUNT);

        for (let i = 0; i < sortedWells.length && i < this.gravLines.length; i++) {
          const gl = this.gravLines[i];
          const sw = sortedWells[i];
          gl.active = true;
          const pa = gl.line.geometry.attributes.position.array as Float32Array;
          pa[0] = pr.position.x; pa[1] = pr.position.y; pa[2] = pr.position.z;
          pa[3] = sw.well.position.x; pa[4] = sw.well.position.y; pa[5] = sw.well.position.z;
          gl.line.geometry.attributes.position.needsUpdate = true;
          const strength = 1 - sw.dist / GRAV_LINE_MAX_DIST;
          (gl.line.material as LineBasicMaterial).opacity = strength * 0.15;
          (gl.line.material as LineBasicMaterial).color.set(sw.well.color);
        }
      }
    }

    // R3: Level celebration animation
    if (this.game.celebration.active) {
      this.game.celebration.timer -= dt;
      if (this.game.celebration.timer <= 0) {
        this.game.celebration.active = false;
      } else {
        // Continuous particle shower during celebration
        const intensity = this.game.celebration.timer / CELEBRATION_DURATION;
        if (Math.random() < intensity * 0.5) {
          const angle = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 5;
          const pos = new Vector3(Math.cos(angle) * r, 3 + Math.random() * 2, Math.sin(angle) * r - 5);
          const celebColors = [0x00ff88, 0xffaa00, 0xff44ff, 0x44aaff, 0xffffff];
          const color = new Color(celebColors[Math.floor(Math.random() * celebColors.length)]);
          this.particles.emit(pos, color, 3, 1.5, 1.5);
        }
      }
    }

    // R2: Update camera follow target
    if (this.game.cameraFollow) {
      const alive = this.probes.filter(p => p.alive);
      if (alive.length > 0) {
        this.game.cameraFollowTarget = alive[alive.length - 1]; // follow most recent
      } else {
        this.game.cameraFollowTarget = null;
      }
    }

    this.game.checkAchievements();
    this.particles.update(dt);
    this.scorePopups.update(dt);
    // Animate wells
    for (const w of this.wells) {
      w.pulsePhase += dt * 2; (w.glowMesh.material as MeshBasicMaterial).opacity = 0.15 + Math.sin(w.pulsePhase) * 0.05;
      w.ringMesh.rotation.z += dt * 0.3;
      // R2: Toggle gravity field lines visibility
      w.fieldLines.forEach((l, i) => { l.rotation.y += dt * (0.1 + i * 0.05); l.visible = this.game.showGravityLines; });
    }
    // Animate targets
    for (const t of this.targets) { if (t.collected) continue; t.pulsePhase += dt * 3; t.group.rotation.y += dt; t.group.rotation.x += dt * 0.5; t.group.scale.setScalar(1 + Math.sin(t.pulsePhase) * 0.15); }
    // Animate power-ups
    for (const pu of this.powerUps) {
      if (pu.collected) continue;
      pu.pulsePhase += dt * 4;
      pu.group.rotation.y += dt * 2;
      pu.outerMesh.rotation.x += dt * 1.5; pu.outerMesh.rotation.z += dt;
      pu.group.scale.setScalar(1 + Math.sin(pu.pulsePhase) * 0.2);
    }
    // Animate wormholes
    for (const wh of this.wormholes) {
      wh.phase += dt * 3;
      wh.ringA.rotation.z += dt * 2; wh.ringB.rotation.z -= dt * 2;
      const opacity = wh.active ? 0.5 + Math.sin(wh.phase) * 0.3 : 0.15;
      (wh.ringA.material as MeshBasicMaterial).opacity = opacity;
      (wh.ringB.material as MeshBasicMaterial).opacity = opacity;
    }
    // R3: Animate asteroids (tumble)
    for (const ast of this.asteroids) {
      const q = new Quaternion().setFromAxisAngle(ast.rotAxis, ast.rotSpeed * dt);
      ast.mesh.quaternion.premultiply(q);
    }
    // Check level end
    if (this.game.mode !== 'zen') {
      const allDone = this.targets.length > 0 && this.targets.every(t => t.collected);
      const noProbes = this.game.probesRemaining <= 0 && !this.probes.some(p => p.alive);
      if (allDone || noProbes) this.endLevel();
    }
  }

  private collectTarget(tgt: Target, pr: Probe) {
    tgt.collected = true; tgt.group.visible = false; this.game.targetsCollected++; this.game.totalTargetsCollected++;
    pr.targetsHitThisProbe++;
    const now = this.game.elapsedTime;
    if (now - this.game.lastCollectTime < COMBO_WINDOW) this.game.combo++; else this.game.combo = 1;
    this.game.lastCollectTime = now;
    if (this.game.combo > this.game.bestCombo) this.game.bestCombo = this.game.combo;
    if (this.game.combo > this.game.allTimeBestCombo) this.game.allTimeBestCombo = this.game.combo;
    const pts = tgt.points * this.game.combo;
    this.game.score += pts; this.game.totalScore += pts;
    this.audio.playCollect(this.game.combo);
    // R2: Score popup ring
    this.scorePopups.spawn(tgt.position, pts, this.game.combo);
    // R2: Bigger particle burst for combos
    const burstCount = 25 + this.game.combo * 5;
    this.particles.emit(tgt.position, new Color(0x00ff88), burstCount, 4 + this.game.combo * 0.5, 1.0);
    if (this.game.combo >= 3) {
      this.particles.emitRing(tgt.position, new Color(0xffaa00), 16, 0.5, 0.6);
    }
    if (this.game.magnetActive) this.game.magnetCollects++;
    if (this.game.timeFreezeActive) this.game.freezeCollects++;
    if (pr.orbitCount >= 3) { const a = this.game.achievements.find(a => a.id === 'slingshot-3'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }
    if (pr.orbitCount >= 5) { const a = this.game.achievements.find(a => a.id === 'slingshot-5'); if (a && !a.unlocked) { a.unlocked = true; this.game.pendingAchievements.push(a); } }
    this.game.checkAchievements();
  }

  private collectPowerUp(pu: PowerUp, pr: Probe) {
    pu.collected = true; pu.group.visible = false;
    this.game.activatePowerUp(pu.type);
    this.audio.playPowerUp();
    this.particles.emit(pu.position, new Color(0xffaa00), 20, 3, 0.8);
    if (pu.type === 'shield') pr.shielded = true;
    if (pu.type === 'multi-shot') {
      const ach = this.game.achievements.find(a => a.id === 'multi-shot-1');
      if (ach && !ach.unlocked) { ach.unlocked = true; this.game.pendingAchievements.push(ach); }
    }
    this.game.checkAchievements();
  }

  private killProbe(pr: Probe) {
    pr.alive = false; pr.mesh.visible = false; pr.trailLine.visible = false;
    pr.shieldMesh.visible = false; pr.glowLight.intensity = 0;
    if (this.game.cameraFollowTarget === pr) this.game.cameraFollowTarget = null;
  }

  private endLevel() {
    if (this.game.state !== 'playing') return;
    // R2: Track longest orbit from all probes
    for (const pr of this.probes) {
      if (pr.orbitCount > this.game.longestOrbit) this.game.longestOrbit = pr.orbitCount;
    }
    // R2: Restore time freeze visual if active
    if (this.timeFreezeVisualActive) {
      this.timeFreezeVisualActive = false;
      if (this.ambient) this.ambient.color.copy(this.savedAmbientColor);
      if (this.fog) this.fog.color.copy(this.savedFogColor);
    }
    const allDone = this.targets.every(t => t.collected);
    if (allDone && this.game.targetsTotal > 0) {
      this.game.levelsCompleted++; const stars = this.game.getStars();
      if (stars === 3) this.game.tripleStarCount++;
      if (this.game.probesUsed > 0 && this.game.targetsCollected === this.game.probesUsed) this.game.perfectLevels++;
      this.game.addXP(50 + stars * 25 + Math.floor(this.game.score / 10)); this.audio.playSuccess(); this.game.state = 'level-complete';
      // R3: Trigger celebration
      this.game.celebration = { active: true, timer: CELEBRATION_DURATION, threeStars: stars === 3 };
      this.audio.playCelebration(stars === 3);
      // Big particle burst at center
      const center = new Vector3(0, 1.5, -4);
      this.particles.emitRing(center, new Color(stars === 3 ? 0xffaa00 : 0x00ff88), 40, 2, 1.5);
      if (stars === 3) {
        // Extra gold burst for perfect rating
        for (let i = 0; i < 5; i++) {
          const p = center.clone().add(new Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
          this.particles.emit(p, new Color(0xffaa00), 15, 3, 1.2);
        }
      }
      // R3: Survival wave advancement
      if (this.game.mode === 'survival') {
        this.game.survivalWave++;
        this.game.survivalWaveBannerTimer = 2.5;
      }
    } else { this.audio.playFail(); this.game.state = 'game-over'; }
    this.game.gamesPlayed++; this.game.modesPlayed.add(this.game.mode); this.game.checkAchievements();
    // R2: Camera follow off when level ends
    this.game.cameraFollow = false; this.game.cameraFollowTarget = null;
    // R2: Save progress
    GameSaveManager.save(this.game);
  }
}



// ---- Input System ----
class InputControlSystem extends createSystem({}) {
  private game!: GameManager; private audio!: AudioManager; private keys!: KeyState;
  private probes: Probe[] = []; private wells: GravityWell[] = [];
  private predLine!: Line; private launchInd!: Group;
  private launchDir = new Vector3(0, 0, -1); private aimOrigin = new Vector3(0, 1.5, 0);
  private chargeTick = 0;
  private onMultiShot!: () => void;
  // R2: Camera follow
  private baseCamPos = new Vector3(0, 1.7, 0);
  private followLerp = new Vector3(0, 1.7, 0);

  setRefs(refs: { game: GameManager; audio: AudioManager; keys: KeyState; probes: Probe[]; wells: GravityWell[]; predLine: Line; launchInd: Group; onMultiShot: () => void }) {
    this.game = refs.game; this.audio = refs.audio; this.keys = refs.keys;
    this.probes = refs.probes; this.wells = refs.wells; this.predLine = refs.predLine; this.launchInd = refs.launchInd;
    this.onMultiShot = refs.onMultiShot;
  }

  update(delta: number, _time: number) {
    if (this.game.state !== 'playing') { this.predLine.visible = false; this.launchInd.visible = false; this.keys.endFrame(); return; }
    const right = this.input.gamepads.right;
    let tDown = false, tUp = false, tHeld = false, slowToggle = false, pauseP = false;
    let camToggle = false;
    if (right) {
      const ray = this.player.raySpaces.right;
      const fwd = new Vector3(0, 0, -1).applyQuaternion(ray.quaternion);
      ray.getWorldPosition(this.aimOrigin); this.launchDir.copy(fwd).normalize();
      tDown = !!right.getButtonDown(InputComponent.Trigger); tUp = !!right.getButtonUp(InputComponent.Trigger);
      tHeld = !!right.getButtonPressed(InputComponent.Trigger); slowToggle = !!right.getButtonDown(InputComponent.Squeeze);
      pauseP = !!right.getButtonDown(InputComponent.B_Button);
    }
    const left = this.input.gamepads.left;
    if (left) {
      if (left.getButtonDown(InputComponent.Squeeze)) slowToggle = true;
      if (left.getButtonDown(InputComponent.Y_Button)) pauseP = true;
      // R2: Camera follow toggle on left thumbstick press
      if (left.getButtonDown(InputComponent.Thumbstick)) camToggle = true;
    }
    // Keyboard
    if (!right) {
      const camFwd = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.launchDir.copy(camFwd).normalize(); this.camera.getWorldPosition(this.aimOrigin);
    }
    if (this.keys.isDown('Space')) tDown = true; if (this.keys.isUp('Space')) tUp = true; if (this.keys.isPressed('Space')) tHeld = true;
    if (this.keys.isDown('ShiftLeft') || this.keys.isDown('ShiftRight')) slowToggle = true;
    if (this.keys.isDown('Escape') || this.keys.isDown('KeyP')) pauseP = true;
    // R2: Camera follow toggle — F key
    if (this.keys.isDown('KeyF')) camToggle = true;
    this.keys.endFrame();

    // R2: Camera follow toggle
    if (camToggle) {
      this.game.cameraFollow = !this.game.cameraFollow;
      if (!this.game.cameraFollow) {
        this.game.cameraFollowTarget = null;
        // Snap camera back
        this.camera.position.copy(this.baseCamPos);
      }
    }

    // R2: Smooth camera follow
    if (this.game.cameraFollow && this.game.cameraFollowTarget && !right) {
      const target = this.game.cameraFollowTarget;
      const followPos = target.position.clone().add(new Vector3(0, 0.5, 2));
      this.followLerp.lerp(followPos, delta * 3);
      this.camera.position.copy(this.followLerp);
      this.camera.lookAt(target.position);
    } else if (!this.game.cameraFollow && !right) {
      this.followLerp.copy(this.baseCamPos);
    }

    if (pauseP) { this.game.state = 'paused'; return; }
    if (slowToggle) { this.game.slowMo = !this.game.slowMo; this.game.timeScale = this.game.slowMo ? SLOW_MO_FACTOR : 1; if (this.game.slowMo) this.game.slowMoCount++; }
    if (tDown && !this.game.charging && this.game.probesRemaining > 0) { this.game.charging = true; this.game.chargeAmount = 0; }
    if (this.game.charging && tHeld) {
      this.game.chargeAmount = Math.min(this.game.chargeAmount + delta * CHARGE_RATE, 1);
      this.chargeTick += delta; if (this.chargeTick > 0.12) { this.chargeTick = 0; this.audio.playCharge(this.game.chargeAmount); }
    }
    if (this.game.charging && tUp) {
      this.game.charging = false;
      this.launchProbe();
      if (this.game.multiShotActive) {
        this.game.multiShotActive = false;
        this.onMultiShot();
      }
    }
    // Prediction
    if (this.game.charging && this.game.showTrajectory) {
      const speed = LAUNCH_MIN_SPEED + this.game.chargeAmount * (LAUNCH_MAX_SPEED - LAUNCH_MIN_SPEED);
      const vel = this.launchDir.clone().multiplyScalar(speed);
      const pa = this.predLine.geometry.attributes.position.array as Float32Array;
      const steps = simulateTrajectory(this.aimOrigin, vel, this.wells, PREDICTION_STEPS, PREDICTION_DT, pa);
      this.predLine.geometry.setDrawRange(0, steps); this.predLine.geometry.attributes.position.needsUpdate = true; this.predLine.visible = true;
    } else { this.predLine.visible = false; }
    // Launch indicator
    if (this.game.charging || this.game.probesRemaining > 0) {
      this.launchInd.position.copy(this.aimOrigin);
      this.launchInd.lookAt(this.aimOrigin.x + this.launchDir.x, this.aimOrigin.y + this.launchDir.y, this.aimOrigin.z + this.launchDir.z);
      this.launchInd.visible = true;
    } else { this.launchInd.visible = false; }
    // Haptics
    if (this.game.charging && right) {
      const gp = right.gamepad; const act = gp?.hapticActuators?.[0] as { pulse?: (i: number, ms: number) => void } | undefined;
      act?.pulse?.(this.game.chargeAmount * 0.3, 16);
    }
  }

  private launchProbe(dirOverride?: Vector3) {
    const speed = LAUNCH_MIN_SPEED + this.game.chargeAmount * (LAUNCH_MAX_SPEED - LAUNCH_MIN_SPEED);
    const dir = dirOverride || this.launchDir;
    const vel = dir.clone().multiplyScalar(speed);
    let pr = this.probes.find(p => !p.alive);
    if (!pr) { let oldest = this.probes[0]; for (const p of this.probes) { if (p.age > oldest.age) oldest = p; } pr = oldest; }
    pr.position.copy(this.aimOrigin); pr.velocity.copy(vel); pr.alive = true; pr.age = 0;
    pr.mesh.visible = true; pr.trailLine.visible = true; pr.mesh.position.copy(this.aimOrigin);
    pr.orbitCount = 0; pr.lastWellIdx = -1; pr.closestApproach = Infinity;
    pr.shielded = this.game.shieldActive; pr.targetsHitThisProbe = 0;
    pr.slingshotNotified = false;
    for (const tp of pr.trailPositions) tp.copy(this.aimOrigin);
    this.game.probesUsed++; this.game.probesRemaining--; this.game.totalProbesLaunched++; this.game.chargeAmount = 0;
    this.audio.playLaunch(speed / LAUNCH_MAX_SPEED);
    const right = this.input.gamepads.right;
    if (right) { const gp = right.gamepad; const act = gp?.hapticActuators?.[0] as { pulse?: (i: number, ms: number) => void } | undefined; act?.pulse?.(0.8, 80); }
  }

  launchExtra(dir: Vector3) { this.launchProbe(dir); }
}


// ---- UI System ----
class GameUISystem extends createSystem({
  mainMenu: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/main-menu.json')] },
  hud: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
  gameOver: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/game-over.json')] },
  modeSelect: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/mode-select.json')] },
  howToPlay: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/how-to-play.json')] },
  settings: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/settings.json')] },
  stats: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/stats.json')] },
  achievements: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achievements.json')] },
  pause: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/pause.json')] },
  themeSelect: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/theme-select.json')] },
  notification: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/notification.json')] },
  powerGauge: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/power-gauge.json')] },
  levelComplete: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/level-complete.json')] },
  dailyChallenge: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/daily-challenge.json')] },
  powerUpHud: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/power-up-hud.json')] },
  levelSelect: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/level-select.json')] },
  tutorialHint: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/tutorial-hint.json')] },
  waveBanner: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/wave-banner.json')] },
}) {
  private game!: GameManager; private audio!: AudioManager;
  private highScores!: HighScoreManager;
  private onStart!: (m: GameMode, l: number) => void;
  private onTheme!: (t: ThemeName) => void;
  private pe: Record<string, Entity> = {};
  private hudTimer = 0; private notifTimer = 0; private notifActive = false;
  // R2: Achievement pagination
  private achPage = 0;
  private achPageSize = 10;
  // R2: Level select pagination
  private lvlPage = 0;
  // R3: Tutorial timer
  private tutorialTimer = 0;
  private tutorialAutoAdvance = 8; // seconds between auto-advancing hints

  setRefs(refs: { game: GameManager; audio: AudioManager; highScores: HighScoreManager; onStart: (m: GameMode, l: number) => void; onTheme: (t: ThemeName) => void }) {
    this.game = refs.game; this.audio = refs.audio; this.highScores = refs.highScores;
    this.onStart = refs.onStart; this.onTheme = refs.onTheme;
  }

  private doc(e: Entity) { return e.getValue(PanelDocument, 'document') as UIKitDocument | undefined; }
  private st(e: Entity, id: string, text: string) { (this.doc(e)?.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text }); }
  private btn(e: Entity, id: string, fn: () => void) { (this.doc(e)?.getElementById(id) as UIKit.Text | undefined)?.addEventListener('click', () => { this.audio.playClick(); fn(); }); }

  init() {
    this.queries.mainMenu.subscribe('qualify', (e) => {
      this.pe['mainMenu'] = e;
      this.btn(e, 'btn-play', () => this.onStart(this.game.mode, this.game.level));
      this.btn(e, 'btn-modes', () => this.showP('modeSelect'));
      this.btn(e, 'btn-achievements', () => { this.achPage = 0; this.showP('achievements'); });
      this.btn(e, 'btn-stats', () => this.showP('stats'));
      this.btn(e, 'btn-settings', () => this.showP('settings'));
      this.btn(e, 'btn-how', () => this.showP('howToPlay'));
      // R2: Show player info on main menu
      this.st(e, 'player-info', `Lv.${this.game.playerLevel} ${this.game.getPlayerTitle()}`);
    });
    this.queries.modeSelect.subscribe('qualify', (e) => {
      this.pe['modeSelect'] = e;
      const modes: [string, GameMode][] = [['btn-classic','classic'],['btn-slingshot','slingshot'],['btn-time-trial','time-trial'],['btn-precision','precision'],['btn-chaos','chaos'],['btn-zen','zen'],['btn-survival','survival'],['btn-daily','daily']];
      for (const [b, m] of modes) this.btn(e, b, () => {
        if (m === 'daily') { this.showP('dailyChallenge'); }
        else { this.game.mode = m; this.game.level = 1; this.lvlPage = 0; this.showP('levelSelect'); }
      });
      this.btn(e, 'btn-back', () => this.showP('mainMenu'));
    });
    this.queries.howToPlay.subscribe('qualify', (e) => { this.pe['howToPlay'] = e; this.btn(e, 'btn-back', () => this.showP('mainMenu')); });
    this.queries.settings.subscribe('qualify', (e) => {
      this.pe['settings'] = e;
      // R2: Show current values
      this.st(e, 'music-vol', `${Math.round(this.audio.musicVolume * 100)}%`);
      this.st(e, 'sfx-vol', `${Math.round(this.audio.sfxVolume * 100)}%`);
      this.st(e, 'preview-toggle', this.game.showTrajectory ? 'ON' : 'OFF');
      this.st(e, 'trail-len', this.game.trailLen.charAt(0).toUpperCase() + this.game.trailLen.slice(1));
      this.st(e, 'theme-name', this.game.theme.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
      this.st(e, 'grav-lines', this.game.showGravityLines ? 'ON' : 'OFF');
      this.btn(e, 'music-vol', () => { const v = [0,0.2,0.4,0.6,0.8,1.0]; const i = v.indexOf(this.audio.musicVolume); this.audio.setMusicVolume(v[(i+1)%v.length]); this.st(e, 'music-vol', `${Math.round(this.audio.musicVolume*100)}%`); });
      this.btn(e, 'sfx-vol', () => { const v = [0,0.2,0.4,0.6,0.8,1.0]; const i = v.indexOf(this.audio.sfxVolume); this.audio.setSfxVolume(v[(i+1)%v.length]); this.st(e, 'sfx-vol', `${Math.round(this.audio.sfxVolume*100)}%`); });
      this.btn(e, 'preview-toggle', () => { this.game.showTrajectory = !this.game.showTrajectory; this.st(e, 'preview-toggle', this.game.showTrajectory ? 'ON' : 'OFF'); });
      this.btn(e, 'trail-len', () => { const o: Array<'short'|'medium'|'long'> = ['short','medium','long']; const i = o.indexOf(this.game.trailLen); this.game.trailLen = o[(i+1)%o.length]; this.st(e, 'trail-len', this.game.trailLen.charAt(0).toUpperCase() + this.game.trailLen.slice(1)); });
      this.btn(e, 'theme-name', () => this.showP('themeSelect'));
      this.btn(e, 'grav-lines', () => { this.game.showGravityLines = !this.game.showGravityLines; this.st(e, 'grav-lines', this.game.showGravityLines ? 'ON' : 'OFF'); });
      this.btn(e, 'btn-back', () => { GameSaveManager.save(this.game); this.showP('mainMenu'); });
    });
    this.queries.stats.subscribe('qualify', (e) => { this.pe['stats'] = e; this.btn(e, 'btn-back', () => this.showP('mainMenu')); });
    this.queries.achievements.subscribe('qualify', (e) => {
      this.pe['achievements'] = e;
      this.btn(e, 'btn-back', () => this.showP('mainMenu'));
      // R2: Pagination buttons
      this.btn(e, 'btn-ach-prev', () => { if (this.achPage > 0) { this.achPage--; this.refreshAch(); } });
      this.btn(e, 'btn-ach-next', () => {
        const maxPage = Math.ceil(this.game.achievements.length / this.achPageSize) - 1;
        if (this.achPage < maxPage) { this.achPage++; this.refreshAch(); }
      });
    });
    this.queries.pause.subscribe('qualify', (e) => { this.pe['pause'] = e; this.btn(e, 'btn-resume', () => { this.game.state = 'playing'; }); this.btn(e, 'btn-restart', () => this.onStart(this.game.mode, this.game.level)); this.btn(e, 'btn-quit', () => { this.game.state = 'menu'; }); });
    this.queries.gameOver.subscribe('qualify', (e) => { this.pe['gameOver'] = e; this.btn(e, 'btn-retry', () => this.onStart(this.game.mode, this.game.level)); this.btn(e, 'btn-next', () => { this.game.level++; this.onStart(this.game.mode, this.game.level); }); this.btn(e, 'btn-menu', () => { this.game.state = 'menu'; }); });
    this.queries.themeSelect.subscribe('qualify', (e) => {
      this.pe['themeSelect'] = e;
      const ts: [string, ThemeName][] = [['btn-deep-space','deep-space'],['btn-nebula','nebula'],['btn-solar','solar'],['btn-ice','ice'],['btn-void','void']];
      for (const [b, t] of ts) this.btn(e, b, () => { this.game.theme = t; this.onTheme(t); this.showP('settings'); });
      this.btn(e, 'btn-back', () => this.showP('settings'));
    });
    this.queries.notification.subscribe('qualify', (e) => { this.pe['notification'] = e; });
    this.queries.powerGauge.subscribe('qualify', (e) => { this.pe['powerGauge'] = e; });
    this.queries.hud.subscribe('qualify', (e) => { this.pe['hud'] = e; });
    this.queries.levelComplete.subscribe('qualify', (e) => { this.pe['levelComplete'] = e; this.btn(e, 'btn-next-lvl', () => { this.game.level++; this.onStart(this.game.mode, this.game.level); }); this.btn(e, 'btn-replay', () => this.onStart(this.game.mode, this.game.level)); });
    this.queries.dailyChallenge.subscribe('qualify', (e) => {
      this.pe['dailyChallenge'] = e;
      this.btn(e, 'btn-start-daily', () => { this.game.mode = 'daily'; this.game.level = 1; this.onStart('daily', 1); });
      this.btn(e, 'btn-back', () => this.showP('modeSelect'));
      // R3: Show daily challenge info
      this.st(e, 'streak', `${this.game.dailyStreak} days`);
      this.st(e, 'best-score', this.game.lastDailyDate ? `${this.highScores.get('daily', 1)?.score ?? '---'}` : '---');
    });
    this.queries.powerUpHud.subscribe('qualify', (e) => { this.pe['powerUpHud'] = e; });
    // R2: Level select
    this.queries.levelSelect.subscribe('qualify', (e) => {
      this.pe['levelSelect'] = e;
      for (let i = 1; i <= 10; i++) {
        this.btn(e, `lvl-${i}`, () => {
          const lvl = this.lvlPage * 10 + i;
          this.game.level = lvl;
          this.onStart(this.game.mode, lvl);
        });
      }
      this.btn(e, 'btn-prev-page', () => { if (this.lvlPage > 0) { this.lvlPage--; this.refreshLvlSelect(); } });
      this.btn(e, 'btn-next-page', () => { this.lvlPage++; this.refreshLvlSelect(); });
      this.btn(e, 'btn-back', () => this.showP('modeSelect'));
    });
    // R3: Tutorial hint panel
    this.queries.tutorialHint.subscribe('qualify', (e) => {
      this.pe['tutorialHint'] = e;
      this.btn(e, 'hint-dismiss', () => {
        this.advanceTutorial();
      });
    });
    // R3: Wave banner panel
    this.queries.waveBanner.subscribe('qualify', (e) => {
      this.pe['waveBanner'] = e;
    });
  }

  private showP(name: string) {
    const menus = ['mainMenu','modeSelect','howToPlay','settings','stats','achievements','themeSelect','dailyChallenge','levelSelect'];
    for (const n of menus) { const p = this.pe[n]; if (p?.object3D) p.object3D.visible = (n === name); }
    if (name === 'stats') this.refreshStats();
    if (name === 'achievements') this.refreshAch();
    if (name === 'levelSelect') this.refreshLvlSelect();
    // R2: Refresh player info on main menu
    if (name === 'mainMenu') {
      const e = this.pe['mainMenu'];
      if (e) this.st(e, 'player-info', `Lv.${this.game.playerLevel} ${this.game.getPlayerTitle()}`);
    }
  }

  // R2: Refresh level select display
  private refreshLvlSelect() {
    const e = this.pe['levelSelect']; if (!e) return;
    const mn: Record<GameMode, string> = { classic:'Classic',slingshot:'Slingshot','time-trial':'Time Trial',precision:'Precision',chaos:'Chaos',zen:'Zen',survival:'Survival',daily:'Daily' };
    this.st(e, 'mode-label', mn[this.game.mode]);
    this.st(e, 'page-label', `${this.lvlPage + 1} / 5`);
    const maxCompleted = this.highScores.getMaxLevel(this.game.mode);
    for (let i = 1; i <= 10; i++) {
      const lvl = this.lvlPage * 10 + i;
      const data = this.highScores.get(this.game.mode, lvl);
      const unlocked = lvl <= maxCompleted + 1;
      let label = String(lvl);
      if (data) {
        const starStr = '*'.repeat(data.stars) + '-'.repeat(3 - data.stars);
        label = `${lvl} ${starStr}`;
      } else if (!unlocked) {
        label = `${lvl} ...`;
      } else {
        label = `${lvl} ---`;
      }
      this.st(e, `lvl-${i}`, label);
      const el = this.doc(e)?.getElementById(`lvl-${i}`) as UIKit.Text | undefined;
      if (el) {
        if (data && data.stars === 3) el.setProperties({ color: '#ffaa00' });
        else if (data) el.setProperties({ color: '#00ff88' });
        else if (unlocked) el.setProperties({ color: '#aaaacc' });
        else el.setProperties({ color: '#444466' });
      }
    }
    const totalStars = this.highScores.getTotalStars(this.game.mode);
    this.st(e, 'best-info', `Total Stars: ${totalStars}`);
  }

  update(delta: number, _time: number) {
    const sv = (n: string, v: boolean) => { const p = this.pe[n]; if (p?.object3D) p.object3D.visible = v; };
    const isM = this.game.state === 'menu', isP = this.game.state === 'playing', isPa = this.game.state === 'paused';
    const isGO = this.game.state === 'game-over', isLC = this.game.state === 'level-complete';
    if (isM) {
      const subs = ['modeSelect','howToPlay','settings','stats','achievements','themeSelect','dailyChallenge','levelSelect'];
      if (!subs.some(n => this.pe[n]?.object3D?.visible)) sv('mainMenu', true);
    } else {
      sv('mainMenu', false);
      ['modeSelect','howToPlay','settings','stats','achievements','themeSelect','dailyChallenge','levelSelect'].forEach(n => sv(n, false));
    }
    sv('hud', isP || isPa); sv('pause', isPa); sv('gameOver', isGO); sv('levelComplete', isLC);
    sv('powerGauge', isP && this.game.charging);
    sv('powerUpHud', isP && this.game.activePowerUp !== null);
    // HUD updates
    if (isP || isPa) {
      this.hudTimer += delta;
      if (this.hudTimer > 0.1) {
        this.hudTimer = 0; const h = this.pe['hud'];
        if (h) {
          this.st(h, 'score', String(this.game.score)); this.st(h, 'probes', String(this.game.probesRemaining));
          this.st(h, 'targets', `${this.game.targetsCollected}/${this.game.targetsTotal}`);
          const m = Math.floor(this.game.elapsedTime / 60); const s = Math.floor(this.game.elapsedTime % 60);
          this.st(h, 'time', `${m}:${s.toString().padStart(2, '0')}`); this.st(h, 'level', `Level ${this.game.level}`);
          const mn: Record<GameMode, string> = { classic:'Classic',slingshot:'Slingshot','time-trial':'Time Trial',precision:'Precision',chaos:'Chaos',zen:'Zen',survival:'Survival',daily:'Daily' };
          this.st(h, 'mode', mn[this.game.mode]);
          if (this.game.combo > 1) { this.st(h, 'combo', `x${this.game.combo} COMBO`); (this.doc(h)?.getElementById('combo') as UIKit.Text | undefined)?.setProperties({ opacity: 1 }); }
          else { (this.doc(h)?.getElementById('combo') as UIKit.Text | undefined)?.setProperties({ opacity: 0 }); }
          // R2: Slingshot notification in HUD
          if (this.game.slingshotNotif) {
            this.st(h, 'combo', 'SLINGSHOT!');
            (this.doc(h)?.getElementById('combo') as UIKit.Text | undefined)?.setProperties({ opacity: 1, color: '#ffaa44' });
          } else if (this.game.combo <= 1) {
            (this.doc(h)?.getElementById('combo') as UIKit.Text | undefined)?.setProperties({ color: '#ffaa00' });
          }
          // R2: Camera follow indicator
          if (this.game.cameraFollow) {
            this.st(h, 'mode', `${mn[this.game.mode]} [CAM]`);
          }
        }
        // Power-up HUD
        if (this.game.activePowerUp) {
          const puh = this.pe['powerUpHud'];
          if (puh) {
            const icons: Record<PowerUpType, string> = { shield: 'SH', magnet: 'MG', 'multi-shot': 'MS', 'time-freeze': 'TF' };
            const names: Record<PowerUpType, string> = { shield: 'Shield', magnet: 'Magnet', 'multi-shot': 'Multi-Shot', 'time-freeze': 'Time Freeze' };
            const colors: Record<PowerUpType, string> = { shield: '#44aaff', magnet: '#ff44ff', 'multi-shot': '#ffaa00', 'time-freeze': '#88ffff' };
            this.st(puh, 'pu-icon', icons[this.game.activePowerUp]);
            this.st(puh, 'pu-name', names[this.game.activePowerUp]);
            (this.doc(puh)?.getElementById('pu-icon') as UIKit.Text | undefined)?.setProperties({ color: colors[this.game.activePowerUp] });
            (this.doc(puh)?.getElementById('pu-name') as UIKit.Text | undefined)?.setProperties({ color: colors[this.game.activePowerUp] });
            if (this.game.activePowerUp !== 'shield') {
              this.st(puh, 'pu-timer', `${Math.ceil(this.game.powerUpTimer)}s`);
            } else {
              this.st(puh, 'pu-timer', 'ACT');
            }
            this.st(puh, 'shield-status', this.game.shieldActive ? 'ON' : 'OFF');
            (this.doc(puh)?.getElementById('shield-icon') as UIKit.Text | undefined)?.setProperties({ color: this.game.shieldActive ? '#44aaff' : '#444466' });
          }
        }
      }
    }
    // Power gauge
    if (this.game.charging) { const pg = this.pe['powerGauge']; if (pg) { this.st(pg, 'power-pct', `${Math.round(this.game.chargeAmount * 100)}%`); } }
    // Game over
    if (isGO) {
      const e = this.pe['gameOver']; if (e) {
        this.st(e, 'final-score', String(this.game.score)); this.st(e, 'final-targets', `${this.game.targetsCollected}/${this.game.targetsTotal}`);
        this.st(e, 'final-probes', String(this.game.probesUsed));
        this.st(e, 'final-accuracy', `${this.game.probesUsed > 0 ? Math.round(this.game.targetsCollected / this.game.probesUsed * 100) : 0}%`);
        const m = Math.floor(this.game.elapsedTime / 60); const s = Math.floor(this.game.elapsedTime % 60);
        this.st(e, 'final-time', `${m}:${s.toString().padStart(2, '0')}`); this.st(e, 'final-combo', `x${this.game.bestCombo}`);
        this.st(e, 'rating', this.game.getRating()); this.st(e, 'xp-gained', `+${Math.round(50 + this.game.getStars() * 25 + this.game.score / 10)} XP`);
        // R2: High score display
        if (this.game.newHighScore) {
          this.st(e, 'rating', `${this.game.getRating()} NEW BEST!`);
        }
      }
    }
    if (isLC) {
      const e = this.pe['levelComplete']; if (e) {
        const stars = this.game.getStars();
        for (let i = 1; i <= 3; i++) { this.st(e, `star-${i}`, stars >= i ? '*' : '-'); (this.doc(e)?.getElementById(`star-${i}`) as UIKit.Text | undefined)?.setProperties({ color: stars >= i ? '#ffaa00' : '#444466' }); }
        this.st(e, 'score-text', `Score: ${this.game.score}`);
        // R2: Extra stats on level complete
        this.st(e, 'combo-text', `Best Combo: x${this.game.bestCombo}`);
        const acc = this.game.probesUsed > 0 ? Math.round(this.game.targetsCollected / this.game.probesUsed * 100) : 0;
        this.st(e, 'accuracy-text', `Accuracy: ${acc}%`);
        const xpGain = 50 + stars * 25 + Math.floor(this.game.score / 10);
        this.st(e, 'xp-text', `+${xpGain} XP`);
        // R2: High score display
        if (this.game.newHighScore) {
          this.st(e, 'score-text', `Score: ${this.game.score} - NEW BEST!`);
        }
      }
    }
    // R3: Tutorial hint auto-advance
    if (isP && !this.game.tutorialComplete) {
      this.tutorialTimer += delta;
      if (this.tutorialTimer >= this.tutorialAutoAdvance) {
        this.advanceTutorial();
      }
      // Show first hint when game starts
      const e = this.pe['tutorialHint'];
      if (e?.object3D && !e.object3D.visible && this.game.tutorialHintsShown < TUTORIAL_HINTS.length) {
        this.showTutorialHint();
      }
    } else {
      const e = this.pe['tutorialHint'];
      if (e?.object3D) e.object3D.visible = false;
    }

    // R3: Survival wave banner
    if (this.game.survivalWaveBannerTimer > 0) {
      this.game.survivalWaveBannerTimer -= delta;
      const wb = this.pe['waveBanner'];
      if (wb) {
        if (wb.object3D) wb.object3D.visible = this.game.survivalWaveBannerTimer > 0;
        this.st(wb, 'wave-label', `WAVE ${this.game.survivalWave}`);
        const waveDescs = ['Survive the gravity fields!', 'Intensity rising...', 'Chaos approaches!', 'The void deepens...', 'Master the orbits!'];
        this.st(wb, 'wave-desc', waveDescs[Math.min(this.game.survivalWave - 1, waveDescs.length - 1)]);
      }
    } else {
      const wb = this.pe['waveBanner'];
      if (wb?.object3D) wb.object3D.visible = false;
    }

    // R3: Danger proximity HUD indicator
    if (isP && this.game.maxProximity > 0.3) {
      const h = this.pe['hud'];
      if (h) {
        const dangerPct = Math.round(this.game.maxProximity * 100);
        this.st(h, 'mode', `DANGER ${dangerPct}%`);
        const modeEl = this.doc(h)?.getElementById('mode') as UIKit.Text | undefined;
        if (modeEl) {
          const flash = Math.sin(Date.now() * 0.01) > 0;
          modeEl.setProperties({ color: this.game.maxProximity > 0.7 ? (flash ? '#ff0000' : '#ff4444') : '#ffaa00' });
        }
      }
    } else if (isP) {
      const h = this.pe['hud'];
      if (h) {
        const modeEl = this.doc(h)?.getElementById('mode') as UIKit.Text | undefined;
        if (modeEl && !this.game.slingshotNotif) modeEl.setProperties({ color: '#aabbcc' });
      }
    }

    // Achievement notifications
    if (this.game.pendingAchievements.length > 0 && !this.notifActive) {
      const a = this.game.pendingAchievements.shift()!; const ne = this.pe['notification'];
      if (ne) { this.st(ne, 'notif-text', 'Achievement Unlocked!'); this.st(ne, 'notif-detail', a.name); sv('notification', true); this.notifActive = true; this.notifTimer = 3; this.audio.playAchievement(); }
    }
    if (this.notifActive) { this.notifTimer -= delta; if (this.notifTimer <= 0) { this.notifActive = false; sv('notification', false); } }
  }

  private refreshStats() {
    const e = this.pe['stats']; if (!e) return;
    this.st(e, 'total-score', String(this.game.totalScore)); this.st(e, 'games-played', String(this.game.gamesPlayed));
    this.st(e, 'probes-launched', String(this.game.totalProbesLaunched)); this.st(e, 'targets-collected', String(this.game.totalTargetsCollected));
    this.st(e, 'accuracy', `${this.game.totalProbesLaunched > 0 ? Math.round(this.game.totalTargetsCollected / this.game.totalProbesLaunched * 100) : 0}%`);
    this.st(e, 'best-combo', `x${this.game.allTimeBestCombo}`); this.st(e, 'crashes', String(this.game.planetsCrashedInto));
    this.st(e, 'perfect-levels', String(this.game.perfectLevels)); this.st(e, 'longest-orbit', `${this.game.longestOrbit}s`);
    this.st(e, 'play-time', `${Math.round(this.game.totalPlayTime / 60)}m`);
    this.st(e, 'player-level', `Lv. ${this.game.playerLevel}`); this.st(e, 'player-title', this.game.getPlayerTitle());
    this.st(e, 'xp-text', `${this.game.xp} / ${this.game.xpToNext} XP`);
    // R3: Show graze/orbit/asteroid stats
    this.st(e, 'graze-count', String(this.game.grazeCount));
    this.st(e, 'orbit-bonus', String(this.game.orbitBonusCount));
    this.st(e, 'asteroids-hit', String(this.game.asteroidsHit));
  }

  // R3: Tutorial management
  private showTutorialHint() {
    if (this.game.tutorialComplete || this.game.tutorialHintsShown >= TUTORIAL_HINTS.length) {
      this.game.tutorialComplete = true;
      const e = this.pe['tutorialHint'];
      if (e?.object3D) e.object3D.visible = false;
      return;
    }
    const e = this.pe['tutorialHint'];
    if (e) {
      this.st(e, 'hint-text', TUTORIAL_HINTS[this.game.tutorialHintsShown]);
      this.st(e, 'hint-icon', `TIP ${this.game.tutorialHintsShown + 1}/${TUTORIAL_HINTS.length}`);
      if (e.object3D) e.object3D.visible = true;
    }
    this.tutorialTimer = 0;
  }

  private advanceTutorial() {
    this.game.tutorialHintsShown++;
    if (this.game.tutorialHintsShown >= TUTORIAL_HINTS.length) {
      this.game.tutorialComplete = true;
      const e = this.pe['tutorialHint'];
      if (e?.object3D) e.object3D.visible = false;
      GameSaveManager.save(this.game);
    } else {
      this.showTutorialHint();
    }
  }

  private refreshAch() {
    const e = this.pe['achievements']; if (!e) return;
    this.st(e, 'progress', `${this.game.achievements.filter(a => a.unlocked).length} / ${this.game.achievements.length} Unlocked`);
    // R2: Paginated display — show achPageSize achievements per page
    const start = this.achPage * this.achPageSize;
    const maxPage = Math.ceil(this.game.achievements.length / this.achPageSize) - 1;
    for (let i = 0; i < 20; i++) {
      const achIdx = start + i;
      const el = this.doc(e)?.getElementById(`ach-${i}`) as UIKit.Text | undefined;
      if (!el) continue;
      if (achIdx < this.game.achievements.length) {
        const a = this.game.achievements[achIdx];
        const pre = a.unlocked ? '[*]' : '[?]';
        el.setProperties({ text: `${pre} ${a.name} - ${a.desc}`, color: a.unlocked ? '#00ff88' : '#666688', opacity: 1 });
      } else {
        el.setProperties({ text: '', opacity: 0 });
      }
    }
    // R2: Page indicator
    const pageEl = this.doc(e)?.getElementById('ach-page') as UIKit.Text | undefined;
    if (pageEl) pageEl.setProperties({ text: `Page ${this.achPage + 1} / ${maxPage + 1}` });
  }
}



// ---- Main Entry ----
async function main() {
  const container = document.getElementById('scene-container') as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: 'once' },
    features: {
      grabbing: false,
      locomotion: false,
      physics: false,
      spatialUI: true,
    },
    render: {
      fov: 60,
      near: 0.05,
      far: 250,
      defaultLighting: false,
    },
  });

  world.camera.position.set(0, 1.7, 0);

  const game = new GameManager();
  const audio = new AudioManager();
  const keys = new KeyState();
  const particles = new ParticlePool(world.scene);
  const shake = new ScreenShake();
  const highScores = new HighScoreManager();
  const scorePopups = new ScorePopupPool(world.scene);

  // R2: Load saved progress
  GameSaveManager.load(game);
  let currentTheme = THEMES[game.theme];

  // Lighting
  const ambient = new AmbientLight(currentTheme.ambient, 0.6);
  world.scene.add(ambient);
  const dirLight = new DirectionalLight(0xffffff, 0.3);
  dirLight.position.set(5, 10, 5);
  world.scene.add(dirLight);
  world.scene.fog = new Fog(currentTheme.fog, 15, 50);
  (world.scene as any).background = new Color(currentTheme.bg);

  // Scene objects
  const starField = createStarField(world.scene);
  const gridFloor = createGridFloor(world.scene, currentTheme.grid);
  // R2: Atmospheric effects
  const shootingStars = new ShootingStarManager(world.scene);
  shootingStars.setThemeColor(currentTheme.nebula);
  let nebulaClouds = createNebulaClouds(world.scene, currentTheme.nebula);
  const ambientDust = createAmbientDust(world.scene);

  // Level data
  let wells: GravityWell[] = [];
  let targets: Target[] = [];
  let powerUps: PowerUp[] = [];
  let wormholes: WormholePortal[] = [];
  let energyBeams: EnergyBeam[] = [];
  let asteroids: Asteroid[] = [];
  // R3: Gravity interaction lines
  const gravLines = createGravInteractionLines(world.scene, GRAV_LINE_COUNT);
  const probes: Probe[] = [];
  for (let i = 0; i < MAX_PROBES; i++) probes.push(createProbe(world.scene));
  const predLine = createPredictionLine(world.scene);
  const launchInd = createLaunchIndicator(world.scene);

  // Start/restart level
  function startLevel(mode: GameMode, levelNum: number) {
    for (const w of wells) world.scene.remove(w.group);
    for (const t of targets) world.scene.remove(t.group);
    for (const pu of powerUps) world.scene.remove(pu.group);
    for (const wh of wormholes) { world.scene.remove(wh.groupA); world.scene.remove(wh.groupB); }
    // R2: Clean up energy beams
    for (const beam of energyBeams) world.scene.remove(beam.line);
    // R3: Clean up asteroids
    for (const ast of asteroids) world.scene.remove(ast.mesh);
    for (const p of probes) { p.alive = false; p.mesh.visible = false; p.trailLine.visible = false; }
    predLine.visible = false; launchInd.visible = false;

    game.mode = mode; game.level = levelNum; game.state = 'playing';
    const lvl = generateLevel(levelNum, mode);
    game.currentLevel = lvl; game.score = 0; game.probesUsed = 0;
    game.probesRemaining = lvl.probeLimit; game.targetsCollected = 0;
    game.targetsTotal = lvl.targets.length; game.elapsedTime = 0;
    game.combo = 0; game.bestCombo = 0; game.lastCollectTime = 0;
    game.charging = false; game.chargeAmount = 0;
    game.slowMo = false; game.timeScale = 1;
    game.activePowerUp = null; game.powerUpTimer = 0;
    game.shieldActive = false; game.magnetActive = false;
    game.multiShotActive = false; game.timeFreezeActive = false;
    game.magnetCollects = 0; game.freezeCollects = 0;
    // R2: Reset camera follow and high score flag
    game.cameraFollow = false; game.cameraFollowTarget = null;
    game.newHighScore = false;
    game.slingshotNotif = false; game.slingshotNotifTimer = 0;
    // R3: Reset survival wave and danger state
    if (mode === 'survival' && levelNum === 1) game.survivalWave = 1;
    game.survivalWaveBannerTimer = mode === 'survival' ? 2.5 : 0;
    game.dangerWarningTimer = 0; game.maxProximity = 0;
    game.celebration = { active: false, timer: 0, threeStars: false };
    // R3: Reset graze cooldowns
    game.grazeCooldowns.clear();

    wells = lvl.wells.map(cfg => createGravityWell(world.scene, cfg));
    targets = lvl.targets.map(cfg => createTarget(world.scene, cfg));
    powerUps = lvl.powerUps.map(cfg => createPowerUp(world.scene, cfg));
    wormholes = lvl.wormholes.map(cfg => createWormhole(world.scene, cfg));
    // R3: Create asteroids
    asteroids = lvl.asteroids.map(cfg => createAsteroid(world.scene, cfg));
    // R2: Create energy beams between nearby wells
    energyBeams = createEnergyBeams(world.scene, wells);
    game.wells = wells; game.targets = targets; game.probes = probes;
    game.powerUps = powerUps; game.wormholes = wormholes;

    physicsSys.setRefs({ game, audio, particles, shake, shootingStars, scorePopups, probes, wells, targets, powerUps, wormholes, energyBeams, gravLines, asteroids, dustUpdate: ambientDust.update, starTwinkle: starField.twinkle, ambient, fog: world.scene.fog as Fog });
    inputSys.setRefs({ game, audio, keys, probes, wells, predLine, launchInd, onMultiShot: handleMultiShot });

    audio.startDrone();
  }

  // Multi-shot handler
  function handleMultiShot() {
    if (game.probesRemaining < 2) return;
    const baseDir = new Vector3(0, 0, -1);
    if (world.camera) baseDir.applyQuaternion(world.camera.quaternion).normalize();
    const up = new Vector3(0, 1, 0);
    for (const angle of [-0.26, 0.26]) {
      const dir = baseDir.clone().applyAxisAngle(up, angle).normalize();
      inputSys.launchExtra(dir);
    }
  }

  // R2: Record high scores on level end (called from a state watcher)
  let lastState: GameState = 'menu';
  function checkHighScoreRecording() {
    if ((game.state === 'level-complete' || game.state === 'game-over') && lastState === 'playing') {
      const accuracy = game.probesUsed > 0 ? game.targetsCollected / game.probesUsed : 0;
      const isNew = highScores.record(game.mode, game.level, game.score, game.getStars(), accuracy);
      if (isNew) {
        game.newHighScore = true;
        audio.playHighScore();
      }
    }
    lastState = game.state;
  }

  // Theme switcher
  function applyTheme(t: ThemeName) {
    currentTheme = THEMES[t];
    ambient.color.set(currentTheme.ambient);
    (world.scene as any).background = new Color(currentTheme.bg);
    (world.scene.fog as Fog).color.set(currentTheme.fog);
    gridFloor.traverse((child) => {
      if ((child as any).isMesh || (child as any).isLineSegments) {
        const mat = (child as Mesh).material as MeshBasicMaterial | LineBasicMaterial;
        if (mat.color) mat.color.set(currentTheme.grid);
      }
    });
    // R2: Update atmospheric colors
    shootingStars.setThemeColor(currentTheme.nebula);
    for (const cloud of nebulaClouds) world.scene.remove(cloud);
    nebulaClouds = createNebulaClouds(world.scene, currentTheme.nebula);
    // R3: Theme-reactive audio
    audio.setThemeTuning(t);
  }

  // ---- Create Panel UI entities ----
  const panelConfigs: Array<{
    name: string; config: string; maxW: number; maxH: number;
    follow: boolean; offset?: [number, number, number]; visible?: boolean;
  }> = [
    { name: 'mainMenu', config: './ui/main-menu.json', maxW: 0.6, maxH: 0.8, follow: true, offset: [0, -0.05, -0.9], visible: true },
    { name: 'hud', config: './ui/hud.json', maxW: 0.35, maxH: 0.12, follow: true, offset: [0.3, 0.15, -0.6] },
    { name: 'gameOver', config: './ui/game-over.json', maxW: 0.55, maxH: 0.7, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'modeSelect', config: './ui/mode-select.json', maxW: 0.55, maxH: 0.7, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'howToPlay', config: './ui/how-to-play.json', maxW: 0.55, maxH: 0.7, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'settings', config: './ui/settings.json', maxW: 0.55, maxH: 0.65, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'stats', config: './ui/stats.json', maxW: 0.55, maxH: 0.7, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'achievements', config: './ui/achievements.json', maxW: 0.55, maxH: 0.8, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'pause', config: './ui/pause.json', maxW: 0.45, maxH: 0.5, follow: true, offset: [0, -0.05, -0.8] },
    { name: 'themeSelect', config: './ui/theme-select.json', maxW: 0.5, maxH: 0.55, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'notification', config: './ui/notification.json', maxW: 0.35, maxH: 0.1, follow: true, offset: [0, 0.25, -0.65] },
    { name: 'powerGauge', config: './ui/power-gauge.json', maxW: 0.2, maxH: 0.06, follow: true, offset: [0, -0.2, -0.55] },
    { name: 'levelComplete', config: './ui/level-complete.json', maxW: 0.55, maxH: 0.65, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'dailyChallenge', config: './ui/daily-challenge.json', maxW: 0.55, maxH: 0.65, follow: true, offset: [0, -0.05, -0.85] },
    { name: 'powerUpHud', config: './ui/power-up-hud.json', maxW: 0.25, maxH: 0.05, follow: true, offset: [-0.3, 0.15, -0.6] },
    // R2: Level select panel
    { name: 'levelSelect', config: './ui/level-select.json', maxW: 0.55, maxH: 0.7, follow: true, offset: [0, -0.05, -0.85] },
    // R3: Tutorial hint panel
    { name: 'tutorialHint', config: './ui/tutorial-hint.json', maxW: 0.4, maxH: 0.08, follow: true, offset: [0, -0.2, -0.7] },
    // R3: Wave banner panel
    { name: 'waveBanner', config: './ui/wave-banner.json', maxW: 0.4, maxH: 0.12, follow: true, offset: [0, 0.1, -0.8] },
  ];

  for (const pc of panelConfigs) {
    const entity = world.createTransformEntity(undefined, { persistent: true });
    entity.addComponent(PanelUI, { config: pc.config, maxWidth: pc.maxW, maxHeight: pc.maxH });
    if (pc.follow) {
      entity.addComponent(Follower, {
        target: world.player.head,
        offsetPosition: pc.offset || [0, 0, -0.8],
        speed: 5,
        tolerance: 0.3,
      });
    }
    entity.object3D!.visible = pc.visible ?? false;
  }

  // ---- Register Systems ----
  world.registerSystem(OrbitPhysicsSystem);
  world.registerSystem(InputControlSystem);
  world.registerSystem(GameUISystem);

  const physicsSys = world.getSystem(OrbitPhysicsSystem) as OrbitPhysicsSystem;
  const inputSys = world.getSystem(InputControlSystem) as InputControlSystem;
  const uiSys = world.getSystem(GameUISystem) as GameUISystem;

  physicsSys.setRefs({ game, audio, particles, shake, shootingStars, scorePopups, probes, wells, targets, powerUps, wormholes, energyBeams, gravLines, asteroids, dustUpdate: ambientDust.update, starTwinkle: starField.twinkle, ambient, fog: world.scene.fog as Fog });
  inputSys.setRefs({ game, audio, keys, probes, wells, predLine, launchInd, onMultiShot: handleMultiShot });
  uiSys.setRefs({ game, audio, highScores, onStart: startLevel, onTheme: applyTheme });

  // R2: State watcher for high score recording — poll every frame via a lightweight system
  class StateWatcherSystem extends createSystem({}) {
    update(_delta: number, _time: number) { checkHighScoreRecording(); }
  }
  world.registerSystem(StateWatcherSystem);
}

main();
