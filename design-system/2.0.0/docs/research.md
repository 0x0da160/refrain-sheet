# 調査 — UI デザインの定番・最新の手法と代表的なデザインシステム

Refrain Sheet Design System v2.0.0 の判断材料です。判断そのものは
[decisions.md](decisions.md) にあります。

## この文書の確度について

- **[確認済]** — 2026-09-26 の作業中に Web 検索で出典を確かめた事実。出典を末尾に挙げます。
- **[既知]** — 公開ドキュメントとして広く知られている値を、作業者の知識から記したもの。
  作業環境から各デザインシステムの公式サイトへ直接アクセスできなかったため、
  値は採用前に一次資料で再確認してください。v2 の決定は、これらの値の一致に依存しないように作っています
  （数値そのものではなく、「業務系の本文は 14px 前後に集中する」といった傾向を根拠にしています）。

特定製品（とくに Microsoft Excel）の画面・アイコン・配置は調査対象にしていません。
`knowledge/decisions/ip-risk-policy.md` に従い、参照したのは公開されているデザインシステムの一般原則と、
表計算という分野に共通する操作の約束事だけです。

---

## 1. 代表的なデザインシステムの比較

| 体系 | 本文 | 小さい文字 | コントロール高 | 余白の基準 | 密度 | 出典の確度 |
| --- | --- | --- | --- | --- | --- | --- |
| Fluent 2（Microsoft） | Body 1 = 14px | Caption 12px | 24 / 32 / 40 | 4px | サイズ違いで表現 | 本文 [確認済] / 他 [既知] |
| Atlassian Design System | 14px | 12px | 32 前後 | 8px 基準、2px（space.025）から | — | [確認済] |
| Carbon（IBM） | body-compact 14px | label 12px | 24 / 32 / 40 / 48 | 8px（2px 刻みあり） | データテーブルに 5 段の行高 | 5 段の存在 [確認済] / 値 [既知] |
| Primer（GitHub） | 14px | 12px | 28 / 32 / 40 | 4px | — | [既知] |
| Material Design 3 | 14px（body medium） | 11–12px | 40（ボタン） | 4dp | 0 / −1 / −2 / −3、1 段ごとに 4dp | 密度 [確認済] |
| Apple HIG | iOS 17pt | — | タッチ 44pt 以上 | — | — | 44pt [確認済] |
| デジタル庁デザインシステム | 16px 以上 | 14px はフッター等のみ、14px 未満は原則不可 | — | — | — | [確認済] |
| SmartHR Design System | トークンで定義 | — | — | トークン | — | 行送り TIGHT 1.25 / NORMAL 1.5 [確認済] |
| Radix Colors | — | — | — | — | — | 12 段階の用途別スケール [確認済] |

### 読み取れること

1. **業務用の道具は本文 14px に収束している。** Fluent・Atlassian・Carbon・Primer・Material がそろって 14px 前後を
   UI の本文にし、12px を補助に使っています。v1 の「本文 16px・最小 14px」は、公共サイトの読み物を対象にした
   デジタル庁の基準に近く、1 日中開いておく密度の高い道具には大きすぎます。
2. **ただし日本語には下限が要る。** デジタル庁の基準（14px 未満は原則不可）と、BIZ UD の設計（小さいサイズでも読める
   UD 書体）の間を取り、v2 では日本語の下限を 13px、12px を英数字専用にしました（[decisions.md](decisions.md) D-01）。
3. **コントロールは 24 / 28 / 32 / 40 の帯に集中している。** Fluent・Carbon・Primer はいずれも 24〜40px の範囲で段階を持ち、
   既定値は 32px 付近です。表計算のバー内は 1 段小さく（28px）、フォームは 32px が妥当です。
4. **密度は「高さと余白を段階的に減らす」方式が主流。** Material は 1 段ごとに 4dp 減らし、Carbon は行高の段階を持ちます。
   どの体系も、密度を上げても文字サイズは変えません。
5. **タッチの下限は 44px、アクセシビリティの下限は 24px。** WCAG 2.2 の 2.5.8 は 24×24 CSS px（または間隔による例外）で、
   Apple は 44pt を推奨しています。compact でも 24px 以上にし、粗いポインタでは 44px にします。
6. **色は「段階の用途」を決めてから作る。** Radix の 12 段階（背景・部品の背景・境界・塗り・文字）のように、
   段階に役割を割り当てると、テーマ間で対応が崩れません。v2 は Paper / Ink / Green などの段階をそのまま使い、
   意味トークン側で役割（chrome-hover・border-control・accent-subtle など）を固定しました。

## 2. 定番の手法

| 手法 | 内容 | v2 での扱い |
| --- | --- | --- |
| 8pt / 4pt グリッド | 余白と寸法を 4 または 8 の倍数に揃える | 4px 基準。密な UI のために 2px・6px を追加 |
| 型のスケール（役割名） | サイズを「body」「caption」など役割で名付ける | 採用。比率ではなく役割で 6 段 |
| 意味トークンの 3 層 | プリミティブ → 意味 → 部品 | プリミティブ（`--green-600`）と意味（`--accent`）の 2 層。部品トークンは作らず、部品 CSS が意味トークンを直接使う |
| 状態の網羅 | rest / hover / active / focus / disabled / loading | 採用。pressed（切替のオン）と busy を明記 |
| 面の分離手段を 1 つに | 線・影・地色のどれか 1 つ | v1 から継承 |
| 色だけに頼らない | 状態に形の手がかりを添える | グリッドの四隅と辺を状態ごとに予約 |
| 同心の角丸 | 外側の半径 = 内側 + 余白 | 角丸の段階そのものをこの関係から決めた |
| 動詞のボタン、名指しの確認 | 「OK」を使わない | 採用（日本語は体言止め：「保存」「3 行を削除」） |

