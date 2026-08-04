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

### Changed

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
