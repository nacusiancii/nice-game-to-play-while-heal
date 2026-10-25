// Connection to the SpacetimeDB module and a tiny reactive store over its tables.
import { DbConnection } from './module_bindings';
import type { Battle, Hall, Player, Run } from './module_bindings/types';
import { UNITS, ITEMS } from '../../server/src/game/data';
import { emit as announce } from './events';

export const URI = import.meta.env.VITE_STDB_URI ?? `ws://${location.hostname || '127.0.0.1'}:3000`;
export const DB = import.meta.env.VITE_STDB_DB ?? 'rabble-below';
const TOKEN_KEY = 'rabble-below/token';

export interface Store {
  status: 'connecting' | 'online' | 'offline';
  error: string;
  me: string; // identity hex
  player?: Player;
  run?: Run;
  battles: Battle[];
  hall: Hall[];
}

export const store: Store = { status: 'connecting', error: '', me: '', battles: [], hall: [] };
// tools/feel scenes read the live store (__store.run.gold) instead of scraping the page
if ('__feel' in globalThis) Object.assign(globalThis, { __store: store });

type Listener = (reason: string) => void;
const listeners = new Set<Listener>();
export const onChange = (f: Listener) => { listeners.add(f); return () => listeners.delete(f); };
const emit = (reason: string) => listeners.forEach(f => f(reason));

export let conn: DbConnection | null = null;

function refresh(reason: string) {
  if (!conn) return;
  const meHex = store.me;
  store.player = [...conn.db.player.iter()].find(p => p.identity.toHexString() === meHex);
  store.run = [...conn.db.run.iter()].find(r => r.owner.toHexString() === meHex);
  store.battles = [...conn.db.battle.iter()]
    .filter(b => b.owner.toHexString() === meHex)
    .sort((a, b) => a.seq - b.seq);
  store.hall = [...conn.db.hall.iter()].sort((a, b) =>
    Number(b.won) - Number(a.won) || b.wins - a.wins || Number(b.at.microsSinceUnixEpoch - a.at.microsSinceUnixEpoch));
  emit(reason);
}

export function connect() {
  const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
  conn = DbConnection.builder()
    .withUri(URI)
    .withDatabaseName(DB)
    .withToken(token)
    .onConnect((c, identity, token) => {
      localStorage.setItem(TOKEN_KEY, token);
      store.me = identity.toHexString();
      store.status = 'online';
      c.subscriptionBuilder()
        .onApplied(() => refresh('sync'))
        .subscribe(['SELECT * FROM player', 'SELECT * FROM run', 'SELECT * FROM battle', 'SELECT * FROM hall']);
    })
    .onConnectError((_ctx, err) => {
      // A token signed by another server (say, an old sandbox on this port) is refused: join as a new player.
      if (token && /401|token/i.test(String(err?.message ?? err))) {
        localStorage.removeItem(TOKEN_KEY);
        return connect();
      }
      store.status = 'offline';
      store.error = String(err?.message ?? err);
      emit('offline');
    })
    .onDisconnect(() => { store.status = 'offline'; emit('offline'); })
    .build();

  conn.db.run.onInsert(() => refresh('run'));
  conn.db.run.onUpdate(() => refresh('run'));
  conn.db.run.onDelete(() => refresh('run'));
  conn.db.battle.onInsert((_c, b) => { refresh('run'); emit(`battle:${b.id}`); });
  conn.db.battle.onDelete(() => refresh('battle'));
  conn.db.player.onInsert(() => refresh('player'));
  conn.db.player.onUpdate(() => refresh('player'));
  conn.db.hall.onInsert(() => refresh('hall'));
}

// Reducer calls. Errors (rule violations) come back as rejected promises.
// Every call is also announced as an event, in words ("sell Skeleton (slot 1)").
type Err = (msg: string) => void;
let onError: Err = () => {};
export const setErrorHandler = (f: Err) => { onError = f; };
let readOnly = '';
export const setReadOnly = (why: string) => { readOnly = why; };
const call = (what: string, p: () => Promise<void> | undefined) => {
  announce('call', what);
  if (readOnly) { onError(readOnly); return; }
  return p()?.then(() => announce('done', what), e => { const m = cleanErr(e); announce('rejected', m); onError(m); });
};
function cleanErr(e: unknown) {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/^.*SenderError:\s*/, '').replace(/^(Error:\s*)+/, '');
}

const unitName = (i: number) => { const u = store.run?.team[i]; return u?.kind ? `${UNITS[u.kind]?.name ?? u.kind} (slot ${i})` : `empty slot ${i}`; };
const shopName = (i: number) => {
  const s = store.run?.shop[i];
  return s?.kind ? `${(s.isItem ? ITEMS[s.kind]?.name : UNITS[s.kind]?.name) ?? s.kind} (shop ${i})` : `empty shop ${i}`;
};

// item spots: a team slot, or -1 for the pocket
const itemName = (i: number) => {
  const k = i < 0 ? store.run?.pocket : store.run?.team[i]?.item;
  return `${k ? ITEMS[k]?.name ?? k : 'nothing'} (${i < 0 ? 'pocket' : `slot ${i}`})`;
};
const spotName = (i: number) => (i < 0 ? 'the pocket' : unitName(i));

export const api = {
  startRun: () => call('start run', () => conn?.reducers.startRun({})),
  abandonRun: () => call('abandon run', () => conn?.reducers.abandonRun({})),
  buy: (shopIdx: number, teamIdx: number) => call(`buy ${shopName(shopIdx)} onto ${unitName(teamIdx)}`, () => conn?.reducers.buyFromShop({ shopIdx, teamIdx })),
  sell: (teamIdx: number) => call(`sell ${unitName(teamIdx)}`, () => conn?.reducers.sellUnit({ teamIdx })),
  move: (from: number, to: number) => call(`move ${unitName(from)} onto ${unitName(to)}`, () => conn?.reducers.moveUnit({ from, to })),
  moveItem: (from: number, to: number) => call(`move item ${itemName(from)} onto ${spotName(to)}`, () => conn?.reducers.moveItem({ from, to })),
  sellItem: (from: number) => call(`sell item ${itemName(from)}`, () => conn?.reducers.sellItem({ from })),
  reroll: () => call('reroll', () => conn?.reducers.reroll({})),
  freeze: (shopIdx: number) => call(`${store.run?.shop[shopIdx]?.frozen ? 'unfreeze' : 'freeze'} ${shopName(shopIdx)}`, () => conn?.reducers.toggleFreeze({ shopIdx })),
  relic: (idx: number) => call(`pick relic ${store.run?.relicChoices[idx] ?? idx}`, () => conn?.reducers.chooseRelic({ idx })),
  fight: () => call('fight', () => conn?.reducers.fightGhost({})),
  setName: (name: string) => call(`rename to ${name}`, () => conn?.reducers.setName({ name })),
  // not part of play, so it isn't announced
  react: (text: string, battleId: bigint, view: string): Promise<boolean> =>
    conn ? conn.reducers.react({ text, battleId, view }).then(() => true, e => { onError(cleanErr(e)); return false; }) : Promise.resolve(false),
};
