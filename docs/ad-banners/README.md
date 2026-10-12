# Ad banners / 広告バナー

Display-ad banners that send people to the landing page
(<https://refrain-sheet.com/>). Each size is rendered at 1x and 2x
(`-2x.png`); every file is under the 150 KB limit most ad networks set.

ランディングページへの集客用のディスプレイ広告バナーです。各サイズを 1x と 2x
（`-2x.png`）で書き出しています。どのファイルも多くの広告配信の上限 150KB 未満です。

| Size    | 1x                                                     | 2x                                                           |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| 300×250 | [refrain-sheet-300x250.png](refrain-sheet-300x250.png) | [refrain-sheet-300x250-2x.png](refrain-sheet-300x250-2x.png) |
| 336×280 | [refrain-sheet-336x280.png](refrain-sheet-336x280.png) | [refrain-sheet-336x280-2x.png](refrain-sheet-336x280-2x.png) |
| 728×90  | [refrain-sheet-728x90.png](refrain-sheet-728x90.png)   | [refrain-sheet-728x90-2x.png](refrain-sheet-728x90-2x.png)   |
| 160×600 | [refrain-sheet-160x600.png](refrain-sheet-160x600.png) | [refrain-sheet-160x600-2x.png](refrain-sheet-160x600-2x.png) |
| 300×600 | [refrain-sheet-300x600.png](refrain-sheet-300x600.png) | [refrain-sheet-300x600-2x.png](refrain-sheet-300x600-2x.png) |
| 970×250 | [refrain-sheet-970x250.png](refrain-sheet-970x250.png) | [refrain-sheet-970x250-2x.png](refrain-sheet-970x250-2x.png) |

## Design / デザイン

- Copy: 「CSVを、壊さない。」, kicker 「無料のCSVエディタ」, button 「無料で使ってみる」.
- Type: Noto Sans JP Black (900) and Bold (700), `palt` (the vertical 160×600
  uses `vpal`). Display lines are scaled to fill an exact width.
- Colour: deep green `#003D22`, lime `#C8F542`. These are ad-only colours
  outside the brand palette, chosen for attention on third-party pages.
- Logo: the design system's reverse lockup, never below its 24 px minimum.

## Regenerate / 再生成

The banners are HTML/CSS rendered in headless Chromium by
[`scripts/build/ad-banners.mjs`](../../scripts/build/ad-banners.mjs).
Noto Sans JP (SIL OFL 1.1) is not vendored; download the static
`NotoSansJP-Bold.ttf` and `NotoSansJP-Black.ttf` from Google Fonts into a
folder and pass it:

```bash
npm run build:ad-banners -- --fonts <dir>
```
