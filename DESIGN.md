# The Ledger of the Black Market

*Found nailed to a damp wall somewhere below the third torch. The handwriting is a goblin's.
The coffee stains are a dwarf's. The tiny bite marks are almost certainly the Grey Rat's.*

---

## Page 1: How this all started

It began on 24 October 2026, when a wanderer named Krishna caught a fever and asked for a game
to play while the medicine did its slow work. They liked *Probably Stolen*, *Batomon* and
*Slay the Spire*, and cared more about a good loop than shiny graphics.

So the Black Market opened. Hire a rabble of dungeon misfits, squash three of the same kind into
one stronger misfit, and send them against the **ghosts** of crews who came before.
Ten trophies before five lives run out. About twenty minutes a run, or one cup of tea.

## Page 2: The four rules of the Market (do not eat this page)

1. **Every turn is a small, real decision.** Spend or save. Reroll or freeze. Merge now or wait.
   Who stands in front and takes the first punch. *If a choice is obvious, it isn't a choice,
   it's a chore.*
2. **Rules you can read.** Every ability fits on one line and does exactly what it says.
   No fine print. (The fine print was eaten. See: rat.)
3. **Battles are the payoff, not the work.** They run by themselves, they're short, and if you're
   impatient there's an Instant button. The thinking happens in the shop. Small things happen together:
   a fallen misfit's last trick lands in the same beat as its fall, and a pile of little buffs lands as
   one. The punches each get their own moment.
4. **Ghosts make the dungeon feel alive.** Every crew you field leaves a ghost behind to haunt
   future runs. When the halls are empty, the Market hires bots to pretend.

## Page 3: Who's for hire

| Tribe | Their whole deal | Warning label |
|---|---|---|
| 🐺 **Beast** | Brawlers. They get angrier when hurt or when a friend falls. | Easy to love, easy to play. |
| 💀 **Undead** | They come back. Summons on death; they feed on everyone else's. | Order matters. Arrange your corpses carefully. |
| 🍄 **Fungus** | Patience. They grow a little every single turn. | The strongest tribe late, by design: the only one that grows for good. The Spore Puff was put on a diet (1/1) for growing too well too early. |
| 💰 **Goblin** | Greed versus tempo. Earn gold, and turn *unspent* gold into muscle. | Spend it now, or hoard it for the Warlord? This is the Probably Stolen itch. |
| ✨ **Arcane** | Zap things before and during the fight. The Archmage makes everyone do their opening move twice. | Fragile. Stand them behind someone sturdy. |
| ⛏️ **Dwarf** | Ward: a shield that soaks damage first. They protect whoever stands behind them. | Will lecture you about proper shield maintenance. |

## Page 4: Shiny things on the shelf

On rounds 3, 6, 9 and 12, three **relics** glint in the dark and you get to keep one, Slay the
Spire style. A good relic should *bend* a build: Spore Pouch makes mushrooms grow twice as
fast, and Sixth Seat gives you room for one more misfit.

A relic pick should be a real dilemma, not a reflex. When the Veteran first looked, not one of
209 relic picks was a dilemma: everybody grabbed Troll Heart's two lives, and nobody touched the
Dice or the Tome. So the Market changed its shelf:

- **Strong things cost something.** Troll Heart still gives two lives, but every reroll after that
  costs 2 gold. (The drink was strong enough.)
- **Tribe relics only show up for that tribe.** Spore Pouch needs a Fungus on the team, Grave Lantern
  something that summons, Tome of Echoes an Arcane. An offer you can't use is no offer at all.
- **Small relics bend, not just add.** Loaded Dice's free first reroll can reach a tier higher, which
  is a different game from "one gold off".

## Page 5: Decisions the Market has made (and why)

- **The server is the referee.** The shop, the dice and every battle happen inside SpacetimeDB.
  Your screen only shows what happened and replays the fights. Nobody gets to cheat, not even the rat.
- **One rulebook for everyone.** The server, the game screen and the training simulator all read
  the same rules (`server/src/game/`), so a tooltip can never lie. They even pick opponents the same
  way (`server/src/game/match.ts`), so the basement's numbers are about the dungeon you actually play.
- **Bots train in the basement, and a Veteran watches them.** A league of dumb bots (`tools/sim.ts`)
  plays hundreds of runs in seconds. The **Veteran** (`tools/veteran.ts`) is slower and sharper: before
  every purchase it tries each option on a copy of its run and fights the copies against ghosts it has
  seen. It keeps a tally of which choices were real **dilemmas** and which were **obvious**, because
  a choice that's obvious isn't a choice (see rule 1). It has never been told what any unit does,
  so it doesn't care how many tribes the Market hires.
- **Playtesters with opinions.** `tools/play.ts` is the Market as a terminal game, so an agent can
  play a run like a person, grumble in a diary, and argue with the Veteran's hints
  (the `balance-check` skill). Their grumbles find what numbers can't; the numbers keep their grumbles honest.
- **Every apprentice gets their own cellar.** The Market's builders once knocked over the counter while
  Krishna was shopping. Twice. Now each one tinkers in a private cellar (`./sandbox`) with its own torches,
  its own coin and its own locks, and the shop upstairs can't even hear them. Their keys don't fit
  upstairs doors. Moving something upstairs is one deliberate trip, and Krishna holds the stairs.
- **The game narrates itself, once.** Every call to the server, screen change, battle beat, toast and
  sound is announced on one stream (`client/src/events.ts`). The complaints box (page 6) keeps the last
  few in words; `tools/feel`, which films a moment of the game frame by frame in a builder's cellar,
  writes them under its pictures. Two listeners, one story, so they can't disagree.
- **No undo. We live with our decisions.** A sale is a sale, like at any honest black market. Instead,
  the expensive mistakes are hard to make by accident: selling a levelled misfit, or one holding
  something, takes a second press (dragging it to Sell is deliberate enough), and so does swapping out
  an item someone already holds. The front line that was sold in the first playtest is avenged.
- **The shelf stays put.** When you buy something, its spot on the shelf stays empty until the next
  reroll, so nothing slides under your hand and the number keys keep pointing where they did.
- **A draw costs nothing.** Both crews walk away embarrassed but alive, like in Super Auto Pets.
  If someone learns to stall for draws, we revisit.

## Page 6: The complaints box

Every player gets a **"huh?" button**: press H, mutter a word or two, keep playing. The Market keeps
the exact moment it was muttered in (the run, the screen, the battle frame, the last few things
you did) and can lay it out again like it never left (`?moment=<id>`).

When a session ends, all its mutterings go to one fresh agent together, who reads them side by
side, fixes the small things in its own corner of the dungeon, and reports back
(`playtest/TRIAGE.md`). A real bug doesn't wait for the session to end. We judge a fix by whether
the "huh?"s about it stop coming.

## Page 7: Known cracks in the walls

- **Difficulty against a real human is untested.** The early rounds are probably a gentle stroll.
- **The bots are simple.** Ghost opponents get truly interesting only once real runs pile up.

## Page 8: Scribbled on the back

Ideas for when the fever is gone:

- **Friends' ghosts** and live async PvP. Your rabble against theirs.

---

*The Ledger only tells how things stand today. When something changes, rewrite the page cleanly.
Old pages aren't lost: the Archivist keeps every one of them (`git log -p DESIGN.md`).*
