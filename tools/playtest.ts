// Playtest courier: turns in-game reactions into a session an agent thread can work from.
//
//   npx tsx playtest.ts deliver   bundle every undelivered reaction into one session now
//   npx tsx playtest.ts watch     run beside the game: a bug goes out at once, the rest when
//                                 play goes quiet (IDLE_MIN); play.sh delivers on exit
//   npx tsx playtest.ts status    what is waiting
//
// A session is a folder in .playtest/sessions/ with SESSION.md (every reaction side by side)
// and moments/<id>.json (raw rows, replayable). If .playtest/webhook holds a T3 webhook URL,
// the session is posted there and a fresh thread picks it up; otherwise you get told where it is.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ITEMS, RELICS, UNITS } from '../server/src/game/data';
import { levelOf } from '../server/src/game/core';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, '.playtest');
const STATE = join(DIR, 'state.json');
const STDB = process.env.STDB_HTTP ?? 'http://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'rabble-below';
const GAME = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const IDLE_MIN = Number(process.env.IDLE_MIN ?? 20);
const BUG = /\b(bug|broken|crash\w*|stuck|glitch\w*|froze)\b/i;

interface Row { id: number; name: string; at: number; text: string; round: number; run: string; battles: string; view: string }
// Delivered reactions are remembered by id and time: ids start again from 1 when the
// database is wiped, and those new reactions must not look already sent.
interface State { delivered: string[] }
const key = (r: Row) => `${r.id}@${r.at}`;

// The CLI's identity owns the database, so it can see every run (players only see their own).
function cliToken() {
  try { return readFileSync(join(homedir(), '.config/spacetime/cli.toml'), 'utf8').match(/spacetimedb_token\s*=\s*"([^"]+)"/)?.[1] ?? ''; } catch { return ''; }
}
const TOKEN = process.env.STDB_TOKEN ?? cliToken();

async function sql(q: string): Promise<unknown[][]> {
  const headers: Record<string, string> = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};
  const res = await fetch(`${STDB}/v1/database/${DB}/sql`, { method: 'POST', body: q, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json())[0]?.rows ?? [];
}

async function reactions(): Promise<Row[]> {
  const rows = await sql('SELECT id, name, at, text, round, run, battles, view FROM reaction');
  return rows.map(([id, name, at, text, round, run, battles, view]) => ({
    id: Number(id), name: String(name), text: String(text), round: Number(round),
    at: Number((at as [number])[0] ?? at) / 1000, // timestamp arrives as [micros]
    run: String(run), battles: String(battles), view: String(view),
  })).sort((a, b) => a.id - b.id);
}

const loadState = (): State => {
  const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { delivered: [] };
  return { delivered: st.delivered.filter((k: unknown) => typeof k === 'string') };
};
const saveState = (s: State) => { mkdirSync(DIR, { recursive: true }); writeFileSync(STATE, JSON.stringify(s)); };

// ---------- rendering a moment in words ----------
const parse = (s: string) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

function unitStr(u: { kind: string; atk: number; hp: number; xp?: number; item?: string }) {
  const name = UNITS[u.kind]?.name ?? u.kind;
  const lvl = u.xp !== undefined ? ` L${levelOf(u.xp)}` : '';
  const item = u.item ? ` +${ITEMS[u.item]?.name ?? u.item}` : '';
  return `${name} ${u.atk}/${u.hp}${lvl}${item}`;
}

interface Snap { k: string; a: number; h: number; w: number; i: string }
const sideStr = (ss: Snap[]) =>
  ss.map(s => `${UNITS[s.k]?.name ?? s.k} ${s.a}/${s.h}${s.w ? ` ward ${s.w}` : ''}${s.i ? ` +${ITEMS[s.i]?.name ?? s.i}` : ''}`).join(' · ') || 'nobody';
const resultStr = (n: number) => (n > 0 ? 'won' : n < 0 ? 'lost' : 'draw');

