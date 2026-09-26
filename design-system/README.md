# Refrain Sheet Design System

| 版 | 状態 |
| --- | --- |
| [2.0.0](2.0.0/) | **現行。** 新しい作業はこの版だけを参照する |
| [1.0.0](1.0.0/) | 履歴として保存。アプリはまだ一部（色・フォント・アイコン）をここから取り込んでいる |

2.0.0 は 3 つの層でできています。

| 層 | 対象 | 説明書 | CSS |
| --- | --- | --- | --- |
| 共通基盤 `foundations/` | ブランドとアプリの両方 | `foundations/docs/foundations.html` | `foundations/css/foundations.css` |
| ブランド `brand/` | LP・ドキュメント・ストア掲載 | `brand/docs/brand-guidelines.html`（v3.0） | `brand/css/refrain-brand.css` |
| アプリ `app/` | アプリ UI | `app/docs/design-system.html` | `app/css/refrain-sheet.css` |

- 説明書はブラウザで直接開けます（ネットワーク不要）。
- 判断の根拠：`2.0.0/docs/decisions.md`、調査：`2.0.0/docs/research.md`、
  アプリと LP への適用計画：`2.0.0/docs/migration.md`
- 値の変更：`2.0.0/tools/source/*.mjs` を編集して `node design-system/2.0.0/tools/build.mjs` を実行する。
  `--check` を付けると、生成物が最新であること・コントラスト監査・色リテラルの検出を検証する。
