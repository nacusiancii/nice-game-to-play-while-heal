// Every unit, item and relic in the game, with its rules.
import type { Tribe, Unit, RunState, Rng } from './core';
import { HOARD_CAP } from './core';
import type { Battle, BU } from './battle';

// Shop-side hooks get a small API over the run state.
export interface ShopApi {
  st: RunState;
  rng: Rng;
  units(): Unit[]; // non-empty, front to back
  ahead(u: Unit): Unit | undefined;
  behind(u: Unit): Unit | undefined;
  buff(u: Unit, atk: number, hp: number): void;
  gold(n: number): void;
}

export interface UnitDef {
  name: string;
  tribe: Tribe;
  tier: number; // 0 = token, never in shop
  atk: number;
  hp: number;
  sprite: string;
  text: (L: number) => string;
  // battle hooks
  sob?: (b: Battle, u: BU, L: number) => void;
  beforeAttack?: (b: Battle, u: BU, L: number) => void;
  afterAttack?: (b: Battle, u: BU, L: number) => void;
  friendAheadAttacks?: (b: Battle, u: BU, L: number) => void;
  hurt?: (b: Battle, u: BU, L: number) => void;
  faint?: (b: Battle, u: BU, L: number, idx: number) => void;
  friendFaint?: (b: Battle, u: BU, L: number, dead: BU, idx: number, wasAhead: boolean) => void;
  kill?: (b: Battle, u: BU, L: number, victim: BU) => void;
  friendSummoned?: (b: Battle, u: BU, L: number, s: BU) => void;
  // shop hooks
  startTurn?: (s: ShopApi, u: Unit, L: number) => void;
  endTurn?: (s: ShopApi, u: Unit, L: number) => void;
  sell?: (s: ShopApi, u: Unit, L: number) => void;
  friendBought?: (s: ShopApi, u: Unit, L: number, bought: Unit) => void;
}

