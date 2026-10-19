// Shared by server.js and mcp.js.
// Text files (.md, .txt) can be saved. Each save copies the current file into
// <short>/.studio_backups/ first. Media (audio, video, images) is read-only.
// Unknown types are listed with kind "other". The only media-mode write is
// <mediafile>.review.md, a normal text file next to the media. File review
// status (yes/no + note) lives in reviews.json. Add an extension to TEXT_EXT /
// AUDIO_EXT / VIDEO_EXT / IMAGE_EXT to support a new type.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const STUDIO_DIR = __dirname;
// Root resolution order: SHORTS_ROOT env var, then "root" in studio.config.json
// (gitignored, local only), then ./workspace next to this file.
const DEFAULT_ROOT = path.join(STUDIO_DIR, "workspace");
const LOCAL_CONFIG = path.join(STUDIO_DIR, "studio.config.json");

function configuredRoot() {
  try {
    const cfg = JSON.parse(fs.readFileSync(LOCAL_CONFIG, "utf8"));
    return cfg && typeof cfg.root === "string" && cfg.root.trim() ? cfg.root : null;
  } catch {
    return null;
  }
}

const TEXT_EXT = new Set([".md", ".txt"]);
const AUDIO_EXT = new Set([".wav", ".mp3"]);
const VIDEO_EXT = new Set([".mp4"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

class StudioError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.name = "StudioError";
    this.status = status;
    this.extra = extra || null;
  }
}

let rootCache = null;

function getRoot() {
  if (rootCache) return rootCache;
  const raw = path.resolve(process.env.SHORTS_ROOT || configuredRoot() || DEFAULT_ROOT);
  try {
    rootCache = fs.realpathSync(raw);
  } catch {
    rootCache = raw;
  }
  return rootCache;
}

function controlPath() {
  return path.resolve(process.env.CONTROL_PATH || path.join(STUDIO_DIR, "control.json"));
}

function reviewsPath() {
  return path.resolve(process.env.REVIEWS_PATH || path.join(STUDIO_DIR, "reviews.json"));
}

function ensureInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new StudioError(400, "Path escapes SHORTS_ROOT");
  }
}

function assertSegment(seg, label) {
  if (typeof seg !== "string" || seg.length === 0 || seg.length > 240) {
    throw new StudioError(400, "Invalid " + label);
  }
  if (seg === "." || seg === ".." || seg.startsWith(".")) {
    throw new StudioError(400, "Invalid " + label);
  }
  if (/[\\/\0:]/.test(seg) || path.isAbsolute(seg)) {
    throw new StudioError(400, "Invalid " + label);
  }
}

function kindFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (TEXT_EXT.has(ext)) return "text";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  return "other";
}

function mimeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function resolveShortDir(short) {
  assertSegment(short, "short");
  const abs = path.resolve(getRoot(), short);
  ensureInside(getRoot(), abs);
  return abs;
}

// file is a relative path inside the short, using / or \ separators.
// allow: "text" | "media" | "known" | "any"
function resolveUserFile(short, file, allow) {
  const shortDir = resolveShortDir(short);
  if (typeof file !== "string" || file.length === 0 || file.length > 500) {
    throw new StudioError(400, "Invalid file");
  }
  if (/[\\/]$/.test(file)) throw new StudioError(400, "Invalid file");
  const parts = file.split(/[\\/]/);
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) {
    throw new StudioError(400, "Invalid file");
  }
  for (const part of parts) assertSegment(part, "file");
  const abs = path.resolve(shortDir, ...parts);
  ensureInside(shortDir, abs);
  ensureInside(getRoot(), abs);
  const kind = kindFor(parts[parts.length - 1]);
  if (allow === "text" && kind !== "text") {
    throw new StudioError(400, "Only .md and .txt files can be read or written as text");
  }
  if (allow === "media" && kind !== "audio" && kind !== "video" && kind !== "image") {
    throw new StudioError(400, "Not a media file");
  }
  if (allow === "known" && kind === "other") throw new StudioError(400, "Unsupported file type");
  return { abs, kind, rel: parts.join("/") };
}

