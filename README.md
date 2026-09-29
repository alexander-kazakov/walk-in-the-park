# 🌳 Walk in the Park 🦆

A small top-down browser game: go to the park, work through a checklist of quests — and try not to get arrested.

**Play:** open `index.html` in any modern browser. No build step, no dependencies.

## Quests

1. 🐕 **Walk Grandma's dog** — Grandma Rosa (south-west bench) hands you Biscuit's leash.
2. 🐿️ **Lose the dog** — walk long enough and a squirrel will take care of this for you.
3. 🔎 **Find the dog** — follow the "woof!"s, search bushes, bring Biscuit back to Grandma.
4. 🗑️ **Pick the garbage with a picker** — get a picker from Keeper Pim (north-west shed), collect 8 pieces of litter.
5. 🤝 **Make a friend** — Sam is lonely on the east bench. A flower (or a fire-breathing picker) helps.
6. 🌸 **Find some flowers** — 5 of them, hidden off the paths.
7. ⚡ **Upgrade your picker** — Keeper Pim installs the Switch-O-Matic 3000: ❄️ **ice** freezes anything (including the pond — walk on it!), 🔥 **fire** exterminates anything (trees, bushes, litter…). Use both.
8. 🦆 **Quack-a-mole** — whack the (quacking) moles, spare the real ducks. Score 12 in 30 seconds.
9. 🚓 **Bonus: get arrested for littering** — press `L` to litter. If Officer Bramble sees you, he'll chase you down and throw you in Park Jail. Freezing him with the ice picker buys you time…

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Walk | WASD / arrow keys | joystick |
| Interact / talk | E or Enter | E |
| Use picker (hold for ice/fire) | Space or click/hold toward a spot | ⚡ |
| Switch picker mode | Q | Q |
| Litter (don't) | L | 🗑️ |
| Checklist | J or Tab | 📋 |
| Mute | M | — |

## Files

- `index.html` — page, overlays (title, dialogue, Quack-a-mole, jail, win)
- `style.css` — UI styling, mobile touch controls
- `game.js` — world, quests, NPCs, picker modes, rendering (canvas), sound (Web Audio)
