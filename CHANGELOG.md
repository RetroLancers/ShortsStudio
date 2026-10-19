# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Quick open (**Ctrl+K** or **Ctrl+P**, **Cmd** on Mac): fuzzy search across every file, with `type:`, `ext:`, `short:`, `reviewed:`, and `has:note` filters. Arrow keys, Enter, Esc, and click. Matched letters and the review badge show on each row.
- **Ctrl+click** (**Cmd+click** on Mac) closes a tab, with the same wait for a dirty review as ×.
- Drag a tab in the strip or the **▾** list to reorder it. The order stays in `studio.openTabs`.
- Tab strip stays one scrolling row and keeps the active tab in view. Middle-click closes a tab. Right-click opens Close, Close others, Close to the right, and Close all. **▾ N** lists every open tab. Tabs that share a file name show the parent folder.
- Ready banner quick **Yes** / **No** for a file (keeps the note and dismisses). Folder targets get **Next unreviewed** instead. The banner dismisses when that file gains a verdict.
- Review shortcuts: Y, N, U, J, K, arrows, Shift+J, period, Esc, and `?`, plus a shortcut help overlay.
- **Next unreviewed** on the review bar and in the folder toolbar. Folder rows highlight the current file for those keys.
- `studio-ui-lib.js` (served at `/studio-ui-lib.js`) for tab labels, sibling order, and next unreviewed.

- Sidebar file-type filter chips for Video, Audio, Image, Text, and Other, persisted in `localStorage`.
- Unreviewed-only sidebar toggle, persisted in `localStorage`.
- File listing includes unknown types with `kind` `"other"` (in the `media` array).
- Info view for other files (name, size, modified time).
- Review status for any file: verdict `yes` or `no`, free-text note, and ISO `updatedAt`, stored in `reviews.json` (path overridable with `REVIEWS_PATH`).
- Review badges in the sidebar tree and folder view, plus a Yes / No / note / Save / Clear panel on file tabs.
- HTTP `GET` / `POST` / `DELETE` `/api/reviews` (including `POST` with `{ "clear": true }`).
- MCP tools `get_reviews`, `get_review`, `set_review`, and `clear_review`.
- Folder view lists every file in the folder: image thumbnails, inline audio and video players, text links, and other-file entries, with review badges and quick Yes / No.
- Audio-heavy folders use a playlist layout with **Play all**.
- Clicking a folder name in the sidebar opens the folder view.

### Changed

- Visual refresh on the same dark theme: spacing, corners, borders, shadows, type hierarchy, sidebar indent guides, compact review badges, a clearer active tab, shared button styles, and keyboard focus rings.
- The review bar on `.md` and `.txt` tabs stays out of the way of editing, **Ctrl+S** / **Cmd+S**, and the markdown preview. **Y**, **N**, **U**, **J**, and **K** do not run while the cursor is in the editor. Preview blurs the editor so those keys apply to the review again.
- The ready banner is one line: kind, note, and actions.
- Review **Yes** / **No** fill green or red when selected (`aria-pressed`). The note field grows with the text. **Save** is a text button. The status reads **Saved ✓** and the time, **Saving…**, **Unsaved**, or the error in red.

- `GET /api/resolve` still returns `images` for a folder and also returns `files` with a `kind` for each direct child.
- `/media` still refuses non-media types.
- `list_files` documents unknown types as `kind` `"other"`.
- HTTP method guard allows `POST` and `DELETE` on `/api/reviews` in addition to `PUT /api/file`.

### Fixed

- `open`, `goto`, `open_review`, and `notify_ready` commands resolve their target on the server before opening, so a folder (including `short` with no `file`, a folder `file`, or a trailing slash) opens the all-files folder view (audio playlist for audio folders) and media is never read as text. This fixes "Path must be a file inside a short folder", "Cannot read properties of undefined (reading 'split')", and "Only .md and .txt files can be read or written as text" toasts. Saved text tabs that point at non-text paths are dropped on restore.
- `npm test` runs automated checks for file and folder open/notify over HTTP and MCP, plus an optional headless-browser check (`STUDIO_CHROMIUM` + `playwright-core`).

- A review note can be saved with no Yes/No verdict. `setReview` takes verdict `yes`, `no`, or `null` (`""` and an omitted verdict count as `null`). The server returns 400 unless the post has a verdict or a non-empty note. Records already in `reviews.json` still load.
- The file review bar autosaves the note (about 800ms after typing, and on blur). Yes and No toggle, and each click saves the current note immediately. Switching or closing a tab waits for a dirty review instead of dropping it. Leaving the page warns when a review draft is unsaved or a save is still in flight.
- Folder rows (playlist, file list, and image thumbnails) have a note field that autosaves on blur, Enter, and after a short pause, with a per-row Saved or Error status. Yes / No toggle and send that note. Saving a row updates it in place so typing keeps focus.
- A note with no verdict shows a note badge, and its tooltip is the note. **Unreviewed only** treats a file as reviewed only when it has a Yes or No verdict, so a note-only file stays visible.
- `GET /api/reviews?path=` and MCP `get_review` include `timestampNotes`, the text of the sibling `<file>.review.md`, or `null`. The media pane heading names that file so timestamped notes are distinct from the review note.
- The full `GET /api/reviews` list and MCP `get_reviews` include `timestampNotes` for every `<file>.review.md`, including notes whose media file no longer exists. `?lite=1` skips them; the page polls with it.
- Reviews keep a size/mtime/sha256 fingerprint. A reviewed file that is moved or renamed within its short is re-keyed to the new path on the next read (`movedFrom`, `movedAt`, and a `moved` list in the response), and its `<file>.review.md` is moved along, or appended to existing notes at the new path without overwriting.

## [1.0.0] - 2026-10-19

### Added

- Initial release of Shorts Studio.
