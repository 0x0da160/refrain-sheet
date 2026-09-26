# 調査 — UI デザインの定番・最新の手法と代表的なデザインシステム

Refrain Sheet Design System v2.0.0 の判断材料です。判断そのものは
[decisions.md](decisions.md) にあります。最終更新 2026-09-26。

## 確度の表記

| 表記 | 意味 |
| --- | --- |
| **[一次]** | 各組織が公開しているソースやトークンのパッケージを、この作業中に取得して値を読んだもの（パッケージ名と版を併記） |
| **[検索]** | Web 検索の結果で確認したもの（出典は末尾） |
| **[既知]** | 作業者の知識によるもの。採用前に一次資料で再確認すること |

ネットワークについて：npm レジストリと `raw.githubusercontent.com` には届きましたが、
次のホストは作業環境のプロキシで遮断され、直接読めませんでした：
`fluent2.microsoft.design`、`carbondesignsystem.com`、`primer.style`、`atlassian.design`、`m3.material.io`、
`www.designtokens.org`、`www.w3.org`、`design.digital.go.jp`、`smarthr.design`、`support.microsoft.com`、
`help.libreoffice.org`。そのため、公式サイトの代わりに、同じ組織が公開しているトークンのパッケージとソースを一次資料にしました。

特定製品（とくに Microsoft Excel）の画面・アイコン・配置は調査対象にしていません
（`knowledge/decisions/ip-risk-policy.md`）。表計算ソフトについて調べたのは、セルの既定の文字サイズという数値だけです。

---

## 1. 代表的なデザインシステムの実測値

| 体系 | 本文 | 小さい文字 | コントロール高 | 角丸 | 余白 | 確度・出典 |
| --- | --- | --- | --- | --- | --- | --- |
| Fluent 2（Microsoft） | Body 1 = 14 / 20px | Caption 1 = 12 / 16px、Caption 2 = 10 / 14px | ボタン 24 / 32 / 40px（small / medium / large） | 2 / 4 / 6 / 8px | 2, 4, 6, 8, 10, 12, 16, 20, 24, 32px | [一次] `@fluentui/tokens` 1.0.0-alpha.24、`@fluentui/react-button` |
| Carbon（IBM） | body-compact-01 = 14px / 1.286 | label-01・helper-text-01 = 12px / 1.333 | 24 / 32 / 40 / 48 / 64px（xs〜xl） | — | 2, 4, 8, 12, 16, 24, 32, 40, 48px… | [一次] `@carbon/type` 11.68.0、`@carbon/layout` 11.60.0 |
| Primer（GitHub） | body medium = 14px / 1.5 | body small・caption = 12px | 24 / 28 / 32 / 40 / 48px（xsmall〜xlarge）、タッチ時の最小 44px | 3 / 6 / 12px | — | [一次] `@primer/primitives` 11.10.0 |
| Atlassian | body = 14 / 20px | body small = 12 / 16px | — | 2 / 4 / 6 / 8 / 12 / 16px | 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px | [一次] `@atlaskit/tokens` 20.0.0 |
| Material Design 3 | body medium = 14 / 20px | body small・label medium = 12 / 16px、label small = 11 / 16px | — | — | 4dp | [一次] `@material/web` 2.5.0 |
| Material の密度 | 0 / −1 / −2 / −3、1 段ごとに 4dp 小さく | | | | | [検索] |
| Apple HIG | iOS 17pt | — | タッチ 44pt 以上 | — | — | [検索] |
| デジタル庁デザインシステム | 16px 以上 | 14px はフッター等のみ、14px 未満は原則不可 | — | — | — | [検索] |
| SmartHR | トークンで定義 | — | — | — | — | 行送り TIGHT 1.25 / NORMAL 1.5 [検索] |

### 読み取れること

1. **業務用の道具は本文 14px・補助 12px に収束している。** Fluent・Carbon・Primer・Atlassian・Material の 5 つがすべて同じです。
   Primer は 12px の caption について「小さいので 1 行の場面だけに使う」と注記しています。
2. **12px は多くの体系の下限。** 11px 以下は Fluent の Caption 2 と Material の label small だけです。
   一方、デジタル庁は公共サイトの読み物を対象に 16px 以上を求めています。アプリ（道具）と LP（読み物）で基準を分けるのが妥当です。
3. **コントロールは 24〜48px を 8px 前後の刻みで持つ。** Fluent 24/32/40、Carbon 24/32/40/48、Primer 24/28/32/40/48。
   表計算のバー内は 28px、フォームは 32px が中央値に当たります。
