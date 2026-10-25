// Injected into every page before the game's own scripts. Collects what the game says it is doing
// (client/src/events.ts sends every game event to window.__feel(kind, data)), summarises DOM churn, draws a cursor
// so frames show where the pointer is, and finds elements for scenario clicks.
(() => {
  if (window.__feel) return;
  // scenes are compiled by tsx, which wraps named functions in __name(); functions sent to the page need it too
  window.__name = window.__name || ((f) => f);
  const log = [];
  window.__feel = (kind, data) => { log.push({ t: performance.now(), kind, data }); };

  // ---- DOM churn: how many nodes were added/removed, and which containers were rebuilt ----
  let mut = { added: 0, removed: 0, imgs: 0, rebuilt: new Set() };
  const describe = el => {
    if (!el || el.nodeType !== 1) return '?';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };
  const mine = n => n.nodeType === 1 && n.id?.startsWith('__feel_cursor');
  const mo = new MutationObserver(recs => {
    for (const r of recs) {
      let add = 0, rem = 0;
      for (const n of r.addedNodes) {
        if (mine(n)) continue;
        add++;
        if (n.nodeType === 1) mut.imgs += (n.tagName === 'IMG' ? 1 : 0) + n.querySelectorAll('img').length;
      }
      for (const n of r.removedNodes) if (!mine(n)) rem++;
      mut.added += add;
      mut.removed += rem;
      if (add && rem) mut.rebuilt.add(describe(r.target));
    }
  });
  mo.observe(document, { childList: true, subtree: true });

  // Regions that move on their own forever (torches, idle bobbing) and the fake cursor. Analysis masks
  // them, so "motion" means the game reacting, not the scenery breathing.
  let lastAmb = '';
  const ambient = () => {
    const rects = [];
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming?.();
      const el = a.effect?.target;
      if (!t || t.iterations !== Infinity || a.playState !== 'running' || !el?.getBoundingClientRect) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) rects.push([Math.floor(r.left), Math.floor(r.top), Math.ceil(r.width), Math.ceil(r.height)]);
    }
    if (cursor?.isConnected && cursor.style.display !== 'none') {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(cursor.style.transform);
      if (m) rects.push([Math.floor(+m[1] - 18), Math.floor(+m[2] - 18), 40, 44]);
    }
    const key = JSON.stringify(rects);
    if (key === lastAmb) return undefined;
    lastAmb = key;
    return rects;
  };

  window.__feelDrain = () => {
    const out = {
      now: performance.now(),
      amb: ambient(),
      log: log.splice(0),
      mut: mut.added || mut.removed ? { added: mut.added, removed: mut.removed, imgs: mut.imgs, rebuilt: [...mut.rebuilt] } : null,
    };
    mut = { added: 0, removed: 0, imgs: 0, rebuilt: new Set() };
    return out;
  };

  // ---- a visible cursor (headless screenshots have none) ----
  let cursor = null;
  const ensureCursor = () => {
    if (cursor?.isConnected || !document.body) return cursor;
    cursor = document.createElement('div');
    cursor.id = '__feel_cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    cursor.innerHTML = '<svg width="18" height="24" viewBox="0 0 18 24" style="position:absolute;left:-1px;top:-1px;filter:drop-shadow(0 1px 1px #0008)">'
      + '<path d="M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.6 L9 13.4 L15.5 13.4 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>'
      + '<div class="ring" style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #ff3df0;opacity:0;transition:opacity .15s"></div>';
    document.body.append(cursor);
    return cursor;
  };
  window.__feelCursor = (x, y, down) => {
    const c = ensureCursor();
    if (!c) return;
    c.style.transform = `translate(${x}px,${y}px)`;
    if (down !== undefined) c.querySelector('.ring').style.opacity = down ? '1' : '0';
  };
  // a one-pixel, invisible repaint, so the next frame has something to screenshot
  let poke = null;
  window.__feelPoke = () => {
    if (!document.body) return;
    if (!poke?.isConnected) {
      poke = document.createElement('div');
      poke.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647;background:rgba(0,0,0,0.001)';
      poke.id = '__feel_cursor_poke';
      document.body.append(poke);
    }
    poke.style.background = poke.style.background.includes('0.001') ? 'rgba(0,0,0,0.002)' : 'rgba(0,0,0,0.001)';
  };
  window.__feelHideCursor = () => { if (cursor) cursor.style.display = 'none'; };

  // ---- element lookup for scenarios ----
  // target: a CSS selector, or "text=Fight" (smallest visible element whose text contains it).
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  window.__feelFind = (target, nth = 0) => {
    let els;
    if (target.startsWith('text=')) {
      const want = target.slice(5).trim().toLowerCase();
      const all = [...document.querySelectorAll('body *')].filter(el => !el.closest('#__feel_cursor') && (el.textContent ?? '').toLowerCase().includes(want));
      // keep only the innermost matches, but prefer the clickable ancestor (button, [onclick]-ish)
      els = all.filter(el => !all.some(o => o !== el && el.contains(o)))
        .map(el => el.closest('button, a, input, .slot, .choice') ?? el);
      els = [...new Set(els)];
    } else {
      els = [...document.querySelectorAll(target)];
    }
    els = els.filter(visible);
    const el = els[nth];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const label = (el.innerText || el.getAttribute('title') || el.className || el.tagName).toString().trim().split('\n')[0].slice(0, 40);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top, label, count: els.length };
  };
})();
