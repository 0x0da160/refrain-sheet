# 移行ガイド — v1.0.0 → v2.0.0、アプリと LP への適用

## 1. 構成の変更

| v1.0.0 | v2.0.0 |
| --- | --- |
| `css/tokens.css`（すべて） | `foundations/css/foundations.css`（共通）＋ `app/css/app-tokens.css` ＋ `brand/css/brand-tokens.css` |
| `css/refrain-sheet.css` | アプリ：`app/css/refrain-sheet.css`、LP：`brand/css/refrain-brand.css`（どちらも共通基盤を含む） |
| `docs/design-system.html` | `app/docs/design-system.html`（アプリ）と `foundations/docs/foundations.html`（共通） |
| `docs/brand-guidelines.html`（v2.0） | `brand/docs/brand-guidelines.html`（v3.0） |
| `logo/` `icons/` | `foundations/logo/` `foundations/icons/`（中身は同一） |

v1.0.0 のディレクトリは履歴として残します。アプリのテスト（`tests/brand-assets.test.ts`）はまだ `design-system/1.0.0/` のアイコンを参照していますが、中身は同一なので、適用時にパスを変えるだけで済みます。

## 2. トークンの対応（v1.0.0 → v2.0.0）

| v1.0.0 | v2.0.0 |
| --- | --- |
| `--chrome-bg` `--chrome-surface` `--chrome-raised` `--chrome-sunken` | `--bg-page` `--bg-surface` `--bg-raised` `--bg-sunken` |
| — | `--bg-hover` `--bg-pressed`（新規） |
| `--chrome-border` `--chrome-border-strong` `--border-control` | `--border-default` `--border-strong` `--border-control` |
| `--chrome-text` `--chrome-text-muted` `--chrome-text-subtle` | `--fg-default` `--fg-muted` `--fg-subtle`（暗いテーマの値を 4.5:1 に変更） |
| `--border-thin` `--border-thick`（太さ） | `--stroke-thin` `--stroke-thick`、2px は `--stroke-medium`（新規） |
| `--text-xs` 14px / `--text-body` 16px | `--text-caption` 12px / `--text-body` 14px（アプリ層） |
| `--text-lead` `--text-h1..h3` `--text-display` | アプリ：`--text-title` 16 / `--text-heading` 20。LP：`--brand-text-*`（流体） |
| `--leading-tight` `--leading-ui` `--leading-body` | 役割ごとの `--leading-*`（rem）、読み物は `--leading-prose` |
| `--radius-lg` 10 / `--radius-xl` 14 | 8 / 12。`--radius-2xl` 16 を追加 |
| `--control-h-sm/md/lg` `--control-gap` `--control-slot` | 密度で決まる `--control-h` と `--field-h`、`--icon-*` |
| 密度 `comfortable`（既定）/ `spacious` | `standard`（既定）/ `comfortable`（値も変更） |
| `--row-h` `--cell-px` | `--grid-row-h` `--grid-cell-px`（px × 表示倍率） |
| `--z-sticky` 〜 `--z-tooltip`（100〜600） | `--z-raised` 〜 `--z-tooltip`（10〜400、アプリ層） |
| `--tracking-caps` 0.04em | 0.08em |
| バナーが `--state-*` を使う | `--info-subtle` `--warning-subtle` `--danger-subtle` |

## 3. アプリの現行トークン → v2.0.0

アプリ（`src/styles/tailwind-token-bridge.css`）は独自の名前でトークンを持っています。
**`--space-N` は同じ名前で値が違う**ので、機械的な置換は禁止です。

### 余白（名前の衝突に注意）

| アプリ | 値 | v2.0.0 |
| --- | --- | --- |
| `--space-1` | 2px | `--space-0-5` |
| `--space-2` | 4px | `--space-1` |
| `--space-3` | 6px | `--space-1-5` |
| `--space-4` | 8px | `--space-2` |
| `--space-5` | 12px | `--space-3` |
| `--space-6` | 16px | `--space-4` |
| `--space-7` | 24px | `--space-6` |

安全な手順：先にアプリ側を一時的な名前（`--app-space-*`）に退避し、DS の CSS を読み込んでから、上の表で置き換えます。

### 色

