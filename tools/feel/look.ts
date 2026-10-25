// "Look" at a span of a recording: a contact sheet of the frames that matter plus a text timeline
// with what happened, what you would hear, and what felt off (flicker, cuts, dead air, slow responses).
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import type { Ev, Session } from './capture';
import { analyze, type Analysis, type Box } from './analyze';

export interface LookOpts {
  from?: string;
  to?: string;
  frames?: number; // number of key frames to pick (default 12)
  every?: string; // or: one frame every "100ms" / "3f"
  crop?: string; // "auto" (default), "full", or "x,y,w,h"
  cols?: number;
  width?: number; // sheet width in px (default 1568, the most Claude reads without downscaling)
  out?: string;
}

// ---------- time expressions: "3.2", "3.2s", "800ms", "12f", "battle", "result+1.5s", "screen=battle", "end-2s" ----------
export function parseTime(expr: string, s: Session): number {
  const m = expr.trim().match(/^(.*?)([+-]\s*[\d.]+\s*(?:ms|s|f)?)?$/)!;
  const base = m[1].trim(), off = m[2] ? dur(m[2].replace(/\s/g, ''), s) : 0;
  if (!base) return off;
  if (/^[\d.]+(ms|s|f)?$/.test(base)) return dur(base, s) + off;
  const mark = s.marks.find(k => k.name === base);
  if (mark) return mark.t + off;
  const [kind, val] = base.split('=');
  const ev = s.events.find(e => e.kind === kind && (val === undefined || JSON.stringify(e.data).includes(val)));
  if (ev) return ev.t + off;
  throw new Error(`no mark or event "${base}". Marks: ${s.marks.map(k => k.name).join(', ')}; events: ${[...new Set(s.events.map(e => e.kind))].join(', ')}`);
}
function dur(x: string, s: Session) {
  const v = parseFloat(x);
  if (x.endsWith('ms')) return v;
  if (x.endsWith('f')) return v * 1000 / s.fps;
  return v * 1000;
}
const sec = (ms: number) => (ms / 1000).toFixed(2);

// ---------- how events read in a timeline ----------
type Fx = { t: string; u?: number; n?: number; a?: number; h?: number; s?: string };
function fxSummary(fx: Fx[]) {
  const by = new Map<string, Fx[]>();
  for (const f of fx) by.set(f.t, [...(by.get(f.t) ?? []), f]);
  const out: string[] = [];
  for (const [t, list] of by) {
    if (t === 'note') out.push(list.map(f => `"${f.s}"`).join(' '));
    else if (t === 'dmg') out.push(`dmg ${list.map(f => f.n).join(',')}`);
    else if (t === 'buff') out.push(`buff ${list.map(f => `+${f.a}/+${f.h}`).join(',')}`);
    else if (t === 'ward' || t === 'heal') out.push(`${t} ${list.map(f => f.n).join(',')}`);
    else out.push(list.length > 1 ? `${t}×${list.length}` : t);
  }
  return out.join(' ');
}
function evText(e: Ev): string | null {
  const d = e.data as any;
  switch (e.kind) {
    case 'mark': return `◆ ${d}`;
    case 'input': return `▶ ${d}`;
    case 'sfx': return `♪ ${d}`;
    case 'beat': return `beat ${d.i}/${d.n} ${fxSummary(d.fx) || '(layout)'}`;
    case 'stage-battle': return `battle: ${d.a}  vs  ${d.b}  (${d.frames} beats, ${d.winner === 0 ? 'A wins' : d.winner === 1 ? 'B wins' : 'draw'})`;
    case 'battle': return `battle round ${d.round} vs ${d.opp} (${d.result}) at ${d.speed || 'instant'}x`;
    case 'note': return `“${d}”`;
    case 'check': return `${d.ok ? '✓' : '✗ CHECK FAILED:'} ${d.label}${d.detail ? ` (${d.detail})` : ''}`;
    case 'camera': return d === 'off' ? '(camera off: frames not saved)' : '(camera on)';
    case 'open': return `open ${d} page`;
    case 'screen': return `screen → ${d}`;
    case 'toast': return `toast “${d}”`;
    case 'call': return `→ server ${d}`;
    case 'done': return `← server ok ${d}`;
    case 'rejected': return `← server REJECTED ${d}`;
    case 'result': return `result: ${d}`;
    case 'skip': return `skipped at beat ${Number(d) + 1}`;
    case 'stage': return null;
    default: return `${e.kind} ${typeof d === 'string' ? d : JSON.stringify(d)}`;
  }
}

