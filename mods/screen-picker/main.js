// Screen picker for herdr-app: every URL, file, folder, image and `!command`
// on the focused terminal's screen, as letter badges. Ctrl+Shift+O (keys.json).
// Enter opens the row by kind, Shift+Enter copies its value, Esc closes.
// Source: https://github.com/Paul-Yuchao-Dong/herdr-screen-picker (MIT).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { focused, hc, exec, home, notify, props, closeOverlay, theme } from "herdr";

const MAX_ROWS = 12;
const MAX_CANDIDATES = 60;
const HINTS = "abcdefghijklmnopqrstuvwxyz".split("");
const ROW = 24;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)$/i;

// One pass, first match wins at each position: quoted strings (paths with
// spaces), URLs, then bare paths. URLs come before paths so a URL is never
// re-read as a path fragment.
const SCAN = /"([^"\n]{1,400})"|'([^'\n]{1,400})'|((?:https?:\/\/|www\.)[^\s<>"'`]+)|((?:~|\.{1,2})?\/[^\s<>"'`,;)]+)/gi;
// A line's own `!command`, at the start of a line or after "Run: ".
const COMMAND = /(?:^|:[ \t]+)[ \t]*!(\S[^\n]*)$/gm;
// `~/proj ❯ ` style prompts look exactly like a path: skip when the rest of
// the line is only a prompt glyph.
const PROMPT_TAIL = /^[ \t]*[\u276f>$%#\u00bb\u203a][ \t]*$/;

function promptTail(text, end) {
  const lineEnd = text.indexOf("\n", end);
  return PROMPT_TAIL.test(text.slice(end, lineEnd < 0 ? text.length : lineEnd));
}

const tail = value => value.replace(/[.,;:!?'"]+$/, "");

function tidyPath(value) {
  let out = tail(value.trim());
  if (out.endsWith(")") && out.split("(").length < out.split(")").length) out = out.slice(0, -1);
  if (out.endsWith("]") && out.split("[").length < out.split("]").length) out = out.slice(0, -1);
  return out;
}

const looksLikePath = value => /^(?:~|\.{1,2})?\//.test(value) && value.length > 1;

/** URLs, paths and `!commands` in screen order, unresolved. */
function candidates(text) {
  const found = [];
  for (const match of text.matchAll(SCAN)) {
    const quoted = match[1] ?? match[2];
    const raw = quoted ?? match[3] ?? match[4];
    if (!raw) continue;
    if (match[3]) { found.push({ kind: "url", value: tail(raw), at: match.index }); continue; }
    const value = tidyPath(raw);
    if (!looksLikePath(value)) continue;
    if (!quoted && promptTail(text, match.index + raw.length)) continue;
    if (found.some(c => c.kind === "path" && c.at === match.index)) continue;
    found.push({ kind: "path", value, at: match.index, quoted: Boolean(quoted) });
  }
  for (const match of text.matchAll(COMMAND)) {
    found.push({ kind: "cmd", value: `!${match[1].trim()}`, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).slice(0, MAX_CANDIDATES);
}

const expand = (value, base) => value.startsWith("~")
  ? `${home()}${value.slice(1)}`
  : value.startsWith("/") ? value : `${base}/${value}`;

/** One `bash` call: which candidates exist, and what they are. */
function statScript() {
  return 'for p in "$@"; do if [ -d "$p" ]; then t=dir; elif [ -f "$p" ]; then t=file; elif [ -e "$p" ]; then t=other; else t=missing; fi; printf "%s\\t%s\\n" "$t" "$p"; done';
}

export default class ScreenPicker extends View {
  init(_props, cx) {
    // Capture what the person is looking at before the overlay takes focus.
    const current = focused();
    this.terminal = current?.shown ?? current?.terminal ?? current?.agent ?? null;
    this.cwd = current?.cwd ?? home();
    this.rows = [];
    this.at = 0;
    this.busy = "";
    this.loading = Boolean(this.terminal);
    this.error = this.terminal ? "" : "Focus a terminal, then open the picker.";
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (!this.terminal) return;
    const terminal = this.terminal, base = this.cwd;
    cx.spawn(async (cx) => {
      try {
        // Screen only, never scrollback: a history read can send input to a
        // full-screen program.
        const read = await hc(["read", "--json", "--lines", "0", terminal]);
        if (read.code !== 0) throw new Error("Could not read this terminal.");
        const screen = JSON.parse(read.stdout);
        if (typeof screen.text !== "string") throw new Error("Herdr returned an unreadable screen.");
        const found = candidates(screen.text).filter(c => !/[\t\n]/.test(c.value));
        const paths = [...new Set(found.filter(c => c.kind === "path").map(c => expand(c.value, base)))];
        const types = new Map();
        if (paths.length) {
          const stat = await exec("bash", ["-c", statScript(), "scan", ...paths]);
          for (const line of (stat.stdout ?? "").split("\n")) {
            const tab = line.indexOf("\t");
            if (tab < 0) continue;
            types.set(line.slice(tab + 1), line.slice(0, tab));
          }
        }
        const seen = new Set();
        const rows = [];
        for (const candidate of found) {
          let row;
          if (candidate.kind === "url") row = { kind: "url", value: candidate.value, path: null };
          else if (candidate.kind === "cmd") row = { kind: "cmd", value: candidate.value, path: null };
          else {
            const absolute = expand(candidate.value, base);
            const type = types.get(absolute);
            if (!type || type === "missing" || type === "other") continue;
            row = {
              kind: type === "dir" ? "dir" : IMAGE.test(absolute) ? "image" : "file",
              value: candidate.value, path: absolute,
            };
          }
          const key = row.path ?? row.value;
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

  dismiss() {
    closeOverlay(props().overlay);
  }

  move(step, cx) {
    if (!this.rows.length) return;
    this.at = (this.at + step + this.rows.length) % this.rows.length;
    cx.notify();
  }

  activate(copy, cx) {
    const row = this.rows[this.at];
    if (!row || this.busy) return;
    const value = row.path ?? row.value;
    const clipboard = () => {
      try {
        cx.write_to_clipboard(value);
        notify({ title: "Copied", body: value });
        this.dismiss();
      } catch (error) {
        this.error = error.message;
        cx.notify();
      }
    };
    // Commands are never typed into anything by themselves: this picker only
    // copies them, so nothing can be submitted by accident.
    if (copy || row.kind === "cmd") return clipboard();
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
    this.busy = value;
    this.error = "";
    // Start the opener, then close at once: a viewer inherits our pipes, so
    // waiting for exec would keep the card up until the viewer exits.
    const started = exec("xdg-open", [value]);
    notify({ title: "Opening", body: value });
    this.dismiss();
    started.then(result => {
      if (result && result.code !== 0) {
        notify({ title: "Could not open", body: `${value}: ${(result.stderr || "").trim() || result.code}`, level: "error" });
      }
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
    if (this.loading || this.busy) return;
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
    const kind = { url: "URL", cmd: "CMD", file: "FILE", image: "IMG", dir: "DIR" }[row.kind] ?? "···";
    const t = theme();
    const color = { url: t.accent, cmd: t.working, file: t.foreground, image: t.done, dir: t.muted }[row.kind] ?? t.muted;
    const value = row.value.length > 92 ? `${row.value.slice(0, 44)} … ${row.value.slice(-44)}` : row.value;
    const selected = this.rows[this.at] === row;
    return h_flex().id(`row-${row.value}`).items_center().gap(8).px(6).rounded(4).h(ROW)
      .bg(selected ? t.selected : t.popover).cursor_pointer()
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((event, cx) => {
        cx.stop_propagation();
        this.at = this.rows.indexOf(row);
        this.activate(Boolean(event.modifiers?.shift), cx);
      })
      .child(div().w(18).text_size(11).font_family("JetBrains Mono").font_semibold()
        .text_color(selected ? t.accent : t.muted)
        .child((HINTS[this.rows.indexOf(row)] ?? "·").toUpperCase()))
      .child(div().w(30).text_size(9.5).font_family("JetBrains Mono").text_color(color).child(kind))
      .child(div().flex_1().text_size(12).text_color(selected ? t.foreground : t.muted).child(value));
  }

  render() {
    const t = theme();
    const rows = this.rows;
    const start = rows.length > MAX_ROWS
      ? Math.min(Math.max(0, this.at - Math.floor(MAX_ROWS / 2)), rows.length - MAX_ROWS) : 0;
    const slice = rows.slice(start, start + MAX_ROWS);
    const status = this.loading ? "Reading this screen…"
      : this.busy ? `Opening ${this.busy}`
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