| アプリ | v2.0.0 |
| --- | --- |
| `--bg` | `--bg-page` |
| `--panel` / `--surface` | `--bg-surface`（浮く面は `--bg-raised`） |
| `--panel-hover` / `--panel-active` | `--bg-hover` / `--bg-pressed` |
| `--border` / `--border-subtle` | `--border-default` |
| `--text` / `--text-dim` / `--text-muted` | `--fg-default` / `--fg-muted` / `--fg-subtle`（キャンバス内は `--canvas-text` / `--canvas-text-muted`） |
| `--field-bg` | `--bg-surface` |
| `--cell-bg` / `--grid-line` / `--row-alt` | `--canvas-bg` / `--canvas-grid` / `--canvas-row-alt` |
| `--selected-row` | `--canvas-header-selected-bg` |
| `--sticky-bg` | `--canvas-header-bg`（境界は `--canvas-frozen-divider`） |
| `--info-soft` | `--info-subtle` |
| `--accent` / `--accent-soft` / `--accent-contrast` | `--accent` / `--accent-subtle` / `--accent-contrast` |
| `--range-fill` | `--canvas-range-fill` |
| `--edited` / `--edited-border` | `--state-modified` / `--canvas-edited-mark` |
| `--danger` / `--warning` / `--success` | 同名（文字には `--danger-text` / `--warning-text`） |
| `--warning-soft` / `--warning-border` | `--warning-subtle` / `--warning` |
| `--formula-text` / `--formula-marker` | `--canvas-formula-text` / `--canvas-formula-mark` |
| `--void-a` / `--void-b` | `--canvas-bg` / `--canvas-row-alt` |
| `--find-highlight` | `--canvas-find-match`（現在の一致は `--canvas-find-current`） |
| `--scrim` / `--scrim-light` | `--overlay` |
| `--tooltip-bg` / `--tooltip-text` | `--inverse-bg` / `--inverse-text` |
| `--toast-warn-bg` / `--toast-error-bg` | トーストは `--inverse-bg`、エラーは `--danger` ＋ `--danger-contrast`。警告トーストは v2 に部品がないため、`--inverse-bg` ＋警告アイコンにするか決める |
| `--shadow` / `--shadow-strong` | `--shadow-md` / `--shadow-lg` |
| `--fref-1`〜`--fref-4` と `formula-reference-highlight.css` の `rgba()` | `--ref-1`〜`--ref-4` と `--ref-N-fill` |

### 寸法

| アプリ | v2.0.0 |
| --- | --- |
| `--bar-height` 32px | `--bar-h`（standard で 32px） |
| `--status-bar-height` 24px | `--statusbar-h` |
| `--radius-sm` 4 / `--radius-md` 6 / `--radius-lg` 12 | `--radius-sm` 4 / `--radius-md` 6 / `--radius-xl` 12（パネル・メニューは `--radius-lg` 8） |
| `--font-sheet` | 既定値を `--font-data` にする。利用者が選ぶスプレッドシートフォントの仕組みはそのまま |
| `--grid-row-height` 24px | `--grid-row-h`（24px） |
| グリッドの `calc(12px * var(--sheet-zoom))` | `calc(var(--grid-font-size) * var(--sheet-zoom))`（12px、値は変えない） |
| `body { font-size: 13px }` | `--text-body`（14px） |

## 4. アプリへの適用計画

1 つの PR に 1 つの段階。各段階で `npm run ui:check` とランディングページのスクリーンショットを確認します。

| 段階 | 内容 | 目に見える変化 | 危険度 |
| --- | --- | --- | --- |
| 1 | 共通基盤とアプリ層の CSS を取り込み、上の対応表で名前だけを置き換える（値が同じもの） | なし | 低 |
| 2 | 色の差分：暗いテーマの副次テキスト、バナー（F-3）、参照色（D-12）、コメントの印の色と位置（D-11）、`rgba()` の直書きの除去 | 小 | 低 |
| 3 | 重なり順を `--z-*` に置き換える | なし（順序は同じ） | 低 |
| 4 | 太さ 600 を 700 に（描画は同じ）。9〜11px の文字を 12px（caption）に | 小さすぎる文字が 12px になる | 低 |
| 5 | UI の本文を 13px から 14px に。コントロールとメニュー項目の高さを `--control-h` / `--field-h` に | 全画面の文字とボタンが一回り大きくなる | 中 |
| 6 | 角丸・余白のリテラル（3px・5px・9px・10px など）をトークンに | ごく小 | 低 |
| 7 | 密度の切り替えを「表示」メニューに追加（**利用者が決定済み**）。設定は端末ごとに保存 | 新機能 | 中 |
| 8 | 文書の色の見本と条件付き書式の既定色（D-13） | 色の選択 UI | 中 |
| 9 | アイコンの線幅を 1.5px に（D-15） | アイコンがやや細くなる | 低 |

