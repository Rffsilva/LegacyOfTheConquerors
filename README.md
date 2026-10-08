# Legacy of the Conquerors

A modern remake of [OpenGlad](https://github.com/openglad/openglad) — the open-source port of
FSGames' *Gladiator* — that runs in the browser and on phones. It keeps the original units, combat,
campaign and team-building, and adds a modern UI, touch controls and responsive scaling.

Built with TypeScript, [Phaser 3](https://phaser.io) and [Vite](https://vite.dev).

## Status

**Milestone 1: asset pipeline and scenario viewer.** All 53 original scenarios load, with their maps,
units, team colours, palette-cycled water and briefings. You can pan and zoom with mouse, keyboard or touch.
There is no gameplay yet; see the roadmap.

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
src/scenes/    Phaser scenes
src/input/     Camera pan/zoom (mouse, keyboard, touch, pinch)
src/ui/        HTML overlay UI
tools/         Asset converter (runs directly with Node's TypeScript support)
tests/         Vitest suites
```

## Roadmap

1. ~~Asset pipeline and scenario viewer~~
2. **Simulation core.** Port `walker`/`living`/`weapon`/`effect` into a deterministic fixed-tick
   engine (≈12 ticks/s, like the original) that doesn't depend on Phaser, so it can be unit-tested.
   Includes enemy AI, generators, treasure, doors and exits.
3. **Player control.** Keyboard, gamepad, and on-screen touch stick and buttons. Switching between squad members.
4. **Team management.** Recruiting, training and levelling (`picker.cpp`), plus campaign
   progress saved locally.
5. **Presentation.** Sound, HUD and radar, help screens, settings.
6. **Ship it.** Installable offline PWA, plus iOS and Android builds via Capacitor.

## License and credits

Licensed under the **GNU General Public License v2.0 or later** (see [LICENSE](LICENSE)). This
project derives from OpenGlad's code and data, which are GPL-2.0-or-later.

*Gladiator* © 1995–2002 FSGames. OpenGlad was ported and maintained by Zardus, Sean Ford, Yan Shosh,
Jonathan Dearborn and other contributors. All original graphics, levels and sounds are theirs.
