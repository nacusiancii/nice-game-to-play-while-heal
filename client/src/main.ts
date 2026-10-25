import './style.css';
import { BASE_GOLD, WINS_TO_VICTORY } from '../../server/src/game/core';
import { RELICS, UNITS } from '../../server/src/game/data';
import { DB, URI, api, connect, onChange, setErrorHandler, setReadOnly, store } from './net';
import { h, img, toast } from './dom';
import { ShopView } from './shopView';
import type { Frame } from '../../server/src/game/battle';
import { battleNow, getSpeed, playBattle, type BattleMeta } from './battleView';
import { sfx } from './sfx';
import { initReactions } from './react';
import { emit } from './events';
import type { Battle, Run } from './module_bindings/types';

const app = document.getElementById('app')!;
type Screen = 'title' | 'board' | 'battle';
let screen: Screen = 'title';
let waitingFight = false;
let lastRun: Run | undefined;
let shownScreen = '';
const shown = (now: string) => { if (now !== shownScreen) emit('screen', shownScreen = now); };

const shop = new ShopView(app, {
  onMenu: () => { screen = 'title'; render(); },
  onFight: () => {
    waitingFight = true;
    api.fight()?.then(() => {
      // the battle row arrives through the subscription; if not, recover
      setTimeout(() => { if (waitingFight) { waitingFight = false; shop.fighting = false; render(); } }, 4000);
    });
  },
});

setErrorHandler(msg => {
  sfx.error();
  toast(msg, true);
  waitingFight = false;
  shop.fighting = false;
  if (screen === 'board') render();
});

onChange(reason => {
  if (reason.startsWith('battle:')) {
    if (waitingFight) { waitingFight = false; shop.fighting = false; showBattle(); }
    return;
  }
  if (screen === 'battle') return; // the board re-renders after the replay
  const prev = lastRun;
  render();
  if (screen === 'board' && store.run) shop.diff(prev, store.run);
});

function showBattle() {
  const b = store.battles[store.battles.length - 1];
  const r = store.run;
  if (!b || !r) return;
  emit('battle', { round: b.round, opp: b.oppName, result: b.result > 0 ? 'won' : b.result < 0 ? 'lost' : 'draw', speed: getSpeed() });
  if (getSpeed() === 0) {
    // instant mode: skip the replay, just report the result
    (b.result > 0 ? sfx.win : b.result < 0 ? sfx.lose : sfx.draw)();
    // say who was left standing, so a loss you didn't watch still has a reason
    const last = (JSON.parse(b.frames) as Frame[]).at(-1);
    const left = (b.result > 0 ? last?.a : last?.b)?.filter(u => u.h > 0).map(u => `${UNITS[u.k]?.name ?? u.k} ${u.a}/${u.h}`) ?? [];
    const standing = left.length ? ` ${b.result > 0 ? 'Still standing' : 'Their survivors'}: ${left.join(', ')}.` : '';
    const said = b.result > 0 ? `Victory over ${b.oppName}! +1 trophy.` : b.result < 0 ? `Defeated by ${b.oppName}. -1 life.` : `Draw with ${b.oppName}.`;
    toast(said + standing, b.result < 0, standing ? 5000 : 2700);
    afterBattle();
    return;
  }
  screen = 'battle';
  shown('battle');
  // the run row already holds post-battle numbers; show the pre-battle record
  const myWins = r.wins - (b.result > 0 ? 1 : 0);
  const myLives = r.lives + (b.result < 0 ? 1 : 0);
  playBattle(app, b, { myName: store.player?.name ?? 'You', myWins, myLives, myRelics: [...r.relics] }, afterBattle);
}

function afterBattle() {
  screen = 'board';
  lastRun = store.run;
  render();
  const now = store.run;
  if (now?.status === 'shop') {
    if (now.gold > BASE_GOLD) { toast(`+${now.gold - BASE_GOLD} bonus gold this turn`); sfx.coin(); }
    if (now.round === 5 || now.round === 9) toast('The market grows: more units on offer.');
  }
}

