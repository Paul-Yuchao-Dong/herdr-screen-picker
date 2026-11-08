# Screen picker

A card in the corner of a Herdr window that lists everything already printed in
the focused terminal — URLs, files, folders, images and `!commands` — one letter
badge each. Pressing the letter opens the thing by its kind, or copies it. One
key (`ctrl-shift-o`) to reach a link you can see but can't easily select.

![Screen picker](preview.png)

It is an app mod: a JavaScript view in a frameless full-window overlay, no
build step, no dependencies, no processes of its own. It reads the screen with
`hc read`, types what it finds, and hands the chosen thing to the platform's
opener.

## What you see

A card 700px wide at the bottom-right of the window, 12px in from the right and
bottom edges, on the theme's `popover` background with a 1px `border`, radius 8,
10px padding.

- **Header**, one row, 6px under it: the word `Screen` at 12px semibold in
  `foreground`, then the row count at 10.5px `muted`, then a spacer, then the
  footer hint on the right, 10.5px `muted`: `Enter open · ⇧Enter copy · Esc close`.
- **Rows**, one per item, 24px tall, 6px side padding, radius 4, 8px gaps. Each
  row is three parts: the badge letter at 11px semibold in a fixed 18px slot
  (`accent` when selected, `muted` otherwise), a 30px kind tag at 9.5px in mono
  (`URL` in `accent`, `CMD` in `working`, `IMG` in `done`, `FILE`/`DIR`/`PATH` in
  `foreground`/`muted`), then the value at 12px, truncated in the middle past 92
  characters. The selected row has the `selected` background; the rest sit on
  `popover`.
- **Status line**, 11.5px `muted`, only when there is something to say:
  `Reading this screen…`, the error, or
  `No links, files or commands on this screen.`
- At most 12 rows are visible. The list pages with the selection, so the
  selected row is always on screen; the card grows and shrinks with the count.
- One key per item while it is open. Nothing is submitted, nothing is typed into
  the terminal, and the row is mouse-clickable (shift-click copies).

## How it behaves

`Enter` opens the selected row; `Shift+Enter` copies it; `a`–`z` jump to that
row and do the same. `↑ ↓ Tab Shift+Tab` move, `Home`/`End` jump, and `Esc`,
`Ctrl+C` or a click outside close the card. Every key is stopped inside the
card, so no keystroke reaches the agent underneath while it is open.

What "open" means, per kind:

| Kind | `Enter` | `Shift+Enter` |
| --- | --- | --- |
| `URL` | the browser, `www.` prefixed with `https://` | copy |
| `FILE` / `IMG` / `DIR` | `xdg-open` / `open` / `explorer.exe` | copy the absolute path |
| `PATH` | the same opener, for a row that could not be typed | copy |
| `CMD` | copy only, always | copy |

Commands are deliberately copy-only: a `!command` line found on screen can only
leave as clipboard text, so nothing can be submitted by accident. The opener is
started and the card closes at once; a failed launch becomes an error toast.

## How it is built

Two files in `mods/screen-picker/`:

- `mod.json` — `{"place": "none", "overlay": {"kind": "window", "frame": "none",
  "at": {"x": 0, "y": 0}, "width": 1, "height": 1}, "title": "Screen picker"}`.
  In that overlay block `width`/`height` are fractions of the app window, so
  `1`/`1` is a transparent canvas the size of the window; `frame: "none"` means
  the mod draws its own card.
- `main.js` — a `View` subclass. `init` captures `focused()` (`shown`, then
  `terminal`, then `agent`), remembers its `cwd` as the base for relative paths,
  reads `window().platform` (falling back to `os.platform()` where there is no
  window, as under `herdr-app check`), takes the focus handle, and spawns one
  read: `hc(["read", "--json", "--lines", "0", terminal])` — current screen
  only, never history, because a history read can send input to a full-screen
  program.
- `scan.js` — pure functions, no filesystem: `candidates(text)` returns `{kind:
  "url" | "path" | "cmd", value, at}` in screen order, plus `normalize` and
  `absolutePath`. Quoted strings are read first (the only way a path may hold
  spaces, and they may hold a URL), then URLs, then bare paths — in that order,
  so `https://host/a/b` is never re-read as `/a/b`. Path forms: `/x`, `~/x`,
  `./x`, `../x`, `C:\x`, `C:/x`, `\\server\share\x`. A path is dropped when what
  follows it on the line is a prompt glyph (`~/proj ❯`, `C:\Users\me>`,
  `/tmp $ ls -la` all look exactly like a path).

Turning candidates into rows:

1. expand (`~` → home) and resolve relative paths against the pane's cwd;
2. `readdir(dir, {withFileTypes: true})`, one call per directory, to type each
   path as `DIR` or file — a Herdr mod may only read inside the person's home
   folder, so this covers exactly that;
3. everything else is settled by `exec("test", ["-e"…])` + `["-d"…]` on
   Linux/macOS and one `powershell -Command …Test-Path -LiteralPath…` batch on
   Windows; a path neither can settle is kept and shown as `PATH`;
4. absolute paths are deduped (case-insensitively on Windows) and the `!command`
   lines are appended in place.

The card is a `v_flex()` with explicit `.w()` and a height computed from the
row count — an absolutely positioned child anchored with `right`/`bottom`
paints nothing if its height is left to `auto`. Colours come from `theme()`.

## Keys

Merge `keys.json` next to this file into `~/.config/herdr-app/keys.json` (or let
`install.sh` / `install.ps1` do it):

```json
{ "global": { "ctrl-shift-o": "mod.open:screen-picker" } }
```

`ctrl-shift-o` is Herdr's default for `pane.split:right`, so that action needs
another key afterwards (`ctrl-shift-r` suits it).

## Install

```sh
./install.sh          # copy into ~/.config/herdr-app/mods/screen-picker
./install.sh link     # symlink instead: edit the repo, the app hot-reloads
```

`install.ps1` does the same on Windows (`-Link`, `-NoKeys`, `-AppHome`).

## Limits

Screen only, no scrollback. Bare filenames without a separator (`notes.md`) are
ignored on purpose. OSC 8 named hyperlinks (link text that is not a URL) are not
resolved. Windows' `explorer.exe` reports a non-zero exit code even when it
works, so there only a launch failure counts.

## Checks

```sh
npm test                                        # 21 tests over scan.js
herdr-app check ~/.config/herdr-app/mods/screen-picker
```

Then, in the app: show a screen with a URL, an existing image path, a folder and
a `!command`; press the key; check the rows and their kinds, that a missing path
produced no row, that a prompt line produced none either, that a badge copies
the value, and that an image path opens the viewer.
