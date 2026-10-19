# Shorts Studio

A local review studio for creators who work with AI agents. Agents (Grok Bot or any MCP-capable assistant) write scripts, notes, images, audio, and video into a workspace folder and push them to the page you have open. You read, edit, listen, watch, and leave timestamped review notes, all in one dark browser tab.

It is one small Node server (no framework, no build step), one static page, and an MCP stdio server. Agents drive the page through a tiny `control.json` protocol: bump `seq`, list commands, and the page opens the file, jumps to a line, or shows a "Ready for review" banner.

A `CHANGELOG.md` is maintained with every change.

What it does:

- Edits `.md` and `.txt` with line numbers, backups before every save, and conflict detection.
- Renders markdown with Preview, Edit, and Split views.
- Plays audio with a waveform, plays video (9:16 friendly), and shows images and folder views of every file type.
- Filters the sidebar by Video, Audio, Image, Text, and Other, and can hide files that already have a Yes or No verdict. A note with no verdict still shows.
- Stores a review for any file in `reviews.json`: verdict `yes`, `no`, or `null`, plus an optional note and timestamp. A review needs a verdict or a non-empty note.
- Stores timestamped media notes as plain markdown next to each media file (`<media file>.review.md`). That file is separate from the review note.
- Live-reloads files that agents change and highlights what changed.

Audio, video, and images are read-only. Timestamped notes from a media tab still write `<media file>.review.md`. File reviews (verdict and review note) write `reviews.json`.

## Setup

Requires Node 18 or newer.

```sh
git clone https://github.com/RetroLancers/ShortsStudio.git
cd ShortsStudio
npm install
npm test   # server, MCP, and path tests
node server.js
```

Then open http://localhost:5178

On Windows you can double-click `start_studio.bat` instead. It starts `server.js` in a minimized window when the port is free, then opens the browser. If something is already listening, it only opens the browser. Close the minimized "Shorts Studio" window to stop the server.

## Configuration

The workspace is a folder of projects. Each subfolder is one project (a "short"): its scripts, voice-over takes, renders, art, and so on.

The root is resolved in this order:

1. The `SHORTS_ROOT` environment variable.
2. `"root"` in `studio.config.json` next to `server.js`. Copy `studio.config.example.json` to `studio.config.json` and edit it. This file is gitignored, so your local paths stay out of the repo.
3. `./workspace` next to `server.js`.

```json
{
  "root": "/absolute/path/to/your/workspace"
}
```

| Env | Default |
| --- | --- |
| `PORT` | `5178` |
| `SHORTS_ROOT` | `studio.config.json` root, else `./workspace` |
| `CONTROL_PATH` | `control.json` in this folder |
| `REVIEWS_PATH` | `reviews.json` in this folder |

The server listens on `127.0.0.1` and `::1` only.

`control.json` and `reviews.json` are created at runtime and gitignored. `control.example.json` shows the empty starting state.

## Paths

| What | Where |
| --- | --- |
| Projects | `<root>/<short>/` |
| Text | `.md` and `.txt`, including files in subfolders |
| Media | `.wav`, `.mp3`, `.mp4`, `.png`, `.jpg`, `.jpeg`, `.webp` in the project, including subfolders such as `clips/`, `vo/`, and `art/` |
| Other | any other file type, listed with `kind` `"other"` |
| Backups | `<short>/.studio_backups/<filename>.<YYYYMMDD-HHMMSS>.bak` |
| Media notes | next to the media, e.g. `vo/take3.wav.review.md` |
| File reviews | `reviews.json` in this folder (`verdict` `yes`, `no`, or `null`, `note`, `updatedAt`, keyed by `short/file`) |
| Viewer commands | `control.json` in this folder |

Hidden folders (names starting with `.`) are not listed. That keeps `.studio_backups` out of the sidebar. Unknown file types are listed as Other.

Nested text backups use the relative path with slashes turned into `__`:
`vo/take3.wav.review.md` becomes `.studio_backups/vo__take3.wav.review.md.<stamp>.bak`.

Projects are ordered by the newest `.md` or `.txt` modification time. A folder with only media sorts last.
## Page

The sidebar lists projects, newest first. Toggle chips filter **Video**, **Audio**, **Image**, **Text**, and **Other** (stored in `localStorage` as `studio.fileFilters`). **Unreviewed only** hides files that have a Yes or No verdict (`studio.unreviewedOnly`). A note with no verdict does not count as reviewed, so that file stays in the list. Click the caret to expand a project. Click the project name (or a nested folder name) to open a folder view. Click a file to open a tab. Several tabs stay open. Switch by clicking a tab. Drag a tab to reorder it. Close with ×. A dot on a tab means unsaved text edits. A green ✓ or red ✕ on a file is its review verdict. A note with no verdict shows ✎. Hover a badge for the note.