// shorter, for the label under a tile
function tileText(e: Ev): string | null {
  const d = e.data as any;
  if (e.kind === 'beat') { const fx = fxSummary(d.fx); return fx ? `b${d.i} ${fx}` : null; }
  if (e.kind === 'stage-battle') return 'battle';
  if (e.kind === 'battle') return `battle vs ${d.opp}`;
  return evText(e);
}

// ---------- picking frames ----------
function pickKeyframes(a: Analysis, lo: number, hi: number, n: number): number[] {
  if (hi - lo + 1 <= n) return range(lo, hi);
  // spread picks over where change happens: a new frame each time enough has changed since the last pick
  let total = 0;
  for (let i = lo + 1; i <= hi; i++) total += a.frames[i].e;
  if (total === 0) return evenly(lo, hi, n);
  // binary search a threshold that yields about n picks
  const run = (th: number) => {
    const picks = [lo];
    let acc = 0;
    for (let i = lo + 1; i <= hi; i++) {
      acc += a.frames[i].e;
      if (acc >= th) {
        // take the frame where this burst of motion has settled a little, if it settles soon
        let j = i;
        while (j < hi && j - i < 6 && a.frames[j + 1].e > a.frames[j].e * 0.3 && a.frames[j + 1].e > 0) j++;
        picks.push(j);
        i = j;
        acc = 0;
      }
    }
    if (picks[picks.length - 1] !== hi) picks.push(hi);
    return picks;
  };
  let lo2 = total / (n * 8), hi2 = total;
  let best = run(total / n);
  for (let k = 0; k < 30; k++) {
    const mid = (lo2 + hi2) / 2, p = run(mid);
    if (Math.abs(p.length - n) < Math.abs(best.length - n) || (p.length <= n && best.length > n)) best = p;
    if (p.length > n) lo2 = mid; else hi2 = mid;
  }
  return [...new Set(best)].slice(0, n);
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const evenly = (a: number, b: number, n: number) => [...new Set(Array.from({ length: n }, (_, k) => Math.round(a + (b - a) * k / Math.max(1, n - 1))))];

// ---------- the report ----------
export async function look(dir: string, o: LookOpts = {}) {
  const s: Session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  const a = await analyze(dir, s);
  const fr = s.frames;
  const dt = 1000 / s.fps;
  const has = (name: string) => s.marks.some(m => m.name === name);
  const t0 = o.from ? parseTime(o.from, s) : has('start') ? parseTime('start', s) : 0;
  const t1 = o.to ? parseTime(o.to, s) : fr[fr.length - 1].t;
  const idx = (t: number) => Math.max(0, Math.min(fr.length - 1, Math.round(t / dt) - 1));
  const lo = idx(t0), hi = Math.max(idx(t1), lo);
  const inSpan = (t: number) => t >= fr[lo].t - dt / 2 && t <= fr[hi].t + dt / 2;
  const lines: string[] = [];
  const out = (x = '') => lines.push(x);

  const argStr = Object.entries(s.args).map(([k, v]) => `${k}=${v}`).join(' ');
  out(`${s.scene}${argStr ? ` (${argStr})` : ''} · ${s.fps} fps · ${s.width}×${s.height} · ${sec(fr[fr.length - 1].t)} s filmed in ${sec(s.wallMs)} s real time (+${sec(s.setupMs ?? 0)} s setup)`);
  out(`span ${sec(fr[lo].t)}–${sec(fr[hi].t)} s · ${hi - lo + 1} frames`);
  out();

  // motion strip
  const spanMs = fr[hi].t - fr[lo].t;
  const bucket = [50, 100, 200, 250, 500, 1000, 2000, 5000].find(b => spanMs / b <= 100) ?? 10000;
  const levels = [[0.0002, '▁'], [0.001, '▂'], [0.003, '▃'], [0.008, '▄'], [0.02, '▅'], [0.05, '▆'], [0.12, '▇'], [Infinity, '█']] as const;
  let strip = '', ticks = '';
  for (let b = 0; b * bucket <= spanMs; b++) {
    const from = fr[lo].t + b * bucket, to = from + bucket;
    let m = 0;
    for (let i = lo; i <= hi; i++) if (fr[i].t >= from && fr[i].t < to) m = Math.max(m, a.frames[i].e);
    strip += m === 0 ? '·' : levels.find(([th]) => m < th)![1];
    const evs = s.events.filter(e => e.t >= from && e.t < to);
    ticks += evs.some(e => e.kind === 'input') ? '▲' : evs.some(e => e.kind === 'beat') ? '|' : evs.some(e => e.kind === 'mark') ? '◆' : ' ';
  }
  const axis = Array.from(strip, () => ' ');
  for (let b = 0; b < strip.length; b += 10) [...`${sec(fr[lo].t + b * bucket)}s`].forEach((c, k) => { if (b + k < axis.length) axis[b + k] = c; });
  out(`motion (1 char = ${bucket} ms, · = nothing moved; looping scenery and cursor ignored; ▲ input, | battle beat, ◆ mark)`);
  for (let k = 0; k < strip.length; k += 100) {
    out(`  ${strip.slice(k, k + 100)}`);
    out(`  ${ticks.slice(k, k + 100)}`);
    out(`  ${axis.slice(k, k + 100).join('')}`);
  }
  out();

  // timeline
  out('timeline');
  const evs = s.events.filter(e => inSpan(e.t));
  const rows = new Map<string, string[]>();
  for (const e of evs) {
    const text = evText(e);
    if (!text) continue;
    const key = sec(e.t);
    const row = rows.get(key) ?? [];
    // fold sounds into one item per line
    if (e.kind === 'sfx') {
      const prev = row.findIndex(x => x.startsWith('♪ '));
      if (prev >= 0) { row[prev] += ` ${e.data}`; rows.set(key, row); continue; }
    }
    row.push(text);
    rows.set(key, row);
  }
  for (const [t, row] of rows) out(`  ${t.padStart(6)}  ${row.join('  ·  ')}`);
  if (!rows.size) out('  (no events)');
  out();

  // findings
  out('findings');
  let found = 0;
  const say = (x: string) => { found++; out(`  - ${x}`); };
  for (const e of evs.filter(e => e.kind === 'check' && !(e.data as any).ok)) say(`CHECK FAILED at ${sec(e.t)} s: ${(e.data as any).label}${(e.data as any).detail ? ` (${(e.data as any).detail})` : ''}`);
  // the event closest in time to a flicker or snap, within 3 frames (inputs and screen changes win ties)
  const near = (t: number) => {
    const cands = s.events.filter(e => Math.abs(e.t - t) <= 4 * dt && ['screen', 'input', 'beat', 'result', 'toast'].includes(e.kind) && evText(e));
    cands.sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t) || Number(['beat', 'toast'].includes(x.kind)) - Number(['beat', 'toast'].includes(y.kind)));
    return cands.length ? evText(cands[0])! : '';
  };
  // one flicker often shows up as several overlapping ones a frame apart: merge them
  const flick: typeof a.flickers = [];
  for (const f of a.flickers.filter(f => inSpan(f.t))) {
    const prev = flick[flick.length - 1];
    const overlap = prev && f.t - prev.t <= 3 * dt + 0.5 && f.box[0] < prev.box[0] + prev.box[2] && prev.box[0] < f.box[0] + f.box[2]
      && f.box[1] < prev.box[1] + prev.box[3] && prev.box[1] < f.box[1] + f.box[3];
    if (!overlap) { flick.push({ ...f }); continue; }
    const x0 = Math.min(prev.box[0], f.box[0]), y0 = Math.min(prev.box[1], f.box[1]);
    prev.box = [x0, y0, Math.max(prev.box[0] + prev.box[2], f.box[0] + f.box[2]) - x0, Math.max(prev.box[1] + prev.box[3], f.box[1] + f.box[3]) - y0];
    prev.frames = Math.max(prev.frames, Math.round((f.t - prev.t) / dt) + f.frames);
  }
  for (const f of flick.slice(0, 8)) say(`FLICKER at ${sec(f.t)} s${near(f.t) ? ` (near: ${near(f.t)})` : ''}: ${f.box[2]}×${f.box[3]} px at (${f.box[0]},${f.box[1]}) changed and snapped back after ${f.frames} frame${f.frames > 1 ? 's' : ''} (${Math.round(f.frames * dt)} ms). Zoom: --from ${sec(f.t - 2 * dt)} --to ${sec(f.t + (f.frames + 2) * dt)} --every 1f --crop ${pad(f.box, 30, s).join(',')}`);
  if (flick.length > 8) say(`…and ${flick.length - 8} more flickers`);
  const snaps = a.snaps.filter(c => inSpan(c.t));
  const big = snaps.filter(c => c.share > 0.2), small = snaps.filter(c => c.share <= 0.2);
  for (const c of big.slice(0, 4)) say(`hard cut at ${sec(c.t)} s: ${Math.round(c.share * 100)}% of the screen changed in one frame${near(c.t) ? ` (${near(c.t)})` : ''}`);
  if (small.length) {
    say(`${small.length} snap${small.length > 1 ? 's' : ''} (a region jumps in one frame, still before and after: teleports, pop-ins, layout jumps)${small.length > 6 ? ', largest:' : ':'}`);
    for (const c of [...small].sort((x, y) => y.share - x.share).slice(0, 6).sort((x, y) => x.t - y.t)) {
      out(`      ${sec(c.t)} s  ${c.box[2]}×${c.box[3]} at (${c.box[0]},${c.box[1]})${near(c.t) ? `  near: ${near(c.t)}` : ''}`);
    }
  }
  // still stretches
  const stills: [number, number][] = [];
  let st = -1;
  for (let i = lo; i <= hi + 1; i++) {
    const moving = i > hi || a.frames[i].e > 0;
    if (!moving && st < 0) st = i;
    if (moving && st >= 0) { if ((i - st) * dt >= 400) stills.push([fr[st].t, fr[i - 1].t]); st = -1; }
  }
  const stillMs = stills.reduce((x, [p, q]) => x + q - p, 0);
  if (stills.length) {
    const top = [...stills].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 5).sort((x, y) => x[0] - y[0]);
    say(`still for ${Math.round(100 * stillMs / Math.max(1, spanMs))}% of the span (stretches ≥ 0.4 s where nothing but scenery moves): ${top.map(([p, q]) => `${sec(p)}–${sec(q)} (${((q - p) / 1000).toFixed(1)} s)`).join(', ')}`);
  }
  // responsiveness: from each input to the first visible reaction, and until things settle
  for (const e of evs.filter(e => e.kind === 'input' && !String(e.data).startsWith('hover'))) {
    const i0 = fr.findIndex(f => f.t >= e.t);
    if (i0 < 0) continue;
    // with the camera off there are no pictures to judge a reaction by
    if (fr.slice(i0, i0 + 6).some(f => !f.img)) continue;
    let r = -1;
    for (let i = i0; i < fr.length && fr[i].t - e.t < 3000; i++) if (a.frames[i].e > 0) { r = i; break; }
    if (r < 0) { say(`no visible reaction within 3 s to ${e.data} at ${sec(e.t)} s`); continue; }
    let settle = r, quiet = 0;
    for (let i = r; i < fr.length && quiet * dt < 250; i++) { if (a.frames[i].e > 0) { settle = i; quiet = 0; } else quiet++; }
    const react = fr[r].t - e.t;
    say(`${e.data} at ${sec(e.t)} s: first reaction after ${Math.round(react)} ms${react > 100 ? ' (SLOW: over 100 ms feels laggy)' : ''}, settles after ${Math.round(fr[settle].t - e.t)} ms`);
  }
  // rhythm of repeated events
  const beats = evs.filter(e => e.kind === 'beat');
  if (beats.length >= 3) {
    const gaps = beats.slice(1).map((b, k) => b.t - beats[k].t).sort((x, y) => x - y);
    const med = gaps[Math.floor(gaps.length / 2)];
    const first = beats.find(b => (b.data as any).fx.some((f: Fx) => f.t === 'atk'));
    // where the time goes: each beat holds the screen until the next one; group by what the beat does
    const kindOf = (d: any) => {
      const t = new Set((d.fx as Fx[]).map(f => f.t));
      return t.has('atk') ? 'attack' : t.has('die') ? 'faint' : t.has('note') ? 'banner' : t.has('sum') ? 'summon'
        : t.has('zap') || t.has('dmg') ? 'zap/damage' : t.has('buff') || t.has('ward') || t.has('heal') || t.has('proc') ? 'ability/buff' : t.size ? [...t].join('+') : 'relayout';
    };
    const hold = new Map<string, { n: number; ms: number }>();
    beats.forEach((b, k) => {
      const next = k + 1 < beats.length ? beats[k + 1].t : (evs.find(e => e.kind === 'result' && e.t >= b.t)?.t ?? b.t);
      const g = hold.get(kindOf(b.data)) ?? { n: 0, ms: 0 };
      g.n++; g.ms += next - b.t;
      hold.set(kindOf(b.data), g);
    });
    const totalHold = [...hold.values()].reduce((x, g) => x + g.ms, 0);
    say(`battle rhythm: ${beats.length} beats over ${((beats[beats.length - 1].t - beats[0].t) / 1000).toFixed(1)} s, median gap ${Math.round(med)} ms (min ${Math.round(gaps[0])}, max ${Math.round(gaps[gaps.length - 1])})${first ? `, first attack ${((first.t - beats[0].t) / 1000).toFixed(1)} s after the first beat` : ''}`);
    out(`      where the time goes (beat type: count × hold = total, share): ${[...hold].sort((x, y) => y[1].ms - x[1].ms)
      .map(([k, g]) => `${k} ${g.n}×${Math.round(g.ms / g.n)}ms=${(g.ms / 1000).toFixed(1)}s ${Math.round(100 * g.ms / Math.max(1, totalHold))}%`).join(' · ')}`);
  }
  // main-thread cost (real CPU time, measured while recording)
  const heavy = range(lo, hi).filter(i => fr[i].cpu > 16 && i > 3).sort((x, y) => fr[y].cpu - fr[x].cpu);
  if (heavy.length) say(`heavy frames (page main thread > 16 ms, would drop frames at 60 fps): ${heavy.slice(0, 5).sort((x, y) => x - y).map(i => `${sec(fr[i].t)} s ${Math.round(fr[i].cpu)} ms`).join(', ')}${heavy.length > 5 ? ` …${heavy.length} in all` : ''}`);
  // DOM rebuilds
  const rebuilds = range(lo, hi).filter(i => fr[i].mut && (fr[i].mut!.imgs > 0 || fr[i].mut!.added + fr[i].mut!.removed > 40));
  if (rebuilds.length) {
    const by = new Map<string, { n: number; imgs: number; first: number }>();
    for (const i of rebuilds) {
      const m = fr[i].mut!, key = m.rebuilt[0] ?? 'nodes';
      const g = by.get(key) ?? { n: 0, imgs: 0, first: fr[i].t };
      g.n++; g.imgs += m.imgs;
      by.set(key, g);
    }
    say(`DOM rebuilt ${rebuilds.length}×, ${rebuilds.reduce((x, i) => x + fr[i].mut!.imgs, 0)} <img> re-created (they can blink in a real browser even when these frames look fine): ${[...by].sort((x, y) => y[1].n - x[1].n).slice(0, 4).map(([k, g]) => `${k} ${g.n}× from ${sec(g.first)} s`).join(', ')}`);
  }
  for (const e of evs.filter(e => e.kind === 'page-error' || e.kind === 'console.error' || e.kind === 'scene-error')) say(`${e.kind} at ${sec(e.t)} s: ${e.data}`);
  if (!found) out('  (nothing stood out)');
  out();

  // the contact sheet
  let picks: number[];
  if (o.every) {
    const step = Math.max(1, Math.round(dur(o.every, s) / dt));
    picks = [];
    for (let i = lo; i <= hi && picks.length < 60; i += step) picks.push(i);
  } else picks = pickKeyframes(a, lo, hi, o.frames ?? 12);
  const crop = cropBox(o.crop ?? 'auto', a, lo, hi, s);
  const file = o.out ?? path.join(dir, `look-${sec(fr[lo].t)}-${sec(fr[hi].t)}${o.every ? `-every${o.every}` : ''}.png`);
  const info = await renderSheet(dir, s, a, picks, crop, file, o);
  out(`sheet  ${file}`);
  out(`       ${picks.length} frames${o.every ? ` every ${o.every}` : ' picked where things change'}, crop ${crop.join(',')}, ${info.width}×${info.height} px ≈ ${Math.round(info.width * info.height / 750)} tokens to view`);
  return lines.join('\n');
}