async function assertRealInside(abs) {
  try {
    const real = await fsp.realpath(abs);
    ensureInside(getRoot(), real);
    return real;
  } catch (err) {
    if (err instanceof StudioError) throw err;
    if (err.code === "ENOENT") return abs;
    throw err;
  }
}

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function readRaw(abs) {
  const buf = await fsp.readFile(abs);
  const stat = await fsp.stat(abs);
  const raw = buf.toString("utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const content = eol === "\r\n" ? raw.replace(/\r\n/g, "\n") : raw;
  return {
    content,
    raw,
    eol,
    hash: hashBuffer(buf),
    mtime: Math.round(stat.mtimeMs),
    size: stat.size,
  };
}

async function walkFiles(dir, rel, into) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      throw new StudioError(404, "Short not found");
    }
    throw err;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const relChild = rel ? rel + "/" + ent.name : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(abs, relChild, into);
      continue;
    }
    if (!ent.isFile()) continue;
    const kind = kindFor(ent.name);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      continue;
    }
    const item = { name: relChild, mtime: Math.round(stat.mtimeMs), size: stat.size };
    if (kind === "text") into.text.push(item);
    else into.media.push(Object.assign({ kind }, item));
  }
}

async function listFiles(short) {
  const dir = resolveShortDir(short);
  const into = { text: [], media: [] };
  await walkFiles(dir, "", into);
  into.text.sort((a, b) => a.name.localeCompare(b.name));
  into.media.sort((a, b) => a.name.localeCompare(b.name));
  const mtime = into.text.reduce((max, file) => Math.max(max, file.mtime), 0);
  return { short, mtime, text: into.text, media: into.media };
}

async function listShorts() {
  const root = getRoot();
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return { root, shorts: [], missing: true };
    throw err;
  }
  const shorts = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    try {
      const info = await listFiles(ent.name);
      if (info.text.length === 0 && info.media.length === 0) continue;
      shorts.push({
        name: ent.name,
        mtime: info.mtime,
        text: info.text,
        media: info.media,
      });
    } catch {
      // Skip folders we cannot read.
    }
  }
  shorts.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  return { root, shorts };
}

async function readText(short, file) {
  const located = resolveUserFile(short, file, "text");
  const abs = await assertRealInside(located.abs);
  try {
    const data = await readRaw(abs);
    return {
      short,
      file: located.rel,
      content: data.content,
      raw: data.raw,
      eol: data.eol,
      hash: data.hash,
      mtime: data.mtime,
      size: data.size,
    };
  } catch (err) {
    if (err.code === "ENOENT") throw new StudioError(404, "File not found");
    throw err;
  }
}

function stamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

