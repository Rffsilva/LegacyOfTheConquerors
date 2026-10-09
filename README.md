# Legacy of the Conquerors

**▶ Play now: [rffsilva.github.io/LegacyOfTheConquerors](https://rffsilva.github.io/LegacyOfTheConquerors/)**
(works in any modern browser, on desktop and phones; install it from the main menu to play offline)

**▶ With friends: [rffsilva.github.io/LegacyOfTheConquerors/online](https://rffsilva.github.io/LegacyOfTheConquerors/online/)**
(the new version, with online campaigns for invited players)

The site root is the classic game, built from the `classic` branch (tag `v1.0.0`). `main` is the
new version, published under `/online`.

A modern remake of [OpenGlad](https://github.com/openglad/openglad) — the open-source port of
FSGames' *Gladiator* — that runs in the browser and on phones. It keeps the original units, combat,
campaign and team-building, and adds a modern UI, touch controls and responsive scaling.

Built with TypeScript, [Phaser 3](https://phaser.io) and [Vite](https://vite.dev).

## Status

Playable. Start a campaign, hire and train a team in the barracks, and fight through the
original's fields. Defeat every enemy, then walk onto an exit. Skirmish mode lets you try any of
the 53 fields with a ready-made squad.

- **Combat:** a faithful, deterministic port of OpenGlad's simulation, including every special ability
- **Controls:** keyboard, gamepad and on-screen touch controls; press **?** in battle for the list
- **Campaign:** hiring, training, rewards, levelling and permanent losses, saved in the browser
- **The Arena:** endless rounds of ever harder foes, alone or with friends online; leave every 5 rounds with your winnings, or risk them and fight on

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from your phone on the same network)
```

| Script                   | What it does                                            |
| ------------------------ | ------------------------------------------------------- |
| `npm run dev`            | Dev server with hot reload                              |
| `npm run build`          | Typecheck and build a static site into `dist/`          |
| `npm test`               | Unit tests, plus integrity checks on the converted data |
| `npm run convert-assets` | Regenerate `public/assets` from an OpenGlad checkout    |
| `npm run make-icons`     | Regenerate the app icons in `public/icons`              |
| `npm run dev:server`     | The online campaign server, locally (Cloudflare Worker) |

Open a specific scenario with `?scen=scen12`.

## Installing and offline play

The production build is an installable web app that plays fully offline. `dist/` is a static
site: put it on any HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, itch.io...). On the first
visit a service worker caches the whole game (about 3 MB). After that it works offline, and
it can be installed from the main menu's **Install** button, or on iPhone/iPad via
Share → Add to Home Screen. When a new build is deployed, players get a "new version is ready"
prompt.

The service worker only runs in production builds (`npm run build && npm run preview`), not
in `npm run dev`.

## Assets

`public/assets` is generated from the original OpenGlad data and is committed so the game runs
out of the box. To regenerate it:

```bash
npm run convert-assets -- /path/to/openglad
```

The converter ([tools/convert-assets.ts](tools/convert-assets.ts)) reads the loose `pix/` and `scen/`
files, falling back to the `graphics.001` / `levels.001` GladPack archives (the same order as the original).

- **Sprites** stay palette-indexed in a single `sprites.bin`. They are turned into textures at runtime,
  which keeps team recolouring and palette-cycled water/lava animation identical to the original.
- **Scenarios** become JSON, with the map grid inlined.
- **Sounds** are copied as WAV.

The binary formats are documented in [src/formats](src/formats).

## Online campaigns

Online campaigns are shared: everyone you invite keeps their own barracks, team and cash inside
the campaign, and any field one player opens up is open to all. Battles are fought together:
everyone in the barracks picks **Ready**, and when all of them are, the battle starts for all.
Friends can join a battle in progress, leave it (their squad fights on under the computer) and
come back; a dropped connection does the same after 10 seconds. Any campaign can also go to
**the Arena**: waves of foes in rounds, each harder than the last, with no end. Every 5 rounds
each player chooses to leave with the gold and experience earned so far, or fight on; a squad
that falls before leaving earns nothing from the run. Each campaign has a **bank**
(🏦 in the online bar): anyone can put cash in or take it out, and everyone sees who did what.

Each device runs the same battle in lockstep: the simulation is deterministic (integer maths and
a seeded random generator), so the server only keeps the clock and relays what changed in each
player's input every tick, and keeps that log so a late joiner can replay the battle so far.
When it ends, the first device to get there sends everyone's results.

The server is a Cloudflare Worker with Durable Objects (`server/`); the rules it applies live in
`src/online/room.ts`, shared with the game and the tests. Playing online needs the access
password, which the server checks before handing out a sign-in token.

**Accounts:** players sign in with a username and a personal code of their own. A new username
creates an account; the same username and code on another device (case doesn't matter) loads it,
with the list of campaigns the player is in. Codes are stored only as a salted PBKDF2 hash, and
five wrong codes lock a username for 15 minutes. **Log off** (on the online campaigns screen)
removes the sign-in and the campaign list from that device; they come back with the next sign-in.

**Running it locally:**

```bash
echo 'ACCESS_PASSWORD=letmein' > server/.dev.vars
npm run dev:server                                         # http://localhost:8787
VITE_ONLINE_SERVER=http://localhost:8787 npm run dev       # the game, with online campaigns
```

**Deploying:** the Pages workflow deploys the server too when the repository has these Actions
secrets: `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template), `CLOUDFLARE_ACCOUNT_ID`
and `ONLINE_PASSWORD`. Changing `ONLINE_PASSWORD` signs everyone out; they get their campaigns
back when they sign in again with their username, code and the new password. Without the secrets, the site builds without online play.

## Layout

```
src/formats/   Parsers for the original file formats (GladPack, pixie, .fss scenario, VGA palette)
src/data/      Tables ported from the C++ source (tile ids, object orders/families → sprites)
src/render/    Indexed-colour → texture conversion, palette cycling
src/sim/       The game simulation (walkers, AI, specials, world), independent of Phaser
src/game/      Campaign rules, saving and the app flow between menus and battles
src/scenes/    Phaser scenes
src/input/     Camera pan/zoom (mouse, keyboard, touch, pinch)
src/ui/        HTML overlay UI: battle HUD, menus, barracks, battle report
src/online/    Online campaigns: the shared rules, messages and the game's connection
server/        The online campaign server (Cloudflare Worker)
tools/         Asset converter (runs directly with Node's TypeScript support)
tests/         Vitest suites
```

## Roadmap

1. ~~Asset pipeline and scenario viewer~~
2. ~~Combat engine, player control and special abilities~~
3. ~~Campaign: recruiting, training, rewards and saving~~
4. ~~**Presentation.** Radar, settings, music, field manual~~
5. ~~**Ship it.** Installable offline web app for desktop and mobile browsers~~
6. **Online campaigns** (in progress): ~~shared campaigns with invites~~, ~~live co-op battles~~,
   smoother play on slow connections

## License and credits

Licensed under the **GNU General Public License v2.0 or later** (see [LICENSE](LICENSE)). This
project derives from OpenGlad's code and data, which are GPL-2.0-or-later.

*Gladiator* © 1995–2002 FSGames. OpenGlad was ported and maintained by Zardus, Sean Ford, Yan Shosh,
Jonathan Dearborn and other contributors. All original graphics, levels and sounds are theirs.
