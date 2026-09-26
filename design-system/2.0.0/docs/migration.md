# 移行ガイド — v1.0.0 → v2.0.0、そしてアプリへの適用

## 1. デザインシステム v1.0.0 → v2.0.0（破壊的変更）

| 種類 | v1.0.0 | v2.0.0 |
| --- | --- | --- |
| 値の変更 | `--text-xs` 14px / `--text-body` 16px | `--text-meta` 13px / `--text-body` 14px（`--text-xs` は廃止） |
| 廃止 | `--text-lead` `--text-h1` `--text-h2` `--text-h3` | `--text-title` 16 / `--text-heading` 20 / `--text-display` 28 |
| 廃止 | `--leading-tight` `--leading-ui` `--leading-body`（倍率） | 役割ごとの `--leading-{caption,meta,body,title,heading,display}`（rem）、読み物は `--leading-prose` |
| 値の変更 | `--radius-lg` 10px / `--radius-xl` 14px | 8px / 12px |
| 廃止 | `--control-h-sm` `-md` `-lg`、`--control-gap`、`--control-slot` | 密度で決まる `--control-h`（バー内）と `--field-h`（フォーム）、`--icon-*` |
| 改名 | 密度 `comfortable`（既定）/ `spacious` | `standard`（既定）/ `comfortable`（値も変更） |
| 廃止 | `--row-h` `--cell-px` | グリッドは `--grid-row-h` `--grid-cell-px`（px × 表示倍率） |
| 値の変更 | `--z-sticky` 100 〜 `--z-tooltip` 600 | `--z-raised` 10 〜 `--z-tooltip` 400（アプリの層構造に合わせた） |
| 廃止 | `--z-dropdown` `--z-drawer` | `--z-popover` `--z-menu` `--z-submenu` `--z-panel` `--z-overlay` |
| 値の変更 | 暗いテーマの `--chrome-text-muted` `#81878F`、`--chrome-text-subtle` `#6F757D` | `#A7ADB5` / `#8D939B`（4.5:1 を満たすため） |
| 値の変更 | 暗いテーマの `--chrome-border` `#323941` | 同じ。`--chrome-hover` `#323941`、`--chrome-pressed` `#474E57` を追加 |
| 用途の変更 | バナーが `--state-*` を使う | `--info-subtle` `--warning-subtle` `--danger-subtle` を使う |
| 追加 | — | `--space-0` `--space-0-5` `--space-1-5`、`--border-strong`、`--icon-*`、`--inverse-*`、キャンバスの状態・参照・構文色、文書の色の見本、`--font-code` |

v1.0.0 のディレクトリは履歴として残します。新しい作業は v2.0.0 だけを参照してください。

## 2. アプリの現行トークン → v2.0.0

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

安全な手順：先にアプリ側を一時的な名前（`--app-space-*`）に退避し、DS の `tokens.css` を読み込んでから、上の表で置き換えます。

### 色

| アプリ | v2.0.0 |
| --- | --- |
| `--bg` | `--chrome-bg` |
| `--panel` / `--surface` | `--chrome-surface`（浮く面は `--chrome-raised`） |
| `--panel-hover` / `--panel-active` | `--chrome-hover` / `--chrome-pressed` |
| `--border` / `--border-subtle` | `--chrome-border` / `--chrome-border`（区別が必要なら `--chrome-border-strong`） |
| `--text` / `--text-dim` / `--text-muted` | `--chrome-text` / `--chrome-text-muted` / `--chrome-text-subtle`（キャンバス内は `--canvas-text` / `--canvas-text-muted`） |
| `--field-bg` | `--chrome-surface` |
| `--cell-bg` / `--grid-line` / `--row-alt` | `--canvas-bg` / `--canvas-grid` / `--canvas-row-alt` |
| `--selected-row` | `--canvas-header-selected-bg` |
| `--sticky-bg` | `--canvas-header-bg`（固定行は見出しと同じ地色にし、境界は `--canvas-frozen-divider`） |
| `--info-soft` | `--info-subtle` |
| `--accent` / `--accent-soft` / `--accent-contrast` | `--accent` / `--accent-subtle` / `--accent-contrast` |
| `--accent-contrast-dim` | `--inverse-text-muted` またはアクセント上の用途を見直す |
| `--range-fill` | `--canvas-range-fill` |
| `--edited` / `--edited-border` | `--state-modified` / `--canvas-edited-mark` |
| `--danger` / `--warning` / `--success` | 同名（文字には `--danger-text` / `--warning-text`） |
| `--warning-soft` / `--warning-border` | `--warning-subtle` / `--warning` |
| `--formula-text` / `--formula-marker` | `--canvas-formula-text` / `--canvas-formula-mark` |
| `--void-a` / `--void-b` | `--canvas-bg` / `--canvas-row-alt` |
| `--find-highlight` | `--canvas-find-match`（現在の一致は `--canvas-find-current`） |
| `--scrim` / `--scrim-light` | `--overlay` / （読み込み中の覆いは `--overlay` に統一） |
| `--tooltip-bg` / `--tooltip-text` | `--inverse-bg` / `--inverse-text` |
| `--toast-warn-bg` / `--toast-error-bg` | トーストは `--inverse-bg`、エラーは `--danger` + `--danger-contrast` |
| `--shadow` / `--shadow-strong` | `--shadow-md` / `--shadow-lg` |
| `--fref-1`〜`--fref-4` と `formula-reference-highlight.css` の `rgba()` | `--ref-1`〜`--ref-4` と `--ref-N-fill` |

