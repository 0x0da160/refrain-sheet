# 移行ガイド — v1.0.0 → v2、アプリと LP への適用

> 2.1.0 でディレクトリを `design-system/2.0.0/` から `design-system/v2/` に改めました（decisions.md の D-27）。§1〜§9 の記録は、当時のパスのまま読み替えてください。

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
| 1 | 共通基盤とアプリ層の CSS を取り込み、上の対応表で名前だけを置き換える（値が同じもの）— **適用済み（§7）** | なし | 低 |
| 2 | 色の差分：暗いテーマの副次テキスト、バナー（F-3）、参照色（D-12）、コメントの印の色と位置（D-11）、`rgba()` の直書きの除去 — **適用済み（§7）** | 小 | 低 |
| 3 | 重なり順を `--z-*` に置き換える — **適用済み（§7）** | なし（順序は同じ） | 低 |
| 4 | 太さ 600 を 700 に（描画は同じ）。9〜11px の文字を 12px（caption）に — **適用済み（§8）** | 小さすぎる文字が 12px になる | 低 |
| 5 | UI の本文を 13px から 14px に。コントロールとメニュー項目の高さを `--control-h` / `--field-h` に — **適用済み（§8）** | 全画面の文字とボタンが一回り大きくなる | 中 |
| 6 | 角丸・余白のリテラル（3px・5px・9px・10px など）をトークンに — **適用済み（§8）** | ごく小 | 低 |
| 7 | 密度の切り替えを「表示」メニューに追加（**利用者が決定済み**）。設定は端末ごとに保存 — **適用済み（§8）** | 新機能 | 中 |
| 8 | 文書の色の見本と条件付き書式の既定色（D-13） — **適用済み（§8）** | 色の選択 UI | 中 |
| 9 | アイコンの線幅を 1.5px に（D-15） — **適用済み（§8）** | アイコンがやや細くなる | 低 |

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

## 7. アプリへの適用の記録 — 段階 1〜3（2026-09-26）

`src/styles.css` が最初に `foundations/css/foundations.css` と `app/css/app-tokens.css` を読み込みます。
アプリ独自の色・余白・角丸・影の定義（`tailwind-token-bridge.css` の `:root`、`dark-theme.css`、`hybrid-theme.css`）は削除しました。
アプリに残る独自トークンは、フォントの連鎖（`--font-ui` の上書き、`--sheet-font-*`、`--font-sheet`）と `--bar-height` / `--status-bar-height` だけです。
`src/app/theme.ts` は、hybrid が暗く解決されたときに `data-theme="hybrid"` を付けます。
グリッドは `canvas-*` / `state-*` / `ref-*` だけを使うように書き換えました。
`npm run check:contrast` は生成された CSS の色を読んで、アプリが組み合わせる 25 組を 3 テーマで検査します。

### 計画・対応表と実際が違った点

| 項目 | 計画・文書の記述 | 実際 |
| --- | --- | --- |
| hybrid の枠 | アプリの文書（§色・テーマ）は「hybrid の枠は常に dark」 | アプリの hybrid は OS に従う。OS が明るいときは全体が light で、`data-theme="hybrid"` は OS が暗いときだけ付く |
| `--bar-height` → `--bar-h` | 段階 1（値が同じ） | `pointer: coarse` では `--bar-h` が 48px になり値が変わる。密度の段階（5・7）まで `--bar-height` / `--status-bar-height` を残す |
| `--font-ui` / `--font-sheet` | 既定値を DS の `--font-ui` / `--font-data` に | DS の連鎖は短く、アプリが検証済みの Windows の代替（Meiryo UI・MS UI Gothic など）がない。アプリの連鎖で上書きしたまま |
| `--surface` | `--bg-surface`（浮く面は `--bg-raised`） | アプリの `--surface` は両テーマで `--bg-raised` と同じ値だったので、すべて `--bg-raised` に |
| `--selected-row` | `--canvas-header-selected-bg` | 見出しではなく選択行のセルの背景だったので `--canvas-selection`（値は従来と同じ） |
| `--cell-bg`（ソースエディタ） | `--canvas-bg` | 入れ物はツールバーを含む枠なので `--bg-surface`。入力欄（`.source-editor`）だけを `--canvas-bg` ＋ `--canvas-text` に |
| `--find-highlight` | `--canvas-find-match` | アプリではファイルのドロップ表示（枠）だけが使っていた。`color-mix(in srgb, var(--accent) 18%, transparent)` で従来の見た目のまま |
| ドロップ表示の重なり順 | ファイルのドロップは `--z-overlay`（250） | 読み込み中の表示（250）より下に置く必要があるので `--z-modal`（200、従来と同じ値） |
| 数式参照の注記（60） | 対応する層がない | `--z-raised`（10）。これより上で競合する要素はなく、順序は同じ |
| `--danger-soft` | — | アプリで未定義のまま `rgba()` の代替値が使われていた。`--state-removed` に |
| 警告トースト | 決める | `--warning-subtle` ＋ `--warning-text`（警告バナーと同じ配色） |
| 表示診断（`viewport-debug.css`） | — | 開発用の診断表示なので、色の直書きを残す |