function render() {
  shown(store.status !== 'online' ? store.status : screen === 'board' && store.run ? 'board' : 'title');
  if (store.status !== 'online') return renderOffline();
  if (screen === 'title' || !store.run) { screen = 'title'; return renderTitle(); }
  if (screen === 'board') {
    lastRun = store.run;
    shop.render();
    if (store.run.status !== 'shop') app.append(endModal(store.run));
  }
}

function renderOffline() {
  const msg = store.status === 'connecting'
    ? 'Lighting the torches…'
    : h('div', null,
      h('p', null, 'Cannot reach the SpacetimeDB server.'),
      h('p', null, 'Start it with ', h('code', null, './play.sh'), ' and reload.'),
      store.error && h('p', { style: 'font-size:14px' }, store.error));
  app.replaceChildren(h('div', { class: 'den' }, h('div', { class: 'center-msg' }, msg)));
}

const PARADE = ['kobold', 'rat', 'spore', 'skeleton', 'gnome', 'goblin', 'dwarf', 'wolf', 'necro', 'troll', 'deathcap', 'lich', 'treant', 'warlord'];

function renderTitle() {
  const r = store.run;
  const nameInput = h('input', { value: store.player?.name ?? '', maxLength: 24, placeholder: 'Name your rabble' }) as HTMLInputElement;
  nameInput.addEventListener('change', () => { if (nameInput.value.trim()) api.setName(nameInput.value); });
  const canContinue = r && r.status === 'shop';
  const start = () => {
    sfx.buy();
    if (nameInput.value.trim() && nameInput.value !== store.player?.name) api.setName(nameInput.value);
    api.startRun();
    screen = 'board';
  };
  const hall = store.hall.slice(0, 10);
  app.replaceChildren(h('div', { class: 'den' },
    h('div', { class: 'wall' }, h('div', { class: 'torch' }), h('div', { class: 'torch' }), h('div', { class: 'torch' })),
    h('div', { class: 'title-screen' },
      h('div', { class: 'logo' }, 'Rabble Below'),
      h('div', { class: 'tagline' }, 'Hire a rabble of dungeon misfits, merge them, and send them against the ghosts of other crews. Ten trophies before five lives run out.'),
      h('div', { class: 'parade' }, PARADE.map((k, i) => { const el = img(UNITS[k].sprite); el.style.animationDelay = `${i * 0.11}s`; return el; })),
      h('div', { class: 'namebox' }, 'Your rabble:', nameInput),
      h('div', { class: 'controls' },
        canContinue && h('button', { class: 'btn primary', onclick: () => { sfx.click(); screen = 'board'; render(); } }, `Continue run (round ${r!.round})`),
        h('button', { class: `btn ${canContinue ? '' : 'primary'}`, onclick: () => {
          if (canContinue && !confirm('Abandon your current run and start a new one?')) return;
          start();
        } }, 'New run')),
      h('div', { class: 'cols' },
        h('div', { class: 'card' },
          h('h3', null, 'How to play'),
          h('ul', null,
            h('li', null, h('b', null, 'Shop: '), '10 gold a turn. Units and items cost 3, reroll costs 1.'),
            h('li', null, h('b', null, 'Merge: '), 'drop a unit on the same kind to level it up. Levelling adds a stronger unit to the market.'),
            h('li', null, h('b', null, 'Order: '), 'the rightmost unit fights first. Battles are automatic.'),
            h('li', null, h('b', null, 'Tribes: '), 'Beasts brawl, Undead return, Fungus grow every turn, Goblins love gold, Arcane zap, Dwarves ward.'),
            h('li', null, h('b', null, 'Relics: '), 'pick one on rounds 3, 6, 9 and 12.'),
            h('li', null, h('b', null, 'Ghosts: '), 'every team you field is saved and haunts future runs.'),
            h('li', null, h('b', null, 'Keys: '), 'R reroll · F freeze · S sell · Space fight · T battle speed · 1-7 pick market slot'))),
        h('div', { class: 'card' },
          h('h3', null, 'Hall of Legends'),
          hall.length ? hall.map(e => h('div', { class: 'hall-row' },
            h('span', { class: 'crown' }, e.won ? '👑' : '🏆'),
            h('span', { class: 'nm' }, e.name),
            h('span', null, `${e.wins}/${WINS_TO_VICTORY}`),
            e.team.slice(0, 6).map(u => img(UNITS[u.kind]?.sprite ?? 'bones')))) : h('div', { class: 'hint', style: 'color:var(--dim)' }, 'No legends yet. Be the first.'),
          store.player && h('div', { class: 'label', style: 'margin-top:8px;text-align:left' },
            `Runs: ${store.player.runs} · Crowns: ${store.player.victories} · Best: ${store.player.bestWins} trophies`))))));
}

