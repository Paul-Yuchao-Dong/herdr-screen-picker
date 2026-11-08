# herdr-screen-picker

One keystroke to reach anything already printed in a Herdr terminal: URLs,
files, folders, images and `!commands`, as letter badges in a small card.

```
Screen 8                                  Enter open · ⇧Enter copy · Esc close
A  URL   https://herdr.dev/docs
B  URL   www.example.com/?q=hello+world
C  FILE  /tmp/notes.txt
D  IMG   /tmp/shot.png
E  IMG   /tmp/link hints inline.png        quoted path with spaces
F  DIR   ~/.config/herdr-app/mods          ~ expanded
G  FILE  ./package.json                    resolved against the pane's cwd
H  CMD   !git status --short
```

This is a **herdr-app** mod (the desktop app), not herdr-tui. Tested on
herdr-app 0.1.13 with herdr-core 0.1.18.

## Install

Requires herdr-app (desktop) and Python 3 for the key merge.

```sh
./install.sh          # copy into ~/.config/herdr-app/mods/screen-picker
./install.sh link     # symlink instead: edit the repo, the app hot-reloads it
```

Then press **Ctrl+Shift+O** in the app. `install.sh` backs up `keys.json`
before pointing `ctrl-shift-o` at `mod.open:screen-picker`; if that key was
`pane.split:right` (the Herdr default), you get a warning naming the old
action, which now has no key — bind it elsewhere or restore the backup.

Use `HERDR_APP_HOME` for another profile, and `./install.sh copy no-keys` to
deploy without touching the key map:

```json
{ "global": { "ctrl-shift-o": "mod.open:screen-picker" } }
```

Verify:

```sh
herdr-app check ~/.config/herdr-app/mods/screen-picker
herdr-app status          # errors: [] while the card is open
herdr-app do mod.open --name screen-picker
```

## Keys

| Key | Does |
| --- | --- |
| `a`…`z` | open that row (`shift` copies it) |
| `Enter` / `Shift+Enter` | open / copy the selected row |
| `↑` `↓` `Tab` `Shift+Tab` | move |
| `Home` `End` | first / last |
| `Esc`, `Ctrl+C`, click outside | close |

Every key stays inside the card while it is open; nothing reaches the agent.

## What each kind does

| Kind | `Enter` | `Shift+Enter` |
| --- | --- | --- |
| `URL` | open in the browser (`www.` gets `https://`) | copy |
| `FILE` / `IMG` / `DIR` | `xdg-open` (your `xdg-mime` defaults) | copy the absolute path |
| `CMD` | **copy only** | copy |

Commands are never typed anywhere by this mod: a `!command` on screen can only
leave as clipboard text, so no agent can receive text you did not paste yourself.

## How it finds things

A single screen read (`hc read --json --lines 0 <terminal>`), then one pass:

- quoted strings that look like paths, URLs, then bare paths — in that order,
  so `https://host/a/b` is never re-read as `/a/b`;
- paths are expanded (`~`), resolved against the focused pane's cwd, and then
  **stat'ed in one `bash` call** — non-existent ones are dropped, real ones
  become `FILE`, `IMG` (by extension) or `DIR`;
- a line's own `!command`, at the start of a line or after `Run: `;
- prompt tails such as `~/proj ❯` are skipped instead of badged as a folder;
- duplicates share one row, and rows keep screen order.

## Limits

- **Current screen only.** Herdr's scrollback is not exposed to mods; return to
  the bottom of the terminal first. Nothing is saved, uploaded or fetched.
- Bare filenames without a slash (`notes.md`) are ignored on purpose: badging
  every word ending in `.md` would be worse than missing some.
- OSC 8 named hyperlinks (link text that is not a URL) are not resolved.
- Relative paths use the pane's cwd, so a path printed by a program that
  `cd`'d elsewhere may not resolve.

## Notes for other mod authors

Two things this cost me on herdr-app 0.1.13, both verified:

- In `mod.json`, overlay `width`/`height` are **fractions of the app window**
  (the shipped picker uses `"height": 0.8`), so `1`/`1` is a frameless
  full-window canvas. Give absolutely positioned cards explicit `.w()`/`.h()`;
  an auto-height card anchored with `right`/`bottom` can paint nothing.
- `exec()` resolves when the child's pipes close, so awaiting `xdg-open` keeps
  your overlay up until the viewer exits. Start it, dismiss, then handle the
  promise.

## License

MIT.
