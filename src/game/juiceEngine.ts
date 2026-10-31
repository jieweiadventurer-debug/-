// Zero-GC Pooled Particle Ring Buffer + Procedural & Sampled Audio Engine for Signal Relay v0.6.0

export interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const POOL_CAPACITY = 160;

export class ParticlePool {
  readonly pool: PooledParticle[];
  private cursor = 0;

  constructor() {
    this.pool = Array.from({ length: POOL_CAPACITY }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 3,
      color: '#ffcd75',
    }));
  }

  spawnBurst(
    cx: number,
    cy: number,
    color: string,
    count: number,
    speedMin = 40,
    speedMax = 140,
    size = 3.5,
  ): void {
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % POOL_CAPACITY;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      p.active = true;
      p.x = cx;
      p.y = cy;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 15;
      p.maxLife = 0.28 + Math.random() * 0.25;
      p.life = p.maxLife;
      p.size = size * (0.8 + Math.random() * 0.45);
      p.color = color;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < POOL_CAPACITY; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt; // gentle gravity
      p.vx *= 0.96;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    const prevAlpha = g.globalAlpha;
    for (let i = 0; i < POOL_CAPACITY; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      const ratio = Math.max(0, p.life / p.maxLife);
      g.globalAlpha = ratio;
      g.fillStyle = p.color;
      const s = p.size * (0.5 + 0.5 * ratio);
      g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    g.globalAlpha = prevAlpha;
  }

  clear(): void {
    for (let i = 0; i < POOL_CAPACITY; i++) {
      this.pool[i].active = false;
    }
  }
}

export type VolumeTier = 'low' | 'mid' | 'high';
export type SoundPipeKind = 's' | 'c' | 't' | 'a';
export type CellHapticAction = 'place' | 'remove' | 'rotate';
export type WxVibrateShortType = 'light' | 'medium' | 'heavy';

export interface CellHapticProfile {
  action: CellHapticAction;
  pipeType: SoundPipeKind;
  wxType: WxVibrateShortType;
  pulseCount: 1 | 2;
  secondaryWxType?: WxVibrateShortType;
  secondaryDelayMs?: number;
  durationMs: number;
  webPattern: number | number[];
  label: string;
}

interface WxMiniGameGlobal {
  vibrateShort?: (opts?: {
    type?: WxVibrateShortType;
    success?: () => void;
    fail?: () => void;
    complete?: () => void;
  }) => void;
  vibrateLong?: (opts?: {
    success?: () => void;
    fail?: () => void;
    complete?: () => void;
  }) => void;
}

/**
 * Returns differentiated haptic feedback profiles for board cell interactions
 * (rotate = short/light 12ms, place = medium/solid 28ms or 46ms for amplifier,
 * remove = longer/heavy release pulse 62ms).
 */
export function getCellInteractionHapticProfile(
  action: CellHapticAction,
  pipeType: SoundPipeKind = 's',
): CellHapticProfile {
  switch (action) {
    case 'rotate':
      return {
        action: 'rotate',
        pipeType,
        wxType: 'light',
        pulseCount: 1,
        durationMs: 12,
        webPattern: 12,
        label: '旋转微震 (light · 12ms)',
      };
    case 'place':
      if (pipeType === 'a') {
        return {
          action: 'place',
          pipeType: 'a',
          wxType: 'medium',
          pulseCount: 2,
          secondaryWxType: 'light',
          secondaryDelayMs: 32,
          durationMs: 44,
          webPattern: [26, 16, 18],
          label: '放置增幅器谐振震动 (medium+light · 44ms)',
        };
      }
      return {
        action: 'place',
        pipeType,
        wxType: 'medium',
        pulseCount: 1,
        durationMs: 28,
        webPattern: 28,
        label: '放置管件中度震动 (medium · 28ms)',
      };
    case 'remove':
    default:
      return {
        action: 'remove',
        pipeType,
        wxType: 'heavy',
        pulseCount: 2,
        secondaryWxType: 'medium',
        secondaryDelayMs: 42,
        durationMs: 62,
        webPattern: [40, 20, 22],
        label: '移除管件长震动 (heavy+medium · 62ms)',
      };
  }
}

