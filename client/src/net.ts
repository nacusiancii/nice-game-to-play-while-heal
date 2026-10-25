// Connection to the SpacetimeDB module and a tiny reactive store over its tables.
import { DbConnection } from './module_bindings';
import type { Battle, Hall, Player, Run } from './module_bindings/types';

const URI = import.meta.env.VITE_STDB_URI ?? `ws://${location.hostname || '127.0.0.1'}:3000`;
const DB = import.meta.env.VITE_STDB_DB ?? 'rabble-below';
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
type Err = (msg: string) => void;
let onError: Err = () => {};
export const setErrorHandler = (f: Err) => { onError = f; };
const call = (p: Promise<void> | undefined) => p?.catch(e => onError(cleanErr(e)));
function cleanErr(e: unknown) {
  const s = e instanceof Error ? e.message : String(e);
  return s.replace(/^.*SenderError:\s*/, '').replace(/^(Error:\s*)+/, '');
}

export const api = {
  startRun: () => call(conn?.reducers.startRun({})),
  abandonRun: () => call(conn?.reducers.abandonRun({})),
  buy: (shopIdx: number, teamIdx: number) => call(conn?.reducers.buyFromShop({ shopIdx, teamIdx })),
  sell: (teamIdx: number) => call(conn?.reducers.sellUnit({ teamIdx })),
  move: (from: number, to: number) => call(conn?.reducers.moveUnit({ from, to })),
  reroll: () => call(conn?.reducers.reroll({})),
  freeze: (shopIdx: number) => call(conn?.reducers.toggleFreeze({ shopIdx })),
  relic: (idx: number) => call(conn?.reducers.chooseRelic({ idx })),
  fight: () => call(conn?.reducers.fightGhost({})),
  setName: (name: string) => call(conn?.reducers.setName({ name })),
};
