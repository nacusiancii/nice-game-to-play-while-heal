// The den: your team, the shop, and all buying/selling/arranging.
import { REROLL_COST, UNIT_COST, WINS_TO_VICTORY, levelOf, sellValue, shopTier } from '../../server/src/game/core';
import { ITEMS, RELICS, UNITS } from '../../server/src/game/data';
import { itemCost } from '../../server/src/game/shop';
import type { Run } from './module_bindings/types';
import { api, store } from './net';
import { floatAt, h, img, toast } from './dom';
import { TRIBE_BLURB, hearts, itemEl, itemInfo, relicInfo, tribeTag, unitEl, unitInfo } from './pieces';
import { isMuted, sfx, toggleMute } from './sfx';
import { cycleSpeed, getSpeed, speedLabel } from './battleView';

type Sel = { from: 'shop' | 'team'; idx: number } | null;

export interface ShopHooks { onMenu: () => void; onFight: () => void }

export class ShopView {
  sel: Sel = null;
  hoverInfo: (() => (Node | string)[]) | null = null;
  root: HTMLElement;
  infoBox!: HTMLElement;
  prev: Run | undefined;
  dragging = false;
  pendingRender = false;
  fighting = false;
  // Costly actions ask twice: the first press arms them, a second one within a few seconds does it.
  armed: { key: string; until: number } | null = null;

  constructor(root: HTMLElement, private hooks: ShopHooks) {
    this.root = root;
  }

  get run() { return store.run!; }

  // ---------- rendering ----------
  render() {
    if (this.dragging) { this.pendingRender = true; return; }
    const r = this.run;
    if (!r) return;
    const cost = itemCost(r);
    const top = h('div', { class: 'topbar' },
      h('div', { class: 'title' }, 'Rabble Below'),
      h('div', { class: 'stat', title: 'Lives' }, hearts(r.lives)),
      h('div', { class: 'stat', title: 'Trophies' }, `🏆 ${r.wins}/${WINS_TO_VICTORY}`),
      h('div', { class: 'stat', title: 'Round' }, `Round ${r.round}`),
      h('div', { class: 'stat gold-stat', title: 'Gold' }, img('gold_pile_3', 'ico'), h('span', { class: 'goldnum', style: 'color:var(--gold)' }, r.gold)),
      h('div', { class: 'spacer' }),
      h('div', { class: 'relics' }, r.relics.map(k => {
        const el = h('div', { class: 'relic' }, img(RELICS[k].sprite));
        this.hoverable(el, () => relicInfo(k));
        return el;
      })),
      h('button', { class: 'iconbtn', title: 'Battle speed (T)', onclick: (e: Event) => { (e.currentTarget as HTMLElement).textContent = `⏩ ${speedLabel(cycleSpeed())}`; } }, `⏩ ${speedLabel(getSpeed())}`),
      h('button', { class: 'iconbtn', title: 'Sound', onclick: (e: Event) => { const m = toggleMute(); (e.currentTarget as HTMLElement).textContent = m ? '🔇' : '🔊'; } }, isMuted() ? '🔇' : '🔊'),
      h('button', { class: 'iconbtn', onclick: () => this.hooks.onMenu() }, 'Menu'));

    // team: index 0 is the front, shown on the right
    const teamRow = h('div', { class: 'team' });
    for (let i = r.team.length - 1; i >= 0; i--) teamRow.append(this.teamSlot(i));
    teamRow.append(h('div', { class: 'front-arrow', title: 'Front' }, '➜'));
    const counts = new Map<string, number>();
    for (const u of r.team) if (u.kind) counts.set(UNITS[u.kind].tribe, (counts.get(UNITS[u.kind].tribe) ?? 0) + 1);
    const tribes = h('div', { class: 'tribes' }, [...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
      const el = h('span', { class: 'tribe-chip' }, tribeTag(t), `×${n}`);
      this.hoverable(el, () => [h('div', null, h('h3', null, t), h('div', { class: 'txt' }, TRIBE_BLURB[t] ?? ''))]);
      return el;
    }));

