// Deterministic auto-battle. Produces frames the client replays.
import { levelOf, type Rng, type Unit } from './core';
import { UNITS, type UnitDef } from './data';

export interface BU {
  uid: number;
  kind: string;
  atk: number;
  hp: number;
  ward: number;
  lvl: number;
  item: string;
  side: 0 | 1;
  dead: boolean;
  uses: number;
  revived: boolean;
  killer: BU | null;
}

export interface Side {
  team: Unit[];
  relics: string[];
  gold: number; // unspent gold at battle time
}

// Compact snapshot of a unit for replay.
export interface Snap { u: number; k: string; a: number; h: number; w: number; l: number; i: string }
export type Fx =
  | { t: 'atk'; u: number }
  | { t: 'dmg'; u: number; n: number }
  | { t: 'buff'; u: number; a: number; h: number }
  | { t: 'ward'; u: number; n: number }
  | { t: 'heal'; u: number; n: number }
  | { t: 'die'; u: number }
  | { t: 'sum'; u: number }
  | { t: 'proc'; u: number }
  | { t: 'zap'; f: number; u: number }
  | { t: 'note'; s: string };
export interface Frame { a: Snap[]; b: Snap[]; fx: Fx[] }

export interface BattleResult { winner: 0 | 1 | -1; frames: Frame[] }

const CAP = 99;
const MAX_TEAM = 6;

export class Battle {
  teams: [BU[], BU[]] = [[], []];
  frames: Frame[] = [];
  fx: Fx[] = [];
  queue: (() => void)[] = [];
  nextUid = 100000;

  constructor(public rng: Rng, public sides: [Side, Side]) {
    sides.forEach((s, side) => {
      for (const u of s.team) {
        if (!u.kind) continue;
        this.teams[side].push({
          uid: u.uid + side * 50000, kind: u.kind, atk: u.atk, hp: u.hp, ward: 0, lvl: levelOf(u.xp),
          item: u.item, side: side as 0 | 1, dead: false, uses: 0, revived: false, killer: null,
        });
      }
    });
  }

  // ---------- queries ----------
  def(u: BU): UnitDef { return UNITS[u.kind]; }
  relic(side: number, id: string) { return this.sides[side].relics.includes(id); }
  gold(side: number) { return this.sides[side].gold; }
  // living = not removed and not at 0 hp (units at 0 hp are waiting to faint)
  alive(side: number) { return this.teams[side].filter(u => !u.dead && u.hp > 0); }
  friends(u: BU, self = false) { return this.alive(u.side).filter(f => self || f !== u); }
  enemies(u: BU) { return this.alive(1 - u.side); }
  front(side: number) { return this.alive(side)[0]; }
  ahead(u: BU) { const t = this.alive(u.side); return t[t.indexOf(u) - 1]; }
  behind(u: BU) { const t = this.alive(u.side); const i = t.indexOf(u); return i < 0 ? undefined : t[i + 1]; }
  randomFriend(u: BU) { const f = this.friends(u); return f.length ? f[Math.floor(this.rng() * f.length)] : undefined; }
  randomEnemy(u: BU) { const e = this.enemies(u); return e.length ? e[Math.floor(this.rng() * e.length)] : undefined; }
  spell(u: BU, n: number) { return n + (this.def(u).tribe === 'Arcane' && this.relic(u.side, 'tome') ? 2 : 0); }

  // ---------- effects ----------
  proc(u: BU) { this.fx.push({ t: 'proc', u: u.uid }); }
  zap(from: BU, to: BU) { this.fx.push({ t: 'zap', f: from.uid, u: to.uid }); }
  zapRandom(from: BU, n: number) {
    const e = this.randomEnemy(from);
    if (!e) return;
    this.zap(from, e);
    this.damage(e, n, from, true);
  }

  buff(u: BU, a: number, h: number, _src?: BU) {
    if (u.dead || (!a && !h)) return;
    u.atk = Math.min(CAP, u.atk + a);
    u.hp = Math.min(CAP, u.hp + h);
    this.fx.push({ t: 'buff', u: u.uid, a, h });
  }
  ward(u: BU, n: number, _src?: BU) {
    if (u.dead || n <= 0) return;
    u.ward = Math.min(CAP, u.ward + n);
    this.fx.push({ t: 'ward', u: u.uid, n });
  }
  heal(u: BU, n: number) {
    if (u.dead || n <= 0) return;
    u.hp = Math.min(CAP, u.hp + n);
    this.fx.push({ t: 'heal', u: u.uid, n });
  }

  damage(t: BU, n: number, src: BU | null, _ability: boolean) {
    if (t.dead || t.hp <= 0 || n <= 0) return;
    const absorbed = Math.min(t.ward, n);
    t.ward -= absorbed;
    const lost = n - absorbed;
    t.hp -= lost;
    this.fx.push({ t: 'dmg', u: t.uid, n });
    if (t.hp <= 0) { t.killer = src; return; }
    if (lost <= 0) return;
    const d = this.def(t);
    if (d.hurt) this.queue.push(() => { if (!t.dead && t.hp > 0) { this.proc(t); d.hurt!(this, t, t.lvl); } });
    if (t.item === 'thorns') this.queue.push(() => {
      const e = this.front(1 - t.side);
      if (!t.dead && e) { this.zap(t, e); this.damage(e, 3, t, true); }
    });
  }