function endModal(r: Run) {
  const won = r.status === 'won';
  return h('div', { class: 'overlay' },
    h('div', { class: 'modal' },
      h('h2', null, won ? '👑 Champions of the Deep!' : 'Your rabble scatters…'),
      h('p', null, won
        ? `Ten trophies in ${r.round} rounds. Your ghosts will haunt the halls.`
        : `You earned ${r.wins} troph${r.wins === 1 ? 'y' : 'ies'} over ${r.round} rounds.`),
      h('div', { class: 'parade', style: 'justify-content:center;margin-bottom:14px' },
        r.team.filter(u => u.kind).map(u => img(UNITS[u.kind].sprite))),
      r.relics.length ? h('p', null, 'Relics: ', r.relics.map(k => RELICS[k].name).join(', ')) : null,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => { sfx.buy(); api.startRun(); } }, 'New run'),
        h('button', { class: 'btn', onclick: () => { screen = 'title'; render(); } }, 'Title'))));
}

window.addEventListener('keydown', ev => {
  if (screen === 'board' && store.run?.status === 'shop' && !store.run.relicChoices.length) shop.onKey(ev);
});

// What the player is looking at, frozen into each reaction.
function viewOf() {
  const r = store.run;
  return {
    screen: r && screen === 'board' && r.status !== 'shop' ? `board (${r.status} modal)` : r?.relicChoices.length && screen === 'board' ? 'board (relic choice)' : screen,
    battleId: screen === 'battle' ? battleNow.id : 0n,
    battleFrame: screen === 'battle' ? battleNow.frame : undefined,
    battleFrames: screen === 'battle' ? battleNow.frames : undefined,
    battleOver: screen === 'battle' ? battleNow.over : undefined,
    battleMeta: screen === 'battle' ? battleNow.meta : undefined,
    waitingFight: (screen === 'board' && waitingFight) || undefined,
    sel: shop.sel,
    speed: getSpeed(),
  };
}

