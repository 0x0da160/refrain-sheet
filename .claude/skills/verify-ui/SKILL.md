---
name: verify-ui
description: Build the app, capture the screen a change affects at phone and desktop widths, in English and Japanese, in the light, dark and hybrid looks, then open every image and report what you saw. A visual check beyond `npm run ui:check`; the images stay outside the repository.
---

# Skill: verify-ui

`npm run ui:check` proves that the built app renders with no console error and keeps its grid
geometry at every zoom level, and `npm run ui:check:minimal` proves that both editions save the same
bytes. Neither shows anyone the screen. This skill does: it captures the state a change affects
across the combinations that break most often, you look at every image, and you report what you saw.
It never changes code to make a screen look right. A defect you find is ordinary work, followed by a
new capture.

It is also how to launch the app. There is no server to start: `npm run build` writes
`dist/index.html`, one file that runs from `file://`.

## When to use it

A change a user would see: anything under `src/ui/`, `src/styles/`, `src/locales/` or
`design-system/`, or a new label, dialog, panel, menu or layout. For a change with no visible
effect, say so and skip this skill.

## 1. Build what you will look at

- `npm run build` writes `dist/` (the regular edition). When the change could reach the CSV-only
  minimal edition (`src/app/edition.ts` lists what it leaves out), also run `npm run build:minimal`
  and capture `dist-minimal/`.
- Reinstall with `npm ci --ignore-scripts` first if `package-lock.json` changed (see `verify-change`).
- `npm run dev` serves the source for quick iteration, but what ships is the built file, so the
  check itself looks at that.

## 2. Choose the matrix

| Axis     | Values                                                                                                               | Why                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Width    | `phone` 390×844 with touch, `desktop` 1400×900                                                                       | The layout changes below 700 px (`43.75em`), and the `(pointer: coarse)` rules in `dialogs.css`, `grid.css` and `sheet-objects.css` apply only with touch.                                        |
| Language | `en` and `ja` (`localStorage` key `refrain-csv-html.locale`)                                                         | Japanese strings differ in length, and `ja` is where an untranslated label shows.                                                                                                                 |
| Look     | `light` and `dark`; add `hybrid` when the change touches grid colours or theme tokens (key `refrain-csv-html.theme`) | Hybrid, the default for new users, is a dark shell around a light grid. It follows the browser's colour scheme, so capture it with `colorScheme: 'dark'`; in a light browser it looks like Light. |

Capture only the state the change affects, not every screen. Two widths, two languages and two
looks make 8 images; with hybrid, 12.

## 3. Capture

Write the script in a scratch folder outside the repository, so the tree stays clean. It loads
Playwright through the repository's `package.json`, so it needs no file in the tree. Run it with
`node capture.mjs <repo> <out-dir> [dist]`, where `[dist]` is `dist` (the default) or `dist-minimal`.
Edit only `reach()`, which puts the app in the state the change affects. The one below opens a
small CSV by dropping it on the window, as the existing checks do. To go further, click menu items
(on the phone layout the menus sit behind `.menu-bar-toggle`), press shortcuts, or follow
`scripts/ui-check/grid.mjs` (an opened file starts protected, so its first edit asks to unlock).