Text tabs are a textarea with line numbers. **Save** and Ctrl+S write the file. Before every save the server copies the current file into `.studio_backups`. The save sends the hash from when the tab was loaded. If the file changed on disk, the server returns 409 and does not overwrite.

`.md` tabs open on **Preview**. The tab bar switches **Preview**, **Edit**, and **Split**. Split puts the preview beside the editor and updates it as you type. Preview renders headings, bold, lists, tables, and code. `.txt` tabs stay editor-only and do not show that switch.

Open tabs are remembered in this browser. Close the page and open it again, and the same tabs come back in the same order, with the same tab selected. A markdown tab returns on Preview, Edit, or Split, whichever was selected. The list is stored in `localStorage` under `studio.openTabs` and rewritten when a tab is opened, closed, reordered, or switched, and when the markdown view changes.

```json
{
  "active": 0,
  "tabs": [
    { "short": "my-short", "file": "script_v1.md", "kind": "text", "mdView": "split" },
    { "short": "my-short", "file": "vo/take3.wav", "kind": "audio" },
    { "short": "my-short", "file": "art", "kind": "gallery" },
    { "short": "my-short", "file": "notes.json", "kind": "other" }
  ]
}
```

`active` is the index of the selected tab, or `-1` when none are open. `mdView` is only on markdown tabs (`preview`, `edit`, or `split`). A gallery of the short folder itself uses `""` for `file`. A saved file or folder that is no longer on disk is skipped with no message. Tabs that were closed stay closed.

Preview uses Marked 18.1.1, copied from the npm package into `vendor/marked.umd.js` (the UMD build; that package has no separate min file). The server serves it at `/vendor/marked.umd.js`. The page does not load a CDN.

Every 1.5 seconds the page refreshes the sidebar and open files.

- A text file changed on disk, and the tab has no unsaved edits: the tab reloads and the changed lines are highlighted for about 5 seconds. For `.md`, the preview reloads too and the changed blocks are highlighted for about 5 seconds.
- The tab has unsaved edits: your text stays, and so does the preview of what you typed. A bar offers **Reload from disk (lose my edits)** and **Keep mine**. Keep mine leaves your text. The next save overwrites that disk version. If the file changes again before you save, the bar comes back.

Audio tabs show a player and a waveform drawn with the Web Audio API. Click the waveform to seek. Video tabs (`.mp4`) fit the stage height and keep the picture's aspect ratio, which suits 9:16 vertical video.

Image tabs (`.png`, `.jpg`, `.jpeg`, `.webp`) fit the picture to the stage. Click the picture to show it at 100% (one image pixel per CSS pixel). Scroll to pan when it is larger than the stage. Click again to fit.

A folder path opens a folder view of every file sitting directly in that folder (not nested folders). Images are thumbnails (click the picture to open the image tab). Audio files get an inline player. Video files get an inline `<video>` player. `.md` and `.txt` names open a text tab. Other files open a small info view (name, size, modified time). Each item shows its review badge, a note field, and Yes / No buttons. The note is saved when you leave the field, press Enter, or stop typing for a moment. The row shows **Saved** or **Error**. Yes and No toggle, and each click saves the current note. Saving a row does not rebuild the folder, so the field keeps what you typed.

When most files in the folder are audio, the view is a playlist: rows ordered by name, each with the file name, an inline player, a review badge, a note field, and Yes / No. **Play all** plays each audio file top to bottom and advances on `ended`.

Unknown types open an info view instead of the editor. `/media` still refuses them.

Every file tab (text, media, or other) has a review bar: **Yes** / **No**, a review note, **Save**, **Clear**, and a status. Yes and No toggle: click the selected one to clear it. **Save** works with a note and no verdict. The note autosaves about 800ms after you type, and again when the field loses focus. Clicking Yes or No saves immediately and sends the current note. The status reads **Unsaved…**, **Saving…**, **Saved** plus the time, or the error in red. Switching tabs or closing the tab waits for that save. Closing the browser warns if a review note is still unsaved or a save is in flight. This review note is separate from `<media file>.review.md` timestamped notes.

On an audio or video tab, the side pane is labelled **Timestamped notes (saved to `<file>.review.md`)**. **Add note @ 0:12** appends a line to that file:

```md
- [0:12] tighten the cadence here
```

Minutes are not zero-padded. Seconds are. Click a note to seek there.

On an image tab the note is optional and has no timestamp. **Add note** appends:

```md
- tighten the crop
```

That review file is the only write from media mode, and it still gets a backup. A gallery tab does not write a review file.

## HTTP API

All JSON. Errors are `{ "error": "..." }` with an HTTP status. A conflict also includes `code`, `content`, `eol`, `hash`, `mtime`, `size`, and `deleted`.

### `GET /api/shorts`

```json
{
  "root": "/absolute/path/to/your/workspace",
  "shorts": [
    {
      "name": "my-short",
      "mtime": 1710000000000,
      "text": [{ "name": "script_v1.md", "mtime": 1710000000000, "size": 4539 }],
      "media": [
        { "name": "vo/take3.wav", "mtime": 1710000000000, "size": 658732, "kind": "audio" },
        { "name": "notes.json", "mtime": 1710000000000, "size": 120, "kind": "other" }
      ]
    }
  ]
}
```

`mtime` on a project is the latest text file time, or `0` when it has no text files. `kind` on media is `audio`, `video`, `image`, or `other`.

### `GET /api/files?short=my-short`

`{ "short", "mtime", "text", "media" }` for one project. Unknown types are in `media` with `kind` `"other"`.

### `GET /api/file?short=my-short&file=script_v1.md`

```json
{
  "short": "my-short",
  "file": "script_v1.md",
  "content": "line one\n",
  "eol": "\n",
  "hash": "<sha256 of the file bytes>",
  "mtime": 1710000000000,
  "size": 12
}
```

`content` uses `\n` in the editor. `eol` is `\r\n` when the file on disk uses Windows newlines. `hash` is the sha256 of the original bytes. Only `.md` and `.txt` are allowed. `file` may be a relative path such as `vo/take3.wav.review.md`.

### `PUT /api/file`

```json
{
  "short": "my-short",
  "file": "script_v1.md",
  "content": "line one\nline two\n",
  "baseHash": "<hash from GET>",
  "eol": "\n"
}
```

`baseHash` must match the current file. Use `""` to create a file that does not exist. A mismatch returns **409** and the body includes the disk copy. `eol` may be `\n`, `\r\n`, or omitted (then `content` is written as UTF-8 exactly).

The response is the saved file plus `backup`, the relative backup path, or `null` for a new file.

### `GET /api/control`

Returns `control.json`: `{ "seq": 0, "commands": [] }`.

### `GET /api/resolve?path=`

`path` is `short/file`, a folder such as `short/art`, or an absolute path inside the root. A trailing slash is allowed on a folder. Response: `{ short, file, kind, mtime, size }`. `kind` is `text`, `audio`, `video`, `image`, `other`, or `gallery`. For a gallery, `file` is the folder path inside the project (empty when `path` is the project folder itself), `images` lists `{ name, mtime, size, kind }` for images directly in that folder (backward compatible), and `files` lists every file directly in that folder with a `kind`. Paths that escape the root are **400**.

### `GET /api/reviews`

```sh
curl http://localhost:5178/api/reviews
```

```json
{
  "reviews": {
    "my-short/vo/line01.wav": {
      "verdict": "yes",
      "note": "keep this take",
      "updatedAt": "2026-04-08T15:02:11.000Z",
      "fp": { "size": 48000, "mtime": 1775660531000, "sha256": "..." }
    }
  },
  "timestampNotes": {
    "my-short/vo/line01.wav": { "text": "- [0:12] tighten the cadence here\n", "fileExists": true }
  }
}
```

Keys are paths relative to `SHORTS_ROOT` with forward slashes (`<short>/<file>`).

- `timestampNotes` lists every `<file>.review.md` under `SHORTS_ROOT`, keyed by the media path, with its text and whether the media file still exists (so notes left behind after a move are still visible).
- Optional `?short=` or `?prefix=` filters both maps. `?lite=1` skips `timestampNotes` (the page polls with it).
- Each review stores a fingerprint (`fp`: size, mtime, sha256) when it is saved. If the file is later moved or renamed inside the same short, the next read finds it again by size and sha256 (mtime breaks ties), re-keys the review to the new path (adding `movedFrom` and `movedAt`), and reports it in `moved`. Its `<file>.review.md` goes along: it is moved if the new location has none, otherwise its text is appended to the existing notes (never overwritten) and the old file is kept. Reviews saved before fingerprints existed are not re-keyed. A failed search is retried after a minute.