4. **2px・6px の半端な刻みは密な UI の標準装備。** Fluent（xxs 2・sNudge 6）と Atlassian（space.025 = 2・space.075 = 6）が持っています。
5. **角丸は 2〜8px が主。** Fluent は最大 8px、Atlassian は 12・16px を大きな面に使います。v2 の 2/4/6/8/12/16px はこれと一致します。
6. **タッチの下限は 44px。** Primer は `pointer: coarse` で 44px にし、Apple は 44pt を推奨しています。

## 2. 表計算ソフトのセルの既定サイズ

「13px が表計算の標準か」という問いへの答えです。

| 製品 | 既定のフォントとサイズ | CSS px 換算（96dpi） | 確度 |
| --- | --- | --- | --- |
| LibreOffice Calc | Liberation Sans 系（言語別の既定）10pt | 13.3px | [一次] `sc/source/core/data/docpool.cxx` の `SvxFontHeightItem( 200, … )`（200 twip = 10pt） |
| Google スプレッドシート | Arial 10 | 13.3px | [検索] |
| Microsoft Excel（2023 年以降） | Aptos Narrow 11 | 14.7px | [検索] |
| Apple Numbers | Helvetica Neue（サイズは表スタイルに依存） | — | [検索]（サイズは未確認） |
| **Refrain Sheet（現行）** | BIZ UDGothic 12px × 表示倍率 | 12px | リポジトリ |

**結論：** 13px は「一般的な」値の 1 つですが、標準ではありません。10pt（13.3px）と 11pt（14.7px）に分かれています。
Refrain Sheet の 12px は小さめですが、既定の行高 24px・列幅 104px・保存済みの列幅がこの値を前提にしているため、
v2 では変えません（[decisions.md](decisions.md) D-03）。

## 3. 定番の手法

| 手法 | 内容 | v2 での扱い |
| --- | --- | --- |
| 4pt / 8pt グリッド | 余白と寸法を 4 または 8 の倍数に揃える | 4px 基準に 2px・6px を追加 |
| 役割名の文字スケール | 「body」「caption」など役割で名付ける | 採用。アプリ 4 段、LP 6 段 |
| 意味トークンの層 | プリミティブ → 意味 → 部品 | プリミティブ（`--green-600`）と意味（`--accent`）の 2 層。部品は意味トークンを直接使う |
| ブランドと製品 UI の分離 | ブランドの規定（ロゴ・声・マーケティング）と製品 UI の規定を別の文書にし、色や書体の基盤は共有する | 採用。共通基盤・ブランド・アプリの 3 層 [既知] |
| 状態の網羅 | rest / hover / active / focus / disabled / loading | 採用。pressed（切替のオン）と busy を明記 |
| 面の分離手段を 1 つに | 線・影・地色のどれか 1 つ | v1 から継承 |
| 色だけに頼らない | 状態に形の手がかりを添える | グリッドの四隅と辺を状態ごとに予約 |
| 同心の角丸 | 外側の半径 = 内側 + 余白 | 角丸の段階そのものをこの関係から決めた |
| 動作を表すボタン、名指しの確認 | 「OK」を使わない | 採用（「保存」「3 行を削除」） |

## 4. 最新の手法（2024〜2026）