    const units = r.shop.map((s, i) => ({ s, i })).filter(x => !x.s.isItem);
    const items = r.shop.map((s, i) => ({ s, i })).filter(x => x.s.isItem);
    const shopRow = h('div', { class: 'shoprow' },
      h('div', { class: 'shopgroup' }, units.map(x => this.shopSlot(x.i, UNIT_COST))),
      items.length ? h('div', { class: 'divider' }) : null,
      h('div', { class: 'shopgroup' }, items.map(x => this.shopSlot(x.i, cost))));

    const selShop = this.sel?.from === 'shop' ? r.shop[this.sel.idx] : undefined;
    const selTeam = this.sel?.from === 'team' ? r.team[this.sel.idx] : undefined;
    const freeReroll = r.rerolls === 0 && r.relics.includes('dice');
    const sure = selTeam?.kind && this.isArmed(`sell:${this.sel!.idx}`);
    const sellBtn = h('button', {
      class: `btn sell${sure ? ' sure' : ''}`, 'data-drop': 'sell', disabled: !selTeam?.kind && !this.dragging,
      onclick: () => this.sellSelected(),
    }, selTeam?.kind ? `${sure ? 'Really sell' : 'Sell'} ${UNITS[selTeam.kind].name} +${sellValue(selTeam)}g${sure ? '?' : ''}` : 'Sell', h('span', { class: 'kbd' }, 'S'));
    const controls = h('div', { class: 'controls' },
      h('button', { class: 'btn gold', onclick: () => this.reroll(), disabled: !freeReroll && r.gold < REROLL_COST },
        freeReroll ? 'Reroll (free)' : `Reroll ${REROLL_COST}g`, h('span', { class: 'kbd' }, 'R')),
      h('button', { class: 'btn ice', onclick: () => this.freezeSelected(), disabled: !selShop?.kind },
        selShop?.frozen ? 'Unfreeze' : 'Freeze', h('span', { class: 'kbd' }, 'F')),
      sellBtn,
      h('button', { class: 'btn primary', onclick: () => this.fight(), disabled: this.fighting || r.status !== 'shop' },
        this.fighting ? 'Marching…' : 'Fight! ⚔', h('span', { class: 'kbd' }, 'Space')));

    this.infoBox = h('div', { class: 'info' });
    this.fillInfo();

    const board = h('div', { class: 'board' },
      h('div', { class: 'label' }, h('b', null, store.player?.name ?? 'Your rabble'), '  ·  back ← → front'),
      teamRow,
      tribes,
      h('div', { class: 'label' }, `The Black Market · tier ${shopTier(r.round)}  ·  `, h('b', null, `units ${UNIT_COST}g · items ${cost}g`)),
      shopRow,
      controls);

    const den = h('div', { class: 'den' },
      h('div', { class: 'wall' }, h('div', { class: 'torch' }), h('div', { class: 'torch' }), h('div', { class: 'torch' }), h('div', { class: 'torch' })),
      board, this.infoBox);
    this.root.replaceChildren(top, den);

