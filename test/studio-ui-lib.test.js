const test = require("node:test");
const assert = require("node:assert");
const ui = require("../studio-ui-lib.js");

test("tab labels stay short until two tabs share a file name", () => {
  const alone = ui.tabLabels([
    { short: "demo", file: "ep01/vo/line01.wav", kind: "audio" },
    { short: "demo", file: "ep01/vo/line02.wav", kind: "audio" },
    { short: "demo", file: "", kind: "gallery" },
    { short: "demo", file: "ep01/vo", kind: "gallery" },
  ]);
  assert.deepStrictEqual(alone.map((item) => item.name), ["line01.wav", "line02.wav", "demo", "vo"]);
  assert.deepStrictEqual(alone.map((item) => item.suffix), ["", "", "", ""]);
  assert.strictEqual(alone[0].title, "demo/ep01/vo/line01.wav");
  assert.strictEqual(alone[2].title, "demo");
  assert.strictEqual(alone[3].title, "demo/ep01/vo");
});

test("duplicate file names show the parent folder, then the project", () => {
  const dupes = ui.tabLabels([
    { short: "demo", file: "ep01/vo/line01.wav", kind: "audio" },
    { short: "demo", file: "ep01/alt/line01.wav", kind: "audio" },
    { short: "demo", file: "script.md", kind: "text" },
    { short: "other", file: "script.md", kind: "text" },
  ]);
  assert.deepStrictEqual(
    dupes.map((item) => [item.name, item.suffix]),
    [
      ["line01.wav", "vo"],
      ["line01.wav", "alt"],
      ["script.md", "demo"],
      ["script.md", "other"],
    ]
  );

  const sameParent = ui.tabLabels([
    { short: "alpha", file: "vo/line01.wav", kind: "audio" },
    { short: "beta", file: "vo/line01.wav", kind: "audio" },
  ]);
  assert.deepStrictEqual(
    sameParent.map((item) => item.suffix),
    ["alpha/vo", "beta/vo"]
  );
});

test("sibling step stays in the folder and stops at the ends", () => {
  const files = ["ep/c.wav", "other/a.wav", "ep/a.wav", "ep/b.wav"];
  assert.strictEqual(ui.folderOf("ep/b.wav"), "ep");
  assert.strictEqual(ui.stepSibling(files, "ep/b.wav", 1), "ep/c.wav");
  assert.strictEqual(ui.stepSibling(files, "ep/b.wav", -1), "ep/a.wav");
  assert.strictEqual(ui.stepSibling(files, "ep/a.wav", -1), null);
  assert.strictEqual(ui.stepSibling(files, "ep/c.wav", 1), null);
  assert.strictEqual(ui.stepSibling(files, "missing.wav", 1), null);
  assert.strictEqual(ui.stepSibling([{ name: "ep/a.wav" }, { name: "ep/b.wav" }], "ep\\a.wav", 1), "ep/b.wav");
});

test("moveSelection orders names and starts from the end when nothing is current", () => {
  assert.strictEqual(ui.moveSelection(["b.wav", "a.wav", "c.wav"], null, 1), "a.wav");
  assert.strictEqual(ui.moveSelection(["a.wav", "b.wav"], null, -1), "b.wav");
  assert.strictEqual(ui.moveSelection(["a.wav", "b.wav", "c.wav"], "b.wav", 1), "c.wav");
  assert.strictEqual(ui.moveSelection(["a.wav", "b.wav", "c.wav"], "a.wav", -1), null);
  assert.strictEqual(ui.moveSelection(["a.wav", "b.wav"], "b.wav", 1), null);
  assert.strictEqual(ui.moveSelection([], "a.wav", 1), null);
});

test("next unreviewed skips verdicts, skips the current file, and wraps", () => {
  const files = ["a.wav", "b.wav", "c.wav", "d.wav"];
  const reviewed = (name) => name === "b.wav" || name === "d.wav";
  assert.strictEqual(ui.hasVerdict({ verdict: "yes" }), true);
  assert.strictEqual(ui.hasVerdict({ verdict: "no" }), true);
  assert.strictEqual(ui.hasVerdict({ verdict: null, note: "later" }), false);
  assert.strictEqual(ui.hasVerdict(null), false);
  assert.strictEqual(ui.nextUnreviewedName(files, "a.wav", reviewed), "c.wav");
  assert.strictEqual(ui.nextUnreviewedName(files, "c.wav", reviewed), "a.wav");
  assert.strictEqual(ui.nextUnreviewedName(files, null, reviewed), "a.wav");
  assert.strictEqual(ui.nextUnreviewedName(["a.wav"], "a.wav", () => false), null);
  assert.strictEqual(ui.nextUnreviewedName(files, "a.wav", () => true), null);

  const mixed = ["vo/a.wav", "vo/b.wav", "alt/a.wav"];
  const map = { "vo/a.wav": { verdict: "yes" }, "alt/a.wav": { verdict: null, note: "x" } };
  assert.strictEqual(ui.nextUnreviewedName(mixed, "vo/a.wav", map), "vo/b.wav");
  assert.strictEqual(ui.nextUnreviewedName(mixed, "vo/b.wav", map), null);
});

