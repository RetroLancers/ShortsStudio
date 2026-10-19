# Shorts Studio

A local review studio for creators who work with AI agents. Agents (Grok Bot or any MCP-capable assistant) write scripts, notes, images, audio, and video into a workspace folder and push them to the page you have open. You read, edit, listen, watch, and leave timestamped review notes, all in one dark browser tab.

It is one small Node server (no framework, no build step), one static page, and an MCP stdio server. Agents drive the page through a tiny `control.json` protocol: bump `seq`, list commands, and the page opens the file, jumps to a line, or shows a "Ready for review" banner.

What it does:

- Edits `.md` and `.txt` with line numbers, backups before every save, and conflict detection.
- Renders markdown with Preview, Edit, and Split views.
- Plays audio with a waveform, plays video (9:16 friendly), and shows images and image galleries.
- Stores review notes as plain markdown next to each media file (`<media file>.review.md`).
- Live-reloads files that agents change and highlights what changed.

Audio, video, and images are read-only. The only file written from a media tab is `<media file>.review.md` next to that media.

## Setup

Requires Node 18 or newer.

```sh
git clone https://github.com/RetroLancers/ShortsStudio.git
cd ShortsStudio
npm install
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

The server listens on `127.0.0.1` and `::1` only.

`control.json` is created at runtime and gitignored. `control.example.json` shows the empty starting state.

## Paths

| What | Where |
| --- | --- |
| Projects | `<root>/<short>/` |
| Text | `.md` and `.txt`, including files in subfolders |
| Media | `.wav`, `.mp3`, `.mp4`, `.png`, `.jpg`, `.jpeg`, `.webp` in the project, including subfolders such as `clips/`, `vo/`, and `art/` |
| Backups | `<short>/.studio_backups/<filename>.<YYYYMMDD-HHMMSS>.bak` |
| Review notes | next to the media, e.g. `vo/take3.wav.review.md` |
| Viewer commands | `control.json` in this folder |

Hidden folders (names starting with `.`) are not listed. That keeps `.studio_backups` out of the sidebar. Other file types are ignored.

Nested text backups use the relative path with slashes turned into `__`:
`vo/take3.wav.review.md` becomes `.studio_backups/vo__take3.wav.review.md.<stamp>.bak`.

Projects are ordered by the newest `.md` or `.txt` modification time. A folder with only media sorts last.
## Page

The sidebar lists projects, newest first. Expand one to see **Text** and **Media**. Click a file to open a tab. Several tabs stay open. Switch by clicking a tab. Drag a tab to reorder it. Close with ×. A dot on a tab means unsaved text edits.

Text tabs are a textarea with line numbers. **Save** and Ctrl+S write the file. Before every save the server copies the current file into `.studio_backups`. The save sends the hash from when the tab was loaded. If the file changed on disk, the server returns 409 and does not overwrite.

`.md` tabs open on **Preview**. The tab bar switches **Preview**, **Edit**, and **Split**. Split puts the preview beside the editor and updates it as you type. Preview renders headings, bold, lists, tables, and code. `.txt` tabs stay editor-only and do not show that switch.

Open tabs are remembered in this browser. Close the page and open it again, and the same tabs come back in the same order, with the same tab selected. A markdown tab returns on Preview, Edit, or Split, whichever was selected. The list is stored in `localStorage` under `studio.openTabs` and rewritten when a tab is opened, closed, reordered, or switched, and when the markdown view changes.

```json
{
  "active": 0,
  "tabs": [
    { "short": "my-short", "file": "script_v1.md", "kind": "text", "mdView": "split" },
    { "short": "my-short", "file": "vo/take3.wav", "kind": "audio" },
    { "short": "my-short", "file": "art", "kind": "gallery" }
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

A folder path opens a gallery tab: a grid of the images directly in that folder (not images in nested folders). Click a thumbnail to open that image.

On an audio or video tab, **Add note @ 0:12** appends a line to `<media file>.review.md`:

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
      "media": [{ "name": "vo/take3.wav", "mtime": 1710000000000, "size": 658732, "kind": "audio" }]
    }
  ]
}
```

`mtime` on a project is the latest text file time, or `0` when it has no text files. `kind` is `audio`, `video`, or `image`.

### `GET /api/files?short=my-short`

`{ "short", "mtime", "text", "media" }` for one project.

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

`path` is `short/file`, a folder such as `short/art`, or an absolute path inside the root. A trailing slash is allowed on a folder. Response: `{ short, file, kind, mtime, size }`. `kind` is `text`, `audio`, `video`, `image`, or `gallery`. For a gallery, `file` is the folder path inside the project (empty when `path` is the project folder itself) and `images` lists `{ name, mtime, size, kind }` for images directly in that folder. Paths that escape the root are **400**.

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
| `open` | `short`, `file` | Open or focus a tab. `.wav` and `.mp3` open as audio, `.mp4` as video, `.png` `.jpg` `.jpeg` `.webp` as image, anything else as text. |
| `close` | `short`, `file` | Close matching tabs. |
| `closeAll` | | Close every tab. |
| `goto` | `short`, `file`, `line`, `highlight` | Open the text file, scroll to the 1-based line. Highlights the line unless `highlight` is false. |
| `banner` | `text`, `level`, `timeoutSec` | Toast. `level` is `info`, `warn`, or `ok`. Default timeout is 8 seconds. |
| `open_review` | `path`, `note` | Open a review tab. `path` is `short/file`, a folder such as `short/art`, or an absolute path inside the root. An image opens an image tab. A folder opens a gallery tab. Shows `note` as a normal banner. A `*.wav.review.md` (or mp3/mp4/png/jpg/jpeg/webp) path opens the media file instead. |
| `notify_ready` | `path`, `kind`, `note` | Open that review tab (file, image, or gallery folder) and show a prominent **Ready for review** banner until dismissed. `kind` is `audio`, `short`, or `image`. |
## MCP

`mcp.js` is a stdio MCP server, so agents can list, read, and edit workspace files and push things to your screen. It uses `@modelcontextprotocol/sdk` and `zod` from the local `node_modules`. Do not print to stdout from this process.

Tools:

| Tool | Role |
| --- | --- |
| `list_shorts` | Same listing as `GET /api/shorts`. |
| `list_files` | `{ short }` |
| `read_file` | `{ short, file }` content, mtime, hash. Exact text, including newlines. |
| `write_file` | `{ short, file, content }` backup, then write. No hash check. |
| `replace_lines` | `{ short, file, startLine, endLine, newText }` backup, then replace a 1-based inclusive range. Keeps the file's newline style. Empty `newText` deletes the range. |
| `control` | `{ commands }` bumps `seq` and writes `control.json`. |
| `open_review` | `{ path, note }` writes one `open_review` command. `path` may be an image or a folder of images. |
| `notify_ready` | `{ path, kind, note }` writes one `notify_ready` command. `path` may be an image or a folder. `kind` is `audio`, `short`, or `image`. |

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
- New audio, video, or image type: add it to `AUDIO_EXT`, `VIDEO_EXT`, or `IMAGE_EXT`, and to `mimeFor`. In `index.html`, teach `openAnything` and the `*.review.md` pattern the extension. Range streaming already follows `mimeFor`.
- New API route: add a branch in `route()` in `server.js`. Throw `StudioError(status, message)` for a JSON error.
- New viewer action: handle `cmd.action` in `runCommand` in `index.html`. `control` already passes extra fields through.
- New MCP tool: `server.registerTool` in `mcp.js`, and call a function in `studio-lib.js` so the backup and path checks stay in one place.
- Poll speed: `POLL_MS` at the top of the page script.
- Remembered tabs: `persistTabs` and `restoreOpenTabs` in `index.html`. The `localStorage` key is `studio.openTabs`.

Do not write media bytes from a new tool. Review notes stay `.md` files so the backup and conflict rules apply.
