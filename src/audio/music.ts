// Original background music, synthesised with Web Audio (the original game had none).
// A tiny step sequencer plays note patterns on three chip-style voices plus noise drums.

export type TrackName = 'menu' | 'battle' | 'victory' | 'defeat';

type Voice = 'lead' | 'pluck' | 'bass';

interface Note {
  voice: Voice;
  /** MIDI note number. */
  pitch: number;
  /** Start and length in sixteenth-note steps. */
  step: number;
  length: number;
  gain: number;
}

interface Hit {
  drum: 'kick' | 'snare' | 'hat';
  step: number;
}

interface Track {
  bpm: number;
  steps: number;
  loop: boolean;
  notes: Note[];
  hits: Hit[];
}

// --- Composition helpers ---------------------------------------------------------

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4", "F#3", "Bb2" -> MIDI number. */
function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/**
 * A melody line: "D5:4 F5:2 A5:2 -:4 ..." where each token is note:steps and "-" is a rest.
 * Returns notes laid end to end from `start`.
 */
function line(voice: Voice, text: string, start = 0, gain = 1): Note[] {
  const notes: Note[] = [];
  let step = start;
  for (const token of text.trim().split(/\s+/)) {
    const [name, len] = token.split(':');
    const length = Number(len ?? 1);
    if (name !== '-') notes.push({ voice, pitch: midi(name), step, length, gain });
    step += length;
  }
  return notes;
}

/** Repeats a one-bar arpeggio pattern over a chord progression (one chord per bar). */
function arpeggio(chords: string[][], pattern: number[], voice: Voice, stepLength: number, gain: number): Note[] {
  const notes: Note[] = [];
  chords.forEach((chord, bar) => {
    pattern.forEach((idx, i) => {
      const pitch = midi(chord[idx % chord.length]) + 12 * Math.floor(idx / chord.length);
      notes.push({ voice, pitch, step: bar * 16 + i * stepLength, length: stepLength, gain });
    });
  });
  return notes;
}

function drums(bars: number, pattern: Record<Hit['drum'], number[]>): Hit[] {
  const hits: Hit[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const [drum, steps] of Object.entries(pattern) as [Hit['drum'], number[]][]) {
      for (const s of steps) hits.push({ drum, step: bar * 16 + s });
    }
  }
  return hits;
}

// --- The score ----------------------------------------------------------------------

/** Barracks and menus: an unhurried D Dorian air over a plucked accompaniment. */
const MENU: Track = (() => {
  const chords = [
    ['D3', 'A3', 'F4'], ['C3', 'G3', 'E4'], ['G2', 'D3', 'B3'], ['D3', 'A3', 'F4'],
    ['F2', 'C3', 'A3'], ['C3', 'G3', 'E4'], ['A2', 'E3', 'C4'], ['D3', 'A3', 'F4'],
  ];
  const melody =
    'D5:4 E5:2 F5:2 A5:6 G5:2 ' +
    'E5:4 D5:2 C5:2 E5:8 ' +
    'D5:2 B4:2 G4:4 B4:4 D5:4 ' +
    'F5:4 E5:2 D5:2 D5:8 ' +
    'C5:2 D5:2 F5:4 A5:4 C6:4 ' +
    'G5:4 E5:4 C5:8 ' +
    'A4:2 C5:2 E5:4 D5:2 C5:2 A4:4 ' +
    'D5:12 -:4';
  return {
    bpm: 84,
    steps: 128,
    loop: true,
    notes: [
      ...arpeggio(chords, [0, 1, 2, 1, 0, 1, 2, 1], 'pluck', 2, 0.55),
      ...chords.map((c, bar) => ({ voice: 'bass' as Voice, pitch: midi(c[0]) - 12, step: bar * 16, length: 16, gain: 0.6 })),
      ...line('lead', melody, 0, 0.45),
    ],
    hits: [],
  };
})();

/** Battle: driving A minor with a galloping bass and a heroic call-and-answer lead. */
const BATTLE: Track = (() => {
  const roots = ['A1', 'A1', 'F1', 'G1', 'A1', 'A1', 'D2', 'E1'];
  const bass: Note[] = roots.flatMap((root, bar) =>
    [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].map((s, i) => ({
      voice: 'bass' as Voice,
      pitch: midi(root) + (i % 3 === 2 ? 12 : 0),
      step: bar * 16 + s,
      length: 1,
      gain: i % 3 === 0 ? 0.8 : 0.55,
    })),
  );
  const lead =
    'A4:3 C5:1 E5:4 D5:2 C5:2 B4:4 ' +
    'A4:2 B4:2 C5:2 D5:2 E5:8 ' +
    'F5:3 E5:1 D5:4 C5:2 A4:2 C5:4 ' +
    'B4:2 C5:2 D5:4 G4:8 ' +
    'A4:3 C5:1 E5:4 A5:4 G5:4 ' +
    'E5:2 F5:2 G5:2 A5:2 E5:8 ' +
    'F5:4 D5:4 A5:4 F5:4 ' +
    'E5:2 D5:2 C5:2 B4:2 G#4:8';
  const stabs = arpeggio(
    [['A3', 'C4', 'E4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4'], ['A3', 'C4', 'E4'], ['A3', 'C4', 'E4'], ['D3', 'F3', 'A3'], ['E3', 'G#3', 'B3']],
    [0, 1, 2, 1],
    'pluck',
    4,
    0.3,
  );
  return {
    bpm: 136,
    steps: 128,
    loop: true,
    notes: [...bass, ...stabs, ...line('lead', lead, 0, 0.4)],
    hits: drums(8, { kick: [0, 6, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] }),
  };
})();