### `GET /api/reviews?path=`

```sh
curl "http://localhost:5178/api/reviews?path=my-short/vo/line01.wav"
```

Returns `{ "path": "my-short/vo/line01.wav", "review": { ... }, "timestampNotes": "- [0:12] tighten the cadence here\n" }`. `review` is `null` when none is stored. `review.verdict` is `"yes"`, `"no"`, or `null` (a note with no verdict). `timestampNotes` is the text of the sibling `<file>.review.md`, or `null` if that file does not exist. The full list (no `path`) includes `timestampNotes` for every notes file. The file must exist inside `SHORTS_ROOT`.

### `POST /api/reviews`

```sh
curl -X POST http://localhost:5178/api/reviews -H "Content-Type: application/json" -d "{\"path\":\"my-short/vo/line01.wav\",\"verdict\":\"yes\",\"note\":\"keep this take\"}"
```

`verdict` is `"yes"`, `"no"`, or `null`. Omit it, or send `""`, and it is stored as `null`. `note` is optional free text, and required when `verdict` is null: the server returns **400** if both are missing. The stored record is exactly the verdict and note in the body. A missing verdict does not keep the previous one. Writes `reviews.json` atomically (temp file + rename) and serializes writes. Response: `{ "path", "review" }`.

```sh
curl -X POST http://localhost:5178/api/reviews -H "Content-Type: application/json" -d "{\"path\":\"my-short/vo/line01.wav\",\"verdict\":null,\"note\":\"listen again\"}"
```

Clear with `{ "path": "my-short/vo/line01.wav", "clear": true }` or with DELETE.

### `DELETE /api/reviews?path=`

```sh
curl -X DELETE "http://localhost:5178/api/reviews?path=my-short/vo/line01.wav"
```

Removes that review. Response: `{ "path": "my-short/vo/line01.wav", "review": null }`.

### `GET /media?short=&file=`

Read-only `.wav`, `.mp3`, `.mp4`, `.png`, `.jpg`, `.jpeg`, or `.webp`, with `Accept-Ranges: bytes` and **206** range responses. HEAD is supported. Content types are `audio/wav`, `audio/mpeg`, `video/mp4`, `image/png`, `image/jpeg`, and `image/webp`. There is no upload and no delete.

Paths with `..`, absolute segments, or a segment that starts with `.` are rejected. The resolved real path must stay inside the root.

## control.json

This is how agents drive the page. The page polls this file every 1.5 seconds. It runs `commands` only when `seq` changes. The first value it sees is stored and not replayed, so refreshing the page does not repeat the last command. Restored tabs are opened before that baseline is taken, so a command already in the file is not applied again on load. A later `seq` change still runs and adds to the restored tabs. Agents should bump `seq` (the MCP tools do that).

```json
{
  "seq": 4,
  "commands": [
    { "action": "open", "short": "my-short", "file": "script_v1.md" },
    { "action": "goto", "short": "my-short", "file": "script_v1.md", "line": 12, "highlight": true },
    { "action": "banner", "text": "Updated take 3", "level": "info", "timeoutSec": 8 }
  ]
}
```

| Action | Fields | Effect |
| --- | --- | --- |
| `open` | `short`, `file` (or `path`) | Open or focus a tab. The page resolves the target first: `.wav` and `.mp3` open as audio, `.mp4` as video, `.png` `.jpg` `.jpeg` `.webp` as image, `.md` and `.txt` as text, anything else as an info view. A folder (`file` naming a folder, `short` with no `file`, or a folder `path`) opens the folder view. |
| `close` | `short`, `file` | Close matching tabs. |
| `closeAll` | | Close every tab. |
| `goto` | `short`, `file`, `line`, `highlight` | Open the text file, scroll to the 1-based line. Highlights the line unless `highlight` is false. A media file or folder is opened normally instead (no text read). |
| `banner` | `text`, `level`, `timeoutSec` | Toast. `level` is `info`, `warn`, or `ok`. Default timeout is 8 seconds. |
| `open_review` | `path` (or `short` + `file`), `note` | Open a review tab. `path` is `short/file`, a folder such as `short/art`, or an absolute path inside the root. An image opens an image tab. A folder opens a folder view of every file in that folder. Shows `note` as a normal banner. A `*.wav.review.md` (or mp3/mp4/png/jpg/jpeg/webp) path opens the media file instead. |
| `notify_ready` | `path` (or `short` + `file`), `kind`, `note` | Open that review tab (file, image, or folder) and show a prominent **Ready for review** banner until dismissed. `kind` is `audio`, `short`, or `image`; it only labels the banner, so a folder with `kind: "audio"` opens the folder view (audio playlist). |
## MCP

