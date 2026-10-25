// What the game is doing, as a stream of small events: a server call and its answer, a screen change,
// a battle, a toast. Listeners make something of it: trail.ts keeps the last few in words for playtest
// reactions. Data is plain JSON (often just a string), so any listener can log it as is.
export type Listener = (kind: string, data?: unknown) => void;
const listeners: Listener[] = [];

export const listen = (f: Listener) => { listeners.push(f); };
export function emit(kind: string, data?: unknown) {
  for (const f of listeners) f(kind, data);
}

window.addEventListener('error', ev => emit('js-error', `${ev.message} @ ${ev.filename?.split('/').pop()}:${ev.lineno}`));
window.addEventListener('unhandledrejection', ev => emit('js-error', String(ev.reason?.message ?? ev.reason)));
