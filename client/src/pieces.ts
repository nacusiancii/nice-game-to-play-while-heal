// Reusable visual pieces: units, items, info panel content.
import { levelOf, xpProgress } from '../../server/src/game/core';
import { ITEMS, RELICS, UNITS } from '../../server/src/game/data';
import { h, img } from './dom';

export interface UnitLike { kind: string; atk: number; hp: number; xp?: number; lvl?: number; item?: string; ward?: number; uid?: number }

export function unitEl(u: UnitLike, faceRight = false) {
  const d = UNITS[u.kind];
  const lvl = u.lvl ?? levelOf(u.xp ?? 0);
  const pips = u.xp !== undefined ? xpProgress(u.xp) : null;
  return h('div', { class: `unit${faceRight ? ' face-right' : ''}`, 'data-uid': u.uid ?? '' },
    h('div', { class: 'shadow' }),
    img(d.sprite, 'spr'),
    d.tier > 0 && (u.xp === undefined && u.lvl === undefined
      ? h('div', { class: 'lvl tier' }, `Tier ${d.tier}`)
      : h('div', { class: `lvl${lvl === 3 ? ' max' : ''}` }, `Lv${lvl}`,
        pips && pips.need ? Array.from({ length: pips.need }, (_, i) => h('span', { class: `pip${i < pips.have ? ' on' : ''}` })) : null)),
    u.item ? h('div', { class: 'held' }, img(ITEMS[u.item].sprite)) : null,
    h('div', { class: 'stats' },
      h('div', { class: 'badge atk' }, u.atk),
      h('div', { class: 'badge hp' }, u.hp)),
    u.ward ? h('div', { class: 'badge ward' }, u.ward) : null,
  );
}

export function itemEl(kind: string) {
  return h('div', { class: 'item' }, img(ITEMS[kind].sprite));
}

export const tribeTag = (t: string) => h('span', { class: `tribe ${t}` }, t);

export function unitInfo(kind: string, xp: number | undefined, extra?: string) {
  const d = UNITS[kind];
  const L = levelOf(xp ?? 0);
  const next = d.tier > 0 && L < 3 ? `Level ${L + 1}: ${d.text(L + 1)}` : '';
  return [
    img(d.sprite, 'pic'),
    h('div', null,
      h('h3', null, d.name),
      h('div', { class: 'meta' }, tribeTag(d.tribe), d.tier ? `Tier ${d.tier} · Level ${L}` : 'Summoned', extra ? ` · ${extra}` : ''),
      h('div', { class: 'txt' }, d.text(L)),
      next && h('div', { class: 'next' }, next)),
  ];
}

export function itemInfo(kind: string, extra?: string) {
  const d = ITEMS[kind];
  return [
    img(d.sprite, 'pic'),
    h('div', null,
      h('h3', null, d.name),
      h('div', { class: 'meta' }, d.held ? 'Held item' : 'Instant', ` · Tier ${d.tier}`, extra ? ` · ${extra}` : ''),
      h('div', { class: 'txt' }, d.text)),
  ];
}

export function relicInfo(kind: string) {
  const d = RELICS[kind];
  return [img(d.sprite, 'pic'), h('div', null, h('h3', null, d.name), h('div', { class: 'meta' }, 'Relic'), h('div', { class: 'txt' }, d.text))];
}

export function hearts(lives: number, max = 5) {
  const n = Math.max(max, lives);
  return h('span', { class: 'hearts' }, Array.from({ length: n }, (_, i) => h('span', { class: i < lives ? '' : 'lost' }, '♥')));
}

export const TRIBE_BLURB: Record<string, string> = {
  Beast: 'Beasts brawl: they grow when hurt or when friends fall.',
  Undead: 'Undead come back: summons on faint, and they feed on death.',
  Fungus: 'Fungus grows a little every turn. Patience pays.',
  Goblin: 'Goblins love gold: earn it, and turn unspent gold into stats.',
  Arcane: 'Arcane units zap enemies before and during the fight.',
  Dwarf: 'Dwarves hand out ward, a shield that absorbs damage first.',
};
