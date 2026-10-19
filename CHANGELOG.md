# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- `GET /api/resolve` still returns `images` for a folder and also returns `files` with a `kind` for each direct child.
- `/media` still refuses non-media types.
- `list_files` documents unknown types as `kind` `"other"`.
- HTTP method guard allows `POST` and `DELETE` on `/api/reviews` in addition to `PUT /api/file`.

### Fixed

- A review note can be saved with no Yes/No verdict. `setReview` takes verdict `yes`, `no`, or `null` (`""` and an omitted verdict count as `null`). The server returns 400 unless the post has a verdict or a non-empty note. Records already in `reviews.json` still load.
- The file review bar autosaves the note (about 800ms after typing, and on blur). Yes and No toggle, and each click saves the current note immediately. Switching or closing a tab waits for a dirty review instead of dropping it. Leaving the page warns when a review draft is unsaved or a save is still in flight.
- Folder rows (playlist, file list, and image thumbnails) have a note field that autosaves on blur, Enter, and after a short pause, with a per-row Saved or Error status. Yes / No toggle and send that note. Saving a row updates it in place so typing keeps focus.
- A note with no verdict shows a note badge, and its tooltip is the note. **Unreviewed only** treats a file as reviewed only when it has a Yes or No verdict, so a note-only file stays visible.
- `GET /api/reviews?path=` and MCP `get_review` include `timestampNotes`, the text of the sibling `<file>.review.md`, or `null`. The media pane heading names that file so timestamped notes are distinct from the review note.

## [1.0.0] - 2026-10-19

### Added

- Initial release of Shorts Studio.