```js
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, outDir, dist = 'dist'] = process.argv.slice(2);
const { chromium } = createRequire(join(repo, 'package.json'))('playwright');

const SIZES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1400, height: 900 } },
};
const LOCALES = ['en', 'ja'];
// [name, stored theme choice, the browser's colour scheme]. Hybrid and System follow the browser.
const LOOKS = [
  ['light', 'light', 'light'],
  ['dark', 'dark', 'dark'],
  // ['hybrid', 'hybrid', 'dark'],
];
const CSV = 'id,name,note\r\n1,Ann,hello\r\n2,Bob,こんにちは\r\n3,Cy,"a, quoted"\r\n';

/** Put the app in the state the change affects. Edit this per change. */
async function reach(page) {
  await page.evaluate((csv) => {
    const dt = new DataTransfer();
    dt.items.add(new File([csv], 'sample.csv', { type: 'text/csv' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, CSV);
  await page.waitForSelector('.vgrid-rows .vcell[data-row="1"][data-col="0"]');
}

mkdirSync(outDir, { recursive: true });
const problems = [];
const browser = await chromium.launch();
for (const [size, options] of Object.entries(SIZES)) {
  for (const locale of LOCALES) {
    for (const [look, theme, colorScheme] of LOOKS) {
      const name = `${size}-${locale}-${look}`;
      const context = await browser.newContext({ ...options, colorScheme, deviceScaleFactor: 2 });
      await context.addInitScript(
        ([l, t]) => {
          localStorage.setItem('refrain-csv-html.locale', l);
          localStorage.setItem('refrain-csv-html.theme', t);
        },
        [locale, theme],
      );
      const page = await context.newPage();
      page.on('pageerror', (e) => problems.push(`${name}: page error: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`${name}: console error: ${m.text()}`);
      });
      await page.goto(pathToFileURL(join(repo, dist, 'index.html')).href);
      await page.waitForSelector('.menu-bar');
      await reach(page);
      // Compare with the configured width: on the phone, innerWidth grows to fit a page that is too wide.
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const wider = scrollWidth - options.viewport.width;
      if (wider > 0) problems.push(`${name}: the page is ${wider}px wider than the screen`);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
      await context.close();
    }
  }
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'no console errors, no horizontal overflow');
process.exit(problems.length ? 1 : 0);
```

- Use made-up data only, never a person's real file. The script opens `file://` and nothing else.
- Playwright needs its Chromium. CI installs it with `npx --no-install playwright install --with-deps chromium`,
  and the Docker image has it. If the installed revision differs from the one Playwright expects and
  you point `PLAYWRIGHT_BROWSERS_PATH` at a substitute, say so in the report (see `verify-change`).
- In the Docker form the container sees only the repository (`compose.yaml` mounts it at `/app`). Put the
  script and the images in a folder inside it, run `docker compose run --rm app node <script> /app <out-dir>`,
  and delete the folder before you commit.
- `UI_CHECK_SCREENSHOT_DIR=<dir> npm run ui:check` also saves the grid at each zoom level. Use it for a
  zoom or grid-geometry change.

## 4. Look at every image

Open each PNG with a tool that can show images (Claude Code's Read tool does). You have not verified
a screen you did not open. Look for:

- text clipped, overlapping, or pushed out of its box, and Japanese labels that no longer fit;
- anything hard to read in `dark` or `hybrid`: low contrast, dark text on a dark fill, an icon that
  vanishes (`npm run check:contrast` covers token pairs, not composed screens). In `hybrid` the shell
  is dark and the grid is light;
- on `phone`: controls out of reach or cramped, content cut off at the edge (the script also flags a
  page wider than the screen);
- an English string in a `ja` image, or a raw key such as `menu.file.open` in any image;
- for a change to an existing screen, the same state captured from a build of `main`, so you can see
  what moved.

## 5. Report and deliver

- Save the images and the script outside the repository, named `<size>-<locale>-<look>.png`. Never
  commit them: the repository stays small and offline-clean.
- When the session can hand files to the person (for example a shared project folder), copy the
  images there and attach them to your reply. A pull request description cannot hold a local file.
- In the pull request's Verification section (see `open-pr`), say which matrix you captured and the
  state it shows, what you saw (defects found and fixed, or "no defect in N images"), the result of the
  console and overflow checks, and where the images are.
- Say what you could not capture: no browser, a state you could not reach, a look you left out and why.

## Rules

- **Looking is the check.** Do not call a screen verified unless you opened its image.
- **No silent fixes.** A defect is fixed as ordinary work, said so in the report, and every affected
  image is captured again.
- **Refrain Sheet only.** Never add a Microsoft or Excel screenshot, even as a reference: the Never
  list in `knowledge/decisions/ip-risk-policy.md` includes them.
- **Leave the tree clean.** No image or script in a commit: `git status --porcelain` prints nothing.
