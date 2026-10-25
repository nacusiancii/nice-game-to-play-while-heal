// Records a scene frame by frame on a virtual clock. Every frame the page would show at the chosen fps
// is rendered and saved, so nothing between two screenshots is lost, however slow the machine is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, type Cdp } from './cdp';
import { startWorld, type World } from './world';
import { makeBattle, type BattleSpec } from './battles';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface FrameRec {
  i: number;
  t: number; // ms since the recording started
  img: string; // file under frames/, shared with the previous frame when nothing was redrawn
  cpu: number; // main-thread ms the page spent on this frame (real time, not virtual)
  mut?: { added: number; removed: number; imgs: number; rebuilt: string[] };
  amb?: [number, number, number, number][]; // ambient rects, present when they changed since the last frame
}
export interface Ev { t: number; kind: string; data?: unknown }
export interface Session {
  version: 1;
  scene: string;
  args: Record<string, string>;
  fps: number;
  width: number;
  height: number;
  frames: FrameRec[];
  events: Ev[];
  marks: { t: number; name: string }[];
  regions: Record<string, [number, number, number, number]>;
  wallMs: number; // filming, in real time
  setupMs: number; // starting the server, browser and page, in real time
}

export const interrupt = { signal: '' };

export interface Target { x: number; y: number; w: number; h: number; left: number; top: number; label: string; count: number }

// how an input reads in the timeline: the selector you used, plus the element's text when it says something
function describe(target: string, label: string, nth?: number) {
  const sel = target.startsWith('text=') ? JSON.stringify(target.slice(5)) : target + (nth ? ` #${nth}` : '');
  const text = label.trim();
  return text && !target.startsWith('text=') && text.length > 1 && !/^[\d\s]+$/.test(text) ? `${sel} (${JSON.stringify(text)})` : sel;
}

const KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
};
function keyInfo(k: string) {
  if (KEYS[k]) return KEYS[k];
  if (k.length === 1) {
    const up = k.toUpperCase();
    const code = /[a-z]/i.test(k) ? `Key${up}` : /\d/.test(k) ? `Digit${k}` : '';
    return { key: k, code, vk: up.charCodeAt(0), text: k };
  }
  throw new Error(`unknown key "${k}"`);
}

export interface SceneOpts { fps?: number; width?: number; height?: number; page?: 'game' | 'stage' }
export type SceneFn = (s: Scene) => Promise<void>;

export class Scene {
  frame = 0;
  readonly dt: number;
  mouse = { x: 0, y: 0 };
  session: Session;
  private framesDir: string;
  private lastImg = '';
  /** When false, frames still run (the game keeps playing) but aren't saved: cheaper fast-forwarding. */
  filming = true;
  private lastCpu = 0;
  private t0 = Date.now();

  constructor(public cdp: Cdp, public world: World, readonly out: string, readonly args: Record<string, string>, opts: Required<SceneOpts>, scene: string) {
    this.dt = 1000 / opts.fps;
    this.framesDir = path.join(out, 'frames');
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.session = { version: 1, scene, args, fps: opts.fps, width: opts.width, height: opts.height, frames: [], events: [], marks: [], regions: {}, wallMs: 0, setupMs: 0 };
  }

  /** Current time in ms since the recording started. */
  get t() { return this.frame * this.dt; }

  ev(kind: string, data?: unknown, t = this.t) { this.session.events.push({ t, kind, data }); }

