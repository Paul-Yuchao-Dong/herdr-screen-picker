import test from "node:test";
import assert from "node:assert/strict";
import { candidates, tidy, looksLikePath } from "../mods/screen-picker/scan.js";

const kinds = list => list.map(c => `${c.kind}:${c.value}`);

test("urls: bare, www, trailing punctuation", () => {
  const text = "see https://herdr.dev/docs. and www.example.com/?q=a+b, ok";
  assert.deepEqual(kinds(candidates(text)), [
    "url:https://herdr.dev/docs",
    "url:www.example.com/?q=a+b",
  ]);
});

test("urls: a quoted url is one url, not a quoted string plus a path", () => {
  const text = 'link "https://example.com/a/b?c=1" here';
  assert.deepEqual(kinds(candidates(text)), ["url:https://example.com/a/b?c=1"]);
});

test("paths: posix absolute, home, dot-relative", () => {
  const text = "a /tmp/x.txt b ~/proj/notes.md c ./build out ../up/y";
  assert.deepEqual(kinds(candidates(text)), [
    "path:/tmp/x.txt",
    "path:~/proj/notes.md",
    "path:./build",
    "path:../up/y",
  ]);
});

test("paths: quoted path keeps its spaces", () => {
  const text = 'open "/tmp/link hints inline.png" now';
  assert.deepEqual(kinds(candidates(text)), ["path:/tmp/link hints inline.png"]);
  assert.equal(candidates(text)[0].quoted, true);
});

test("paths: unbalanced closing bracket is dropped", () => {
  assert.deepEqual(kinds(candidates("(see /tmp/a.txt)")), ["path:/tmp/a.txt"]);
  assert.deepEqual(kinds(candidates("see /tmp/a(1).txt")), ["path:/tmp/a(1).txt"]);
});

test("paths: windows drive paths, both separators", () => {
  const text = String.raw`open C:\Users\me\notes.txt or C:/Users/me/shot.png now`;
  assert.deepEqual(kinds(candidates(text)), [
    String.raw`path:C:\Users\me\notes.txt`,
    "path:C:/Users/me/shot.png",
  ]);
});

test("paths: windows quoted path with spaces and a crlf screen", () => {
  const text = 'x "C:\\Users\\me\\My Files\\a.txt"\r\nnext\r\n';
  assert.deepEqual(kinds(candidates(text)), [String.raw`path:C:\Users\me\My Files\a.txt`]);
});

test("paths: UNC share", () => {
  assert.deepEqual(kinds(candidates(String.raw`copy \\server\share\f.txt here`)), [
    String.raw`path:\\server\share\f.txt`,
  ]);
});

test("paths: drive without a separator is not a path", () => {
  assert.deepEqual(kinds(candidates("ratio C:2 and a:b")), []);
});

test("paths: a prompt tail is not a folder", () => {
  for (const text of ["~/proj \u276f ", "/tmp/work $ ", "/srv/app #", "C:\\Users\\me> "]) {
    assert.deepEqual(kinds(candidates(text)), [], text);
  }
  // but a path that is followed by words still counts
  assert.deepEqual(kinds(candidates("~/proj sub")), ["path:~/proj"]);
});

test("paths: trailing separator survives", () => {
  assert.deepEqual(kinds(candidates("ls ~/proj/")), ["path:~/proj/"]);
});

test("commands: line start, after a colon, not mid-word", () => {
  const text = ["!git status --short", "Run this: !pwd", "wow!pwd", "  !make test"].join("\n");
  assert.deepEqual(kinds(candidates(text)), [
    "cmd:!git status --short",
    "cmd:!pwd",
    "cmd:!make test",
  ]);
});

test("order is screen order, and duplicates stay separate candidates", () => {
  const text = "b /tmp/b a /tmp/a\n/tmp/b";
  assert.deepEqual(kinds(candidates(text)), ["path:/tmp/b", "path:/tmp/a", "path:/tmp/b"]);
});

test("an empty quote or a word in quotes yields nothing", () => {
  assert.deepEqual(kinds(candidates('say "hello" and "" and \'x\'')), []);
});

test("tidy keeps meaningful trailing slashes and brackets", () => {
  assert.equal(tidy("https://x/y."), "https://x/y");
  assert.equal(tidy("~/p/"), "~/p/");
  assert.equal(tidy("/tmp/a(1)"), "/tmp/a(1)");
  assert.equal(tidy("/tmp/a)"), "/tmp/a");
});

test("looksLikePath rejects bare filenames", () => {
  for (const value of ["notes.md", "README", "C:", "", "/"]) assert.equal(looksLikePath(value), false, value);
  for (const value of ["/x", "~/x", "./x", "C:\\x", "\\\\srv\\x"]) assert.equal(looksLikePath(value), true, value);
});

// ---- path arithmetic (home and base are injected, so this is platform-agnostic)

import { join } from "node:path";
import { normalize, absolutePath } from "../mods/screen-picker/scan.js";

test("normalize keeps roots, drops trailing separators", () => {
  assert.equal(normalize("/tmp/x/"), "/tmp/x");
  assert.equal(normalize("/"), "/");
  assert.equal(normalize("C:\\"), "C:\\");
  assert.equal(normalize("C:\\Users\\me\\"), "C:\\Users\\me");
  assert.equal(normalize("\\\\server\\share\\x\\"), "\\\\server\\share\\x");
});

test("absolutePath: absolute forms pass through", () => {
  const home = "/home/me", base = "/home/me/proj";
  assert.equal(absolutePath("/tmp/a.txt", base, home), "/tmp/a.txt");
  assert.equal(absolutePath(String.raw`C:\Users\me\a.txt`, base, home), String.raw`C:\Users\me\a.txt`);
  assert.equal(absolutePath("C:/Users/me/a.txt", base, home), "C:/Users/me/a.txt");
  assert.equal(absolutePath(String.raw`\\srv\share\a.txt`, base, home), String.raw`\\srv\share\a.txt`);
});

test("absolutePath: home and relative forms join", () => {
  const home = "/home/me", base = join("/home/me", "proj");
  assert.equal(absolutePath("~/notes.md", base, home), join(home, "notes.md"));
  assert.equal(absolutePath("~", base, home), home);
  assert.equal(absolutePath("./build", base, home), join(base, "build"));
  assert.equal(absolutePath("../up/x", base, home), join(home, "up/x"));
  assert.equal(absolutePath("sub/file.txt", base, home), join(base, "sub/file.txt"));
});

test("paths: a prompt with the typed line is still a prompt", () => {
  // the terminal echoes `/tmp ❯ cat /tmp/x.txt`: only the argument is a path
  assert.deepEqual(kinds(candidates("/tmp \u276f cat /tmp/x.txt")), ["path:/tmp/x.txt"]);
  assert.deepEqual(kinds(candidates("~/proj $ ls -la")), []);
});

test("paths: a path followed by prose still counts", () => {
  assert.deepEqual(kinds(candidates("see /tmp/x # note")), ["path:/tmp/x"]);
  assert.deepEqual(kinds(candidates("~/proj sub")), ["path:~/proj"]);
});