const VICTORY: Track = {
  bpm: 120,
  steps: 32,
  loop: false,
  notes: [
    ...line('lead', 'C5:2 C5:1 C5:1 G5:4 E5:2 G5:2 C6:8 -:12', 0, 0.5),
    ...line('pluck', 'C4:2 E4:2 G4:4 C4:2 E4:2 G4:8 -:12', 0, 0.5),
    ...line('bass', 'C2:8 G2:4 C2:8 -:12', 0, 0.7),
  ],
  hits: [{ drum: 'kick', step: 0 }, { drum: 'snare', step: 8 }, { drum: 'kick', step: 12 }],
};

const DEFEAT: Track = {
  bpm: 76,
  steps: 32,
  loop: false,
  notes: [
    ...line('lead', 'E5:4 D5:4 C5:4 B4:4 A4:12 -:4', 0, 0.4),
    ...line('bass', 'A2:8 F2:8 E2:8 A1:8', 0, 0.6),
  ],
  hits: [],
};

const TRACKS: Record<TrackName, Track> = { menu: MENU, battle: BATTLE, victory: VICTORY, defeat: DEFEAT };

// --- Playback ---------------------------------------------------------------------------

const LOOKAHEAD_S = 0.2;
const TIMER_MS = 50;

class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track | null = null;
  private trackName: TrackName | null = null;
  private stepTime = 0;
  private nextStep = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private volume = 0.5;
  /** Notes waiting to sound, per step, for the current track. */
  private byStep: { notes: Note[]; hits: Hit[] }[] = [];

  constructor() {
    // Browsers only allow audio after a user gesture.
    const unlock = () => {
      this.ensureContext();
      void this.ctx?.resume();
      if (this.trackName && !this.timer) this.play(this.trackName, true);
    };
    if (typeof window === 'undefined') return; // e.g. tests
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, { capture: true });
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(volume * 0.35, this.ctx.currentTime, 0.05);
  }

  /** Switches track; playing the same looping track again is a no-op. */
  play(name: TrackName, force = false): void {
    if (!force && this.trackName === name && this.timer) return;
    this.stop();
    this.trackName = name;
    this.ensureContext();
    if (!this.ctx || this.ctx.state !== 'running') return; // starts once audio is unlocked
    const track = TRACKS[name];
    this.track = track;
    this.stepTime = 60 / track.bpm / 4;
    this.byStep = Array.from({ length: track.steps }, () => ({ notes: [], hits: [] }));
    for (const n of track.notes) this.byStep[n.step % track.steps].notes.push(n);
    for (const h of track.hits) this.byStep[h.step % track.steps].hits.push(h);
    this.nextStep = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.35;
    this.master.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const track = this.track;
    if (!ctx || !track) return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      if (this.nextStep >= track.steps) {
        if (!track.loop) {
          this.stop();
          this.trackName = null;
          return;
        }
        this.nextStep = 0;
      }
      const { notes, hits } = this.byStep[this.nextStep];
      for (const n of notes) this.playNote(n, this.nextTime);
      for (const h of hits) this.playDrum(h.drum, this.nextTime);
      this.nextStep++;
      this.nextTime += this.stepTime;
    }
  }

  private playNote(note: Note, at: number): void {
    const ctx = this.ctx!;
    const freq = 440 * Math.pow(2, (note.pitch - 69) / 12);
    const duration = note.length * this.stepTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = freq;
    let peak = note.gain;
    let release: number;
    if (note.voice === 'lead') {
      osc.type = 'square';
      peak *= 0.22;
      release = Math.min(0.12, duration * 0.3);
      // A little vibrato on held notes.
      if (duration > 0.4) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.value = freq * 0.006;
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(at + 0.15);
        lfo.stop(at + duration);
      }
    } else if (note.voice === 'pluck') {
      osc.type = 'triangle';
      peak *= 0.5;
      release = duration;
    } else {
      osc.type = 'triangle';
      peak *= 0.75;
      release = Math.min(0.08, duration * 0.4);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = note.voice === 'lead' ? 2600 : 1800;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.008);
    if (note.voice === 'pluck') env.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(duration, 0.05) * 1.8);
    else {
      env.gain.setValueAtTime(peak, at + Math.max(0.01, duration - release));
      env.gain.linearRampToValueAtTime(0, at + duration);
    }
    osc.connect(filter).connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + duration * 2 + 0.05);
  }

  private playDrum(drum: Hit['drum'], at: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.connect(this.master!);
    if (drum === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      env.gain.setValueAtTime(0.7, at);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      osc.connect(env);
      osc.start(at);
      osc.stop(at + 0.2);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = drum === 'hat' ? 'highpass' : 'bandpass';
    filter.frequency.value = drum === 'hat' ? 7000 : 1800;
    const length = drum === 'hat' ? 0.04 : 0.14;
    env.gain.setValueAtTime(drum === 'hat' ? 0.12 : 0.35, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + length);
    src.connect(filter).connect(env);
    src.start(at);
    src.stop(at + length + 0.02);
  }
}

export const music = new MusicPlayer();

/** Exposed for tests: the score's raw data. */
export const SCORE = TRACKS;
