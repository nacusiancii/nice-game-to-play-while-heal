// What the game is doing, as a stream of small events: a server call and its answer, a screen change,
// a battle and its beats, a toast, a sound. Listeners make something of it: trail.ts keeps the last few
// in words for playtest reactions, and tools/feel puts them on its timeline while it films.
// Data is plain JSON (often just a string), so any listener can log it as is.
export type Listener = (kind: string, data?: unknown) => void;
const listeners: Listener[] = [];

export const listen = (f: Listener) => { listeners.push(f); };
// tools/feel defines __feel before the game loads (tools/feel/page/init.js)
const feel = (globalThis as { __feel?: Listener }).__feel;
if (feel) listen(feel);
export function emit(kind: string, data?: unknown) {
  for (const f of listeners) f(kind, data);
}

window.addEventListener('error', ev => emit('js-error', `${ev.message} @ ${ev.filename?.split('/').pop()}:${ev.lineno}`));
window.addEventListener('unhandledrejection', ev => emit('js-error', String(ev.reason?.message ?? ev.reason)));