async function makeBackup(short, fileRel, abs) {
  const backupDir = path.join(resolveShortDir(short), ".studio_backups");
  await fsp.mkdir(backupDir, { recursive: true });
  const safe = fileRel.replace(/[\\/]/g, "__");
  const base = safe + "." + stamp();
  for (let i = 0; i < 100; i++) {
    const name = (i === 0 ? base : base + "-" + (i + 1)) + ".bak";
    const dest = path.join(backupDir, name);
    try {
      await fsp.copyFile(abs, dest, fs.constants.COPYFILE_EXCL);
      return ".studio_backups/" + name;
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
  }
  throw new StudioError(500, "Could not create a unique backup name");
}

function conflictError(message, data, deleted) {
  return new StudioError(409, message, {
    code: "conflict",
    content: data ? data.content : "",
    eol: data ? data.eol : "\n",
    hash: data ? data.hash : "",
    mtime: data ? data.mtime : null,
    size: data ? data.size : 0,
    deleted: Boolean(deleted),
  });
}

// HTTP save. baseHash must match the file bytes from the last read.
// Empty baseHash creates a file that does not exist yet.
// eol "\r\n" writes Windows newlines; otherwise content is written as given
// when eol is omitted, or with \n when eol is "\n".
async function saveTextFile({ short, file, content, baseHash, eol }) {
  if (typeof content !== "string") throw new StudioError(400, "content must be a string");
  if (content.length > 5_000_000) throw new StudioError(413, "content too large");
  const located = resolveUserFile(short, file, "text");
  const parent = path.dirname(located.abs);
  try {
    const parentStat = await fsp.stat(parent);
    if (!parentStat.isDirectory()) throw new StudioError(404, "Folder not found");
  } catch (err) {
    if (err instanceof StudioError) throw err;
    if (err.code === "ENOENT") throw new StudioError(404, "Folder not found");
    throw err;
  }

  let diskText = content;
  if (eol === "\r\n") diskText = content.replace(/\n/g, "\r\n");
  else if (eol === "\n") diskText = content.replace(/\r\n/g, "\n");

  let existing = null;
  try {
    existing = await readRaw(located.abs);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const given = baseHash == null ? "" : String(baseHash);
  if (existing) {
    if (given !== existing.hash) throw conflictError("File changed on disk", existing, false);
  } else if (given) {
    throw conflictError("File no longer exists", null, true);
  }

  let backup = null;
  if (existing) backup = await makeBackup(short, located.rel, located.abs);

  if (existing) {
    const again = await readRaw(located.abs);
    if (again.hash !== given) throw conflictError("File changed on disk", again, false);
  }

  await fsp.writeFile(located.abs, diskText, "utf8");
  const saved = await readRaw(located.abs);
  return {
    short,
    file: located.rel,
    content: saved.content,
    eol: saved.eol,
    hash: saved.hash,
    mtime: saved.mtime,
    size: saved.size,
    backup,
  };
}

// MCP write. Same backup rule, no hash check. Writes the string as UTF-8.
async function writeTextFile(short, file, content) {
  if (typeof content !== "string") throw new StudioError(400, "content must be a string");
  if (content.length > 5_000_000) throw new StudioError(413, "content too large");
  const located = resolveUserFile(short, file, "text");
  const parent = path.dirname(located.abs);
  try {
    await fsp.access(parent);
  } catch {
    throw new StudioError(404, "Folder not found");
  }
  let backup = null;
  try {
    await fsp.access(located.abs);
    backup = await makeBackup(short, located.rel, located.abs);
  } catch (err) {
    if (err instanceof StudioError) throw err;
    if (err.code !== "ENOENT") throw err;
  }
  await fsp.writeFile(located.abs, content, "utf8");
  const saved = await readRaw(located.abs);
  return {
    short,
    file: located.rel,
    hash: saved.hash,
    mtime: saved.mtime,
    size: saved.size,
    eol: saved.eol,
    backup,
  };
}

function logicalLines(raw, eol) {
  if (raw === "") return { lines: [], trailing: false };
  const trailing = raw.endsWith(eol);
  const body = trailing ? raw.slice(0, -eol.length) : raw;
  if (body === "") return { lines: [], trailing };
  return { lines: body.split(eol), trailing };
}

// Replace 1-based inclusive lines. Keeps the file's newline style. Backs up first.
async function replaceLines(short, file, startLine, endLine, newText) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new StudioError(400, "startLine and endLine must be integers");
  }
  if (startLine < 1) throw new StudioError(400, "startLine must be >= 1");
  if (endLine < startLine) throw new StudioError(400, "endLine must be >= startLine");
  if (typeof newText !== "string") throw new StudioError(400, "newText must be a string");

  const located = resolveUserFile(short, file, "text");
  let rawInfo;
  try {
    rawInfo = await readRaw(located.abs);
  } catch (err) {
    if (err.code === "ENOENT") throw new StudioError(404, "File not found");
    throw err;
  }
  const parsed = logicalLines(rawInfo.raw, rawInfo.eol);
  if (parsed.lines.length === 0 || endLine > parsed.lines.length) {
    throw new StudioError(
      400,
      "Line range " + startLine + "-" + endLine + " is outside the file (" + parsed.lines.length + " lines)"
    );
  }
  const insert = newText === "" ? [] : newText.split(/\r?\n/);
  if (insert.length > 0 && insert[insert.length - 1] === "" && /\r?\n$/.test(newText)) {
    insert.pop();
  }
  parsed.lines.splice(startLine - 1, endLine - startLine + 1, ...insert);
  let next = parsed.lines.join(rawInfo.eol);
  if (parsed.trailing && parsed.lines.length > 0) next += rawInfo.eol;
  const written = await writeTextFile(short, file, next);
  const reread = await readText(short, file);
  return Object.assign(written, {
    content: reread.content,
    replaced: { startLine, endLine },
  });
}