export const UNITS: Record<string, UnitDef> = {
  // ---------- Tier 1 ----------
  kobold: {
    name: 'Kobold Scavenger', tribe: 'Goblin', tier: 1, atk: 2, hp: 3, sprite: 'kobold_new',
    text: L => `Sell: gain ${L} extra gold.`,
    sell: (s, _u, L) => s.gold(L),
  },
  rat: {
    name: 'Grey Rat', tribe: 'Beast', tier: 1, atk: 1, hp: 3, sprite: 'grey_rat',
    text: L => `Hurt: gain +${L} attack.`,
    hurt: (b, u, L) => b.buff(u, L, 0),
  },
  spore: {
    name: 'Spore Puff', tribe: 'Fungus', tier: 1, atk: 1, hp: 1, sprite: 'giant_spore',
    text: L => `End turn: gain +${L === 3 ? 2 : 1} health.`,
    endTurn: (s, u, L) => s.buff(u, 0, L === 3 ? 2 : 1),
  },
  skeleton: {
    name: 'Skeleton', tribe: 'Undead', tier: 1, atk: 2, hp: 1, sprite: 'skeleton_humanoid_small_new',
    text: L => `Faint: summon a ${L}/${L} Bones.`,
    faint: (b, u, L, idx) => { b.summon(u.side, idx, 'bones', L, L); },
  },
  gnome: {
    name: 'Gnome Apprentice', tribe: 'Arcane', tier: 1, atk: 2, hp: 2, sprite: 'gnome',
    text: L => `Start of battle: deal 1 damage to a random enemy, ${L} time${L > 1 ? 's' : ''}.`,
    sob: (b, u, L) => { for (let i = 0; i < L; i++) b.zapRandom(u, b.spell(u, 1)); },
  },
  firebat: {
    name: 'Fire Bat', tribe: 'Beast', tier: 1, atk: 2, hp: 1, sprite: 'fire_bat',
    text: L => `Faint: give a random friend +${2 * L}/+${L}.`,
    faint: (b, u, L) => { const f = b.randomFriend(u); if (f) b.buff(f, 2 * L, L, u); },
  },

  // ---------- Tier 2 ----------
  goblin: {
    name: 'Goblin Pickpocket', tribe: 'Goblin', tier: 2, atk: 2, hp: 3, sprite: 'goblin_new',
    text: L => `Start of turn: gain ${L} gold.`,
    startTurn: (s, _u, L) => s.gold(L),
  },
  dwarf: {
    name: 'Dwarf Shieldbearer', tribe: 'Dwarf', tier: 2, atk: 2, hp: 4, sprite: 'dwarf_new',
    text: L => `Start of battle: give the friend behind ${3 * L} ward.`,
    sob: (b, u, L) => { const f = b.behind(u); if (f) b.ward(f, 3 * L, u); },
  },
  ghoul: {
    name: 'Ghoul', tribe: 'Undead', tier: 2, atk: 3, hp: 2, sprite: 'ghoul',
    text: L => `Friend faints: gain +${L}/+${L}.`,
    friendFaint: (b, u, L) => b.buff(u, L, L),
  },
  wolf: {
    name: 'Grey Wolf', tribe: 'Beast', tier: 2, atk: 2, hp: 3, sprite: 'wolf',
    text: L => `Start of battle: gain +${L}/+${L} for each other Beast.`,
    sob: (b, u, L) => {
      const n = b.friends(u).filter(f => b.def(f).tribe === 'Beast').length;
      if (n) b.buff(u, n * L, n * L);
    },
  },
  inkcap: {
    name: 'Ink Cap', tribe: 'Fungus', tier: 2, atk: 2, hp: 2, sprite: 'hyperactive_ballistomycete',
    text: L => `End turn: give a random friend +${L} attack.`,
    endTurn: (s, u, L) => {
      const others = s.units().filter(f => f !== u);
      if (others.length) s.buff(others[Math.floor(s.rng() * others.length)], L, 0);
    },
  },
  elfmage: {
    name: 'Elf Battlemage', tribe: 'Arcane', tier: 2, atk: 3, hp: 3, sprite: 'deep_elf_mage',
    text: L => `Hurt: deal ${2 * L} damage to a random enemy.`,
    hurt: (b, u, L) => b.zapRandom(u, b.spell(u, 2 * L)),
  },

  // ---------- Tier 3 ----------
  hoarder: {
    name: 'Hobgoblin Hoarder', tribe: 'Goblin', tier: 3, atk: 3, hp: 5, sprite: 'hobgoblin_new',
    text: L => `Start of battle: gain +${L}/+${L} for every 2 unspent gold (up to ${HOARD_CAP}).`,
    sob: (b, u, L) => { const n = Math.floor(Math.min(HOARD_CAP, b.gold(u.side)) / 2); if (n) b.buff(u, n * L, n * L); },
  },
  necro: {
    name: 'Necromancer', tribe: 'Undead', tier: 3, atk: 2, hp: 4, sprite: 'necromancer_new',
    text: L => `Friend faints: raise a ${2 * L}/${2 * L} Skeleton in its place (${L}x per battle).`,
    friendFaint: (b, u, L, dead, idx) => {
      if (u.uses >= L || dead.kind === 'skel') return;
      if (b.summon(u.side, idx, 'skel', 2 * L, 2 * L)) u.uses++;
    },
  },
  troll: {
    name: 'Cave Troll', tribe: 'Beast', tier: 3, atk: 4, hp: 5, sprite: 'troll',
    text: L => `After attacking: regenerate ${2 * L} health.`,
    afterAttack: (b, u, L) => b.heal(u, 2 * L),
  },
  smith: {
    name: 'Dwarf Smith', tribe: 'Dwarf', tier: 3, atk: 3, hp: 3, sprite: 'deep_dwarf',
    text: L => `End turn: give the friend ahead +${L}/+${L}.`,
    endTurn: (s, u, L) => { const f = s.ahead(u); if (f) s.buff(f, L, L); },
  },
  deathcap: {
    name: 'Deathcap', tribe: 'Fungus', tier: 3, atk: 2, hp: 3, sprite: 'deathcap',
    text: L => `Faint: deal ${2 * L} damage to all enemies.`,
    faint: (b, u, L) => { for (const e of b.enemies(u)) b.damage(e, 2 * L, u, true); },
  },
  conjurer: {
    name: 'Elf Conjurer', tribe: 'Arcane', tier: 3, atk: 3, hp: 3, sprite: 'deep_elf_conjurer',
    text: L => `Friend ahead attacks: deal ${2 * L} damage to a random enemy.`,
    friendAheadAttacks: (b, u, L) => b.zapRandom(u, b.spell(u, 2 * L)),
  },

  // ---------- Tier 4 ----------
  fence: {
    name: 'Kobold Fence', tribe: 'Goblin', tier: 4, atk: 3, hp: 4, sprite: 'big_kobold_new',
    text: L => `Friend bought: give it +${L}/+${L}.`,
    friendBought: (s, _u, L, bought) => s.buff(bought, L, L),
  },
  lich: {
    name: 'Lich', tribe: 'Undead', tier: 4, atk: 3, hp: 5, sprite: 'lich',
    text: L => `Friend summoned: give it +${2 * L}/+${2 * L}.`,
    friendSummoned: (b, u, L, s) => b.buff(s, 2 * L, 2 * L, u),
  },
  bear: {
    name: 'Grizzly', tribe: 'Beast', tier: 4, atk: 5, hp: 6, sprite: 'grizzly_bear',
    text: L => `Friend ahead faints: gain +${2 * L}/+${2 * L}.`,
    friendFaint: (b, u, L, _d, _i, wasAhead) => { if (wasAhead) b.buff(u, 2 * L, 2 * L); },
  },
  berserker: {
    name: 'Dwarf Berserker', tribe: 'Dwarf', tier: 4, atk: 5, hp: 5, sprite: 'deep_dwarf_berserker',
    text: L => `Knock out an enemy: gain +${2 * L}/+${L}.`,
    kill: (b, u, L) => b.buff(u, 2 * L, L),
  },
  mushroom: {
    name: 'Wandering Mushroom', tribe: 'Fungus', tier: 4, atk: 3, hp: 5, sprite: 'wandering_mushroom_new',
    text: L => `End turn: give all other Fungus +${L} health and the friend ahead +${L} attack.`,
    endTurn: (s, u, L) => {
      for (const f of s.units()) if (f !== u && UNITS[f.kind].tribe === 'Fungus') s.buff(f, 0, L);
      const a = s.ahead(u);
      if (a) s.buff(a, L, 0);
    },
  },
  sorcerer: {
    name: 'Elf Sorcerer', tribe: 'Arcane', tier: 4, atk: 4, hp: 5, sprite: 'deep_elf_sorcerer',
    text: L => `Start of battle: deal ${3 * L} damage to the two front enemies.`,
    sob: (b, u, L) => {
      const dmg = b.spell(u, 3 * L);
      for (const e of b.enemies(u).slice(0, 2)) { b.zap(u, e); b.damage(e, dmg, u, true); }
    },
  },

  // ---------- Tier 5 ----------
  warlord: {
    name: 'Orc Warlord', tribe: 'Goblin', tier: 5, atk: 6, hp: 7, sprite: 'orc_warlord',
    text: L => `Start of battle: give all friends +${L}/+${L} for every 2 unspent gold (up to ${HOARD_CAP}).`,
    sob: (b, u, L) => {
      const n = Math.floor(Math.min(HOARD_CAP, b.gold(u.side)) / 2);
      if (n) for (const f of b.friends(u, true)) b.buff(f, n * L, n * L, u);
    },
  },
  deathknight: {
    name: 'Death Knight', tribe: 'Undead', tier: 5, atk: 6, hp: 6, sprite: 'death_knight',
    text: L => `Faint: rise again with ${3 * L} health (once).`,
    faint: (b, u, L, idx) => {
      if (u.revived) return;
      const s = b.summon(u.side, idx, 'deathknight', u.atk, 3 * L, u.lvl);
      if (s) s.revived = true;
    },
  },
  elephant: {
    name: 'Dire Elephant', tribe: 'Beast', tier: 5, atk: 4, hp: 10, sprite: 'elephant_dire_new',
    text: L => `Hurt: give all friends +${L} attack.`,
    hurt: (b, u, L) => { for (const f of b.friends(u)) b.buff(f, L, 0, u); },
  },
  artificer: {
    name: 'Dwarf Artificer', tribe: 'Dwarf', tier: 5, atk: 4, hp: 7, sprite: 'deep_dwarf_artificer',
    text: L => `Start of battle: give all friends ${2 * L} ward.`,
    sob: (b, u, L) => { for (const f of b.friends(u, true)) b.ward(f, 2 * L, u); },
  },
  archmage: {
    name: 'Archmage', tribe: 'Arcane', tier: 5, atk: 5, hp: 6, sprite: 'deep_elf_annihilator',
    text: L => `Start of battle: trigger every other friend's start-of-battle ability again. Arcane friends gain +${L}/+${L}.`,
    sob: (b, u, L) => {
      for (const f of b.friends(u)) {
        if (b.def(f).tribe === 'Arcane') b.buff(f, L, L, u);
        const d = b.def(f);
        if (f.kind === 'archmage' || !d.sob) continue;
        b.proc(f);
        d.sob(b, f, f.lvl);
      }
    },
  },
  treant: {
    name: 'Treant', tribe: 'Fungus', tier: 5, atk: 5, hp: 7, sprite: 'treant',
    text: L => `End turn: give all friends +${L} health.`,
    endTurn: (s, u, L) => { for (const f of s.units()) if (f !== u) s.buff(f, 0, L); },
  },

  // ---------- Tokens ----------
  bones: {
    name: 'Bones', tribe: 'Token', tier: 0, atk: 1, hp: 1, sprite: 'skeleton_small',
    text: () => 'A rattling pile of bones.',
  },
  skel: {
    name: 'Risen Skeleton', tribe: 'Token', tier: 0, atk: 2, hp: 2, sprite: 'skeleton_humanoid_large_new',
    text: () => 'Raised by a Necromancer.',
  },
};

