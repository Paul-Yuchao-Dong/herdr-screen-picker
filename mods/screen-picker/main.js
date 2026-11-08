// Screen picker for herdr-app: every URL, file, folder, image and `!command`
// on the focused terminal's screen, as letter badges. Ctrl+Shift+O (keys.json).
// Enter opens the row by kind, Shift+Enter copies its value, Esc closes.
// Works on Linux, macOS and Windows: no shell, no helper binaries.
// Source: https://github.com/Paul-Yuchao-Dong/herdr-screen-picker (MIT).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { focused, hc, exec, home, notify, props, closeOverlay, theme, window as windowInfo } from "herdr";
import { readdir } from "fs/promises";
import { dirname, basename } from "path";
import { platform as osPlatform } from "os";
import { candidates, absolutePath } from "./scan.js";

const MAX_ROWS = 12;
const HINTS = "abcdefghijklmnopqrstuvwxyz".split("");
const ROW = 24;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)$/i;
/** "linux" | "macos" | "windows". No window during `herdr-app check`. */
function detectPlatform() {
  try {
    const named = windowInfo()?.platform;
    if (named) return named;
  } catch {}
  const value = String(osPlatform?.() ?? "");
  if (/win/i.test(value)) return "windows";
  if (/darwin|mac/i.test(value)) return "macos";
  return "linux";
}

/**
 * Which candidates exist, and what they are.
 *
 * A Herdr mod may only read files under the person's home, so the fast path is
 * one `readdir` per directory; whatever that cannot reach (a path elsewhere on
 * the disk) is settled by `test(1)` on unix and `Test-Path` on Windows. If that
 * fallback is unavailable the row still appears, marked PATH: openable, untyped.
 */
async function probeHome(paths) {
  const kinds = new Map();
  const denied = new Set();
  const byDir = new Map();
  for (const full of paths) {
    const dir = dirname(full);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir).add(full);
  }
  await Promise.all([...byDir].map(async ([dir, list]) => {
    let index;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      index = new Map(entries.map(entry => [String(entry.name).toLowerCase(), Boolean(entry.isDirectory?.())]));
    } catch {
      for (const full of list) denied.add(full); // outside the home folder
      return;
    }
    for (const full of list) {
      const key = basename(full).toLowerCase();
      if (!key) continue;
      kinds.set(full, index.has(key) ? (index.get(key) ? "dir" : "file") : "missing");
    }
  }));
  return { kinds, denied: [...denied] };
}

const WINDOWS_TEST = '$ErrorActionPreference="SilentlyContinue"; foreach($p in $args){'
  + ' if(Test-Path -LiteralPath $p -PathType Container){ "dir`t$p" }'
  + ' elseif(Test-Path -LiteralPath $p -PathType Leaf){ "file`t$p" }'
  + ' else { "missing`t$p" } }';

async function probeOutside(paths, platform) {
  const kinds = new Map();
  if (!paths.length) return kinds;
  if (platform === "windows") {
    try {
      const result = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_TEST, ...paths]);
      for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        const kind = line.slice(0, tab).trim();
        if (kind === "dir" || kind === "file" || kind === "missing") kinds.set(line.slice(tab + 1), kind);
      }
    } catch {
      // no PowerShell: rows stay unverified rather than disappearing
    }
    return kinds;
  }
  await Promise.all(paths.map(async full => {
    try {
      if ((await exec("test", ["-e", full])).code !== 0) { kinds.set(full, "missing"); return; }
      kinds.set(full, (await exec("test", ["-d", full])).code === 0 ? "dir" : "file");
    } catch {}
  }));
  return kinds;
}