### 目に見える変化（段階 2）

- dark：副次テキストが明るくなった（4.5:1 を満たす値）。入力欄の背景が `--bg-surface`（ink.800）に。
- 行・列見出しの背景が `--canvas-header-bg`（light は paper.50、dark は ink.900）に、選択中の見出しが `--canvas-header-selected-*` に。
- 固定行・固定列の境界線が緑から `--canvas-frozen-divider`（灰）に。
- コメントの印が右上の青に、数式の印が左下に（D-11）。重ならなくなった。
- 数式の参照色が blue・violet・amber・teal に（D-12）。
- トーストが `--inverse-*` に（dark では明るい面）。エラーは `--danger`。
- 読み込み中の覆いが白の半透明から `--overlay`（暗い半透明）に。
- 影が `--shadow-*` に。
- hybrid（OS が暗いとき）：ソースエディタの入力欄も明るい紙になった。

### 残した差分（§9 ですべて解消）

- 縞模様の行：DS は「既定では無効」だが、アプリは交互の行に `--canvas-row-alt` を常に付けていた。
- アクセントの文字：DS は文字に `--accent-text` を使うが、アプリは `--accent` のままだった。
- `tests/brand-assets.test.ts` が `design-system/1.0.0/` のアイコンを参照していた。

## 8. アプリへの適用の記録 — 段階 4〜9（2026-09-26）

| 段階 | 実施した内容 |
| --- | --- |
| 4 | `font-weight` の 600 / 700 をすべて `var(--weight-bold)` に。9〜11px の文字は `var(--text-min)`（12px） |
| 5 | 本文 13px → `--text-body`、補助 12px → `--text-caption`、ダイアログの見出し 14px → `--text-title`。ダイアログとパネルの入力欄・ボタン → `--field-h`、バー内のコントロールとメニュー項目 → `--control-h`（最小の高さ） |
| 6 | 角丸 9 / 10 / 999px → `--radius-full`、5px → `--radius-md`、2〜3px → `--radius-xs`、4px → `--radius-sm`。3px / 10px の余白 → `--space-1` / `--space-2` |
| 7 | 「表示 > 表示密度」（`src/app/density.ts`、`data-density`、端末ごとに保存）。バーは `--bar-h` / `--statusbar-h`、ダイアログの上下の余白は `--inset` |
| 8 | 色の選択に 65 色の見本を `<datalist>` で提示（`src/ui/document-colors.ts`、`--swatch-*` を実行時に読む）。条件付き書式の既定色を `--cf-*` に |
| 9 | `createIcon` が `ui-icon` クラスを付け、`base.css` が `vector-effect: non-scaling-stroke` と `--icon-stroke` で描く |

### 計画・文書と実際が違った点

| 項目 | 計画・文書の記述 | 実際 |
| --- | --- | --- |
| 9〜11px → caption | `--text-caption` に | `--text-caption` は粗いポインタで 14px になり、本文より大きくなる箇所が出るため、段階 4 では固定の `--text-min`（12px）にした |
| ソースエディタの文字 | キャンバスは `--grid-font-size`（12px）× 倍率 | 13px のまま。12px にすると小さくなり、倍率の仕組みもエディタにはない |
| モバイルのタップ領域の下限 | `pointer: coarse` のトークンに | 36〜44px の下限は画面幅（700px 以下）で決まっていて、細いデスクトップの窓でも効かせているため直書きのまま |
| メニュー項目の高さ | `--control-h`（standard 28px） | 上下の余白だけで 28px になるので、`min-height` として付けた。compact（24px）でも縮まず、comfortable（32px）でだけ伸びる |
| compact のバー | `--bar-h` 28px | メニューバーは中のボタンと下線で 29px になり、28px まで縮まない（2026-09-26 に実測。standard 32px、comfortable 40px、状態バー 24 / 24 / 32px は値どおり） |
| 余白の密度 | `--inset` / `--stack-gap` で内側の余白が変わる | ダイアログの上下の余白だけを `--inset` に。左右の余白とパネルのフォームの間隔は standard の値と合わないため固定のまま |
| 文書の色の見本 | 65 色の見本（色の選択 UI） | 独自の色選択 UI は作らず、ブラウザ標準の色選択に `<datalist>` で候補を渡した。Chromium 系だけに表示され、他のブラウザでは従来どおり |
| 条件付き書式の強調 | 既定色の置き換え | 塗りだけだった既定を、`--cf-highlight-bg` の塗り ＋ `--cf-highlight-text` の文字にした。色の段階は 2 色なので `--cf-scale-mid` は使っていない |

## 9. 残件の解消（2026-09-26）

§7・§8 で「計画と違う」「残した」とした項目の扱いです。アプリを直したものと、実態に合わせてデザインシステムの文書を直したものがあります。