async function listDirectEntries(dirAbs, folderRel) {
  let entries;
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      throw new StudioError(404, "Folder not found");
    }
    throw err;
  }
  const files = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    if (!ent.isFile()) continue;
    const name = folderRel ? folderRel + "/" + ent.name : ent.name;
    let stat;
    try {
      stat = await fsp.stat(path.join(dirAbs, ent.name));
    } catch {
      continue;
    }
    files.push({
      name,
      mtime: Math.round(stat.mtimeMs),
      size: stat.size,
      kind: kindFor(ent.name),
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function listDirectImages(dirAbs, folderRel) {
  return (await listDirectEntries(dirAbs, folderRel)).filter((item) => item.kind === "image");
}

// A file path resolves as text, audio, video, image, or other.
// A directory path (relative to SHORTS_ROOT, or absolute inside it) resolves
// as a gallery: images (backward compatible) plus files (every direct child).
async function resolveInputPath(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new StudioError(400, "path is required");
  }
  const original = input.trim();
  const hadSlash = /[\\/]$/.test(original);
  const trimmed = original.replace(/[\\/]+$/, "");
  if (trimmed === "") throw new StudioError(400, "Path must be a file");
  let abs;
  if (path.isAbsolute(trimmed)) {
    abs = path.resolve(trimmed);
  } else {
    const parts = trimmed.split(/[\\/]/);
    if (parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) {
      throw new StudioError(400, "Invalid path");
    }
    abs = path.resolve(getRoot(), ...parts);
  }
  ensureInside(getRoot(), abs);
  const real = await assertRealInside(abs);
  const rel = path.relative(getRoot(), real);
  if (rel === "") throw new StudioError(400, "Path must be inside a short folder");
  const parts = rel.split(path.sep);
  if (parts.some((p) => p.startsWith("."))) throw new StudioError(400, "Invalid path");
  let stat;
  try {
    stat = await fsp.stat(real);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new StudioError(hadSlash ? 400 : 404, hadSlash ? "Path must be a file" : "File not found");
    }
    throw err;
  }
  const short = parts[0];
  if (stat.isDirectory()) {
    const folder = parts.slice(1).join("/");
    const files = await listDirectEntries(real, folder);
    const images = files.filter((item) => item.kind === "image");
    return {
      short,
      file: folder,
      kind: "gallery",
      abs: real,
      mtime: Math.round(stat.mtimeMs),
      size: stat.size,
      images,
      files,
    };
  }
  if (hadSlash) throw new StudioError(400, "Path must be a file");
  if (!stat.isFile()) throw new StudioError(400, "Not a file");
  if (parts.length < 2) throw new StudioError(400, "Path must be a file inside a short folder");
  const file = parts.slice(1).join("/");
  const kind = kindFor(parts[parts.length - 1]);
  return {
    short,
    file,
    kind,
    abs: real,
    mtime: Math.round(stat.mtimeMs),
    size: stat.size,
  };
}

async function readControl() {
  try {
    const raw = await fsp.readFile(controlPath(), "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new StudioError(500, "control.json is invalid JSON");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new StudioError(500, "control.json must be an object");
    }
    const seq = Number.isFinite(Number(data.seq)) ? Math.trunc(Number(data.seq)) : 0;
    const commands = Array.isArray(data.commands) ? data.commands : [];
    return { seq, commands };
  } catch (err) {
    if (err instanceof StudioError) throw err;
    if (err.code === "ENOENT") return { seq: 0, commands: [] };
    throw err;
  }
}

let controlQueue = Promise.resolve();

function writeCommands(commands) {
  if (!Array.isArray(commands)) throw new StudioError(400, "commands must be an array");
  if (commands.length > 100) throw new StudioError(400, "too many commands");
  for (const command of commands) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new StudioError(400, "each command must be an object");
    }
    if (typeof command.action !== "string" || command.action.length === 0) {
      throw new StudioError(400, "each command needs an action string");
    }
  }
  const run = controlQueue.then(() => writeCommandsNow(commands));
  controlQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function writeCommandsNow(commands) {
  const current = await readControl();
  const next = { seq: (Number(current.seq) || 0) + 1, commands };
  const target = controlPath();
  const tmp = target + ".tmp";
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  try {
    await fsp.rename(tmp, target);
  } catch {
    await fsp.copyFile(tmp, target);
    await fsp.rm(tmp, { force: true });
  }
  return next;
}

function posixRelKey(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new StudioError(400, "path is required");
  }
  const trimmed = input.trim().replace(/\\/g, "/");
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/")) {
    throw new StudioError(400, "Invalid path");
  }
  const parts = trimmed.split("/").filter((p) => p.length > 0);
  if (parts.length < 2) throw new StudioError(400, "Path must be a file inside a short folder");
  if (parts.some((p) => p === "." || p === ".." || p.startsWith("."))) {
    throw new StudioError(400, "Invalid path");
  }
  const short = parts[0];
  const file = parts.slice(1).join("/");
  const located = resolveUserFile(short, file, "any");
  return { key: short + "/" + located.rel, short, file: located.rel, abs: located.abs, kind: located.kind };
}

