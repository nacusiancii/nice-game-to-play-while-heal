# feel: see a moment of the game the way a player does

Screenshots show where things are. Feel bugs live *between* screenshots: a flicker, a box that lands
off-centre and then jumps, a fight that sits still for two seconds. `feel` records every frame of a
moment on a virtual clock, then hands you a sheet of the frames that matter and a timeline of what
happened, what you would hear, and what looked off.

```sh
tools/feel/feel record battle round=8 seed=3        # a battle on the stage, no server needed
tools/feel/feel record first-turn                   # the real game, in your ./sandbox
tools/feel/feel look /tmp/feel/battle --from result-0.2s --to result+0.6s --every 2f
```

`record` prints the overview for the whole recording. `look` zooms into any span. Read the sheet PNG
it names with your Read tool. Each sheet prints its approximate token cost.

Built-in scenes:

- `battle`: a fight on the stage. Arguments: `round=8` (bots shop up to this round, default 6), `seed=3`,
  `speed=1|2|4`, or explicit teams `a="troll:6/8@2+thorns, wolf, rat" b="lich, skeleton"` (front unit
  first, `kind[:atk/hp][@level][+item]`), plus `relicsA=banner,whet`, `relicsB=…`.
- `first-turn`: start a run, buy three units, sell one, fight, continue.

Sessions go to `/tmp/feel/<scene>` and a new recording replaces the old one. **If other agents may be
recording on this machine, pass `--out /tmp/<you>/<name>`.** For `record`, `--out` is the session
directory. For `look`, it is the sheet file.

## How it works

- **Frame-exact.** Chrome (`chrome-headless-shell` from Playwright's cache) runs under
  `--enable-begin-frame-control` with virtual time. Each step advances the page clock by exactly one
  frame (16.7 ms at 60 fps) and draws it. Timers, `requestAnimationFrame` and CSS animations all
  follow that clock, so nothing gets skipped, even though recording runs at about 3–4× real time.
- **Your worktree, in your sandbox.** `first-turn`-style scenes run `./sandbox up` (this worktree's
  module and client on your private server) and play there in a fresh browser, so each recording is
  a new player. The sandbox stays up afterwards: `./sandbox down` when you're done. Stage scenes skip
  the server: a Vite page runs the real `battleView` on a battle computed by the shared engine.
- **The game says what it means.** The client announces what it does on one event stream
  (`client/src/events.ts`): battle beats (with their effects), sounds, screens, toasts and server
  calls in words. Under `feel` that stream lands on the timeline, so it reads
  `beat 12/30 atk×2 dmg 12,7 · ♪ hit` instead of only pixels. Add an `emit()` wherever new meaning
  lives; the playtest trail hears it too.

## What `look` tells you

- **motion**: one character per time bucket. `·` means nothing moved. Looping scenery (anything with
  an infinite CSS animation, like the torches) and the fake cursor are masked out, so this shows the
  game reacting, not the walls breathing.
- **timeline**: marks, your inputs (`▶`), sounds (`♪`), beats, screens, toasts, server calls.
- **findings**:
  - *flicker*: a region changes and snaps back within 1–2 frames.
  - *snap*: a region jumps in one frame with stillness before and after (teleports, pop-ins, layout
    jumps). A *hard cut* is a snap that covers more than 20% of the screen.
  - *still*: stretches of 0.4 s or more where nothing moves.
  - *responsiveness*: for every click or key, how long until the screen first reacts, and when it
    settles. Over 100 ms is flagged as laggy.
  - *battle rhythm*: beat count, gaps between beats, time to the first attack, and **where the time goes**:
    how long the screen holds on each kind of beat (attack, faint, banner, ability…), in total and as a share.
  - *CHECK FAILED*: a `s.check` in the scene was false.
  - *heavy frames*: frames where the page's main thread took over 16 ms of **real** CPU time. Virtual
    time hides jank, so this is how you see it.
  - *DOM rebuilt*: containers torn down and rebuilt, and how many `<img>` were re-created. Images
    decode synchronously in this capture mode, so a blink a real browser might show can look fine here.
    This line is your warning.
- **sheet**: key frames picked where the picture changes the most (or `--every 100ms` / `--every 1f`
  for a uniform flipbook), cropped to where the motion was, labelled with time, the gap since the
  previous tile, and what happened in between.

Times accept `3.2`, `3.2s`, `800ms`, `12f` (frames), mark names (`start`, `end`, `result`, `fight+2s`,
`end-1s`) and events (`screen=battle`, `beat="i":5`). `start` is set once the page has loaded; a scene
can move it by marking `start` again.

Crops are in page pixels (the recording is 1280×800 unless `--size` says otherwise). To zoom on something,
take the `x,y,w,h` from a finding, from the `crop` line under a sheet, or from a region the scene saved
with `s.region()`.

`look` options: `--from`, `--to`, `--frames N` (default 12), `--every 100ms|3f`, `--crop auto|full|x,y,w,h`,
`--cols N`, `--width PX`, `--out file.png`.

`feel clip <dir> [--from] [--to]` writes a `.webm` so a human can watch the same span.

## Writing a scene

A scene is a TypeScript file that exports `default async (s: Scene) => { … }`. Put it in
`tools/feel/scenes/` to run it by name, or pass any path to `record`. Outside `scenes/`, import the type
by absolute path (`import type { Scene } from '/…/tools/feel/capture'`) or leave it out; types are only
for your editor. Add `export const options = { page: 'stage' }` for
server-less battles, or `{ fps: 30, width: 1024, height: 700 }` to change capture settings.

```ts
import type { Scene } from '../capture';
export default async (s: Scene) => {
  await s.until(() => document.querySelector('.title-screen'));
  await s.click('text=New run');                    // CSS selector or text=…; the pointer glides there
  await s.until(() => document.querySelector('.shoprow .slot'));
  s.mark('shop');                                   // name moments to look at later
  await s.dblclick('.shoprow .slot', { nth: 0 });
  await s.drag('.shoprow .slot .unit', '.team .slot', { toNth: 2, ms: 500 });
  await s.key('Space');                             // r, 1, Space, Escape, Enter…
  await s.check('bought by dragging', () => document.querySelectorAll('.team .slot .unit').length === 1);
  await s.region('shop', '.shoprow');               // later: look --crop shop
  await s.offCamera(() => s.wait(5000));            // fast-forward without saving frames
  await s.wait(1000);                               // let time pass, every frame filmed
};
```

Functions you pass to `until`, `eval` and `check` run **in the page**, so they can't see your scene's
variables. Only `eval` takes extra arguments (`s.eval((n) => …, 3)`); `check(label, fn)` and
`until(fn, { timeout, label })` take none, so bake values into the function text if you need them.
`until` gives up after 15 s by default.

Game state: in the real game, `__store` is the client's live store (`__store.run.gold`, `__store.run.team`,
`__store.run.shop`). Prefer it over scraping the DOM. Pixels moving is not proof that an action worked:
a failed drag still "reacts" because its ghost moves. After each action that matters, `s.check` the
game state. Failed checks come first in `look`'s findings.

