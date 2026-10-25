// feel: see a moment of the game the way a player experiences it.
//   feel record <scene or path.ts> [key=value …] [--out DIR] [--fps 60] [--size 1280x800]
//   feel look <DIR> [--from T] [--to T] [--frames 12 | --every 100ms] [--crop auto|full|x,y,w,h|region] [--cols N] [--out FILE.png]
//   feel clip <DIR> [--from T] [--to T]          a .webm for humans
// Times: 3.2 · 3.2s · 800ms · 12f · a mark ("battle", "result+1s") · an event ("screen=battle", "beat=\"i\":5").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { interrupt, record } from './capture';
import { look } from './look';
import { clip } from './clip';

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags: Record<string, string> = {};
const pos: string[] = [];
for (let k = 0; k < argv.length; k++) {
  const x = argv[k];
  if (x.startsWith('--')) {
    const [name, inline] = x.slice(2).split('=', 2);
    flags[name] = inline ?? (argv[k + 1] && !argv[k + 1].startsWith('--') ? argv[++k] : 'true');
  } else pos.push(x);
}
const lookFlags = () => ({
  from: flags.from, to: flags.to, frames: flags.frames ? Number(flags.frames) : undefined, every: flags.every,
  crop: flags.crop, cols: flags.cols ? Number(flags.cols) : undefined, width: flags.width ? Number(flags.width) : undefined, out: flags.out,
});

function sceneFile(name: string) {
  for (const p of [name, `${name}.ts`, path.join(import.meta.dirname, 'scenes', name), path.join(import.meta.dirname, 'scenes', `${name}.ts`)]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  throw new Error(`no scene "${name}". Built in: ${fs.readdirSync(path.join(import.meta.dirname, 'scenes')).map(f => f.replace(/\.ts$/, '')).join(', ')}`);
}

async function main() {
  if (cmd === 'record') {
    const [scene, ...kv] = pos;
    if (!scene) throw new Error('usage: feel record <scene> [key=value …]');
    const file = sceneFile(scene);
    const args = Object.fromEntries(kv.map(x => { const i = x.indexOf('='); return i < 0 ? [x, 'true'] : [x.slice(0, i), x.slice(i + 1)]; }));
    const out = path.resolve(flags.out ?? path.join(os.tmpdir(), 'feel', path.basename(file, '.ts')));
    const [w, h] = (flags.size ?? '').split('x').map(Number);
    const { session, failure } = await record(file, out, args, { fps: flags.fps ? Number(flags.fps) : undefined, width: w || undefined, height: h || undefined });
    const mb = fs.readdirSync(path.join(out, 'frames')).reduce((n, f) => n + fs.statSync(path.join(out, 'frames', f)).size, 0) / 1e6;
    console.log(`recorded ${session.frames.length} frames to ${out} (${mb.toFixed(0)} MB)\n`);
    console.log(await look(out, { ...lookFlags(), out: undefined })); // --out named the session dir here
    if (failure) { console.error(`\nscene failed: ${(failure as Error).message ?? failure}`); process.exitCode = 1; }
  } else if (cmd === 'look') {
    if (!pos[0]) throw new Error('usage: feel look <session dir> [--from T] [--to T] …');
    console.log(await look(path.resolve(pos[0]), lookFlags()));
  } else if (cmd === 'clip') {
    if (!pos[0]) throw new Error('usage: feel clip <session dir> [--from T] [--to T]');
    console.log(await clip(path.resolve(pos[0]), flags));
  } else {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
    if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

// Ctrl+C or a kill stops at the next frame, so record() still tears down the private server and browser
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => { interrupt.signal = sig; });

main().catch(e => { console.error(`feel: ${e.message ?? e}`); process.exit(1); });
