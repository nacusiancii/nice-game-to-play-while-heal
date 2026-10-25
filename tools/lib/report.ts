// Reading the Veteran's decisions: was a choice obvious, a real dilemma, or a toss-up that didn't matter?
import { ITEMS, RELICS, UNITS } from '../../server/src/game/data';
import type { Decision, Option, RunLog } from './veteran';

export const nm = (k: string) => UNITS[k]?.name ?? ITEMS[k]?.name ?? RELICS[k]?.name ?? k;

// The best version of each distinct choice. Buying the same unit in front or at the back is one choice.
export function distinct(d: Decision): Option[] {
  return d.options.filter((o, i, a) => a.findIndex(p => p.key === o.key) === i);
}

// Gap between the best option and the best different one.
export function margin(d: Decision) {
  const o = distinct(d);
  return o.length > 1 ? o[0].value - o[1].value : Infinity;
}

// How much the choice matters: best option vs a typical (median) one.
export function stakes(d: Decision) {
  const v = distinct(d).map(o => o.value);
  return v.length > 1 ? v[0] - v[Math.floor(v.length / 2)] : 0;
}

// Thresholds in the decision's own unit: battle score (0..1) or expected trophies at run end.
const NEAR = { 'win%': 0.03, wins: 0.25 };
const FAR = { 'win%': 0.1, wins: 0.75 };

export type Verdict = 'obvious' | 'lean' | 'dilemma' | 'toss-up';
export const VERDICTS: Verdict[] = ['dilemma', 'lean', 'obvious', 'toss-up'];
export const VERDICT_HELP: Record<Verdict, string> = {
  dilemma: 'top options within a hair, and picking a weak one costs a lot: a real decision',
  lean: 'one option is somewhat better',
  obvious: 'one option is far ahead, well outside the noise',
  'toss-up': 'top options within a hair, and nothing much rides on it',
};

export function verdict(d: Decision): Verdict {
  const u = d.unit as 'win%';
  const m = margin(d), se = d.se ?? 0;
  if (m <= Math.max(NEAR[u], se)) return stakes(d) >= FAR[u] ? 'dilemma' : 'toss-up';
  return m >= FAR[u] && m >= 2 * se ? 'obvious' : 'lean';
}

export const fmt = (v: number, unit: string) => unit === 'wins' ? `${v.toFixed(2)} trophies` : `${(100 * v).toFixed(0)}`;

export function decisionStats(all: Decision[]) {
  const out: Record<string, Record<Verdict, number> & { n: number }> = {};
  for (const d of all) {
    if (d.kind === 'order') continue;
    const s = out[d.kind] ??= { n: 0, obvious: 0, lean: 0, dilemma: 0, 'toss-up': 0 };
    s.n++;
    s[verdict(d)]++;
  }
  return out;
}

type Played = Pick<RunLog, 'won' | 'turns' | 'decisions'> & { final: { team: { kind: string }[] } };

export function unitStats(vets: Played[]) {
  const m = new Map<string, { kind: string; seen: number; bought: number; inWins: number }>();
  const get = (k: string) => m.get(k) ?? (m.set(k, { kind: k, seen: 0, bought: 0, inWins: 0 }), m.get(k)!);
  for (const r of vets) {
    for (const t of r.turns) {
      for (const k of t.seen) if (UNITS[k]) get(k).seen++;
      for (const k of new Set(t.bought)) if (UNITS[k]) get(k).bought++;
    }
    if (r.won) for (const k of new Set(r.final.team.map(u => u.kind))) if (UNITS[k]?.tier) get(k).inWins++;
  }
  return [...m.values()].sort((a, b) => b.bought / b.seen - a.bought / a.seen);
}

export function relicStats(vets: Played[]) {
  const m = new Map<string, { kind: string; offered: number; taken: number; edgeSum: number }>();
  for (const d of vets.flatMap(r => r.decisions).filter(d => d.kind === 'relic')) {
    const avg = d.options.reduce((t, o) => t + o.value, 0) / d.options.length;
    for (const o of d.options) {
      const s = m.get(o.key) ?? (m.set(o.key, { kind: o.key, offered: 0, taken: 0, edgeSum: 0 }), m.get(o.key)!);
      s.offered++;
      if (o.key === d.options[0].key) s.taken++;
      s.edgeSum += o.value - avg;
    }
  }
  return [...m.values()].map(s => ({ ...s, edge: s.edgeSum / s.offered })).sort((a, b) => b.edge - a.edge);
}

const stage = (r: number) => (r <= 4 ? 'rounds 1-4' : r <= 8 ? 'rounds 5-8' : 'rounds 9+');
const what = (k: string) => (k === 'stop' ? 'stop shopping' : k === 'merge' ? 'merge two copies' : nm(k));

// Decisions of one verdict, grouped by what was chosen over what, so "always X over Y" stands out.
export function patterns(all: Decision[], v: Verdict) {
  const m = new Map<string, { n: number; sum: number }>();
  for (const d of all) {
    if (d.kind === 'order' || verdict(d) !== v) continue;
    const [best, alt] = distinct(d);
    const key = d.kind === 'relic' ? `relic: ${nm(best.key)} over ${alt ? nm(alt.key) : '-'}`
      : d.kind === 'reroll' ? `${stage(d.round)}: ${best.label} over ${alt?.label ?? '-'}`
      : `${stage(d.round)}: ${what(best.key)} over ${alt ? what(alt.key) : '-'}`;
    const s = m.get(key) ?? { n: 0, sum: 0 };
    s.n++;
    s.sum += v === 'obvious' ? margin(d) : stakes(d);
    m.set(key, s);
  }
  return [...m.entries()].map(([k, s]) => ({ what: k, n: s.n, avg: s.sum / s.n })).sort((a, b) => b.n - a.n);
}
