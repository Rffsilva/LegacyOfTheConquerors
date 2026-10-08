# Legacy of the Conquerors

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

Open a specific scenario with `?scen=scen12`.

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
tools/         Asset converter (runs directly with Node's TypeScript support)
tests/         Vitest suites
```

## Roadmap

1. ~~Asset pipeline and scenario viewer~~
2. ~~Combat engine, player control and special abilities~~
3. ~~Campaign: recruiting, training, rewards and saving~~
4. **Presentation.** HUD radar/minimap, help screens, settings, music and polish.
5. **Ship it.** Installable offline PWA, plus iOS and Android builds via Capacitor.

## License and credits

Licensed under the **GNU General Public License v2.0 or later** (see [LICENSE](LICENSE)). This
project derives from OpenGlad's code and data, which are GPL-2.0-or-later.

*Gladiator* © 1995–2002 FSGames. OpenGlad was ported and maintained by Zardus, Sean Ford, Yan Shosh,
Jonathan Dearborn and other contributors. All original graphics, levels and sounds are theirs.
