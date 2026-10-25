// Where a recording happens.
// Live scenes play this worktree's game in its sandbox: `./sandbox up` publishes this worktree's module to a
// private SpacetimeDB and serves this worktree's client build. The sandbox keeps running afterwards, like
// any sandbox: `./sandbox down` when you're done. Krishna's game on :3000 is never touched.
// Stage scenes need no server: a Vite dev server serves the real battle view on /__feel/stage.html.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT = path.join(ROOT, 'client');

export interface World { url: string; close(): Promise<void> }

const say = (s: string) => process.stderr.write(`feel: ${s}\n`);

export async function startWorld(opts: { server: boolean }): Promise<World> {
  return opts.server ? sandbox() : stage();
}

function sandbox(): World {
  say('./sandbox up: this worktree\'s code on your private server');
  const sb = path.join(ROOT, 'sandbox');
  execFileSync(sb, ['up'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  const url = execFileSync(sb, ['env'], { cwd: ROOT, encoding: 'utf8' }).match(/SANDBOX_WEB=(\S+)/)![1];
  say(`playing at ${url}; the sandbox stays up after the recording (./sandbox down when you're done)`);
  return { url, close: async () => {} };
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

async function stage(): Promise<World> {
  if (!fs.existsSync(path.join(CLIENT, 'src/module_bindings'))) {
    // the stage only needs types from the bindings, but Vite still resolves the import
    const bin = execFileSync('mise', ['which', 'spacetimedb-cli'], { cwd: ROOT, encoding: 'utf8' }).trim();
    execFileSync(bin, ['generate', '--lang', 'typescript', '--out-dir', 'client/src/module_bindings', '--module-path', 'server'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  // The stage never connects to a server. vite.config.ts refuses to serve without a database address, so
  // that a dev server can't fall back to Krishna's :3000; this one goes nowhere.
  process.env.VITE_STDB_URI ??= 'ws://127.0.0.1:9';
  const require = createRequire(path.join(CLIENT, 'package.json'));
  const vite = await import(pathToFileURL(require.resolve('vite')).href);
  const stageEntry = path.join(ROOT, 'tools/feel/page/stage.ts');
  const server = await vite.createServer({
    root: CLIENT,
    configFile: path.join(CLIENT, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    server: { port: await freePort(), strictPort: true, host: '127.0.0.1', hmr: false, watch: null, fs: { allow: [ROOT] } },
    plugins: [{
      name: 'feel-stage',
      configureServer(s: any) {
        s.middlewares.use(async (req: any, res: any, next: any) => {
          if (!req.url?.startsWith('/__feel/stage.html')) return next();
          const html = await s.transformIndexHtml(req.url,
            `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Rabble Below stage</title></head>`
            + `<body><div id="app"></div><script type="module" src="/@fs${stageEntry}"></script></body></html>`);
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        });
      },
    }],
  });
  try { await server.listen(); } catch (e) { await server.close(); throw e; }
  const url = `http://127.0.0.1:${server.config.server.port}`;
  say(`stage on ${url}`);
  return { url, close: () => server.close() };
}