セルの文字サイズ（12px）は変えません（D-03）。

## 5. 画面ごとの差分（2026-09-26 時点のアプリ）

| 画面・部品 | 主な差分 |
| --- | --- |
| メニューバー・ドロップダウン | 11px の文字（`menu-bar.css`）、太さ 600、20px・22px の固定の高さ |
| 右クリックメニュー | 13px。ツールバー項目 28px は standard の `--control-h` と一致 |
| 数式バー | 11〜12px の補助文字、入力欄 26px × 倍率 |
| ダイアログ | 本文 13px、見出し 14px、補助 12px。v2 は本文 14px、見出し 16px、補助 12px |
| SQL パネル・差分パネル | 12〜13px が多い |
| 状態バー | 12px（v2 の caption と一致） |
| グリッド | 12px × 倍率（維持）、フィルタボタンの 9px、コメントと数式の印が右上で衝突 |
| ようこそ画面 | 見出しと本文を heading / body に |
| トースト | 右上・濃い面は v2 と一致 |
| モバイル | タッチの下限 36〜44px の直書きを `pointer: coarse` のトークンに |

## 6. LP への適用（`site/`）— 適用済み（2026-09-26）

`scripts/build-landing.mjs` が `foundations/css/foundations.css` と `brand/css/brand-tokens.css` を
`site/styles.css` の前に連結して、1 枚のスタイルシートとして書き出します（`@import` は使いません）。
`site/styles.css` の独自トークンと色の直書きはなくなりました。暗い部分（`.dark`・`.panel-dark`・クッキー同意）は
`data-theme="dark"` で共通トークンを暗い値に切り替え、`<html>` には `data-theme="light"` を付けて、OS のダークモードでも LP は明るいままにしています。
LP のクラス名と HTML の構造は変えていません（`rb-` 部品への書き換えは、LP を作り直すときに行います）。

| 段階 | 内容 | 目に見える変化 |
| --- | --- | --- |
| 1 | `brand/css/refrain-brand.css` の共通基盤とブランドのトークン部分を取り込み、`:root` の独自トークンを置き換える（下表） | なし |
| 2 | 色の直書き（`#fff`・`#006335`・`rgba()`）をトークンに | なし |
| 3 | 太さ 600・800 を 700 に（描画は同じ） | なし |
| 4 | 英字ラベルの字間 0.14em → 0.08em、角丸 10 / 14px → 8 / 12 / 16px、ボタンの持ち上げをやめる | 小 |
| 5 | 暗い帯を `data-theme="dark"` ＋共通トークンで書き直す | なし |

| LP の現行トークン | v2.0.0 |
| --- | --- |
| `--text-xs` `--text-sm` `--text-base` `--text-lg` `--text-xl` `--text-2xl` | `--brand-text-caption` `-small` `-body` `-lead` `-h2` `-display`（値は同じ） |
| `--space-1`〜`--space-24` | 共通基盤の `--space-*`（LP の値は共通基盤と同じ） |
| `--paper` `--surface` `--ink` `--ink-2` `--muted` | `--bg-page` `--bg-surface` `--fg-default` `--fg-muted` `--fg-subtle` |
| `--line` `--line-strong` | `--border-default` `--border-strong` |
| `--green` `--green-soft` | `--accent`（文字は `--accent-text`） / `--accent-subtle` |
| `--amber` `--amber-soft` | 図の中の状態表示だけ：`--amber-600` / `--amber-100` |
| `--night` `--night-2` `--night-line` `--night-text` | 帯に `data-theme="dark"` を付け、`--bg-page` `--bg-surface` `--border-default` `--fg-default` |
| `--radius` 10 / `--radius-lg` 14 | `--radius-lg` 8（ボタン）/ `--radius-xl` 12（カード）/ `--radius-2xl` 16（画面の額縁） |
| `--shadow` | `--brand-shadow-showcase` |
| `--maxw` 1180px | `--brand-content-max` |
| `--font-body` `--font-jp` / `--font-mono` | `--font-ui` / `--font-code` |

LP の余白トークンは、名前も値も共通基盤と同じです（`--space-1` = 4px）。アプリの余白と違い、そのまま置き換えられます。