function pad(b: Box, p: number, s: Session): Box {
  const x = Math.max(0, b[0] - p), y = Math.max(0, b[1] - p);
  return [x, y, Math.min(s.width - x, b[2] + 2 * p), Math.min(s.height - y, b[3] + 2 * p)];
}

function cropBox(spec: string, a: Analysis, lo: number, hi: number, s: Session): Box {
  if (spec === 'full') return [0, 0, s.width, s.height];
  if (s.regions?.[spec]) return pad(s.regions[spec], 0, s);
  if (spec !== 'auto') {
    const v = spec.split(',').map(Number);
    if (v.length !== 4 || v.some(Number.isNaN)) throw new Error(`--crop wants auto, full, x,y,w,h or a region (${Object.keys(s.regions ?? {}).join(', ') || 'none recorded; use s.region() in the scene'})`);
    return pad([v[0], v[1], v[2], v[3]], 0, s);
  }
  // auto: where most of the motion in the span happened (the middle 99% of it, each way), ignoring hard cuts
  const colMass = new Map<number, number>(), rowMass = new Map<number, number>();
  let total = 0;
  for (let i = lo + 1; i <= hi; i++) {
    const f = a.frames[i];
    if (!f.c || f.e > 0.2) continue;
    for (let k = 0; k < f.c.length; k += 2) {
      const cx = f.c[k] % a.cols, cy = Math.floor(f.c[k] / a.cols), n = f.c[k + 1];
      colMass.set(cx, (colMass.get(cx) ?? 0) + n);
      rowMass.set(cy, (rowMass.get(cy) ?? 0) + n);
      total += n;
    }
  }
  if (!total) return [0, 0, s.width, s.height];
  const span = (m: Map<number, number>) => {
    const keys = [...m.keys()].sort((x, y) => x - y);
    let acc = 0, first = keys[0], last = keys[keys.length - 1];
    for (const k of keys) { acc += m.get(k)!; if (acc >= total * 0.005) { first = k; break; } }
    acc = 0;
    for (const k of [...keys].reverse()) { acc += m.get(k)!; if (acc >= total * 0.005) { last = k; break; } }
    return [first * a.cell, (last + 1) * a.cell];
  };
  const [x0, x1] = span(colMass), [y0, y1] = span(rowMass);
  let b = pad([x0, y0, x1 - x0, y1 - y0], 60, s);
  // never crop to a sliver: at least a third of the screen wide and a quarter high
  const minW = s.width / 3, minH = s.height / 4;
  if (b[2] < minW) b = pad([b[0] + b[2] / 2 - minW / 2, b[1], minW, b[3]], 0, s);
  if (b[3] < minH) b = pad([b[0], b[1] + b[3] / 2 - minH / 2, b[2], minH], 0, s);
  return b.map(Math.round) as Box;
}

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function renderSheet(dir: string, s: Session, a: Analysis, picks: number[], crop: Box, file: string, o: LookOpts) {
  const maxW = o.width ?? 1568;
  const gap = 6, labelH = 36;
  const aspect = crop[2] / crop[3];
  const cols = o.cols ?? Math.max(1, Math.min(picks.length, aspect > 3 ? 2 : aspect > 1.8 ? 3 : 4));
  let tileW = Math.floor((maxW - gap * (cols + 1)) / cols);
  let scale = tileW / crop[2];
  if (scale > 2) { scale = 2; tileW = crop[2] * 2; }
  const tileH = Math.round(crop[3] * scale);
  const rows = Math.ceil(picks.length / cols);
  const W = cols * tileW + (cols + 1) * gap, H = rows * (tileH + labelH) + (rows + 1) * gap;
  const fr = s.frames;
  const layers: OverlayOptions[] = [];
  for (let k = 0; k < picks.length; k++) {
    const i = picks[k];
    const x = gap + (k % cols) * (tileW + gap), y = gap + Math.floor(k / cols) * (tileH + labelH + gap);
    const img = fr[i].img ? path.join(dir, 'frames', fr[i].img) : null;
    if (img) {
      const tile = await sharp(img).extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] })
        .resize(tileW, tileH, { kernel: scale >= 1 ? 'nearest' : 'lanczos3' }).toBuffer();
      layers.push({ input: tile, left: x, top: y });
    }
    // label: time, gap since the previous tile, and what happened in between
    const prevT = k ? fr[picks[k - 1]].t : fr[i].t - 1000 / s.fps;
    const happened = s.events.filter(e => e.t > prevT && e.t <= fr[i].t + 0.5 && e.kind !== 'sfx').map(tileText).filter(Boolean) as string[];
    const maxChars = Math.floor(tileW / 7.2);
    const line1 = `${sec(fr[i].t)}s${k ? `  +${Math.round(fr[i].t - prevT)}ms` : ''}`;
    const line2 = happened.join(' · ').slice(0, maxChars);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${labelH}">`
      + `<text x="3" y="14" font-family="DejaVu Sans Mono, monospace" font-size="13" font-weight="bold" fill="#ffd84a">${esc(line1)}</text>`
      + `<text x="3" y="30" font-family="DejaVu Sans Mono, monospace" font-size="12" fill="#e8e8e8">${esc(line2)}</text></svg>`;
    layers.push({ input: Buffer.from(svg), left: x, top: y + tileH });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#16141c' } }).composite(layers).png({ compressionLevel: 6 }).toFile(file);
  void a;
  return { width: W, height: H };
}