test("parseQuickQuery keeps filters and free text, last filter wins", () => {
  assert.deepStrictEqual(ui.parseQuickQuery("  type:audio  line01  ext:.WAV short:De reviewed:Yes has:note "), {
    text: "line01",
    type: "audio",
    ext: "wav",
    short: "De",
    reviewed: "yes",
    has: "note",
  });
  assert.deepStrictEqual(ui.parseQuickQuery("alpha type:audio type:video beta"), {
    text: "alpha beta",
    type: "video",
    ext: "",
    short: "",
    reviewed: "",
    has: "",
  });
  assert.strictEqual(ui.parseQuickQuery("foo:bar line").text, "foo:bar line");
  assert.deepStrictEqual(ui.parseQuickQuery(""), {
    text: "",
    type: "",
    ext: "",
    short: "",
    reviewed: "",
    has: "",
  });
});

test("quick open filters type, ext, short, reviewed, and has:note", () => {
  const entries = [
    { short: "demo", file: "ep/line01.wav", verdict: "yes", note: "" },
    { short: "demo", file: "ep/line01.mp3", verdict: null, note: "later" },
    { short: "demo", file: "ep/line01.txt" },
    { short: "demo", file: "ep/script.md", note: "  " },
    { short: "demo", file: "ep/cover.png" },
    { short: "demo", file: "ep/clip.mp4" },
    { short: "demo", file: "ep/notes.json" },
    { short: "demo", file: "ep/take.wav", hasTimestampNotes: true },
    { short: "demo", file: "ep/take.wav.review.md" },
    { short: "demo", file: "ep/plain.wav", verdict: "no", note: "" },
    { short: "other", file: "line01.wav", note: "x" },
    { short: "demo", file: "ep\\mixed.WaV" },
  ];

  const paths = (query) => ui.matchQuickOpen(entries, query).map((hit) => hit.path);

  assert.deepStrictEqual(paths("type:md").sort(), [
    "demo/ep/line01.txt",
    "demo/ep/script.md",
    "demo/ep/take.wav.review.md",
  ]);
  assert.deepStrictEqual(paths("type:text").sort(), paths("type:md").sort());
  assert.deepStrictEqual(paths("type:audio ext:wav"), [
    "demo/ep/line01.wav",
    "demo/ep/mixed.WaV",
    "demo/ep/plain.wav",
    "demo/ep/take.wav",
    "other/line01.wav",
  ]);
  assert.deepStrictEqual(paths("ext:.mp3"), ["demo/ep/line01.mp3"]);
  assert.deepStrictEqual(paths("type:image"), ["demo/ep/cover.png"]);
  assert.deepStrictEqual(paths("type:video"), ["demo/ep/clip.mp4"]);
  assert.deepStrictEqual(paths("type:other"), ["demo/ep/notes.json"]);
  assert.deepStrictEqual(paths("type:nope"), []);
  assert.deepStrictEqual(paths("type:audio short:demo line01"), [
    "demo/ep/line01.mp3",
    "demo/ep/line01.wav",
  ]);
  assert.deepStrictEqual(paths("short:OTH"), ["other/line01.wav"]);
  assert.deepStrictEqual(paths("reviewed:yes"), ["demo/ep/line01.wav"]);
  assert.deepStrictEqual(paths("reviewed:no"), ["demo/ep/plain.wav"]);
  assert.deepStrictEqual(paths("reviewed:none type:audio ext:wav short:demo"), [
    "demo/ep/mixed.WaV",
    "demo/ep/take.wav",
  ]);
  assert.deepStrictEqual(paths("reviewed:maybe"), []);
  assert.deepStrictEqual(paths("has:note"), [
    "demo/ep/line01.mp3",
    "demo/ep/take.wav",
    "demo/ep/take.wav.review.md",
    "other/line01.wav",
  ]);
  assert.deepStrictEqual(paths("has:label"), []);
  assert.deepStrictEqual(paths("line zz"), []);

  const hit = ui.matchQuickOpen(entries, "ep line01").find((item) => item.file === "ep/line01.wav");
  assert.ok(hit);
  assert.ok(hit.ranges.length >= 2);
});

test("quick open scores basename and contiguous matches above sparse directory hits", () => {
  const entries = [
    { short: "demo", file: "line/notes.txt" },
    { short: "demo", file: "ep/line.txt" },
    { short: "s", file: "l-i-n-e.txt" },
    { short: "s", file: "line.txt" },
  ];
  const ranked = ui.matchQuickOpen(entries, "line");
  const byPath = Object.fromEntries(ranked.map((hit) => [hit.path, hit.score]));
  assert.ok(byPath["demo/ep/line.txt"] > byPath["demo/line/notes.txt"]);
  assert.ok(byPath["s/line.txt"] > byPath["s/l-i-n-e.txt"]);

  const marked = ui.matchQuickOpen([{ short: "demo", file: "ep/line.txt" }], "line")[0];
  assert.strictEqual(marked.path, "demo/ep/line.txt");
  assert.deepStrictEqual(marked.ranges, [[8, 12]]);
  assert.strictEqual(marked.kind, "text");

  const both = ui.matchQuickOpen([{ short: "demo", file: "ep/line.txt" }], "ep line")[0];
  assert.deepStrictEqual(both.ranges, [[5, 7], [8, 12]]);
});

test("quick open caps results and sorts an empty query by path", () => {
  const entries = [];
  for (let i = 0; i < 60; i++) entries.push({ short: "s", file: "f" + String(i).padStart(2, "0") + ".txt" });
  const capped = ui.matchQuickOpen(entries, "");
  assert.strictEqual(capped.length, 50);
  assert.strictEqual(capped[0].file, "f00.txt");
  assert.strictEqual(capped[49].file, "f49.txt");
  assert.strictEqual(ui.matchQuickOpen(entries, "", 3).length, 3);
  assert.deepStrictEqual(ui.matchQuickOpen(null, "a"), []);
});
