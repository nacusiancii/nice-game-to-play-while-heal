// Tiny synthesized sound effects. No audio files.
import { emit } from './events';
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('rabble-below/muted') === '1';

export const isMuted = () => muted;
export function toggleMute() {
  muted = !muted;
  localStorage.setItem('rabble-below/muted', muted ? '1' : '0');
  return muted;
}

function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slideTo?: number, delay = 0) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.08, delay = 0, lowpass = 1200) {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

const sounds = {
  click: () => tone(660, 0.05, 'square', 0.03),
  buy: () => { tone(880, 0.06, 'square', 0.04); tone(1320, 0.08, 'square', 0.04, undefined, 0.05); },
  sell: () => { tone(1200, 0.05, 'triangle', 0.05); tone(900, 0.08, 'triangle', 0.05, undefined, 0.05); },
  coin: () => { tone(1500, 0.05, 'square', 0.03); tone(2000, 0.08, 'square', 0.03, undefined, 0.04); },
  reroll: () => { for (let i = 0; i < 4; i++) tone(400 + i * 120, 0.04, 'triangle', 0.04, undefined, i * 0.03); },
  freeze: () => tone(1800, 0.15, 'sine', 0.04, 900),
  merge: () => [523, 659, 784].forEach((f, i) => tone(f, 0.1, 'square', 0.04, undefined, i * 0.06)),
  levelUp: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.05, undefined, i * 0.08)),
  error: () => tone(160, 0.15, 'sawtooth', 0.04, 120),
  hit: () => { noise(0.12, 0.12, 0, 900); tone(140, 0.08, 'square', 0.04, 70); },
  zap: () => tone(1200, 0.12, 'sawtooth', 0.025, 300),
  buff: () => tone(700, 0.08, 'triangle', 0.035, 1100),
  ward: () => tone(500, 0.15, 'sine', 0.05, 900),
  faint: () => tone(300, 0.3, 'triangle', 0.06, 60),
  summon: () => { tone(200, 0.15, 'sine', 0.05, 600); noise(0.1, 0.04, 0.05, 3000); },
  proc: () => tone(980, 0.06, 'sine', 0.03),
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.16, 'square', 0.05, undefined, i * 0.1)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'triangle', 0.06, undefined, i * 0.15)),
  draw: () => [440, 440].forEach((f, i) => tone(f, 0.15, 'triangle', 0.05, undefined, i * 0.18)),
};

// every sound is announced as an event, so tools/feel knows what you would hear and when
export const sfx = Object.fromEntries(Object.entries(sounds).map(([name, play]) => [name, () => { emit('sfx', name); play(); }])) as typeof sounds;
