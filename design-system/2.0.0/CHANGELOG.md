# Changelog

## 2.0.0 — 2026-09-26

v1.0.0 を再評価し、表計算の密度に合わせて作り直しました。判断の根拠は
`docs/decisions.md`、調査は `docs/research.md`、移行とアプリへの適用計画は
`docs/migration.md` にあります。

### 破壊的変更
- **文字** — UI の本文を 16px → 14px、補助を 14px → 13px、英数字専用の 12px を追加。
  役割名（caption / meta / body / title / heading / display）に改め、
  `--text-xs` `--text-lead` `--text-h1..h3` と倍率の `--leading-*` を廃止。
- **密度** — compact / standard（既定）/ comfortable。バー 28/32/40、
  バー内コントロール 24/28/32、フォーム 28/32/40。`--control-h-*` を廃止し、
  `--control-h` と `--field-h` の 2 系統に。
- **角丸** — `--radius-lg` 10 → 8px、`--radius-xl` 14 → 12px。
- **重なり順** — アプリの実際の層構造に合わせて `--z-*` を再定義。
- **暗いテーマの副次テキスト** — `--chrome-text-muted` と `--chrome-text-subtle` を明るくし、
  すべての背景で 4.5:1 に。
- **バナー** — シート用の `--state-*` ではなく、新設したシェル用の `--*-subtle` を使う
  （hybrid で警告文が 1.53:1 になっていた不具合の修正）。

### 追加
- 余白 `--space-0` `--space-0-5`（2px）`--space-1-5`（6px）、線 `--border-strong`、アイコン `--icon-*`。
- 色 `ink-150` `ink-250` と色相 `violet` `teal`。
- シェルの状態 `--chrome-hover` `--chrome-pressed`、反転面 `--inverse-*`。
- キャンバス：範囲選択（半透明）、見出しの選択、固定境界、検索一致、エラー、数式、コメント、
  編集済み、数式の参照 4 色、構文色。
- 文書の色：テーマに依存しない 65 色の見本と条件付き書式の既定色。
- `--font-code`、グリッドの寸法トークン。
- 部品：メニュー、タブ、数式バー、docked パネル、ツールチップ、進捗、空の状態、
  グリッドとソースエディタ（`css/grid.css`）。
- Design Tokens Format Module 2025.10 形式の JSON（`tokens/`）。
- 生成・監査ツール `tools/build.mjs` と、値の唯一の出典 `tools/source.mjs`。

### 検証
- コントラスト監査 210/210 合格（70 組 × 3 テーマ）。
- 手書きの CSS に色のリテラル 0 件。
- `node design-system/2.0.0/tools/build.mjs --check` で生成物が最新であることを確認。

### 変更なし
- ブランドの色相と段階、ロゴタイプ、アプリアイコン（`logo/` `icons/` は 1.0.0 と同一）。
- `docs/brand-guidelines.html`（ブランドガイドライン v2.0）。UI の文字規定については
  この DS が優先する（`docs/decisions.md` の D-02）。

## 1.0.0 — 2026-09-22

最初のリリース。`../1.0.0/CHANGELOG.md` を参照。