## 3. 最新の手法（2024〜2026）

| 手法 | 状況 | v2 での扱い |
| --- | --- | --- |
| **Design Tokens Format Module 2025.10** | W3C コミュニティグループが 2025-10-28 に最初の安定版を公開。W3C 標準ではないが、Figma・Penpot・Style Dictionary・Tokens Studio などが対応 [確認済] | **採用。** `tokens/*.tokens.json` を生成し、デザインツールと受け渡せるようにした |
| **OKLCH による色設計** | 知覚的に均等な色空間で明度の段階を揃える。CSS Color 4 で全主要ブラウザが対応 | v1 から継承。新しい色相（violet・teal）と文書色の見本 65 色は OKLCH で設計し、sRGB の範囲に収まるまで彩度を落として納品 |
| **`light-dark()`** | 2024-05 に Baseline（新規）。広く使える（Widely available）になるのは 2026-11 ごろ [確認済] | **見送り。** hybrid はシェルとシートで別のテーマを使うため、`color-scheme` の切り替えだけでは表せない。生成した CSS に明示的なテーマの区間を置く方式を続ける |
| **CSS アンカー配置・Popover API** | アンカー配置は 2026 年に主要ブラウザがそろったとされるが、フォールバックの挙動には差がある [確認済・二次資料] | 仕様には書かない。メニューやポップオーバーの位置決めは実装の判断に任せ、見た目と層だけを規定する |
| **`vector-effect: non-scaling-stroke`** | 大きさによらず線幅を一定にする | アイコンの線を常に 1.5px にするために採用 |
| **APCA（WCAG 3 の候補）** | WCAG 3 の草案から 2023 年に外れ、2026 年時点で算出方法は未定。WCAG 3 の勧告は 2028 年以降の見込み [確認済] | **判定には使わない。** WCAG 2.2 の比率で監査する |
| **WCAG 2.2** | 2023-10 に勧告。2.5.8（ターゲット 24px）、2.4.11（フォーカスが隠れない）などを追加 [確認済] | 出荷条件 |
| **密度の選択** | 利用者が密度を選ぶ UI が業務ツールで一般化 | compact / standard / comfortable の 3 段 |

## 4. 表計算の UX に共通する約束事

特定製品の画面ではなく、表計算という分野で利用者が前提にしている操作と表示です。
[既知]（この分野の一般的な知識）。

- 行見出し（数字）と列見出し（英字）で位置を示し、選択中の見出しを強調する。
- アクティブセルは太い枠、範囲は薄い塗り。塗りは半透明にして、セルに付けた色を隠さない。
- 数値は右揃え、文字列は左揃え。
- 右下のフィルハンドルで連続データを埋める。
- 数式を編集している間、参照しているセル範囲を色分けして囲み、数式の文字列も同じ色で塗る。
- 既定の行高は 20〜24px、セルの文字は 10pt（約 13px）前後。
- 下端にシートのタブ、上端に数式バー。
- メニューは「ファイル」「編集」「表示」など一般的な名前。

これらは [ip-risk-policy.md §3.1](../../../knowledge/decisions/ip-risk-policy.md) の「採用を検討できるもの」に当たります。
v2 では配色・角丸・印の形・位置（数式の印は左下、コメントは右上、編集済みは行頭側の変更バー）・文言を独自に決めています。

## 出典

- [Typography - Fluent 2 Design System](https://fluent2.microsoft.design/typography)
- [Data table – Carbon Design System](https://carbondesignsystem.com/components/data-table/usage/)
- [Overview - Spacing - Atlassian Design](https://atlassian.design/foundations/spacing)
- [Grids & spacing: density – Material Design 3](https://m3.material.io/foundations/layout/grids-spacing/density)
- [Using Material Density on the Web – Material Design](https://m3.material.io/blog/material-density-web)
- [Human Interface Guidelines | Apple Developer](https://developer.apple.com/design/human-interface-guidelines/)
- [タイポグラフィ（アクセシビリティ）｜デジタル庁デザインシステムβ版](https://design.digital.go.jp/dads/foundations/typography/accessibility/)
- [タイポグラフィ | デザイントークン | SmartHR Design System](https://smarthr.design/products/design-tokens/typography/)
- [行送り | デザイントークン | SmartHR Design System](https://smarthr.design/products/design-tokens/leading/)
- [Use cases – Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- [Design Tokens specification reaches first stable version | W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/)
- [Target Size (Minimum) — WCAG 2.2 SC 2.5.8](https://wcag22aa.org/new-criteria/target-size/)
- [CSS color-scheme-dependent colors with light-dark() | web.dev](https://web.dev/articles/light-dark)
- [Anchor Positioning Updates for Fall 2025 | OddBird](https://www.oddbird.net/2025/10/13/anchor-position-area-update/)
- [WCAG3 Contrast as of April 2026 — Adrian Roselli](http://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html)