// seen: trail lines already printed for this player, so each reaction shows only what's new.
function describe(r: Row, seen: Map<string, { id: number; lines: Set<string> }>) {
  const run = parse(r.run);
  const view = parse(r.view) ?? {};
  const battles: { id: string; seq: number; round: number; oppName: string; result: number; frames: string }[] = parse(r.battles) ?? [];
  const watched = battles.find(b => String(b.id) === String(view.battleId));
  const link = (extra = '') => `${GAME}/?moment=${r.id}${extra}`;
  const out: string[] = [];
  out.push(`## #${r.id} · ${hhmm(r.at)} · "${r.text}"${BUG.test(r.text) ? '  🐞' : ''}`);
  out.push('');
  out.push(`- **Where:** ${[r.name, `round ${r.round}`, `screen: ${view.screen ?? '?'}`, `build ${view.build ?? '?'}`].join(' · ')}`);
  if (run) {
    out.push(`- **Run:** ${run.gold} gold · ${run.lives} lives · ${run.wins} trophies · status ${run.status}${run.relics?.length ? ` · relics: ${run.relics.map((k: string) => RELICS[k]?.name ?? k).join(', ')}` : ''}`);
    const team = (run.team ?? []).map((u: { kind: string }, i: number) => (u.kind ? `${i}:${unitStr(u as never)}` : `${i}:—`));
    out.push(`- **Team** (slot 0 = front): ${team.join(' · ')}`);
    const shop = (run.shop ?? []).map((s: { kind: string; isItem: boolean; atk: number; hp: number; frozen: boolean }, i: number) =>
      !s.kind ? `${i}:sold` : `${i}:${s.isItem ? `[${ITEMS[s.kind]?.name ?? s.kind}]` : unitStr(s)}${s.frozen ? ' ❄' : ''}`);
    out.push(`- **Market:** ${shop.join(' · ')}`);
    if (run.relicChoices?.length) out.push(`- **Relic choice open:** ${run.relicChoices.map((k: string) => RELICS[k]?.name ?? k).join(' / ')}`);
  }
  if (view.screen === 'battle' && watched) {
    out.push(`- **Watching:** battle ${watched.seq} (round ${watched.round}) vs ${watched.oppName}, frame ${view.battleFrame}/${view.battleFrames}` +
      `${view.battleOver ? ', result box up' : ''}, ends ${resultStr(watched.result)}. The run above is already post-battle.`);
    const frames: { a: Snap[]; b: Snap[]; fx: Record<string, unknown>[] }[] = parse(watched.frames) ?? [];
    const f = frames[view.battleFrame];
    if (f) {
      out.push(`- **On that frame** (front first): you ${sideStr(f.a)} | them ${sideStr(f.b)}`);
      if (f.fx?.length) out.push(`- **Happening:** ${f.fx.map(e => Object.values(e).join(' ')).join('; ')}`);
    }
    out.push('- Players press H a beat after what struck them: look at the frames before too (`&frame=<n>`).');
  }
  if (battles.length) {
    out.push(`- **Recent battles:** ${battles.map(b => `${b.seq}: round ${b.round} vs ${b.oppName}, ${resultStr(b.result)} ([replay](${link(`&battle=${b.id}`)}))`).join(' · ')}`);
  }
  if (view.sel) out.push(`- **Selected:** ${view.sel.from} slot ${view.sel.idx}`);
  if (view.info) out.push(`- **Info panel said:** ${view.info}`);
  if (view.toasts?.length) out.push(`- **On screen:** ${view.toasts.map((t: string) => `"${t}"`).join(', ')}`);
  const prev = seen.get(r.name) ?? { id: 0, lines: new Set<string>() };
  const trail: { s: number; e: string }[] = view.trail ?? [];
  const fresh = trail.filter(t => !prev.lines.has(`${t.s} ${t.e}`));
  if (fresh.length) {
    out.push(`- **Just before** (seconds since page load${fresh.length < trail.length ? `; earlier steps under #${prev.id}` : ''}):`);
    for (const t of fresh) out.push(`  - ${t.s}s ${t.e}`);
  } else if (trail.length) out.push(`- **Just before:** nothing new since #${prev.id}`);
  seen.set(r.name, { id: r.id, lines: new Set([...prev.lines, ...trail.map(t => `${t.s} ${t.e}`)]) });
  out.push(`- **Replay:** ${link()}`);
  out.push('');
  return out.join('\n');
}

// ---------- delivering ----------
async function deliver(rows: Row[], kind: 'session' | 'bug') {
  if (!rows.length) return;
  const stamp = new Date().toLocaleString('sv-SE').slice(0, 16).replace(' ', '-').replace(':', ''); // local time
  const dir = join(DIR, 'sessions', `${stamp}${kind === 'bug' ? `-bug-${rows[0].id}` : ''}`);
  mkdirSync(join(dir, 'moments'), { recursive: true });
  for (const r of rows) writeFileSync(join(dir, 'moments', `${r.id}.json`), JSON.stringify(r, null, 1));

  const players = [...new Set(rows.map(r => r.name))];
  const bugs = rows.filter(r => BUG.test(r.text));
  const head = [
    `# Playtest ${kind === 'bug' ? 'bug report' : 'session'} · ${new Date(rows[0].at).toLocaleString('en-GB')}`,
    '',
    `${rows.length} reaction${rows.length === 1 ? '' : 's'} from ${players.join(', ')}, ${hhmm(rows[0].at)}–${hhmm(rows[rows.length - 1].at)}.` +
      (bugs.length ? ` ${bugs.length} sound${bugs.length === 1 ? 's' : ''} like a bug: ${bugs.map(b => `#${b.id}`).join(', ')}.` : ''),
    '',
    'Read with `playtest/TRIAGE.md`. Raw rows are in `moments/`.',
    '',
    `- **Data:** SpacetimeDB ${STDB}, database \`${DB}\`. That is the player's game: read it, never publish to it.`,
    `- **Replay links** open the player's own build at ${GAME} (only while their game runs).`,
    `  With your build: \`<your client>/?moment=<id>&src=${STDB}\`, or \`&src=<url of moments/<id>.json>\`.`,
    '  `&frame=<n>` and `&battle=<id>` pick a frame or another recent battle; `&clean` hides the banner.',
    '',
    '| # | time | said | round | screen |',
    '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.id} | ${hhmm(r.at)} | ${r.text.replace(/\|/g, '/')} | ${r.round} | ${parse(r.view)?.screen ?? '?'} |`),
    '',
  ];
  const seen = new Map<string, { id: number; lines: Set<string> }>();
  writeFileSync(join(dir, 'SESSION.md'), [...head, ...rows.map(r => describe(r, seen))].join('\n'));

  const st = loadState();
  st.delivered.push(...rows.map(key));
  saveState(st);

  const body = { session: dir, kind, reactions: rows.length, bugs: bugs.length, players: players.join(', ') };
  const hook = existsSync(join(DIR, 'webhook')) ? readFileSync(join(DIR, 'webhook'), 'utf8').trim() : '';
  let sent = false;
  if (hook) {
    try {
      const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      sent = res.ok;
      if (!res.ok) console.error(`webhook said ${res.status}: ${await res.text()}`);
    } catch (e) { console.error(`webhook failed: ${(e as Error).message}`); }
  }
  writeFileSync(join(dir, 'handoff.json'), JSON.stringify({ ...body, webhook: sent ? 'sent' : hook ? 'failed' : 'none' }, null, 1));
  const msg = sent
    ? `${rows.length} reaction(s) sent to a fresh thread.`
    : `${rows.length} reaction(s) saved. Hand them over by telling any thread: "triage the playtest at ${dir}"`;
  console.log(`\n  💬 ${msg}\n     ${dir}/SESSION.md\n`);
  try { execSync(`notify-send -a "Rabble Below" "Playtest ${kind}" ${JSON.stringify(msg)}`, { stdio: 'ignore' }); } catch { /* no desktop */ }
}

async function pending() {
  const done = new Set(loadState().delivered);
  return (await reactions()).filter(r => !done.has(key(r)));
}

async function watch() {
  console.log(`  💬 playtest courier watching ${STDB} (bugs go out at once, the rest after ${IDLE_MIN} quiet minutes)`);
  // Delivery on exit is play.sh's job (it runs `deliver` before stopping the server), so a
  // Ctrl+C that reaches both of us can't produce the session twice.
  let lastSig = '', lastChange = Date.now();
  for (;;) {
    try {
      const waiting = await pending();
      const bugs = waiting.filter(r => BUG.test(r.text));
      for (const b of bugs) await deliver([b], 'bug');
      // "quiet" = no new reactions and no run has changed
      const runs = await sql('SELECT round, gold, battles FROM run');
      const sig = JSON.stringify([waiting.length, runs]);
      if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
      const rest = waiting.filter(r => !BUG.test(r.text));
      if (rest.length && Date.now() - lastChange > IDLE_MIN * 60_000) await deliver(rest, 'session');
    } catch { /* server not up yet or restarting */ }
    await new Promise(r => setTimeout(r, 15_000));
  }
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'deliver') await deliver(await pending(), 'session');
else if (cmd === 'watch') await watch();
else {
  const p = await pending();
  console.log(p.length ? p.map(r => `#${r.id} ${hhmm(r.at)} ${r.name}: ${r.text}`).join('\n') : 'Nothing waiting.');
}
