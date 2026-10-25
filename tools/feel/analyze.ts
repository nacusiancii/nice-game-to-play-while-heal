// Turns a recording into numbers about motion: how much changed each frame and where,
// one- and two-frame flickers, hard cuts, and stretches where nothing moves.
// Looping scenery (torches, idle bobbing) and the fake cursor are masked out.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Session } from './capture';

export type Box = [number, number, number, number]; // x, y, w, h in page pixels

export interface FrameStat {
  e: number; // share of the screen that changed since the previous frame (masked)
  box?: Box; // where it changed
  c?: number[]; // changed pixels per grid cell, flattened as [cell, count, cell, count, …]
}
export interface Flicker { t: number; i: number; frames: number; box: Box; px: number }
// A snap: a sizeable region changes in a single frame while it was still just before and stays still after
// (a teleport, a pop-in, a layout jump, or a hard cut when it covers most of the screen).
export interface Snap { t: number; i: number; share: number; box: Box }
export interface Analysis {
  version: 4;
  cell: number; // grid cell size in page pixels
  cols: number;
  frames: FrameStat[]; // parallel to session.frames
  flickers: Flicker[];
  snaps: Snap[];
}

const SCALE = 2; // analyse at half resolution
const THRESH = 36; // per-channel difference that counts as a change (JPEG noise stays below)
const SNAP_SHARE = 0.003; // 0.3% of the screen, e.g. a 64×48 px sprite at 1280×800
const CELL = 40; // page pixels per heat-map cell

export async function analyze(dir: string, session: Session): Promise<Analysis> {
  const cacheFile = path.join(dir, 'analysis.json');
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).mtimeMs >= fs.statSync(path.join(dir, 'session.json')).mtimeMs) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as Analysis;
    if (cached.version === 4) return cached;
  }
  process.stderr.write(`feel: analysing ${session.frames.length} frames…\n`);
  const W = Math.floor(session.width / SCALE), H = Math.floor(session.height / SCALE);
  const N = W * H;
  const fr = session.frames;

  const cache = new Map<string, Buffer>();
  const load = async (img: string) => {
    if (!img) return null;
    const hit = cache.get(img);
    if (hit) return hit;
    const b = await sharp(path.join(dir, 'frames', img)).resize(W, H).removeAlpha().raw().toBuffer();
    cache.set(img, b);
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return b;
  };

  // mask of ambient pixels, rebuilt whenever the page reports new ambient rects
  const masks: Uint8Array[] = [];
  let mask = new Uint8Array(N);
  for (const f of fr) {
    if (f.amb) {
      mask = new Uint8Array(N);
      for (const [x, y, w, h] of f.amb) {
        const x0 = Math.max(0, Math.floor(x / SCALE)), y0 = Math.max(0, Math.floor(y / SCALE));
        const x1 = Math.min(W, Math.ceil((x + w) / SCALE)), y1 = Math.min(H, Math.ceil((y + h) / SCALE));
        for (let yy = y0; yy < y1; yy++) mask.fill(1, yy * W + x0, yy * W + x1);
      }
    }
    masks.push(mask);
  }

  // changed pixels between two frames, optionally only inside a box
  const gcols = Math.ceil(session.width / CELL);
  const diff = (a: Buffer, b: Buffer, m: Uint8Array, within?: Box, cells?: Map<number, number>) => {
    let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    const bx0 = within ? Math.floor(within[0] / SCALE) : 0, by0 = within ? Math.floor(within[1] / SCALE) : 0;
    const bx1 = within ? Math.ceil((within[0] + within[2]) / SCALE) : W, by1 = within ? Math.ceil((within[1] + within[3]) / SCALE) : H;
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const p = y * W + x;
        if (m[p]) continue;
        const q = p * 3;
        const d = Math.max(Math.abs(a[q] - b[q]), Math.abs(a[q + 1] - b[q + 1]), Math.abs(a[q + 2] - b[q + 2]));
        if (d > THRESH) {
          n++;
          if (cells) { const c = Math.floor(y * SCALE / CELL) * gcols + Math.floor(x * SCALE / CELL); cells.set(c, (cells.get(c) ?? 0) + 1); }
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    const box: Box | undefined = n ? [x0 * SCALE, y0 * SCALE, (x1 - x0 + 1) * SCALE, (y1 - y0 + 1) * SCALE] : undefined;
    return { n, box };
  };

  const stats: FrameStat[] = [{ e: 0 }];
  const flickers: Flicker[] = [];
  const snaps: Snap[] = [];
  for (let i = 1; i < fr.length; i++) {
    if (fr[i].img === fr[i - 1].img || !fr[i].img || !fr[i - 1].img) { stats.push({ e: 0 }); continue; }
    const prev = (await load(fr[i - 1].img))!, cur = (await load(fr[i].img))!;
    const cells = new Map<number, number>();
    const { n, box } = diff(prev, cur, masks[i], undefined, cells);
    // a lone speck of JPEG noise is not motion
    const e = n < 4 ? 0 : n / N;
    stats.push(e ? { e: Math.round(e * 1e5) / 1e5, box, c: [...cells].flat() } : { e: 0 });
    if (!e || !box) continue;
    if (e >= SNAP_SHARE && i >= 2 && i + 1 < fr.length) {
      const before = await load(fr[i - 2].img), after = await load(fr[i + 1].img);
      if (before && after && diff(before, prev, masks[i], box).n < n * 0.1 && diff(cur, after, masks[i], box).n < n * 0.1) {
        snaps.push({ t: fr[i].t, i, share: Math.round(e * 1e4) / 1e4, box });
      }
    }
    // flicker: the changed region snaps back to how it looked before within one or two frames
    if (n < 12) continue;
    for (let k = 1; k <= 2 && i + k < fr.length; k++) {
      const later = await load(fr[i + k].img);
      if (!later) break;
      const back = diff(prev, later, masks[i], box).n;
      if (back <= n * 0.08) {
        flickers.push({ t: fr[i].t, i, frames: k, box, px: n * SCALE * SCALE });
        break;
      }
    }
  }
  const out: Analysis = { version: 4, cell: CELL, cols: gcols, frames: stats, flickers, snaps };
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}
