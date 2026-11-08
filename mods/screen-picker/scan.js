// Pure screen scanning and path arithmetic: no filesystem access, so it runs
// unchanged in the Herdr mod runtime and under `node --test`.
import { join } from "path";

const NOISE = "[^\\s<>\"'`|]"; // what ends a bare token
const URL_RE = new RegExp("(?:https?:\\/\\/|www\\.)" + NOISE + "+", "gi");
const QUOTE_RE = /"([^"\r\n]{1,400})"|'([^'\r\n]{1,400})'/g;
// POSIX absolute, `~`, `./`, `../`, a Windows drive (`C:\` or `C:/`) or UNC.
const PATH_RE = new RegExp("(?:[A-Za-z]:[\\\\/]|\\\\\\\\|~[\\\\/]|\\.{1,2}[\\\\/]|\\/)" + NOISE + "*", "g");
const COMMAND_RE = /(?:^|:[ \t]+)[ \t]*!(\S[^\r\n]*)$/gm;
// `~/proj ❯ ` looks exactly like a path: skip when what follows on the line is
// a prompt glyph, either alone or opening the line that was typed after it.
const PROMPT_TAIL = /^[ \t]*[\u276f>$%#\u00bb\u203a][ \t]*\r?$/;
// A line that starts with a folder then a prompt glyph is a shell prompt with
// the typed command echoed after it, not a folder worth badging.
const PROMPT_OPEN = /^[ \t]*[\u276f>$%#\u00bb\u203a][ \t]/;

const PATH_START = /^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\.{1,2}[\\/]|\/)/;

/** Drops trailing sentence punctuation and an unbalanced closing bracket. */
export function tidy(value) {
  let out = value.replace(/[.,;:!?'"]+$/, "");
  if (out.endsWith(")") && out.split("(").length < out.split(")").length) out = out.slice(0, -1);
  if (out.endsWith("]") && out.split("[").length < out.split("]").length) out = out.slice(0, -1);
  return out;
}

export const looksLikePath = value => value.length > 1 && PATH_START.test(value);
const looksLikeUrl = value => /^(?:https?:\/\/|www\.)/i.test(value);

function promptTailRemainder(text, end) {
  const lineEnd = text.indexOf("\n", end);
  return text.slice(end, lineEnd < 0 ? text.length : lineEnd);
}

/**
 * URLs, filesystem paths and `!commands` in screen order.
 * Each candidate: {kind: "url" | "path" | "cmd", value, at, end, quoted?}.
 */
export function candidates(text) {
  if (typeof text !== "string" || !text) return [];
  const kept = [];
  const inside = (start, end) => kept.some(span => start >= span.at && end <= span.end);

  // Quoted strings first: they are the only way a path may contain spaces, and
  // they may hold a URL.
  for (const match of text.matchAll(QUOTE_RE)) {
    const content = tidy((match[1] ?? match[2] ?? "").trim());
    const start = match.index, end = start + match[0].length;
    if (looksLikeUrl(content)) kept.push({ kind: "url", value: content, at: start, end });
    else if (looksLikePath(content)) kept.push({ kind: "path", value: content, at: start, end, quoted: true });
  }

  for (const match of text.matchAll(URL_RE)) {
    const value = tidy(match[0]);
    const start = match.index, end = start + match[0].length;
    if (!value || inside(start, end)) continue;
    kept.push({ kind: "url", value, at: start, end });
  }

  for (const match of text.matchAll(PATH_RE)) {
    const start = match.index, end = start + match[0].length;
    if (inside(start, end)) continue;
    const value = tidy(match[0]);
    if (!looksLikePath(value)) continue;
    const rest = promptTailRemainder(text, end);
    if (PROMPT_TAIL.test(rest)) continue;
    // Only at the start of a line: `/tmp ❯ cat x` is a prompt, while
    // `see /tmp/x # note` is a path followed by prose.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    if (PROMPT_OPEN.test(rest) && /^[ \t]*$/.test(text.slice(lineStart, start))) continue;
    kept.push({ kind: "path", value, at: start, end });
  }

  for (const match of text.matchAll(COMMAND_RE)) {
    const value = `!${match[1].trim()}`;
    const start = match.index + match[0].indexOf("!");
    kept.push({ kind: "cmd", value, at: start, end: match.index + match[0].length });
  }

  return kept.sort((a, b) => a.at - b.at || a.end - b.end);
}

const ROOT = /^(?:[A-Za-z]:[\\/]|)$/;

/** `C:\`, `/` and `\\server\share` keep their separator; others lose it. */
export function normalize(value) {
  if (typeof value !== "string" || value.length <= 1) return value;
  if (ROOT.test(value) || /^[A-Za-z]:[\\/]$/.test(value)) return value;
  return value.replace(/[\\/]+$/, "");
}

/** `~`, a drive, a UNC share or `/` is absolute; anything else is relative. */
export function absolutePath(value, base, homeDir) {
  if (value === "~" || /^~[\\/]/.test(value)) return normalize(join(homeDir, value.slice(1)));
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)) return normalize(value);
  return normalize(join(base, value));
}
