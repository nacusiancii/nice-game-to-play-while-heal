// A tiny Chrome DevTools Protocol client over Node's built-in WebSocket.
// We drive chrome-headless-shell because only it supports HeadlessExperimental.beginFrame,
// which lets us render exactly one frame at a time on a virtual clock.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findChrome(): string {
  if (process.env.FEEL_CHROME) return process.env.FEEL_CHROME;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    : [];
  for (const d of dirs) {
    const bin = path.join(cache, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('chrome-headless-shell not found. Install it with: npx playwright install chromium-headless-shell (or set FEEL_CHROME)');
}

export interface Cdp {
  send<T = any>(method: string, params?: object): Promise<T>;
  on(method: string, f: (params: any) => void): void;
  close(): Promise<void>;
}

export async function launch(opts: { width: number; height: number }): Promise<Cdp> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'feel-chrome-'));
  const proc: ChildProcess = spawn(findChrome(), [
    '--headless', '--deterministic-mode', '--enable-begin-frame-control',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none',
    `--window-size=${opts.width},${opts.height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const kill = () => {
    try { process.kill(-proc.pid!, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
    fs.rmSync(profile, { recursive: true, force: true });
  };
  let ws: WebSocket;
  try {
    const url = await new Promise<string>((res, rej) => {
      let buf = '';
      proc.stderr!.on('data', d => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\S+)/);
        if (m) res(m[1]);
      });
      proc.on('exit', c => rej(new Error(`chrome exited (${c}): ${buf.slice(-500)}`)));
      setTimeout(() => rej(new Error(`chrome did not start in 20 s: ${buf.slice(-500)}`)), 20000);
    });
    ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  } catch (e) { kill(); throw e; }

  let nextId = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; method: string }>();
  const handlers = new Map<string, ((p: any) => void)[]>();
  ws.onmessage = e => {
    const m = JSON.parse(String(e.data));
    if (m.id !== undefined) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`));
      else p.res(m.result);
    } else {
      for (const f of handlers.get(m.method) ?? []) f(m.params);
    }
  };
  let sessionId: string | undefined;
  const raw = (method: string, params: object = {}, sid?: string) => new Promise<any>((res, rej) => {
    const id = ++nextId;
    pending.set(id, { res, rej, method });
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
  });

  try {
    const { targetId } = await raw('Target.createTarget', { url: 'about:blank', enableBeginFrameControl: true, width: opts.width, height: opts.height });
    ({ sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true }));
  } catch (e) { ws.close(); kill(); throw e; }

  return {
    send: (method, params) => raw(method, params, sessionId),
    on: (method, f) => handlers.set(method, [...(handlers.get(method) ?? []), f]),
    close: async () => {
      try { ws.close(); } catch { /* already closed */ }
      await new Promise(r => setTimeout(r, 100));
      kill();
    },
  };
}