export const UNIT_KINDS = Object.keys(UNITS).filter(k => UNITS[k].tier > 0);

export interface ItemDef {
  name: string;
  tier: number;
  sprite: string;
  held: boolean; // held items stay on the unit; others are used instantly
  text: string;
  use?: (s: ShopApi, target: Unit) => void;
}

export const ITEMS: Record<string, ItemDef> = {
  ration: {
    name: 'Bread Ration', tier: 1, sprite: 'bread_ration_new', held: false,
    text: 'Give a unit +1/+1.', use: (s, u) => s.buff(u, 1, 1),
  },
  bonecharm: {
    name: 'Bone Charm', tier: 1, sprite: 'bone_gray', held: true,
    text: 'Held. Faint: summon a 2/2 Bones.',
  },
  potion: {
    name: 'Healing Draught', tier: 2, sprite: 'ruby_new', held: false,
    text: 'Give a unit +3 health.', use: (s, u) => s.buff(u, 0, 3),
  },
  whetstone: {
    name: 'Whetstone', tier: 2, sprite: 'misc_stone_new', held: false,
    text: 'Give a unit +2 attack.', use: (s, u) => s.buff(u, 2, 0),
  },
  scroll: {
    name: 'Scroll of Learning', tier: 2, sprite: 'scroll-blue', held: false,
    text: 'Give a unit +1 experience and +1/+1.',
  },
  coin: {
    name: 'Lucky Coin', tier: 2, sprite: 'gold_pile_3', held: true,
    text: 'Held. Start of turn: gain 1 gold.',
  },
  amulet: {
    name: 'Ward Amulet', tier: 3, sprite: 'celtic_blue', held: true,
    text: 'Held. Start of battle: gain 5 ward.',
  },
  thorns: {
    name: 'Ring of Thorns', tier: 3, sprite: 'emerald', held: true,
    text: 'Held. Hurt: deal 3 damage to the front enemy.',
  },
  honeycomb: {
    name: 'Honeycomb', tier: 3, sprite: 'honeycomb_new', held: false,
    text: 'Give all friends +1/+1.',
    use: s => { for (const f of s.units()) s.buff(f, 1, 1); },
  },
  ambrosia: {
    name: 'Ambrosia', tier: 4, sprite: 'piece_of_ambrosia_new', held: false,
    text: 'Give a unit +4/+4.', use: (s, u) => s.buff(u, 4, 4),
  },
};