async function assertExistingFile(abs) {
  const real = await assertRealInside(abs);
  let stat;
  try {
    stat = await fsp.stat(real);
  } catch (err) {
    if (err.code === "ENOENT") throw new StudioError(404, "File not found");
    throw err;
  }
  if (!stat.isFile()) throw new StudioError(400, "Path must be a file");
  return real;
}

function sanitizeReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.verdict !== "yes" && value.verdict !== "no") return null;
  return {
    verdict: value.verdict,
    note: typeof value.note === "string" ? value.note : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function matchesReviewFilter(key, opts) {
  if (!opts) return true;
  if (opts.short != null && String(opts.short).trim() !== "") {
    const name = String(opts.short).trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (key !== name && !key.startsWith(name + "/")) return false;
  }
  if (opts.prefix != null && String(opts.prefix).trim() !== "") {
    const prefix = String(opts.prefix).trim().replace(/\\/g, "/");
    if (key !== prefix && !key.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")) return false;
  }
  return true;
}

async function loadReviewMap() {
  try {
    const raw = await fsp.readFile(reviewsPath(), "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new StudioError(500, "reviews.json is invalid JSON");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new StudioError(500, "reviews.json must be an object");
    }
    const map = {};
    for (const [key, value] of Object.entries(data)) {
      const review = sanitizeReview(value);
      if (review) map[key] = review;
    }
    return map;
  } catch (err) {
    if (err instanceof StudioError) throw err;
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function readReviews(opts) {
  const map = await loadReviewMap();
  const reviews = {};
  for (const [key, value] of Object.entries(map)) {
    if (matchesReviewFilter(key, opts)) reviews[key] = value;
  }
  return { reviews };
}

async function getReview(relPath) {
  const located = posixRelKey(relPath);
  await assertExistingFile(located.abs);
  const map = await loadReviewMap();
  return { path: located.key, review: map[located.key] || null };
}

let reviewsQueue = Promise.resolve();

function enqueueReviews(fn) {
  const run = reviewsQueue.then(fn);
  reviewsQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function writeReviewMap(map) {
  const target = reviewsPath();
  const tmp = target + ".tmp";
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(map, null, 2) + "\n", "utf8");
  try {
    await fsp.rename(tmp, target);
  } catch {
    await fsp.copyFile(tmp, target);
    await fsp.rm(tmp, { force: true });
  }
}

async function setReview(relPath, verdict, note) {
  if (verdict !== "yes" && verdict !== "no") {
    throw new StudioError(400, 'verdict must be "yes" or "no"');
  }
  if (note != null && typeof note !== "string") {
    throw new StudioError(400, "note must be a string");
  }
  if (typeof note === "string" && note.length > 8000) {
    throw new StudioError(413, "note too large");
  }
  const located = posixRelKey(relPath);
  await assertExistingFile(located.abs);
  return enqueueReviews(async () => {
    const map = await loadReviewMap();
    const review = {
      verdict,
      note: note == null ? "" : note,
      updatedAt: new Date().toISOString(),
    };
    map[located.key] = review;
    await writeReviewMap(map);
    return { path: located.key, review };
  });
}

async function clearReview(relPath) {
  const located = posixRelKey(relPath);
  await assertExistingFile(located.abs);
  return enqueueReviews(async () => {
    const map = await loadReviewMap();
    delete map[located.key];
    await writeReviewMap(map);
    return { path: located.key, review: null };
  });
}

module.exports = {
  StudioError,
  STUDIO_DIR,
  TEXT_EXT,
  AUDIO_EXT,
  VIDEO_EXT,
  IMAGE_EXT,
  getRoot,
  controlPath,
  reviewsPath,
  kindFor,
  mimeFor,
  resolveUserFile,
  assertRealInside,
  listShorts,
  listFiles,
  readText,
  saveTextFile,
  writeTextFile,
  replaceLines,
  resolveInputPath,
  readControl,
  writeCommands,
  readReviews,
  getReview,
  setReview,
  clearReview,
};