export interface PipePlacementSoundProfile {
  pipeType: SoundPipeKind;
  category: 'amplifier' | 'standard';
  label: string;
  waveform: OscillatorType;
  startHz: number;
  midHz: number;
  endHz: number;
  harmonicRatio: number;
  harmonicGainRatio: number;
  durationSec: number;
  baseGain: number;
}

export interface SpatialAudioInput {
  col: number;
  totalCols: number;
  row?: number;
  totalRows?: number;
  maxPan?: number;
}

export type SpatialChannelBias = 'left' | 'center' | 'right';

export interface SpatialAudioProfile {
  col: number;
  totalCols: number;
  row: number;
  totalRows: number;
  pan: number;
  channelBias: SpatialChannelBias;
  detuneCents: number;
  leftGainRatio: number;
  rightGainRatio: number;
  label: string;
}

/**
 * Computes Web Audio API StereoPannerNode pan offset in [-maxPan, +maxPan]
 * from grid column `col` and `totalCols`.
 * Left-side columns produce negative pan (< 0, left channel offset),
 * center column produces 0, and right-side columns produce positive pan (> 0, right channel offset).
 */
export function computeSpatialAudioPan(
  col: number,
  totalCols: number,
  maxPan = 0.68,
): number {
  if (!Number.isFinite(col) || !Number.isFinite(totalCols) || totalCols <= 1) {
    return 0;
  }
  const safeMax = Math.max(0.1, Math.min(1, maxPan));
  const clampedCol = Math.max(0, Math.min(totalCols - 1, col));
  const normalized = (clampedCol / (totalCols - 1)) * 2 - 1; // [-1, +1]
  const rawPan = Math.max(-1, Math.min(1, normalized * safeMax));
  const rounded = Math.round(rawPan * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function getSpatialAudioProfile(
  input: SpatialAudioInput,
): SpatialAudioProfile {
  const totalCols = Math.max(1, Math.floor(input.totalCols || 1));
  const col = Math.max(0, Math.min(totalCols - 1, Math.floor(input.col ?? 0)));
  const totalRows = Math.max(1, Math.floor(input.totalRows || 1));
  const row = Math.max(0, Math.min(totalRows - 1, Math.floor(input.row ?? 0)));
  const pan = computeSpatialAudioPan(col, totalCols, input.maxPan ?? 0.68);
  const channelBias: SpatialChannelBias =
    pan < -0.05 ? 'left' : pan > 0.05 ? 'right' : 'center';

  // Subtle vertical pitch offset: upper rows slightly brighter (+18 cents), lower rows warmer (-18 cents)
  const normY = totalRows > 1 ? 0.5 - row / (totalRows - 1) : 0;
  const detuneCents = Object.is(Math.round(normY * 36), -0)
    ? 0
    : Math.round(normY * 36);

  // Equal-power stereo gain distribution for left/right channels
  const angle = ((pan + 1) * Math.PI) / 4;
  const leftGainRatio = Math.round(Math.cos(angle) * 1000) / 1000;
  const rightGainRatio = Math.round(Math.sin(angle) * 1000) / 1000;

  const biasLabel =
    channelBias === 'left'
      ? `左声道偏移 (${pan.toFixed(2)})`
      : channelBias === 'right'
        ? `右声道偏移 (+${pan.toFixed(2)})`
        : '中央声道 (0.00)';

  return {
    col,
    totalCols,
    row,
    totalRows,
    pan,
    channelBias,
    detuneCents,
    leftGainRatio,
    rightGainRatio,
    label: biasLabel,
  };
}

export function getPipePlacementSoundProfile(
  pipeType: SoundPipeKind = 's',
): PipePlacementSoundProfile {
  switch (pipeType) {
    case 'a':
      return {
        pipeType: 'a',
        category: 'amplifier',
        label: '增幅器谐振充能音效',
        waveform: 'triangle',
        startHz: 520,
        midHz: 780,
        endHz: 1060,
        harmonicRatio: 1.5,
        harmonicGainRatio: 0.65,
        durationSec: 0.135,
        baseGain: 0.145,
      };
    case 't':
      return {
        pipeType: 't',
        category: 'standard',
        label: '三通管分流双音音效',
        waveform: 'triangle',
        startHz: 440,
        midHz: 560,
        endHz: 720,
        harmonicRatio: 1.33,
        harmonicGainRatio: 0.42,
        durationSec: 0.095,
        baseGain: 0.125,
      };
    case 'c':
      return {
        pipeType: 'c',
        category: 'standard',
        label: '拐角管折向清脆音效',
        waveform: 'sine',
        startHz: 460,
        midHz: 530,
        endHz: 680,
        harmonicRatio: 1.25,
        harmonicGainRatio: 0.3,
        durationSec: 0.082,
        baseGain: 0.12,
      };
    case 's':
    default:
      return {
        pipeType: 's',
        category: 'standard',
        label: '直线管标准卡扣音效',
        waveform: 'triangle',
        startHz: 410,
        midHz: 520,
        endHz: 630,
        harmonicRatio: 1.2,
        harmonicGainRatio: 0.22,
        durationSec: 0.075,
        baseGain: 0.118,
      };
  }
}

export const VOLUME_TIERS: Record<
  VolumeTier,
  { id: VolumeTier; label: string; sfx: number; music: number }
> = {
  low: { id: 'low', label: '低', sfx: 0.3, music: 0.18 },
  mid: { id: 'mid', label: '中', sfx: 0.6, music: 0.35 },
  high: { id: 'high', label: '高', sfx: 1.0, music: 0.55 },
};

class SoundController {
  private audioCtx: AudioContext | null = null;
  private sfxSamples: Record<string, HTMLAudioElement> = {};
  private bgmAudio: HTMLAudioElement | null = null;
  private soundEnabled = true;
  private musicEnabled = false;
  private volumeTier: VolumeTier = 'mid';
  public lastPlayedPipeProfile: PipePlacementSoundProfile | null = null;
  public lastSpatialProfile: SpatialAudioProfile | null = null;
  public lastHapticProfile: CellHapticProfile | null = null;
  public spatialAudioHistory: {
    action: string;
    pipeType: SoundPipeKind;
    col: number;
    totalCols: number;
    pan: number;
    channelBias: SpatialChannelBias;
  }[] = [];
  public wxVibrateHistory: {
    action: CellHapticAction;
    wxType: WxVibrateShortType;
    durationMs: number;
    pipeType: SoundPipeKind;
  }[] = [];

  init(): void {
    if (typeof window === 'undefined') return;
    if (Object.keys(this.sfxSamples).length === 0) {
      for (const name of ['place', 'rotate', 'win', 'reward', 'sign']) {
        const el = new Audio(`/wx-assets/audio/${name}.wav`);
        el.preload = 'auto';
        this.sfxSamples[name] = el;
      }
      const bgm = new Audio('/wx-assets/music/relay-loop.mp3');
      bgm.loop = true;
      bgm.preload = 'auto';
      this.bgmAudio = bgm;
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) this.audioCtx = new Ctor();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private createSpatialDestination(
    ctx: AudioContext,
    pan: number,
    now: number,
  ): AudioNode {
    if (typeof ctx.createStereoPanner === 'function') {
      try {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
        panner.connect(ctx.destination);
        return panner;
      } catch {
        return ctx.destination;
      }
    }
    return ctx.destination;
  }

  configure(opts: {
    sound?: boolean;
    music?: boolean;
    volumeTier?: VolumeTier;
  }): void {
    this.init();
    if (opts.sound !== undefined) this.soundEnabled = opts.sound;
    if (opts.volumeTier !== undefined) {
      this.volumeTier = opts.volumeTier;
      this.syncMusicVolume();
    }
    if (opts.music !== undefined) {
      this.musicEnabled = opts.music;
      if (this.bgmAudio) {
        if (this.musicEnabled) {
          this.bgmAudio.volume = VOLUME_TIERS[this.volumeTier].music;
          this.bgmAudio.play().catch(() => {});
        } else {
          this.bgmAudio.pause();
        }
      }
    }
  }

  syncMusicVolume(): void {
    if (this.bgmAudio) {
      this.bgmAudio.volume = VOLUME_TIERS[this.volumeTier].music;
    }
  }

  pauseMusicForModal(): void {
    if (this.bgmAudio && this.musicEnabled) {
      this.bgmAudio.pause();
    }
  }

  resumeMusicFromModal(): void {
    if (this.bgmAudio && this.musicEnabled) {
      this.bgmAudio.volume = VOLUME_TIERS[this.volumeTier].music;
      this.bgmAudio.play().catch(() => {});
    }
  }

  play(
    kind: 'place' | 'rotate' | 'remove' | 'win' | 'reward' | 'sign' | 'conflict',
    pipeType: SoundPipeKind = 's',
    spatialInput?: SpatialAudioInput,
  ): SpatialAudioProfile {
    const spatial = getSpatialAudioProfile(
      spatialInput ?? { col: 0, totalCols: 1, row: 0, totalRows: 1 },
    );
    this.lastSpatialProfile = spatial;
    if (kind === 'place') {
      this.lastPlayedPipeProfile = getPipePlacementSoundProfile(pipeType);
    }
    if (kind === 'place' || kind === 'rotate' || kind === 'remove') {
      this.spatialAudioHistory = [
        ...this.spatialAudioHistory.slice(-29),
        {
          action: kind,
          pipeType,
          col: spatial.col,
          totalCols: spatial.totalCols,
          pan: spatial.pan,
          channelBias: spatial.channelBias,
        },
      ];
    }

    if (!this.soundEnabled) return spatial;
    this.init();
    const mult = VOLUME_TIERS[this.volumeTier].sfx;

    // Play normalized wav asset when matching (attenuated slightly when spatially panned so Web Audio stereo image leads)
    const sampleName =
      kind === 'remove' ? 'rotate' : kind === 'conflict' ? null : kind;
    if (sampleName && this.sfxSamples[sampleName]) {
      try {
        const s = this.sfxSamples[sampleName];
        const spatialAtten = Math.abs(spatial.pan) > 0.05 ? 0.55 : 0.85;
        s.volume = Math.min(1, mult * spatialAtten);
        s.currentTime = 0;
        s.play().catch(() => {});
      } catch {
        // fallback to synth below
      }
    }

    // Layer pitch-varied & spatially panned Web Audio synth via StereoPannerNode
    const ctx = this.ensureContext();
    if (!ctx) return spatial;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pitchJitter = 0.96 + Math.random() * 0.08;
      const primaryDest = this.createSpatialDestination(ctx, spatial.pan, now);

      if (osc.detune) {
        osc.detune.setValueAtTime(spatial.detuneCents, now);
      }

      if (kind === 'place') {
        const profile = getPipePlacementSoundProfile(pipeType);
        const dur = profile.durationSec;
        osc.type = profile.waveform;
        osc.frequency.setValueAtTime(profile.startHz * pitchJitter, now);
        osc.frequency.exponentialRampToValueAtTime(
          profile.midHz * pitchJitter,
          now + dur * 0.45,
        );
        osc.frequency.exponentialRampToValueAtTime(
          profile.endHz * pitchJitter,
          now + dur,
        );
        gain.gain.setValueAtTime(profile.baseGain * mult, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.01);
        osc.connect(gain);
        gain.connect(primaryDest);
        osc.start(now);
        osc.stop(now + dur + 0.015);

        // Secondary harmonic overtone routed through slightly widened StereoPannerNode
        const harmOsc = ctx.createOscillator();
        const harmGain = ctx.createGain();
        const harmPan = Math.max(-1, Math.min(1, spatial.pan * 1.1));
        const harmDest = this.createSpatialDestination(ctx, harmPan, now);
        harmOsc.type = profile.category === 'amplifier' ? 'sine' : 'triangle';
        if (harmOsc.detune) {
          harmOsc.detune.setValueAtTime(spatial.detuneCents, now);
        }
        harmOsc.frequency.setValueAtTime(
          profile.startHz * profile.harmonicRatio * pitchJitter,
          now,
        );
        harmOsc.frequency.exponentialRampToValueAtTime(
          profile.endHz * profile.harmonicRatio * pitchJitter,
          now + dur,
        );
        harmGain.gain.setValueAtTime(
          profile.baseGain * profile.harmonicGainRatio * mult,
          now,
        );
        harmGain.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.01);
        harmOsc.connect(harmGain);
        harmGain.connect(harmDest);
        harmOsc.start(now);
        harmOsc.stop(now + dur + 0.015);
      } else if (kind === 'rotate' || kind === 'remove') {
        osc.type = kind === 'rotate' && pipeType === 'a' ? 'triangle' : 'sine';
        const base =
          kind === 'remove' ? 320 : pipeType === 'a' ? 610 : 520;
        const target =
          kind === 'remove' ? 210 : pipeType === 'a' ? 740 : 590;
        osc.frequency.setValueAtTime(base * pitchJitter, now);
        osc.frequency.exponentialRampToValueAtTime(
          target * pitchJitter,
          now + 0.055,
        );
        gain.gain.setValueAtTime(0.11 * mult, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(gain);
        gain.connect(primaryDest);
        osc.start(now);
        osc.stop(now + 0.065);
      } else if (kind === 'conflict') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(170, now);
        osc.frequency.linearRampToValueAtTime(135, now + 0.14);
        gain.gain.setValueAtTime(0.11 * mult, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(primaryDest);
        osc.start(now);
        osc.stop(now + 0.16);
      }
    } catch {
      // ignore
    }
    return spatial;
  }
}

export const soundFX = new SoundController();

/**
 * Invokes WeChat Mini-Game SDK `wx.vibrateShort({ type })` (with optional secondary pulse
 * for longer durations on remove / amplifier placement) and falls back to `navigator.vibrate`
 * on mobile browsers.
 */
export function triggerCellHaptic(
  action: CellHapticAction,
  pipeType: SoundPipeKind = 's',
  enabled = true,
): CellHapticProfile {
  const profile = getCellInteractionHapticProfile(action, pipeType);
  soundFX.lastHapticProfile = profile;
  soundFX.wxVibrateHistory = [
    ...soundFX.wxVibrateHistory.slice(-29),
    {
      action: profile.action,
      wxType: profile.wxType,
      durationMs: profile.durationMs,
      pipeType: profile.pipeType,
    },
  ];

  if (!enabled) {
    return profile;
  }

  try {
    const g = globalThis as unknown as {
      wx?: WxMiniGameGlobal;
      navigator?: Navigator;
    };
    if (g.wx && typeof g.wx.vibrateShort === 'function') {
      g.wx.vibrateShort({
        type: profile.wxType,
        success: () => {},
        fail: () => {},
      });
      if (
        profile.pulseCount === 2 &&
        profile.secondaryWxType &&
        profile.secondaryDelayMs
      ) {
        const secondType = profile.secondaryWxType;
        setTimeout(() => {
          try {
            g.wx?.vibrateShort?.({
              type: secondType,
              success: () => {},
              fail: () => {},
            });
          } catch {
            // ignore secondary pulse failure
          }
        }, profile.secondaryDelayMs);
      }
      return profile;
    }

    if (g.navigator && typeof g.navigator.vibrate === 'function') {
      g.navigator.vibrate(profile.webPattern);
    }
  } catch {
    // ignore platform haptic errors
  }

  return profile;
}
