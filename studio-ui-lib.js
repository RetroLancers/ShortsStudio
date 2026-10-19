// Pure helpers for the review page: tab labels, sibling order, next unreviewed,
// and quick-open query parsing / fuzzy match. Loaded by index.html from
// /studio-ui-lib.js and required by node:test.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StudioUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeRel(file) {
    return String(file || "").replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function baseName(file) {
    const norm = normalizeRel(file);
    const index = norm.lastIndexOf("/");
    return index < 0 ? norm : norm.slice(index + 1);
  }

  function folderOf(file) {
    const norm = normalizeRel(file);
    const index = norm.lastIndexOf("/");
    return index < 0 ? "" : norm.slice(0, index);
  }

  function parentSegment(file) {
    const parent = folderOf(file);
    if (!parent) return "";
    const index = parent.lastIndexOf("/");
    return index < 0 ? parent : parent.slice(index + 1);
  }

  function countOf(items) {
    const counts = new Map();
    for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
    return counts;
  }

  function tabBaseLabel(tab) {
    const file = normalizeRel(tab && tab.file);
    if (tab && tab.kind === "gallery") return file ? baseName(file) : String((tab && tab.short) || "");
    return baseName(file);
  }

  function tabTitle(tab) {
    const short = String((tab && tab.short) || "");
    const file = normalizeRel(tab && tab.file);
    if (!file) return short;
    return short ? short + "/" + file : file;
  }

  // When two open tabs share a file name, suffix is the parent folder.
  // A file in the project root uses the project name. If that still collides, prefix the project.
  function tabLabels(tabs) {
    const list = Array.isArray(tabs) ? tabs : [];
    const bases = list.map(tabBaseLabel);
    const baseCounts = countOf(bases);
    const draft = list.map((tab, i) => {
      const name = bases[i];
      if ((baseCounts.get(name) || 0) < 2) return { name: name, suffix: "" };
      const parent = parentSegment(tab && tab.file);
      return { name: name, suffix: parent || String((tab && tab.short) || "") };
    });
    const pairCounts = countOf(draft.map((item) => item.name + "\0" + item.suffix));
    return draft.map((item, i) => {
      const title = tabTitle(list[i]);
      const hits = pairCounts.get(item.name + "\0" + item.suffix) || 0;
      if (!item.suffix || hits < 2) return { name: item.name, suffix: item.suffix, title: title };
      const short = String((list[i] && list[i].short) || "");
      const suffix = short && item.suffix !== short && item.suffix.indexOf(short + "/") !== 0
        ? short + "/" + item.suffix
        : item.suffix;
      return { name: item.name, suffix: suffix, title: title };
    });
  }

  function namesOf(files) {
    const names = [];
    for (const item of files || []) {
      const name = typeof item === "string" ? item : item && item.name;
      if (typeof name !== "string" || name === "") continue;
      names.push(normalizeRel(name));
    }
    return names;
  }

  function uniqueSorted(names) {
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }

  function siblingsInFolder(files, current) {
    const folder = folderOf(current);
    return uniqueSorted(namesOf(files).filter((name) => folderOf(name) === folder));
  }

  function stepSibling(files, current, delta) {
    const names = siblingsInFolder(files, current);
    const index = names.indexOf(normalizeRel(current));
    if (index < 0) return null;
    const next = index + Number(delta);
    if (next < 0 || next >= names.length) return null;
    return names[next];
  }

  // names are one folder, or a mixed list filtered to current's folder.
  // Missing current starts at the first name (delta > 0) or the last (delta < 0).
  function moveSelection(files, current, delta) {
    const names = uniqueSorted(namesOf(files));
    if (!names.length || !delta) return null;
    const index = current == null || current === "" ? -1 : names.indexOf(normalizeRel(current));
    if (index < 0) return delta < 0 ? names[names.length - 1] : names[0];
    const next = index + Number(delta);
    if (next < 0 || next >= names.length) return null;
    return names[next];
  }

  function hasVerdict(review) {
    return Boolean(review && (review.verdict === "yes" || review.verdict === "no"));
  }

  function asReviewed(reviewed) {
    if (typeof reviewed === "function") return reviewed;
    return function (name) {
      return hasVerdict(reviewed && reviewed[name]);
    };
  }

  // Next file after current with no verdict, wrapping once. Skips current.
  // Null when every other file has a verdict, or the folder is empty.
  function nextUnreviewedName(files, current, reviewed) {
    const isReviewed = asReviewed(reviewed);
    const currentName = current == null || current === "" ? null : normalizeRel(current);
    let names = namesOf(files);
    if (currentName) {
      const folder = folderOf(currentName);
      names = names.filter((name) => folderOf(name) === folder);
    }
    names = uniqueSorted(names);
    if (!names.length) return null;
    const start = currentName == null ? -1 : names.indexOf(currentName);
    const from = start < 0 ? 0 : start + 1;
    for (let i = 0; i < names.length; i++) {
      const index = (from + i) % names.length;
      if (start >= 0 && index === start) continue;
      if (!isReviewed(names[index])) return names[index];
    }
    return null;
  }

  const QUICK_TYPES = { audio: 1, video: 1, image: 1, md: 1, text: 1, other: 1 };
  const QUICK_REVIEWED = { yes: 1, no: 1, none: 1 };

  function quickExt(file) {
    const base = baseName(file);
    const index = base.lastIndexOf(".");
    if (index <= 0) return "";
    return base.slice(index + 1).toLowerCase();
  }

  // Sidebar buckets. type:md and type:text both mean .md and .txt.
  function quickTypeBucket(file) {
    const ext = quickExt(file);
    if (ext === "md" || ext === "txt") return "text";
    if (ext === "wav" || ext === "mp3") return "audio";
    if (ext === "mp4") return "video";
    if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return "image";
    return "other";
  }

  function parseQuickQuery(raw) {
    const query = { text: "", type: "", ext: "", short: "", reviewed: "", has: "" };
    const words = [];
    const tokens = String(raw || "").trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const match = /^(type|ext|short|reviewed|has):(.+)$/i.exec(token);
      if (!match) {
        words.push(token);
        continue;
      }
      const key = match[1].toLowerCase();
      let value = match[2];
      if (key === "ext") value = value.replace(/^\.+/, "");
      if (key === "short") query.short = value;
      else query[key] = value.toLowerCase();
    }
    query.text = words.join(" ");
    return query;
  }

  function mergeRanges(ranges) {
    const list = (ranges || [])
      .filter((range) => range && range[1] > range[0])
      .map((range) => [range[0], range[1]])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const range of list) {
      const last = out[out.length - 1];
      if (!last || range[0] > last[1]) out.push([range[0], range[1]]);
      else if (range[1] > last[1]) last[1] = range[1];
    }
    return out;
  }

  // Best-scoring subsequence, not the first one. Contiguous runs and basename
  // hits score higher, so "ep" prefers the folder "ep" over the "e" in "demo".
  // ranges are UTF-16 indexes into text. Returns null when query is not a subsequence.
  function subsequenceHit(query, text) {
    const q = String(query || "").toLowerCase();
    const raw = String(text || "");
    const t = raw.toLowerCase();
    if (!q) return { score: 0, ranges: [] };
    if (t.length !== raw.length) return null;
    const slash = t.lastIndexOf("/");
    const baseStart = slash < 0 ? 0 : slash + 1;
    const memo = new Map();

    function charScore(index, prev) {
      let add = 2;
      if (index >= baseStart) add += 8;
      if (prev >= 0 && index === prev + 1) add += 10;
      else {
        const boundary = index === 0 ? "/" : t[index - 1];
        if (boundary === "/" || boundary === "-" || boundary === "_" || boundary === "." || boundary === " ") add += 5;
      }
      return add;
    }

    function best(qi, prev) {
      const key = qi + ":" + prev;
      if (memo.has(key)) return memo.get(key);
      if (qi === q.length) {
        const done = { score: 0, indexes: [] };
        memo.set(key, done);
        return done;
      }
      let winner = null;
      const start = prev < 0 ? 0 : prev + 1;
      for (let i = start; i < t.length; i++) {
        if (t[i] !== q[qi]) continue;
        const rest = best(qi + 1, i);
        if (!rest) continue;
        const score = charScore(i, prev) + rest.score;
        if (!winner || score > winner.score) winner = { score: score, indexes: [i].concat(rest.indexes) };
      }
      memo.set(key, winner);
      return winner;
    }

    const found = best(0, -1);
    if (!found) return null;
    let score = found.score;
    const base = t.slice(baseStart);
    if (base === q) score += 80;
    else if (base.startsWith(q)) score += 40;
    else if (base.includes(q)) score += 20;
    if (t.includes(q)) score += 12;
    const ranges = [];
    let runStart = found.indexes[0];
    let prevIndex = found.indexes[0];
    for (let k = 1; k <= found.indexes.length; k++) {
      const index = found.indexes[k];
      if (k === found.indexes.length || index !== prevIndex + 1) {
        ranges.push([runStart, prevIndex + 1]);
        runStart = index;
      }
      prevIndex = index;
    }
    return { score: score, ranges: mergeRanges(ranges) };
  }

  function entryVerdict(entry) {
    const verdict = entry && entry.verdict;
    return verdict === "yes" || verdict === "no" ? verdict : null;
  }

  function entryHasNote(entry) {
    if (String((entry && entry.note) || "").trim()) return true;
    if (entry && entry.hasTimestampNotes) return true;
    return normalizeRel(entry && entry.file).toLowerCase().endsWith(".review.md");
  }

  function entryPassesQuick(entry, query) {
    const file = normalizeRel(entry && entry.file);
    if (!file) return false;
    if (query.type) {
      if (!QUICK_TYPES[query.type]) return false;
      const bucket = quickTypeBucket(file);
      const want = query.type === "md" || query.type === "text" ? "text" : query.type;
      if (bucket !== want) return false;
    }
    if (query.ext && quickExt(file) !== query.ext) return false;
    if (query.short && String(entry.short || "").toLowerCase().indexOf(query.short.toLowerCase()) < 0) return false;
    if (query.reviewed) {
      if (!QUICK_REVIEWED[query.reviewed]) return false;
      const verdict = entryVerdict(entry);
      if (query.reviewed === "none") {
        if (verdict) return false;
      } else if (verdict !== query.reviewed) return false;
    }
    if (query.has) {
      if (query.has !== "note") return false;
      if (!entryHasNote(entry)) return false;
    }
    return true;
  }

  // entries: { short, file, verdict, note, hasTimestampNotes }.
  // Free-text tokens are AND subsequence matches on "short/file".
  // limit defaults to 50. Highest score first, then path.
  function matchQuickOpen(entries, rawQuery, limit) {
    const query = rawQuery && typeof rawQuery === "object" ? {
      text: String(rawQuery.text || ""),
      type: String(rawQuery.type || "").toLowerCase(),
      ext: String(rawQuery.ext || "").replace(/^\.+/, "").toLowerCase(),
      short: String(rawQuery.short || ""),
      reviewed: String(rawQuery.reviewed || "").toLowerCase(),
      has: String(rawQuery.has || "").toLowerCase(),
    } : parseQuickQuery(rawQuery);
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const words = query.text ? query.text.split(/\s+/).filter(Boolean) : [];
    const hits = [];
    const list = Array.isArray(entries) ? entries : [];
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entryPassesQuick(entry, query)) continue;
      const file = normalizeRel(entry.file);
      const short = String(entry.short || "");
      const path = short ? short + "/" + file : file;
      let score = 0;
      let ranges = [];
      let ok = true;
      for (const word of words) {
        const hit = subsequenceHit(word, path);
        if (!hit) {
          ok = false;
          break;
        }
        score += hit.score;
        ranges = ranges.concat(hit.ranges);
      }
      if (!ok) continue;
      hits.push({
        short: short,
        file: file,
        path: path,
        kind: quickTypeBucket(file),
        score: score,
        ranges: mergeRanges(ranges),
        verdict: entryVerdict(entry),
        note: String(entry.note || ""),
        hasNote: entryHasNote(entry),
      });
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, cap);
  }

  return {
    baseName: baseName,
    folderOf: folderOf,
    tabLabels: tabLabels,
    tabTitle: tabTitle,
    stepSibling: stepSibling,
    moveSelection: moveSelection,
    hasVerdict: hasVerdict,
    nextUnreviewedName: nextUnreviewedName,
    parseQuickQuery: parseQuickQuery,
    matchQuickOpen: matchQuickOpen,
    quickTypeBucket: quickTypeBucket,
  };
});