| 項目 | 対応 |
| --- | --- |
| 縞模様の行 | 既定でオフ（DS どおり）。「表示 > 行を交互に色分け」でオンにでき、端末ごとに保存（`src/app/banded-rows.ts`、ルートの `data-banded-rows`、D-26） |
| アクセントの文字 | 文字は `--accent-text`、`--accent-subtle` の上の文字は `--accent-subtle-text`、リンクは `--link`。アイコンや印などの図形は `--accent` のまま。`check:contrast` の組も差し替えた |
| compact のバー | メニューのボタンの高さを `--control-h` から、タブ行の上の余白と数式バーの入力欄の高さを `--bar-h` から計算するようにした。ファイルを開いた状態で、メニューバー・タブ行・数式バー・シートの切り替え行が 28 / 32 / 40px、状態バーが 24 / 24 / 32px（幅 1400px、ヘッドレス Chromium で実測） |
| 9〜11px → caption | 本文が `--text-body` になったので、`--text-min` をやめて `--text-caption` にそろえた（タッチでは 14px で、本文 16px より小さいまま） |
| `--font-ui` / `--font-sheet` | アプリの連鎖を共通基盤の `--font-ui` / `--font-data` にした（D-24）。アプリの上書きはなくなり、既定のスプレッドシートのフォントは `--font-data` を参照する。LP も同じ連鎖になる |
| ソースエディタの文字 | アプリ・DS とも `--text-body`（14px）、JSON と YAML は `--font-code`（D-25）。DS の `.rs-source` も同じにした |
| hybrid の枠 | DS の文書（§色・テーマ）に、アプリの hybrid は OS に従い、OS が暗いときだけ `data-theme="hybrid"` になることを追記 |
| `tests/brand-assets.test.ts` | 2.0.0 の原本を参照 |

### 意図して残すもの

| 項目 | 理由 |
| --- | --- |
| 幅 700px 以下のタップ領域の下限（36〜44px） | ポインタではなく画面幅で決まる下限で、細いデスクトップの窓でも効かせている。密度より優先するので、狭い画面では compact でもバーは 44px 前後になる |
| 表示診断（`viewport-debug.css`）の色と文字 | `#debug-viewport` のときだけ出る開発用の表示で、利用者向けの UI ではない |
| 余白の密度（`--inset` / `--stack-gap`） | ダイアログの上下の余白だけに使う。左右の余白（16px）とパネルのフォームの間隔（16px）は standard の値（12px）と違い、変えると standard の見た目が変わるため |

§9 の「意図して残すもの」のうち、タップ領域の下限と余白の密度は 2.1.0 で規則のほうを直して解消しました（§10）。

## 10. 2.1.0 の適用（2026-09-26）

規定の見直し（decisions.md の G-1〜G-10、D-27〜D-35）を、アプリと LP に同時に適用しました。利用側のクラス名や構造は変えていません。

| 項目 | アプリ | LP |
| --- | --- | --- |
| ディレクトリ（D-27） | `src/styles.css` などのパスを `design-system/v2/` に | `scripts/build-landing.mjs` のパスを同じく |
| 密度（D-28） | トークンの値が変わるだけ。comfortable のバーと入力欄が 40 → 36px、状態バーが 32 → 28px。上下の余白だけに `--inset` を使う書き方は、そのまま新しい規則どおり | — |
| タッチ（D-29） | スマートフォン配置の 44 / 40 / 36px の直書きを `--target-touch` と `--target-touch-dense` に。36px だった文書タブの閉じるボタンと状態バーの詳細ボタンは 40px に | ボタンの 44px は `--target-touch` と同じ値（変更なし） |
| ブレークポイント（D-30） | `700px` / `701px` を `43.75em` に（CSS・`matchMedia`・テスト） | 47.5em → 43.75em、55em → 56.25em |
| 意味色（D-31） | Markdown プレビューの文字列を `--success-text` に。差分パネルのバッジを「淡い面 ＋ 文字」に（変更＝warning、追加＝success、削除＝danger。これまで変更と追加が同じ緑だった） | 暗い帯の結果の文字を `--warning-text` に |
| 行送り（D-33） | — | トークン経由で自動（caption・small・lead 1.75、見出し 1.3） |
| 監査（D-34） | `check:contrast` の `success` を `success-text` に、バッジの組を追加 | — |

### 意図して残すもの

| 項目 | 理由 |
| --- | --- |
| 表示診断（`viewport-debug.css`）の色と文字 | 開発用の表示で、利用者向けの UI ではない（§9 と同じ） |
| パネルのフォームの行間（16px） | `--stack-gap`（standard 12px）と値が違い、置き換えると standard の見た目が変わる。次の見直しで、どちらの値に寄せるかを決める |
| `--bp-xl`（90em） | どこも使っていないが、削除はメジャーの変更なので次のメジャーまで「予約」とする |