// ?moment=<id> shows a saved reaction exactly as the player saw it, rendered by this build.
// Read-only; nothing is sent to the server.
//   &src=http://host:port   read it from another SpacetimeDB (default: the one this build uses)
//   &src=<url>.json         read a moments/<id>.json file from a delivered session
//   &frame=<n>              battle moments: show frame n instead (players react a beat late)
//   &battle=<id>            show another of the player's recent battles from that moment
//   &clean                  no banner, for pixel-exact screenshots
async function replayMoment(id: string, params: URLSearchParams) {
  setReadOnly('Replay of a saved moment: read-only.');
  const src = params.get('src') ?? URI.replace(/^ws/, 'http');
  const q = `SELECT id, name, text, round, run, battles, view FROM reaction WHERE id = ${Number(id)}`;
  let row: unknown[] | undefined;
  try {
    if (src.endsWith('.json')) {
      const m = await (await fetch(src)).json();
      row = [m.id, m.name, m.text, m.round, m.run, m.battles, m.view];
    } else {
      const res = await fetch(`${src}/v1/database/${DB}/sql`, { method: 'POST', body: q });
      row = (await res.json())[0]?.rows?.[0];
    }
  } catch (e) { store.error = String(e); }
  if (!row) {
    app.replaceChildren(h('div', { class: 'den' }, h('div', { class: 'center-msg' }, `No moment #${id} on ${src}. ${store.error}`)));
    return;
  }
  const [, name, text, round, runJson, battlesJson, viewJson] = row as [unknown, string, string, number, string, string, string];
  const view = JSON.parse(viewJson || '{}');
  const battles = (JSON.parse(battlesJson || '[]') as Battle[]).map(b => ({ ...b, id: BigInt(b.id as unknown as string) }));
  store.status = 'online';
  store.player = { name } as never;
  store.run = runJson ? JSON.parse(runJson) : undefined;
  const banner = h('div', { class: 'replay-banner', title: 'Click to hide', onclick: (e: Event) => { if (!(e.target as HTMLElement).closest('button')) banner.remove(); } },
    `▶ moment #${id}`, h('q', null, text), `${name} · round ${round} · ${view.screen ?? '?'} · build ${view.build ?? '?'}`);
  const pickedBattle = params.get('battle');
  const b = battles.find(x => String(x.id) === (pickedBattle ?? String(view.battleId)));
  if (b && (pickedBattle || view.screen === 'battle')) {
    const frames = (JSON.parse(b.frames) as unknown[]).length;
    const asked = params.get('frame');
    const frame = Math.max(0, Math.min(frames - 1, asked !== null ? Number(asked) : pickedBattle ? 0 : view.battleFrame ?? 0));
    const go = (n: number) => { params.set('frame', String(n)); location.search = params.toString(); };
    // the result box was up when they reacted: show it again
    const over = view.battleOver && asked === null && !pickedBattle;
    let resume = () => {};
    const done = new Promise<void>(r => { resume = r; if (over) r(); });
    const playOn = h('button', { class: 'btn', onclick: () => { playOn.remove(); resume(); } }, 'Play on ▶');
    banner.append(`· battle ${b.seq} vs ${b.oppName} · frame ${frame}/${frames}${asked === null && !pickedBattle ? ' (when H was pressed)' : ''}`,
      h('button', { class: 'btn', title: 'Previous frame', onclick: () => go(frame - 1) }, '◀'),
      h('button', { class: 'btn', title: 'Next frame', onclick: () => go(frame + 1) }, '▶'),
      ...(over ? [] : [playOn]));
    const meta: BattleMeta = !pickedBattle && view.battleMeta ? view.battleMeta
      : { myName: name, myWins: 0, myLives: 0, myRelics: [] }; // other battles: the record at the time isn't kept
    screen = 'battle';
    playBattle(app, b, meta, () => {}, { freezeAt: frame, resume: done });
  } else if (store.run && String(view.screen).startsWith('board')) {
    screen = 'board';
    shop.sel = view.sel ?? null;
    render();
  } else {
    screen = 'title';
    render();
  }
  if (battles.length) banner.append(h('span', null, ' · battles: ', battles.map(x =>
    h('a', { href: `?${new URLSearchParams({ ...Object.fromEntries(params), battle: String(x.id), frame: '0' })}`, style: 'color:var(--gold)' },
      `${x.seq}${x.result > 0 ? 'W' : x.result < 0 ? 'L' : 'D'} `))));
  if (!params.has('clean')) document.body.append(banner);
  console.log('moment', JSON.stringify({ id, text, view }, null, 1));
}

const moment = new URLSearchParams(location.search).get('moment');
if (moment) {
  replayMoment(moment, new URLSearchParams(location.search));
} else {
  initReactions(viewOf, api.react);
  render();
  connect();
}