  summon(side: number, idx: number, kind: string, atk: number, hp: number, lvl = 1): BU | null {
    const team = this.teams[side];
    if (team.filter(u => !u.dead).length >= Math.min(MAX_TEAM, 5 + (this.relic(side, 'sixth') ? 1 : 0))) return null;
    const s: BU = {
      uid: this.nextUid++, kind, atk, hp, ward: 0, lvl, item: '', side: side as 0 | 1,
      dead: false, uses: 0, revived: false, killer: null,
    };
    // place at the position of the idx-th living unit
    const living = team.filter(u => !u.dead);
    const anchor = living[idx];
    team.splice(anchor ? team.indexOf(anchor) : team.length, 0, s);
    this.fx.push({ t: 'sum', u: s.uid });
    if (this.relic(side, 'lantern')) this.buff(s, 2, 2);
    for (const f of this.friends(s)) {
      const d = this.def(f);
      if (d.friendSummoned) { this.proc(f); d.friendSummoned(this, f, f.lvl, s); }
    }
    return s;
  }

  // ---------- flow ----------
  snap(side: number): Snap[] {
    return this.teams[side].map(u => ({ u: u.uid, k: u.kind, a: u.atk, h: Math.max(0, u.hp), w: u.ward, l: u.lvl, i: u.item }));
  }
  beat(force = false) {
    if (!force && !this.fx.length) return;
    this.frames.push({ a: this.snap(0), b: this.snap(1), fx: this.fx });
    this.fx = [];
  }

  // Resolve queued triggers and faints until stable.
  settle() {
    for (let guard = 0; guard < 300; guard++) {
      if (this.queue.length) { this.queue.shift()!(); this.beat(); continue; }
      const dying = [...this.teams[0], ...this.teams[1]].filter(u => !u.dead && u.hp <= 0);
      if (!dying.length) break;
      for (const d of dying) this.fx.push({ t: 'die', u: d.uid });
      this.beat();
      // idx = position among the survivors, so summons land where the unit stood
      const info = dying.map(d => {
        const team = this.teams[d.side];
        const i = team.indexOf(d);
        const ok = (x: BU) => !x.dead && x.hp > 0;
        return { d, idx: team.slice(0, i).filter(ok).length, behind: team.slice(i + 1).find(ok) };
      });
      for (const { d } of info) { d.dead = true; this.teams[d.side].splice(this.teams[d.side].indexOf(d), 1); }
      this.beat(true);
      for (const { d, idx, behind } of info) {
        const def = this.def(d);
        if (def.faint) { def.faint(this, d, d.lvl, idx); }
        if (d.item === 'bonecharm') this.summon(d.side, idx, 'bones', 2, 2);
        for (const f of this.alive(d.side)) {
          const fd = this.def(f);
          if (fd.friendFaint) {
            const before = this.fx.length;
            fd.friendFaint(this, f, f.lvl, d, idx, f === behind);
            if (this.fx.length > before) this.fx.splice(before, 0, { t: 'proc', u: f.uid });
          }
        }
        const k = d.killer;
        if (k && !k.dead && k.hp > 0 && k.side !== d.side) {
          const kd = this.def(k);
          if (kd.kill) { this.proc(k); kd.kill(this, k, k.lvl, d); }
        }
        this.beat();
      }
    }
  }

  byAttack(units: BU[]) {
    return units
      .map(u => ({ u, r: this.rng() }))
      .sort((x, y) => y.u.atk - x.u.atk || x.r - y.r)
      .map(x => x.u);
  }

  run(): BattleResult {
    this.beat(true);
    // relics
    for (const side of [0, 1]) {
      const f = this.front(side);
      if (f && this.relic(side, 'banner')) this.buff(f, 2, 3);
      if (this.relic(side, 'whet')) for (const u of this.alive(side)) this.buff(u, 1, 0);
    }
    this.beat();
    // start of battle
    this.fx.push({ t: 'note', s: 'Start of battle' });
    for (const u of this.byAttack([...this.alive(0), ...this.alive(1)])) {
      if (u.dead || u.hp <= 0) continue;
      if (u.item === 'amulet') this.ward(u, 5);
      const d = this.def(u);
      if (d.sob) { this.proc(u); d.sob(this, u, u.lvl); }
      this.beat();
      this.settle();
    }
    this.beat();

    for (let turn = 0; turn < 80; turn++) {
      if (!this.front(0) || !this.front(1)) break;
      for (const u of this.byAttack([this.front(0), this.front(1)])) {
        const d = this.def(u);
        if (!u.dead && u.hp > 0 && d.beforeAttack) { this.proc(u); d.beforeAttack(this, u, u.lvl); this.beat(); this.settle(); }
      }
      const a = this.front(0), b = this.front(1);
      if (!a || !b) break;
      this.fx.push({ t: 'atk', u: a.uid }, { t: 'atk', u: b.uid });
      const da = a.atk, db = b.atk;
      this.damage(b, da, a, false);
      this.damage(a, db, b, false);
      this.beat();
      for (const u of [a, b]) {
        const behind = this.behind(u);
        if (behind) {
          const bd = this.def(behind);
          if (bd.friendAheadAttacks) this.queue.push(() => {
            if (!behind.dead && behind.hp > 0) { this.proc(behind); bd.friendAheadAttacks!(this, behind, behind.lvl); }
          });
        }
        const d = this.def(u);
        if (d.afterAttack) this.queue.push(() => {
          if (!u.dead && u.hp > 0) { this.proc(u); d.afterAttack!(this, u, u.lvl); }
        });
      }
      this.settle();
    }
    const l0 = this.alive(0).length, l1 = this.alive(1).length;
    const winner: 0 | 1 | -1 = l0 && !l1 ? 0 : l1 && !l0 ? 1 : -1;
    this.fx.push({ t: 'note', s: winner === 0 ? 'Victory' : winner === 1 ? 'Defeat' : 'Draw' });
    this.beat(true);
    return { winner, frames: this.frames };
  }
}

export function fight(rng: Rng, a: Side, b: Side): BattleResult {
  return new Battle(rng, [a, b]).run();
}
