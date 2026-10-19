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

## [1.0.0] - 2026-10-19

### Added

- Initial release of Shorts Studio.
