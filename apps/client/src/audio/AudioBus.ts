/**
 * AudioBus — wrapper sobre WebAudio API com roteamento por categoria
 * (sfx / music) → master → destination, e um pool de AudioBuffers
 * sintetizados em runtime (sem assets externos).
 *
 * O objetivo é fornecer SFX simples (laser, explosão, UI clicks, ...)
 * sem dependência de arquivos .mp3/.wav. Os sons são gerados
 * proceduralmente quando o bus é criado.
 *
 * Se o `AudioContext` não puder ser instanciado (SSR, ambiente
 * sem WebAudio, teste), o handle retornado é um no-op com `play`
 * sempre devolvendo `null`.
 */

import type { ClientSettings } from '../ui/settings.js';

export type SoundId =
  | 'laser'
  | 'explosion'
  | 'engine'
  | 'ui_click'
  | 'ui_error'
  | 'quest_complete';

export type SoundCategory = 'sfx' | 'music';

export interface PlayOpts {
  volume?: number;
  loop?: boolean;
}

export interface AudioBusHandle {
  play(id: SoundId, opts?: PlayOpts): AudioBufferSourceNode | null;
  stopAll(): void;
  setMasterVolume(v: number): void;
  setCategoryVolume(cat: SoundCategory, v: number): void;
}

interface AudioBusOpts {
  settings: ClientSettings;
}

interface CategoryNodes {
  gain: GainNode;
}

interface MutableCategory {
  gain: GainNode;
  volume: number;
}

const SAMPLE_RATE = 44100;

/** Factory de buffers sintéticos. */
function makeBuffer(ctx: AudioContext, id: SoundId): AudioBuffer {
  switch (id) {
    case 'laser':
      return makeSquare(ctx, 880, 0.05, 0.3);
    case 'explosion':
      return makeNoise(ctx, 0.2, 0.5);
    case 'engine':
      return makeSawtooth(ctx, 110, 0.4, 0.25);
    case 'ui_click':
      return makeSine(ctx, 440, 0.03, 0.4);
    case 'ui_error':
      return makeSine(ctx, 220, 0.1, 0.5);
    case 'quest_complete':
      return makeChord(ctx, [523.25, 659.25, 783.99], 0.05, 0.4, 'triangle');
  }
}

function makeSquare(ctx: AudioContext, freq: number, dur: number, vol: number): AudioBuffer {
  return makeTone(ctx, freq, dur, vol, 'square');
}

function makeSawtooth(ctx: AudioContext, freq: number, dur: number, vol: number): AudioBuffer {
  return makeTone(ctx, freq, dur, vol, 'sawtooth');
}

function makeSine(ctx: AudioContext, freq: number, dur: number, vol: number): AudioBuffer {
  return makeTone(ctx, freq, dur, vol, 'sine');
}

function makeTone(
  ctx: AudioContext,
  freq: number,
  dur: number,
  vol: number,
  kind: 'sine' | 'square' | 'sawtooth' | 'triangle',
): AudioBuffer {
  const samples = Math.max(1, Math.floor(dur * SAMPLE_RATE));
  const buf = ctx.createBuffer(1, samples, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE;
    const phase = 2 * Math.PI * freq * t;
    let s = 0;
    switch (kind) {
      case 'sine':
        s = Math.sin(phase);
        break;
      case 'square':
        s = Math.sign(Math.sin(phase));
        break;
      case 'sawtooth':
        s = 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5));
        break;
      case 'triangle':
        s = 2 * Math.abs(2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5))) - 1;
        break;
    }
    // Envelope rápido (attack 5ms, release resto) para evitar cliques.
    const env =
      t < 0.005
        ? t / 0.005
        : Math.max(0, 1 - (t - 0.005) / Math.max(0.001, dur - 0.005));
    data[i] = s * vol * env;
  }
  return buf;
}

function makeNoise(ctx: AudioContext, dur: number, vol: number): AudioBuffer {
  const samples = Math.max(1, Math.floor(dur * SAMPLE_RATE));
  const buf = ctx.createBuffer(1, samples, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = Math.max(0, 1 - t / dur);
    data[i] = (Math.random() * 2 - 1) * vol * env;
  }
  return buf;
}