### 寸法

| アプリ | v2.0.0 |
| --- | --- |
| `--bar-height` 32px | `--bar-h`（standard で 32px） |
| `--status-bar-height` 24px | `--statusbar-h` |
| `--radius-sm` 4 / `--radius-md` 6 / `--radius-lg` 12 | `--radius-sm` 4 / `--radius-md` 6 / `--radius-xl` 12（パネル・メニューは `--radius-lg` 8） |
| `--font-sheet` | 既定値を `--font-data` にする。利用者が選ぶスプレッドシートフォントの仕組みはそのまま |
| `--grid-row-height` 24px | `--grid-row-h` |
| `body { font-size: 13px }` | `--text-body`（14px） |

## 3. アプリへの適用計画

1 つの PR に 1 つの段階。各段階で `npm run ui:check` とランディングページのスクリーンショットを確認します。

| 段階 | 内容 | 目に見える変化 | 危険度 |
| --- | --- | --- | --- |
| 1 | v2 の `tokens.css` をアプリに取り込み、上の対応表で名前だけを置き換える（値が同じもの） | なし | 低 |
| 2 | 色の差分：暗いテーマの副次テキスト、バナー（F-3）、参照色（D-12）、コメントの印の色と位置（D-11）、`rgba()` の直書きの除去 | 小 | 低 |
| 3 | 重なり順を `--z-*` に置き換える | なし（順序は同じ） | 低 |
| 4 | ウェイト 600 を 700 に（描画は同じ）。9〜11px の文字を caption/meta に | 小さい文字が大きくなる | 中 |
| 5 | UI の本文を 13px から 14px に。コントロールとメニュー項目の高さを `--control-h` / `--field-h` に | 全画面の文字とボタンが一回り大きくなる | 中 |
| 6 | 角丸・余白のリテラル（3px・5px・9px・10px など）をトークンに | ごく小 | 低 |
| 7 | 密度の設定（表示メニュー）を追加 | 新機能 | 中（製品判断が必要） |
| 8 | グリッドの文字を 12px から 13px に（D-03） | セルの文字と自動列幅 | 高（人の判断が必要） |
| 9 | 文書の色の見本と条件付き書式の既定色（D-13） | 色の選択 UI | 中 |
| 10 | アイコンの線幅を 1.5px に（D-15） | アイコンがやや細くなる | 低 |

## 4. 画面ごとの差分（2026-09-26 時点のアプリ）

| 画面・部品 | 主な差分 |
| --- | --- |
| メニューバー・ドロップダウン | 11px の文字（`menu-bar.css`）、ウェイト 600、20px・22px の固定の高さ |
| 右クリックメニュー | 13px、ツールバー項目 28px は standard の `--control-h` と一致 |
| 数式バー | 11〜12px の補助文字、入力欄 26px × 倍率 |
| ダイアログ | 本文 13px、見出し 14px、補助 12px。v2 は本文 14px、見出し 16px |
| SQL パネル・差分パネル | 12〜13px が多い |
| 状態バー | 12px → 13px（meta） |
| グリッド | 12px × 倍率、フィルタボタンの 9px、コメントと数式の印が右上で衝突 |
| ようこそ画面 | 見出しと本文を heading / body に |
| トースト | 右上・濃い面は v2 と一致。警告トースト（`--toast-warn-bg`）は v2 に対応する部品がないため、`--inverse-bg` ＋警告アイコンにするか決める |
| モバイル | タッチの下限 36〜44px の直書きを `pointer: coarse` のトークンに |
