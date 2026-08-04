# Changelog

All notable user-visible changes to Refrain Sheet are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) (see README
§ "Versioning policy").

## Maintaining this file

Add an entry under **Unreleased** as part of any pull request that changes
user-visible behavior (bug fixes, features, performance, or other changes a
user would notice). When a release is cut with `npm run release`, retitle
`Unreleased` to the new version and date, and start a fresh `Unreleased`
section above it. Purely internal changes (CI, tests, refactors with no
user-visible effect) do not need an entry.

CI enforces the first half of that convention: a pull request that changes
`src/` or `wasm/src/` fails unless it also changes this file. Because "touched
`src/`" is only an approximation of "a user would notice", the gate can be
waived — put `Changelog: not-needed` in the pull request description when the
change really is internal, rather than inventing an entry to satisfy it. The
release-time half (retitling `Unreleased`) is still done by hand.

## [Unreleased]

### Added

- A new **Format** menu applies cell/range visual formatting on RSF
  spreadsheets: Bold, Italic, Underline (also Ctrl+B / Ctrl+I / Ctrl+U),
  Text Color…, Background Color…, Borders…, and Clear Formatting.
  Formatting is purely presentational (it never affects cell values, formula
  results, sort/filter, or CSV export), is undoable, and is saved in the
  `.rsf` file. ([#212](https://github.com/0x0da160/refrain-sheet/issues/212))
- A new **View > Sticky First Column** option pins the first data column
  beside the row headers while scrolling horizontally, mirroring the
  existing **Sticky First Row** option. Both can be combined so header row
  and header column stay visible together on large sheets.
  ([#216](https://github.com/0x0da160/refrain-sheet/issues/216))

### Changed

- The landing page's spreadsheet section now has its own navigation link and
  is reorganized into six feature cards (formulas, workbooks, filter & sort,
  cell formatting, export, and the no-`eval` formula engine), adding the
  cell-formatting and sorting capabilities that were missing from its copy.
  Its SEO metadata (meta description and structured-data feature list, in
  both languages) was refreshed to mention them too, and a new FAQ entry
  clarifies that cell formatting never changes CSV bytes.
  ([#224](https://github.com/0x0da160/refrain-sheet/issues/224))
- The app icon, the app favicon, and the marketing site favicon now share one
  brand mark (a rounded frame with a grid divider and a small flourish). The
  favicon also follows the OS/browser dark-mode preference.
  ([#205](https://github.com/0x0da160/refrain-sheet/issues/205))
- The "Web App" link (About dialog, README, and landing page) now points to
  `https://app.refrain-sheet.com/` instead of the GitHub Pages URL.
  ([#204](https://github.com/0x0da160/refrain-sheet/issues/204))
- The landing page no longer loads Google Fonts from an external CDN (it now
  falls back to local/system fonts, like the app itself), and its footer no
  longer misdescribes the page as an "unofficial" introduction page.
  ([#209](https://github.com/0x0da160/refrain-sheet/issues/209))
- The landing page's hero and feature screenshots now load a smaller image on
  narrow viewports (via `srcset`), cutting mobile data transfer for those
  images by roughly two-thirds and improving Largest Contentful Paint;
  desktop viewports still receive the full-resolution image.
  ([#218](https://github.com/0x0da160/refrain-sheet/issues/218))
- The landing page's stylesheet is now minified during the build (comments
  and whitespace stripped), shrinking it by about 22% for a slightly faster
  first paint. ([#219](https://github.com/0x0da160/refrain-sheet/issues/219))

### Removed

- The on-device "AI Assistant" feature (side panel, menu entry, in-browser
  language model engines and bundled model weights, and the related build
  step) has been removed. ([#190](https://github.com/0x0da160/refrain-sheet/issues/190))

### Scope note

This file starts tracking changes as of `v0.6.1` (2026-08-01). Refrain Sheet
had 30 earlier tagged releases (`v0.1.0` through `v0.6.0`); their content is
not reconstructed here; this project's GitHub Release notes are a fixed
description of the app, not a per-version summary of what changed, and the
earliest tagged commits predate descriptive commit messages, so there is no
reliable source to summarize those versions from without risking inaccurate,
invented history. The full commit and tag history remains available via
`git log`/`git tag` and the
[GitHub Releases page](https://github.com/0x0da160/refrain-sheet/releases).
A human wanting that historical backfill written up can file a follow-up
Issue scoping which versions and what level of detail are wanted.