function makeChord(
  ctx: AudioContext,
  freqs: number[],
  noteDur: number,
  vol: number,
  kind: 'sine' | 'square' | 'sawtooth' | 'triangle',
): AudioBuffer {
  const total = noteDur * freqs.length;
  const samples = Math.max(1, Math.floor(total * SAMPLE_RATE));
  const buf = ctx.createBuffer(1, samples, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE;
    const noteIdx = Math.min(freqs.length - 1, Math.floor(t / noteDur));
    const localT = t - noteIdx * noteDur;
    const phase = 2 * Math.PI * freqs[noteIdx]! * localT;
    let s = 0;
    switch (kind) {
      case 'sine':
        s = Math.sin(phase);
        break;
      case 'square':
        s = Math.sign(Math.sin(phase));
        break;
      case 'sawtooth':
        s = 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5));
        break;
      case 'triangle':
        s = 2 * Math.abs(2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5))) - 1;
        break;
    }
    const env = localT < 0.005 ? localT / 0.005 : Math.max(0, 1 - (localT - 0.005) / Math.max(0.001, noteDur - 0.005));
    data[i] = s * vol * env;
  }
  return buf;
}

const SOUND_CATEGORY: Record<SoundId, SoundCategory> = {
  laser: 'sfx',
  explosion: 'sfx',
  engine: 'sfx',
  ui_click: 'sfx',
  ui_error: 'sfx',
  quest_complete: 'sfx',
};

export function createAudioBus(opts: AudioBusOpts): AudioBusHandle {
  let ctx: AudioContext | null = null;
  try {
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? (window.AudioContext as typeof AudioContext | undefined) ??
          ((window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext as typeof AudioContext | undefined)
        : undefined;
    if (Ctor) ctx = new Ctor();
  } catch {
    ctx = null;
  }

  if (!ctx) {
    // No-op handle para SSR / testes / ambientes sem WebAudio.
    return {
      play: () => null,
      stopAll: () => undefined,
      setMasterVolume: () => undefined,
      setCategoryVolume: () => undefined,
    };
  }

  const master = ctx.createGain();
  master.gain.value = clamp01(opts.settings.audioMaster);
  master.connect(ctx.destination);

  const categories: Record<SoundCategory, MutableCategory> = {
    sfx: { gain: ctx.createGain(), volume: opts.settings.audioSfx },
    music: { gain: ctx.createGain(), volume: opts.settings.audioMusic },
  };
  categories.sfx.gain.gain.value = clamp01(categories.sfx.volume);
  categories.music.gain.gain.value = clamp01(categories.music.volume);
  categories.sfx.gain.connect(master);
  categories.music.gain.connect(master);

  const pool: Map<SoundId, AudioBuffer[]> = new Map();
  const active: AudioBufferSourceNode[] = [];

  function getBuffer(id: SoundId): AudioBuffer {
    const list = pool.get(id);
    if (list && list.length > 0) {
      const b = list.pop()!;
      return b;
    }
    const fresh = makeBuffer(ctx!, id);
    return fresh;
  }

  function recycleBuffer(id: SoundId, b: AudioBuffer): void {
    const list = pool.get(id);
    if (list) {
      if (list.length < 8) list.push(b);
    } else {
      pool.set(id, [b]);
    }
  }

  function play(id: SoundId, playOpts?: PlayOpts): AudioBufferSourceNode | null {
    if (!ctx) return null;
    const cat = SOUND_CATEGORY[id];
    const catNode = categories[cat].gain;
    const buffer = getBuffer(id);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = playOpts?.loop === true;
    let gain: GainNode | null = null;
    if (typeof playOpts?.volume === 'number') {
      gain = ctx.createGain();
      gain.gain.value = clamp01(playOpts.volume);
      src.connect(gain);
      gain.connect(catNode);
    } else {
      src.connect(catNode);
    }
    src.onended = (): void => {
      const idx = active.indexOf(src);
      if (idx >= 0) active.splice(idx, 1);
      recycleBuffer(id, buffer);
    };
    active.push(src);
    try {
      src.start();
    } catch {
      return null;
    }
    return src;
  }

  function stopAll(): void {
    for (const src of [...active]) {
      try {
        src.stop();
      } catch {
        /* já parou */
      }
    }
    active.length = 0;
  }

  function setMasterVolume(v: number): void {
    master.gain.value = clamp01(v);
  }

  function setCategoryVolume(cat: SoundCategory, v: number): void {
    const c = categories[cat];
    c.volume = clamp01(v);
    c.gain.gain.value = c.volume;
  }

  return { play, stopAll, setMasterVolume, setCategoryVolume };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