`mcp.js` is a stdio MCP server, so agents can list, read, and edit workspace files and push things to your screen. It uses `@modelcontextprotocol/sdk` and `zod` from the local `node_modules`. Do not print to stdout from this process.

Tools:

| Tool | Role |
| --- | --- |
| `list_shorts` | Same listing as `GET /api/shorts`. |
| `list_files` | `{ short }`. Includes unknown types in `media` with `kind` `"other"`. |
| `read_file` | `{ short, file }` content, mtime, hash. Exact text, including newlines. |
| `write_file` | `{ short, file, content }` backup, then write. No hash check. |
| `replace_lines` | `{ short, file, startLine, endLine, newText }` backup, then replace a 1-based inclusive range. Keeps the file's newline style. Empty `newText` deletes the range. |
| `control` | `{ commands }` bumps `seq` and writes `control.json`. |
| `open_review` | `{ path, note }` writes one `open_review` command. `path` may be a file or a folder. |
| `notify_ready` | `{ path, kind, note }` writes one `notify_ready` command. `path` may be a file or a folder. `kind` is `audio`, `short`, or `image`. |
| `get_reviews` | Optional `{ short }` or `{ prefix }` filter. Returns all matching reviews, `timestampNotes` for every `<file>.review.md`, and `moved` when a moved file was re-keyed. |
| `get_review` | `{ path }` for one file (`my-short/vo/line01.wav`). `review` is null when none is stored. Also returns `timestampNotes`, the text of `<file>.review.md`, or null. |
| `set_review` | `{ path, verdict, note }`. `verdict` is `yes`, `no`, or `null` (optional). A note-only review omits the verdict and sends `note`. |
| `clear_review` | `{ path }` removes that review. |

To register it, copy `.mcp.example.json` to `.mcp.json` (gitignored) and fill in your paths:

```json
{
  "mcpServers": {
    "shorts-studio": {
      "command": "node",
      "args": ["/absolute/path/to/shorts-studio/mcp.js"],
      "env": {
        "SHORTS_ROOT": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

Point your agent's MCP client at that file, or merge the `shorts-studio` entry into the client config you already use. The working directory does not matter because `args` is an absolute path. If you omit `SHORTS_ROOT`, the MCP server uses `studio.config.json` or `./workspace`, the same as the HTTP server. Restart the client after adding it.

`write_file` and `replace_lines` always back up an existing file, then write, even if another editor has the file open. The page notices on its next poll. Prefer `replace_lines` for small edits so the rest of the script stays intact.
## How to extend

Shared file rules live in `studio-lib.js`. The HTTP routes live in `server.js`. Tools live in `mcp.js`. The page is `index.html` (HTML, CSS, and vanilla JS, no build).

- New text type: add the extension to `TEXT_EXT` in `studio-lib.js`.
- Markdown preview: `vendor/marked.umd.js` is served from `server.js` at `/vendor/marked.umd.js`. Preview / Edit / Split live in `index.html`. `.txt` does not use them.
- New audio, video, or image type: add it to `AUDIO_EXT`, `VIDEO_EXT`, or `IMAGE_EXT`, and to `mimeFor`. In `index.html`, teach `openAnything` and the `*.review.md` pattern the extension. Range streaming already follows `mimeFor`. Unknown extensions are listed as `other` and open the info view.
- File reviews: `readReviews` / `setReview` / `clearReview` in `studio-lib.js`, `reviews.json` (override with `REVIEWS_PATH`).
- Sidebar filters: `studio.fileFilters` and `studio.unreviewedOnly` in `localStorage`.
- New API route: add a branch in `route()` in `server.js`. Throw `StudioError(status, message)` for a JSON error.
- New viewer action: handle `cmd.action` in `runCommand` in `index.html`. `control` already passes extra fields through.
- New MCP tool: `server.registerTool` in `mcp.js`, and call a function in `studio-lib.js` so the backup and path checks stay in one place.
- Poll speed: `POLL_MS` at the top of the page script.
- Remembered tabs: `persistTabs` and `restoreOpenTabs` in `index.html`. The `localStorage` key is `studio.openTabs`.

Do not write media bytes from a new tool. Review notes stay `.md` files so the backup and conflict rules apply.