export const ITEM_KINDS = Object.keys(ITEMS);
export const ITEM_COST = 3;

// fits: only offered to a run it could matter to (a tribe relic needs that tribe on the team)
export interface RelicDef { name: string; sprite: string; text: string; fits?: (team: { kind: string; item: string }[]) => boolean }
const fields = (tribe: string) => (team: { kind: string }[]) => team.some(u => u.kind && UNITS[u.kind].tribe === tribe);

export const RELICS: Record<string, RelicDef> = {
  ledger: { name: "Merchant's Ledger", sprite: 'book_dog_eared', text: '+2 gold every turn.' },
  dice: { name: 'Loaded Dice', sprite: 'misc_deck_new', text: 'Your first reroll each turn is free and can show units one tier higher.' },
  banner: { name: 'War Banner', sprite: 'misc_horn', text: 'Start of battle: your front unit gets +2/+3.' },
  lantern: { name: 'Grave Lantern', sprite: 'misc_lantern', text: 'Summoned friends get +2/+2.',
    fits: t => fields('Undead')(t) || t.some(u => u.item === 'bonecharm') },
  spores: { name: 'Spore Pouch', sprite: 'misc_bottle', text: 'Fungus end-turn abilities trigger twice.', fits: fields('Fungus') },
  sixth: { name: 'Sixth Seat', sprite: 'chest', text: 'Your team has 6 slots.' },
  piggy: { name: 'Piggy Bank', sprite: 'gold_pile_10', text: 'Up to 5 unspent gold carries over to the next turn.' },
  tome: { name: 'Tome of Echoes', sprite: 'book_indigo', text: 'Arcane ability damage +2.', fits: fields('Arcane') },
  whet: { name: 'Sharpening Kit', sprite: 'misc_stone_old', text: 'Start of battle: all friends +1 attack.' },
  bag: { name: 'Bottomless Bag', sprite: 'misc_box', text: 'Items cost 1 less.' },
  heart: { name: 'Troll Heart', sprite: 'chunk', text: 'Gain 2 lives now. Rerolls cost 2 gold.' },
};

export const RELIC_KINDS = Object.keys(RELICS);
