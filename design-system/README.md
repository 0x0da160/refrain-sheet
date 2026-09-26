# Refrain Sheet Design System

| 版 | 状態 |
| --- | --- |
| [2.0.0](2.0.0/) | **現行。** 新しい作業はこの版だけを参照する |
| [1.0.0](1.0.0/) | 履歴として保存。アプリはまだ一部（色・フォント・アイコン）をここから取り込んでいる |

- 文書：`2.0.0/docs/design-system.html`（ブラウザで直接開ける。ネットワーク不要）
- 判断の根拠：`2.0.0/docs/decisions.md`、調査：`2.0.0/docs/research.md`
- アプリへの適用計画：`2.0.0/docs/migration.md`
- 値の変更：`2.0.0/tools/source.mjs` を編集して `node design-system/2.0.0/tools/build.mjs` を実行する。
  `--check` を付けると、生成物が最新であること・コントラスト監査・色リテラルの検出を検証する。
