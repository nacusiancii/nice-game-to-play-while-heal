// A .webm of a span (960 px wide), for humans who want to watch what the agent looked at.
// Uses the ffmpeg that Playwright ships (VP8 only), or FEEL_FFMPEG.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session } from './capture';
import { parseTime } from './look';

function findFfmpeg() {
  if (process.env.FEEL_FFMPEG) return process.env.FEEL_FFMPEG;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const d = fs.existsSync(cache) ? fs.readdirSync(cache).filter(x => x.startsWith('ffmpeg-')).sort().pop() : undefined;
  const bin = d && path.join(cache, d, 'ffmpeg-linux');
  if (bin && fs.existsSync(bin)) return bin;
  return 'ffmpeg';
}

export async function clip(dir: string, flags: Record<string, string>) {
  const s: Session = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  const t0 = flags.from ? parseTime(flags.from, s) : 0;
  const t1 = flags.to ? parseTime(flags.to, s) : Infinity;
  const frames = s.frames.filter(f => f.t >= t0 && f.t <= t1 && f.img);
  const out = flags.out ?? path.join(dir, `clip-${(t0 / 1000).toFixed(2)}-${(Math.min(t1, s.frames[s.frames.length - 1].t) / 1000).toFixed(2)}.webm`);
  // Playwright's ffmpeg is minimal: JPEGs in through image2pipe on stdin, VP8 out
  const ff = spawn(findFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(s.fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-vf', 'scale=960:-2', '-c:v', 'libvpx', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '16', '-threads', '8', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = new Promise(r => ff.on('exit', r));
  ff.stdin.on('error', () => { /* ffmpeg quit early; its exit code says why */ });
  for (const f of frames) {
    if (!ff.stdin.write(fs.readFileSync(path.join(dir, 'frames', f.img)))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  const code = await exited;
  if (code !== 0) throw new Error(`ffmpeg failed (${code})`);
  return `${out} (${frames.length} frames, ${(frames.length / s.fps).toFixed(1)} s)`;
}