| 手法 | 状況 | v2 での扱い |
| --- | --- | --- |
| **Design Tokens Format Module 2025.10** | W3C コミュニティグループが 2025-10-28 に最初の安定版を公開 [検索]。仕様の原稿を GitHub（`design-tokens/community-group` の `technical-reports/`）で読み、次を確認した [一次]：色は `colorSpace`・`components`・任意の `alpha`・任意の `hex`（6 桁）の組。寸法は `value` と `unit`（`"px"` か `"rem"` のみ）。`fontWeight` は 1〜1000 の数値。`typography.lineHeight` は数値で、`fontSize` に対する倍率。影は影オブジェクトの配列を取れる。グループに `$root` と `$extends` がある | **採用。** 3 層それぞれの `tokens/*.tokens.json` を生成し、各ファイルに `$schema` を付けた |
| **OKLCH による色設計** | 知覚的に均等な色空間で明度の段階を揃える | v1 から継承。新しい色相と文書色の見本は OKLCH で設計し、sRGB に収まるまで彩度だけを落として納品 |
| **`light-dark()`** | 2024-05 に Baseline（新規）、広く使えるのは 2026-11 ごろ [検索] | **見送り。** hybrid は枠とシートで別のテーマを使うため、`color-scheme` だけでは表せない |
| **CSS アンカー配置・Popover API** | 2026 年に主要ブラウザがそろったとされる [検索] | 仕様には書かない。位置決めは実装に任せ、見た目と層だけを規定する |
| **`vector-effect: non-scaling-stroke`** | 大きさによらず線幅を一定にする | アイコンの線を常に 1.5px にするために採用 |
| **APCA（WCAG 3 の候補）** | 2023 年に WCAG 3 の草案から外れ、2026 年時点で算出方法は未定 [検索] | 判定には使わない |
| **WCAG 2.2** | 2.5.8 ターゲットサイズ（最小）：操作対象は 24×24 CSS px 以上。例外は間隔・同等の操作・文中・ユーザーエージェント任せ・必須の 5 つ。「位置で値を選ぶ対象（スライダー、色の選択、カーソルを置く編集領域）は 1 つの対象とみなす」[一次] `w3c/wcag` の `guidelines/sc/22/target-size-minimum.html` | 出荷条件。グリッドは位置で選ぶ 1 つの対象なので、セル 1 つずつに 24px は求められない。フィルハンドルなどの小さな印は、当たり判定を 24px に広げる |

## 5. LP（ブランド層）について

現行の LP（`site/styles.css`）を読んだ結果です。

- 流体的な文字サイズ（`clamp()`、本文 16〜18px）、最大幅 1180px、セクションの余白 64〜96px は、読み物として妥当です。**ブランド層にそのまま引き継ぎました。**
- 見出しの太さ 800・ボタンの 600 は BIZ UD に存在せず、実際には 700 で描画されています。**700 に揃えます。**
- 英字ラベルの字間 0.14em は、ブランドガイドライン v2.0（0.08em）より広すぎます。
- 色は v1 の値の直書き（`#fff`・`#006335` を含む）で、トークンを参照していません。
- ボタンはホバーで 1px 持ち上がります。v2 では「動かないものを動かさない」に揃えて、色の変化だけにします。

## 出典

- 一次資料（パッケージとソース）
  - npm: [`@fluentui/tokens`](https://www.npmjs.com/package/@fluentui/tokens)、[`@fluentui/react-button`](https://www.npmjs.com/package/@fluentui/react-button)、[`@carbon/type`](https://www.npmjs.com/package/@carbon/type)、[`@carbon/layout`](https://www.npmjs.com/package/@carbon/layout)、[`@primer/primitives`](https://www.npmjs.com/package/@primer/primitives)、[`@atlaskit/tokens`](https://www.npmjs.com/package/@atlaskit/tokens)、[`@material/web`](https://www.npmjs.com/package/@material/web)
  - [design-tokens/community-group — technical-reports](https://github.com/design-tokens/community-group/tree/main/technical-reports)
  - [w3c/wcag — target-size-minimum.html](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/target-size-minimum.html)
  - [LibreOffice/core — sc/source/core/data/docpool.cxx](https://github.com/LibreOffice/core/blob/master/sc/source/core/data/docpool.cxx)
- Web 検索で確認したもの
  - [Using Material Density on the Web – Material Design](https://m3.material.io/blog/material-density-web)
  - [Human Interface Guidelines | Apple Developer](https://developer.apple.com/design/human-interface-guidelines/)
  - [タイポグラフィ（アクセシビリティ）｜デジタル庁デザインシステムβ版](https://design.digital.go.jp/dads/foundations/typography/accessibility/)
  - [行送り | デザイントークン | SmartHR Design System](https://smarthr.design/products/design-tokens/leading/)
  - [Use cases – Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
  - [Design Tokens specification reaches first stable version | W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
  - [CSS color-scheme-dependent colors with light-dark() | web.dev](https://web.dev/articles/light-dark)
  - [Anchor Positioning Updates for Fall 2025 | OddBird](https://www.oddbird.net/2025/10/13/anchor-position-area-update/)
  - [WCAG3 Contrast as of April 2026 — Adrian Roselli](http://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)
  - [Aptos (typeface) — Wikipedia](https://en.wikipedia.org/wiki/Aptos_(typeface))
  - [How to Change Default Font Size in Google Sheets](https://www.thebricks.com/resources/guide-how-to-change-default-font-size-in-google-sheets)
  - [Set a default font for a new Numbers document — Apple Community](https://discussions.apple.com/thread/250367291)
