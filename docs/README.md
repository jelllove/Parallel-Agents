# docs/

This folder hosts images referenced by the project README:

| File | Purpose | Suggested size |
|---|---|---|
| `hero.png` | Top banner / hero screenshot at the top of `README.md` | 1600 × 900 |
| `screenshot-main.png` | Main window — three-column layout | 1280 × 800 |
| `screenshot-diff.png` | Monaco diff window | 1280 × 800 |
| `screenshot-layout.png` | Layout picker popover | 1280 × 800 |
| `screenshot-explorer.png` | Explorer right-click menu | 1280 × 800 |

## How to capture

1. Run `npm run release` and launch `release/latest/Parallel Agents.exe`.
2. Use the Windows **Snipping Tool** (`Win + Shift + S`) or **ShareX** for higher quality.
3. Save as PNG into this folder using the filenames above — the README will pick them up automatically.
4. For an animated hero, replace `hero.png` with `hero.gif` (≤ 5 MB recommended) and update the `<img>` tag in `README.md`.

> Tip: for the cleanest look, set the window to a fixed size (e.g. 1280×800) before capturing, and use the default dark theme.
