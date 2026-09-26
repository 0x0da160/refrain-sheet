# Refrain Sheet Design System

| ディレクトリ | 状態 |
| --- | --- |
| [v2/](v2/) | **現行（2.3.0）。** 新しい作業はここだけを参照する |
| [1.0.0/](1.0.0/) | 履歴として保存。アプリも LP も参照していない |

ディレクトリはメジャー版ごとに 1 つです。マイナー版とパッチ版は同じディレクトリを更新し、
`v2/VERSION` と `v2/CHANGELOG.md` に記録します（`v2/docs/decisions.md` の D-27）。
`1.0.0/` は、版ごとにディレクトリを分けていた頃の名前のまま残しています。

v2 は 3 つの層でできています。ブランドガイドラインも同じ版番号を使います。

| 層 | 対象 | 説明書 | CSS |
| --- | --- | --- | --- |
| 共通基盤 `foundations/` | ブランドとアプリの両方 | `foundations/docs/foundations.html` | `foundations/css/foundations.css` |
| ブランド `brand/` | LP・ドキュメント・ストア掲載 | `brand/docs/brand-guidelines.html` | `brand/css/refrain-brand.css` |
| アプリ `app/` | アプリ UI | `app/docs/design-system.html` | `app/css/refrain-sheet.css` |

- 説明書はブラウザで直接開けます（ネットワーク不要）。
- 判断の根拠：`v2/docs/decisions.md`、調査：`v2/docs/research.md`、
  アプリと LP への適用の記録：`v2/docs/migration.md`
- 値の変更：`v2/tools/source/*.mjs` を編集して `node design-system/v2/tools/build.mjs` を実行する。
  `--check` を付けると、生成物が最新であること・コントラスト監査・色リテラルの検出を検証する。