export default class ScreenPicker extends View {
  init(_props, cx) {
    // Capture what the person is looking at before the overlay takes focus.
    const current = focused();
    this.platform = detectPlatform();
    this.terminal = current?.shown ?? current?.terminal ?? current?.agent ?? null;
    this.base = current?.cwd ?? home();
    this.rows = [];
    this.at = 0;
    this.loading = Boolean(this.terminal);
    this.error = this.terminal ? "" : "Focus a terminal, then open the picker.";
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (!this.terminal) return;
    const terminal = this.terminal, base = this.base, fold = this.fold();
    cx.spawn(async (cx) => {
      try {
        // Screen only, never scrollback: a history read can send input to a
        // full-screen program.
        const read = await hc(["read", "--json", "--lines", "0", terminal]);
        if (read.code !== 0) throw new Error("Could not read this terminal.");
        const screen = JSON.parse(read.stdout);
        if (typeof screen.text !== "string") throw new Error("Herdr returned an unreadable screen.");
        const found = candidates(screen.text).filter(c => !/[\t\r\n]/.test(c.value));
        const paths = [...new Set(found.filter(c => c.kind === "path").map(c => absolutePath(c.value, base, home())))];
        const { kinds, denied } = await probeHome(paths);
        for (const [full, kind] of await probeOutside(denied, this.platform)) kinds.set(full, kind);
        const seen = new Set();
        const rows = [];
        for (const candidate of found) {
          let row;
          if (candidate.kind === "cmd") row = { kind: "cmd", value: candidate.value, path: null };
          else if (candidate.kind === "url") row = { kind: "url", value: candidate.value, path: null };
          else {
            const path = absolutePath(candidate.value, base, home());
            const type = kinds.get(path);
            if (type === "missing") continue; // not on this machine: no badge
            row = {
              kind: type === "dir" ? "dir" : type === "file" ? (IMAGE.test(path) ? "image" : "file") : "path",
              value: candidate.value, path,
            };
          }
          const key = fold(row.path ?? row.value);
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        this.rows = rows;
        this.at = 0;
      } catch (error) {
        this.error = error?.message ?? "Could not read this terminal.";
      }
      this.loading = false;
      cx.notify();
    });
  }

  /** Windows paths are case-insensitive; dedupe on that. */
  fold() {
    const lower = this.platform === "windows";
    return value => lower ? String(value).toLowerCase() : String(value);
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  move(step, cx) {
    if (!this.rows.length) return;
    this.at = (this.at + step + this.rows.length) % this.rows.length;
    cx.notify();
  }

  openWith() {
    return this.platform === "windows" ? "explorer.exe" : this.platform === "macos" ? "open" : "xdg-open";
  }

  activate(copy, cx) {
    const row = this.rows[this.at];
    if (!row) return;
    const value = row.path ?? row.value;
    // Commands are never typed into anything by themselves: this picker only
    // copies them, so nothing can be submitted by accident.
    if (copy || row.kind === "cmd") {
      try {
        cx.write_to_clipboard(value);
        notify({ title: "Copied", body: value });
        this.dismiss();
      } catch (error) {
        this.error = error.message;
        cx.notify();
      }
      return;
    }
    if (row.kind === "url") {
      try {
        cx.open_url(row.value.startsWith("www.") ? `https://${row.value}` : row.value);
        this.dismiss();
      } catch (error) {
        this.error = error.message;
        cx.notify();
      }
      return;
    }
    // Start the opener, then close at once: a viewer inherits our pipes, so
    // awaiting exec would keep the card up until the viewer exits. Windows'
    // explorer.exe reports a non-zero code even when it works, so only a
    // launch failure (a rejection) is an error there.
    const command = this.openWith();
    const started = exec(command, [value]);
    notify({ title: "Opening", body: value });
    this.dismiss();
    started.then(result => {
      if (!result || result.code === 0 || this.platform === "windows") return;
      notify({
        title: "Could not open",
        body: `${value}: ${(result.stderr || "").trim() || result.code}`,
        level: "error",
      });
    }).catch(error => {
      notify({ title: "Could not open", body: `${value}: ${error?.message ?? error}`, level: "error" });
    });
  }

  key(event, cx) {
    // Every key stays here while the picker is open; none reaches an agent.
    cx.stop_propagation();
    const chord = String(event.keystroke ?? "").toLowerCase();
    if (event.key === "escape" || chord === "ctrl-c") return this.dismiss();
    const shift = Boolean(event.modifiers?.shift);
    if (event.key === "up") return this.move(-1, cx);
    if (event.key === "down") return this.move(1, cx);
    if (event.key === "tab") return this.move(shift ? -1 : 1, cx);
    if (event.key === "home") { this.at = 0; return cx.notify(); }
    if (event.key === "end") { this.at = Math.max(0, this.rows.length - 1); return cx.notify(); }
    if (this.loading) return;
    if (event.key === "enter" || event.key === "return") return this.activate(shift, cx);
    if (event.modifiers?.control || event.modifiers?.alt || event.modifiers?.platform) return;
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const index = key.length === 1 ? HINTS.indexOf(key) : -1;
    if (index >= 0 && index < this.rows.length) {
      this.at = index;
      this.activate(shift, cx);
    }
  }

  label(row) {
    const t = theme();
    const index = this.rows.indexOf(row);
    const selected = index === this.at;
    const kind = { url: "URL", cmd: "CMD", file: "FILE", image: "IMG", dir: "DIR", path: "PATH" }[row.kind] ?? "···";
    const color = { url: t.accent, cmd: t.working, image: t.done }[row.kind] ?? (selected ? t.foreground : t.muted);
    const text = row.value.length > 92 ? `${row.value.slice(0, 44)} … ${row.value.slice(-44)}` : row.value;
    return h_flex().id(`row-${index}`).items_center().gap(8).px(6).rounded(4).h(ROW)
      .bg(selected ? t.selected : t.popover).cursor_pointer()
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((event, cx) => {
        cx.stop_propagation();
        this.at = index;
        this.activate(Boolean(event.modifiers?.shift), cx);
      })
      .child(div().w(18).text_size(11).font_family("JetBrains Mono").font_semibold()
        .text_color(selected ? t.accent : t.muted).child((HINTS[index] ?? "·").toUpperCase()))
      .child(div().w(30).text_size(9.5).font_family("JetBrains Mono").text_color(color).child(kind))
      .child(div().flex_1().text_size(12).text_color(selected ? t.foreground : t.muted).child(text));
  }

  render() {
    const t = theme();
    const rows = this.rows;
    const start = rows.length > MAX_ROWS
      ? Math.min(Math.max(0, this.at - Math.floor(MAX_ROWS / 2)), rows.length - MAX_ROWS) : 0;
    const slice = rows.slice(start, start + MAX_ROWS);
    const status = this.loading ? "Reading this screen…"
      : this.error || (!rows.length ? "No links, files or commands on this screen." : "");
    const height = 20 + 20 + 6 + (status ? 20 : 0) + slice.length * ROW;
    return div().id("screen-picker").size_full().relative().track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .on_mouse_down("left", (_event, cx) => {
        cx.stop_propagation();
        this.dismiss();
      })
      .child(
        v_flex().id("screen-picker-card").absolute().right(12).bottom(12).w(700).h(height)
          .rounded(8).border(1).border_color(t.border).bg(t.popover).p(10).gap(6)
          .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
          .child(h_flex().items_center().gap(8)
            .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Screen"))
            .child(div().text_size(10.5).text_color(t.muted).child(`${rows.length}`))
            .child(div().flex_1())
            .child(div().text_size(10.5).text_color(t.muted)
              .child("Enter open · ⇧Enter copy · Esc close")))
          .when(Boolean(status), el => el.child(div().text_size(11.5).text_color(t.muted).child(status)))
          .children(slice.map(row => this.label(row))));
  }
}