Good selectors for this game: `.shoprow .shopgroup:first-child .slot:not(.empty)` (market units),
`.team .slot` (team slots, empty or not), `.team .slot .unit` (your units), `.btn.sell`, `text=Fight`,
`.bunit` (units in battle), `.result` (battle result box), `text=Continue`, `.choice` (relic picks).
Keys: `r` reroll, `f` freeze, `s` sell selected, `Space` fight, `1`–`7` select a market slot.

Also available: `s.hover`, `s.type`, `s.moveTo(x, y, ms)`, `s.eval(fn)`, `s.note(text)`,
`s.battle({ round, seed, a, b, relicsA, relicsB, speed })` (stage only) and `s.cdp` for raw DevTools calls.
Explicit stage teams look like `a="troll:6/8@2+thorns, wolf, rat"` (front unit first).

## Cost and limits

- About 30–40 s of real time and 100 MB of JPEGs per 10 s filmed at 60 fps on an idle machine, plus
  5–10 s of setup. Several recordings at once slow each other down badly (3–5×), and they inflate
  *heavy frames*. `record` prints progress every 5 s filmed. Use `--fps 30` or `s.offCamera` for long
  stretches, and keep `until` timeouts short: a timeout spent waiting is filmed too.
- A sheet is about 1,500–2,600 tokens. Narrow the span or `--crop` before you widen `--frames`.
- Recording happens in virtual time, so main-thread cost doesn't stretch the timeline. Read
  *heavy frames* for that. Network round trips to the private server take real time while the clock
  is stepped, so treat sub-frame latency numbers loosely.
- There's no audio, only the `♪` log of which sounds fired and when.