  /** Render one frame: advance the virtual clock by one frame, draw, save. */
  async step() {
    if (interrupt.signal) throw new Error(`stopped by ${interrupt.signal}`);
    const budgetDone = new Promise<void>(res => { this.onBudget = res; });
    await this.cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: this.dt });
    await Promise.race([budgetDone, new Promise(r => setTimeout(r, 15000))]);
    this.frame++;
    // after an off-camera stretch, make sure the next frame redraws so it gets a screenshot
    if (this.filming && !this.lastImg) await this.eval('window.__feelPoke?.()');
    const r = await this.cdp.send('HeadlessExperimental.beginFrame', {
      frameTimeTicks: 1e7 + this.t, interval: this.dt,
      ...(this.filming ? { screenshot: { format: 'jpeg', quality: 80, optimizeForSpeed: true } } : {}),
    });
    if (!this.filming) this.lastImg = '';
    else if (r.screenshotData) {
      this.lastImg = `${String(this.frame).padStart(6, '0')}.jpg`;
      fs.writeFileSync(path.join(this.framesDir, this.lastImg), Buffer.from(r.screenshotData, 'base64'));
    }
    const d = (await this.cdp.send('Runtime.evaluate', { expression: 'window.__feelDrain?.()', returnByValue: true })).result.value;
    const { metrics } = await this.cdp.send('Performance.getMetrics');
    const task = (metrics as { name: string; value: number }[]).find(m => m.name === 'TaskDuration')!.value * 1000;
    const cpu = Math.max(0, task - this.lastCpu);
    this.lastCpu = task;
    if (d) {
      for (const e of d.log) this.ev(e.kind, e.data, Math.max(0, this.t - (d.now - e.t)));
    }
    if (this.frame % Math.round(5000 / this.dt) === 0) {
      process.stderr.write(`feel: ${(this.t / 1000).toFixed(0)} s filmed, ${((Date.now() - this.t0) / 1000).toFixed(0)} s real time so far\n`);
    }
    this.session.frames.push({ i: this.frame, t: this.t, img: this.lastImg, cpu: Math.round(cpu * 10) / 10, ...(d?.mut ? { mut: d.mut } : {}), ...(d?.amb ? { amb: d.amb } : {}) });
  }
  private onBudget: () => void = () => {};
  /** @internal */ budgetExpired() { this.onBudget(); }

  /** Run `fn` without saving frames (time and the game still advance, events are still logged). */
  async offCamera<T>(fn: () => Promise<T>): Promise<T> {
    const was = this.filming;
    this.filming = false;
    this.ev('camera', 'off');
    try { return await fn(); } finally {
      this.filming = was;
      this.ev('camera', 'on');
    }
  }

  /** Let time pass, recording every frame. */
  async wait(ms: number) {
    const end = this.t + ms;
    while (this.t < end - 1e-6) await this.step();
  }

  /** Step frames until `cond` (a page-side function or expression) is truthy. */
  async until(cond: string | (() => unknown), opts: { timeout?: number; label?: string } = {}) {
    const expr = typeof cond === 'string' ? cond : `(${cond.toString()})()`;
    const end = this.t + (opts.timeout ?? 15000);
    while (!(await this.eval(`!!(${expr})`))) {
      if (this.t >= end) {
        const recent = this.session.events.filter(e => ['toast', 'rejected', 'page-error', 'console.error'].includes(e.kind)).slice(-3)
          .map(e => `${(e.t / 1000).toFixed(2)} s ${e.kind}: ${e.data}`);
        throw new Error(`timed out after ${opts.timeout ?? 15000} ms waiting for ${opts.label ?? expr}${recent.length ? `. Recent messages: ${recent.join(' | ')}` : ''}`);
      }
      await this.step();
    }
  }

  /** Run code in the page (no frame passes). */
  async eval<T = unknown>(fn: string | ((...a: any[]) => T), ...args: unknown[]): Promise<T> {
    const expression = typeof fn === 'string' ? fn : `(${fn.toString()})(...${JSON.stringify(args)})`;
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  /** Assert something about the game right now (runs in the page). A failure shows up first in `look`'s
   *  findings, so a drag that silently did nothing can't pass for one that worked. */
  async check(label: string, fn: string | (() => unknown)): Promise<boolean> {
    let ok = false, detail = '';
    try { ok = !!(await this.eval(fn)); } catch (e) { detail = String((e as Error).message ?? e); }
    this.ev('check', { label, ok, ...(detail ? { detail } : {}) });
    return ok;
  }

  /** Remember where an element is right now, so `look --crop <name>` can zoom to it later. */
  async region(name: string, target: string, opts: { nth?: number; pad?: number } = {}) {
    const el = await this.find(target, opts.nth);
    const p = opts.pad ?? 16;
    this.session.regions[name] = [Math.max(0, Math.round(el.left - p)), Math.max(0, Math.round(el.top - p)), Math.round(el.w + 2 * p), Math.round(el.h + 2 * p)];
  }

  /** Name this moment, so you can look at "fight" or "fight+2s" later. Marking "start" again moves
   *  where `look` begins by default (it is first set once the page has loaded). */
  mark(name: string) {
    if (name === 'start') this.session.marks = this.session.marks.filter(m => m.name !== 'start');
    this.session.marks.push({ t: this.t, name });
    this.ev('mark', name);
  }
  note(text: string) { this.ev('note', text); }

  async open(page: 'game' | 'stage' = 'game') {
    const url = page === 'stage' ? `${this.world.url}/__feel/stage.html` : `${this.world.url}/`;
    this.ev('open', page);
    await this.cdp.send('Page.navigate', { url });
    await this.until(page === 'stage' ? 'window.__feelStageReady' : "document.readyState === 'complete' && document.querySelector('#app')?.children.length", { timeout: 30000, label: `${page} page to load` });
    await this.eval('window.__feelCursor?.(-50, -50)');
  }

  async find(target: string, nth = 0): Promise<Target> {
    const r = await this.eval<Target | null>(`window.__feelFind(${JSON.stringify(target)}, ${nth})`);
    if (!r) throw new Error(`nothing visible matches "${target}"${nth ? ` (nth ${nth})` : ''}`);
    return r;
  }

  // Input is delivered with the next frame, so a press can't be acknowledged until we draw one.
  private async input(method: string, params: object) {
    const sent = this.cdp.send(method, params);
    const quick = await Promise.race([sent.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 30))]);
    if (quick) return;
    await this.step();
    await Promise.race([sent, new Promise((_, rej) => setTimeout(() => rej(new Error(`${method} was never acknowledged`)), 10000))]);
  }

  private async mouseEvent(type: string, x: number, y: number, extra: object = {}) {
    await this.input('Input.dispatchMouseEvent', { type, x, y, ...extra });
  }

  /** Glide the pointer to (x, y) over `ms`, one move per frame, like a hand would. */
  async moveTo(x: number, y: number, ms = 180, buttons = 0) {
    const from = { ...this.mouse };
    const n = Math.max(1, Math.round(ms / this.dt));
    for (let k = 1; k <= n; k++) {
      const p = k / n, e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      this.mouse = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      await this.mouseEvent('mouseMoved', this.mouse.x, this.mouse.y, buttons ? { buttons, button: 'left' } : {});
      await this.eval(`window.__feelCursor?.(${this.mouse.x}, ${this.mouse.y})`);
      if (k < n) await this.step();
    }
  }

  async hover(target: string, opts: { nth?: number; moveMs?: number } = {}) {
    const el = await this.find(target, opts.nth);
    await this.moveTo(el.x, el.y, opts.moveMs);
    this.ev('input', `hover ${describe(target, el.label)}`);
    await this.step();
  }

  /** Move to the target and click it. Holds the button for ~2 frames, like a real click. */
  async click(target: string | { x: number; y: number }, opts: { nth?: number; moveMs?: number; count?: number } = {}) {
    const el = typeof target === 'string' ? await this.find(target, opts.nth) : { ...target, label: '' };
    const what = typeof target === 'string' ? describe(target, el.label, opts.nth) : `(${target.x},${target.y})`;
    await this.moveTo(el.x, el.y, opts.moveMs);
    const count = opts.count ?? 1;
    this.ev('input', `${count === 2 ? 'double-click' : 'click'} ${what}`);
    for (let c = 1; c <= count; c++) {
      await this.mouseEvent('mousePressed', el.x, el.y, { button: 'left', buttons: 1, clickCount: c });
      await this.eval('window.__feelCursor?.(' + el.x + ',' + el.y + ', true)');
      await this.step();
      await this.mouseEvent('mouseReleased', el.x, el.y, { button: 'left', buttons: 0, clickCount: c });
      await this.eval('window.__feelCursor?.(' + el.x + ',' + el.y + ', false)');
      await this.step();
    }
  }

  async dblclick(target: string, opts: { nth?: number; moveMs?: number } = {}) {
    await this.click(target, { ...opts, count: 2 });
  }

  /** Press on `from`, drag to `to` over `ms`, release. */
  async drag(from: string, to: string, opts: { nth?: number; toNth?: number; ms?: number } = {}) {
    const a = await this.find(from, opts.nth);
    await this.moveTo(a.x, a.y);
    const b = await this.find(to, opts.toNth);
    this.ev('input', `drag ${describe(from, a.label, opts.nth)} → ${describe(to, b.label, opts.toNth)}`);
    await this.mouseEvent('mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 });
    await this.eval(`window.__feelCursor?.(${a.x}, ${a.y}, true)`);
    await this.step();
    await this.moveTo(b.x, b.y, opts.ms ?? 400, 1);
    await this.step();
    await this.mouseEvent('mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1 });
    await this.eval(`window.__feelCursor?.(${b.x}, ${b.y}, false)`);
    await this.step();
  }

  /** Press a key: "r", "1", "Space", "Escape"… */
  async key(k: string) {
    const info = keyInfo(k);
    this.ev('input', `key ${k}`);
    await this.input('Input.dispatchKeyEvent', { type: 'keyDown', key: info.key, code: info.code, windowsVirtualKeyCode: info.vk, text: info.text });
    await this.step();
    await this.input('Input.dispatchKeyEvent', { type: 'keyUp', key: info.key, code: info.code, windowsVirtualKeyCode: info.vk });
    await this.step();
  }

  async type(text: string) {
    this.ev('input', `type ${JSON.stringify(text)}`);
    for (const ch of text) {
      await this.input('Input.insertText', { text: ch });
      await this.step();
    }
  }

  /** Stage only: start a battle built by the shared engine. Returns who fought whom. */
  async battle(spec: BattleSpec = {}) {
    const b = makeBattle(spec);
    this.ev('stage-battle', b.summary);
    await this.eval(`window.__feelStage(${JSON.stringify(b.battle)}, ${JSON.stringify(b.meta)}, ${spec.speed ?? 1})`);
    await this.until(() => document.querySelector('.bunit'), { label: 'the battle to appear' });
    return b.summary;
  }

  /** @internal */ restartWallClock() { this.t0 = Date.now(); }

  save() {
    this.session.wallMs = Date.now() - this.t0;
    fs.writeFileSync(path.join(this.out, 'session.json'), JSON.stringify(this.session));
  }
}

export async function record(sceneFile: string, out: string, args: Record<string, string>, cli: SceneOpts) {
  const mod = await import(path.resolve(sceneFile));
  const fn: SceneFn = mod.default;
  if (typeof fn !== 'function') throw new Error(`${sceneFile} must export default async (s) => { … }`);
  const o: Required<SceneOpts> = { fps: 60, width: 1280, height: 800, page: 'game', ...(mod.options ?? {}), ...stripUndef(cli) };
  clearSession(out);

  const setupStart = Date.now();
  const world = await startWorld({ server: o.page === 'game' });
  let cdp: Cdp;
  try { cdp = await launch({ width: o.width, height: o.height }); } catch (e) { await world.close(); throw e; }
  const s = new Scene(cdp, world, out, args, o, path.basename(sceneFile, '.ts'));
  let failure: unknown;
  try {
    cdp.on('Emulation.virtualTimeBudgetExpired', () => s.budgetExpired());
    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error' || p.type === 'warning') s.session.events.push({ t: s.t, kind: `console.${p.type}`, data: p.args.map((a: any) => a.value ?? a.description).join(' ').slice(0, 300) });
    });
    cdp.on('Runtime.exceptionThrown', p => s.session.events.push({ t: s.t, kind: 'page-error', data: (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300) }));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(HERE, 'page/init.js'), 'utf8') });
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    await s.open(o.page);
    s.mark('start');
    s.session.setupMs = Date.now() - setupStart;
    s.restartWallClock();
    await fn(s);
    s.mark('end');
  } catch (e) {
    failure = e;
    s.ev('scene-error', String((e as Error).message ?? e));
  } finally {
    s.save();
    await cdp.close();
    await world.close();
  }
  return { session: s.session, failure };
}

// --out can name any path, so only ever replace an earlier recording there, never anything else.
function clearSession(out: string) {
  if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, 'session.json'))) {
    throw new Error(`${out} is not empty and is not a feel recording; pick another --out`);
  }
  fs.rmSync(path.join(out, 'frames'), { recursive: true, force: true });
  fs.rmSync(path.join(out, 'session.json'), { force: true });
  fs.mkdirSync(out, { recursive: true });
}

const stripUndef = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