    if (r.relicChoices.length && r.status === 'shop') this.root.append(this.relicModal());
  }

  teamSlot(i: number) {
    const r = this.run;
    const u = r.team[i];
    const selected = this.sel?.from === 'team' && this.sel.idx === i;
    const slot = h('div', { class: `slot${selected ? ' selected' : ''}`, 'data-drop': `team:${i}` });
    if (u.kind) {
      const el = unitEl({ ...u }, true);
      slot.append(el);
      this.hoverable(slot, () => unitInfo(u.kind, u.xp, `sells for ${sellValue(u)}g`));
      const held = el.querySelector<HTMLElement>('.held');
      if (held && u.item) this.hoverable(held, () => itemInfo(u.item, `held by ${UNITS[u.kind].name}, can't be sold on its own`));
      this.draggable(el, { from: 'team', idx: i }, UNITS[u.kind].sprite);
    }
    slot.addEventListener('click', () => this.clickTeam(i));
    return slot;
  }

  shopSlot(i: number, price: number) {
    const s = this.run.shop[i];
    const selected = this.sel?.from === 'shop' && this.sel.idx === i;
    const slot = h('div', { class: `slot${selected ? ' selected' : ''}` });
    if (!s.kind) { slot.classList.add('empty'); return slot; }
    slot.append(h('div', { class: 'price' }, img('gold_pile_3'), price));
    if (s.isItem) {
      const el = itemEl(s.kind);
      slot.append(el);
      this.hoverable(slot, () => itemInfo(s.kind, `${price} gold`));
      this.draggable(el, { from: 'shop', idx: i }, ITEMS[s.kind].sprite);
    } else {
      const el = unitEl({ kind: s.kind, atk: s.atk, hp: s.hp });
      slot.append(el);
      this.hoverable(slot, () => unitInfo(s.kind, 0, `${price} gold`));
      this.draggable(el, { from: 'shop', idx: i }, UNITS[s.kind].sprite);
    }
    if (s.frozen) slot.append(h('div', { class: 'frozen-tag' }));
    slot.addEventListener('click', () => this.clickShop(i));
    slot.addEventListener('dblclick', () => this.quickBuy(i));
    return slot;
  }

  hoverTimer = 0;
  hoverable(el: HTMLElement, info: () => (Node | string)[]) {
    el.addEventListener('mouseenter', ev => {
      ev.stopPropagation();
      clearTimeout(this.hoverTimer);
      this.hoverInfo = info;
      this.fillInfo();
    });
    el.addEventListener('mouseleave', () => {
      // small delay so moving between units doesn't flash the hint text
      clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => {
        if (this.hoverInfo === info) { this.hoverInfo = null; this.fillInfo(); }
      }, 150);
    });
  }

  fillInfo() {
    if (!this.infoBox) return;
    const r = this.run;
    let content: (Node | string)[] | null = this.hoverInfo?.() ?? null;
    if (!content && this.sel) {
      if (this.sel.from === 'shop') {
        const s = r.shop[this.sel.idx];
        if (s?.kind) content = s.isItem ? itemInfo(s.kind) : unitInfo(s.kind, 0);
      } else {
        const u = r.team[this.sel.idx];
        if (u?.kind) content = unitInfo(u.kind, u.xp);
      }
    }
    if (!content) {
      const tip = this.sel?.from === 'shop'
        ? 'Now click a slot in your rabble to place it there (same kind = merge and level up).'
        : this.sel?.from === 'team'
          ? 'Click another slot to move or merge, or press S to sell.'
          : 'Drag units from the market into your rabble, or click one then click a slot. Double-click to buy fast. Three copies of the same unit level it up. The unit on the right fights first.';
      content = [h('div', { class: 'hint' }, tip)];
    }
    this.infoBox.replaceChildren(...content);
  }

  relicModal() {
    const r = this.run;
    return h('div', { class: 'overlay' },
      h('div', { class: 'modal' },
        h('h2', null, 'A relic glints in the dark'),
        h('p', null, 'Choose one. It stays with you for the rest of the run.'),
        h('div', { class: 'choices' }, r.relicChoices.map((k, i) =>
          h('div', { class: 'choice', onclick: () => { sfx.levelUp(); api.relic(i); } },
            img(RELICS[k].sprite), h('h3', null, RELICS[k].name), h('div', null, RELICS[k].text))))));
  }

  // ---------- interactions ----------
  setSel(s: Sel) { this.sel = s; this.armed = null; this.render(); }

  isArmed(key: string) { return !!this.armed && this.armed.key === key && Date.now() < this.armed.until; }
  // true if the action may go ahead now; otherwise arms it and says why
  confirm(key: string, why: string) {
    if (this.isArmed(key)) { this.armed = null; return true; }
    this.armed = { key, until: Date.now() + 4000 };
    sfx.error();
    toast(why);
    setTimeout(() => { if (this.armed?.key === key && Date.now() >= this.armed.until) { this.armed = null; this.render(); } }, 4100);
    this.render();
    return false;
  }

  clickShop(i: number) {
    sfx.click();
    if (this.sel?.from === 'shop' && this.sel.idx === i) return this.setSel(null);
    this.setSel({ from: 'shop', idx: i });
  }

  clickTeam(i: number) {
    const r = this.run;
    const sel = this.sel;
    if (sel?.from === 'shop') { this.sel = null; this.doBuy(sel.idx, i); return; }
    if (sel?.from === 'team') {
      if (sel.idx === i) return this.setSel(null);
      this.sel = null;
      this.doMove(sel.idx, i);
      return;
    }
    if (r.team[i].kind) { sfx.click(); this.setSel({ from: 'team', idx: i }); }
  }

  quickBuy(i: number) {
    const r = this.run;
    const s = r.shop[i];
    if (!s?.kind) return;
    this.sel = null;
    if (s.isItem) { toast('Drag items onto a unit.'); this.render(); return; }
    let target = r.team.findIndex(u => u.kind === s.kind && u.xp < 5);
    if (target < 0) target = r.team.findIndex(u => !u.kind);
    if (target < 0) { sfx.error(); toast('Your rabble is full. Sell someone first.', true); this.render(); return; }
    this.doBuy(i, target);
  }

  doBuy(shopIdx: number, teamIdx: number) {
    const r = this.run;
    const s = r.shop[shopIdx];
    const u = r.team[teamIdx];
    if (!s?.kind) return this.render();
    const price = s.isItem ? itemCost(r) : UNIT_COST;
    if (r.gold < price) { sfx.error(); toast('Not enough gold.', true); return this.render(); }
    if (s.isItem && !u.kind) { sfx.error(); toast('Drop items onto a unit.', true); return this.render(); }
    if (!s.isItem && u.kind && u.kind !== s.kind) { sfx.error(); toast('That slot is taken. Drop on an empty slot or the same kind.', true); return this.render(); }
    if (s.isItem && ITEMS[s.kind].held && u.item && u.item !== s.kind &&
      !this.confirm(`item:${shopIdx}:${teamIdx}`, `${UNITS[u.kind].name} already holds ${ITEMS[u.item].name}. Do that again to swap it out.`)) return;
    if (!s.isItem && u.kind === s.kind) sfx.merge(); else sfx.buy();
    api.buy(shopIdx, teamIdx);
    this.render();
  }

  doMove(from: number, to: number) {
    const r = this.run;
    const a = r.team[from], b = r.team[to];
    if (a.kind && b.kind === a.kind) sfx.merge(); else sfx.click();
    api.move(from, to);
    this.render();
  }

  sellSelected() {
    if (this.sel?.from !== 'team') return;
    const i = this.sel.idx;
    const u = this.run.team[i];
    if (!u.kind) return;
    // a levelled unit or one holding an item is worth a second press (dragging to Sell is deliberate enough)
    if ((levelOf(u.xp) > 1 || u.item) && !this.confirm(`sell:${i}`,
      `Sell ${UNITS[u.kind].name}${u.item ? ` and its ${ITEMS[u.item].name}` : ''} for ${sellValue(u)}g? Press Sell again.`)) return;
    this.sel = null;
    this.sellAt(i);
  }

  sellAt(i: number) {
    const u = this.run.team[i];
    sfx.sell();
    floatAt(this.root.querySelector('.goldnum'), `+${sellValue(u) + (u.kind === 'kobold' ? levelOf(u.xp) : 0)}g`, 'gold');
    api.sell(i);
    this.render();
  }

  reroll() {
    const r = this.run;
    if (r.gold < REROLL_COST && !(r.rerolls === 0 && r.relics.includes('dice'))) { sfx.error(); return; }
    sfx.reroll();
    if (this.sel?.from === 'shop') this.sel = null;
    api.reroll();
  }

  freezeSelected() {
    if (this.sel?.from !== 'shop') return;
    sfx.freeze();
    api.freeze(this.sel.idx);
  }

  fight() {
    const r = this.run;
    if (this.fighting) return;
    if (r.relicChoices.length) return;
    if (!r.team.some(u => u.kind)) { sfx.error(); toast('Recruit someone first!', true); return; }
    this.fighting = true;
    this.sel = null;
    this.render();
    this.hooks.onFight();
  }

  onKey(ev: KeyboardEvent) {
    if (ev.target instanceof HTMLInputElement) return;
    const k = ev.key.toLowerCase();
    if (k === 'r') this.reroll();
    else if (k === 'f') this.freezeSelected();
    else if (k === 's') this.sellSelected();
    else if (k === ' ' || k === 'enter') { ev.preventDefault(); this.fight(); }
    else if (k === 'escape') this.setSel(null);
    else if (k === 't') { const v = cycleSpeed(); toast(`Battle speed: ${speedLabel(v)}`); this.render(); }
    else if (/^[1-9]$/.test(k)) {
      // number keys pick shop slots
      const i = Number(k) - 1;
      if (this.run.shop[i]?.kind) this.clickShop(i);
    }
  }

  // ---------- drag & drop ----------
  draggable(el: HTMLElement, src: { from: 'shop' | 'team'; idx: number }, sprite: string) {
    el.addEventListener('pointerdown', (down: PointerEvent) => {
      if (down.button !== 0) return;
      const sx = down.clientX, sy = down.clientY;
      let ghost: HTMLElement | null = null;
      let over: HTMLElement | null = null;
      const move = (e: PointerEvent) => {
        if (!ghost) {
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
          this.dragging = true;
          this.sel = null;
          ghost = h('div', { class: 'drag-ghost' }, img(sprite));
          document.body.append(ghost);
          el.classList.add('dragging-src');
          this.markDropTargets(src);
        }
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-drop]') as HTMLElement | null;
        if (t !== over) {
          over?.classList.remove('hovered');
          over = t;
          over?.classList.add('hovered');
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!ghost) return; // it was a click
        ghost.remove();
        el.classList.remove('dragging-src');
        this.dragging = false;
        this.pendingRender = false;
        const target = over?.dataset.drop;
        // swallow the click that follows a drag
        const swallow = (e: Event) => { e.stopPropagation(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
        if (!target) return this.render();
        if (target === 'sell') {
          if (src.from === 'team') this.sellAt(src.idx); else this.render();
          return;
        }
        const ti = Number(target.split(':')[1]);
        if (src.from === 'shop') this.doBuy(src.idx, ti);
        else if (src.idx !== ti) this.doMove(src.idx, ti);
        else this.render();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  markDropTargets(src: { from: 'shop' | 'team'; idx: number }) {
    const r = this.run;
    const kind = src.from === 'shop' ? r.shop[src.idx].kind : r.team[src.idx].kind;
    const isItem = src.from === 'shop' && r.shop[src.idx].isItem;
    this.root.querySelectorAll<HTMLElement>('[data-drop^="team:"]').forEach(el => {
      const i = Number(el.dataset.drop!.split(':')[1]);
      const u = r.team[i];
      if (isItem) { if (u.kind) el.classList.add('drop-ok'); return; }
      if (src.from === 'team' && i === src.idx) return;
      if (u.kind === kind && u.xp < 5) el.classList.add('drop-merge');
      else if (!u.kind || src.from === 'team') el.classList.add('drop-ok');
    });
    if (src.from === 'team') {
      const sb = this.root.querySelector<HTMLButtonElement>('[data-drop="sell"]');
      if (sb) { sb.disabled = false; sb.classList.add('drop-ok'); }
    }
  }

  // ---------- feedback from server updates ----------
  diff(prev: Run | undefined, next: Run) {
    if (!prev || prev.round !== next.round) return;
    const byUid = new Map(prev.team.filter(u => u.kind).map(u => [u.uid, u]));
    next.team.forEach(u => {
      if (!u.kind) return;
      const el = this.root.querySelector(`.unit[data-uid="${u.uid}"]`);
      const old = byUid.get(u.uid);
      if (!old) { el?.classList.add('pop'); return; }
      const da = u.atk - old.atk, dh = u.hp - old.hp;
      if (da || dh) floatAt(el, [da ? `${da > 0 ? '+' : ''}${da}⚔` : '', dh ? `${dh > 0 ? '+' : ''}${dh}♥` : ''].filter(Boolean).join(' '), 'good');
      if (levelOf(u.xp) > levelOf(old.xp)) {
        el?.parentElement?.classList.add('levelup');
        floatAt(el, 'LEVEL UP!', 'gold big', 250);
        sfx.levelUp();
        toast(`Level up! A tier ${Math.min(5, Math.ceil(next.round / 2) + 1)} unit joined the market.`);
      }
    });
  }
}
