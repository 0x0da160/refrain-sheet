---
type: decision-concept
title: Familiar operation, original expression — IP risk policy
description: How Refrain Sheet pursues an Excel-familiar feel while keeping its visual expression, assets, branding, and implementation its own, and when a UI change must be escalated for IP review (Japan-focused; canonical text in Japanese).
sources:
  - resource: ../../site/template.html
  - resource: ../../site/partials/faq.html
  - resource: ../../README.md
  - resource: ../../CLAUDE.md
status: stable
generated:
  by: claude-code
  at: 2026-09-25T00:00:00Z
---

# Familiar operation, original expression — IP risk policy

## English summary

Refrain Sheet aims to feel familiar to people who already use Excel, but it
does **not** reproduce Excel's concrete visual expression, assets, branding,
or proprietary behavior. Lowering the learning cost of _operation_ and keeping
_screens, assets, and source attribution_ original are managed as two separate
design goals.

- **Adopt (from user goals, implemented independently):** a grid with row and
  column headers; arrow-key movement, range selection, copy/paste, undo;
  plainly named menus such as File and Edit; IME-safe Enter/Esc/arrow keys;
  no clashes with browser key bindings.
- **Make deliberately our own:** information hierarchy, command grouping,
  toolbar/menu layout, icons, color, typography, spacing, dialog wording and
  layout, onboarding/save/error/warning flows — and above all the
  "never silently change your CSV" information design (edited-cell marks,
  encoding/delimiter/line-ending status, save-time format choices).
- **Never:** Microsoft/Excel images, logos, icons, screenshots, UI parts, or
  code; a one-to-one recreation of a specific Excel screen; recolored or
  retraced copies presented as original; wording that implies Microsoft
  authorship, endorsement, partnership, full compatibility, or identical
  operation.
- **Non-commercial, free, public-interest, or open source is not a licence**
  to use third-party IP, and does not exempt a change from patent or design
  review.
- **Escalate** (hold the change, look for an original alternative, then
  review individually) under the conditions in §5 below. This mirrors the
  root [`CLAUDE.md`](../../CLAUDE.md) "High-risk changes" rule.

This file is an internal design and publication policy, **not** legal advice
on any specific infringement question. The canonical text follows in Japanese
because the policy targets publication in Japan and cites Japanese law.

---

# Refrain Sheet：Excel に近い操作感と権利侵害リスクへの対応方針

- 制定日：2026年9月25日
- 対象：日本向けに公開する Refrain Sheet の UI・UX、実装、OSS としての配布、紹介ページ（LP）
- 位置づけ：設計・公開判断のための内部方針。個別の権利侵害に関する法律意見ではない。

## 1. 結論と前提

**結論：** Excel の利用経験がある人が迷わず使える「近い操作感」は追求する。
一方で、Excel の具体的な視覚表現、素材、ブランド、独自の処理方法を再現する
ことは目的としない。操作上の学習コストを下げることと、画面・素材・出所表示を
独自にすることを、別々の設計目標として管理する。

本方針は次の前提に立つ。

- Refrain Sheet は非収益・非商用の OSS であり、オフィス業務の困りごとを解決する
  公益性を重視する。
- Excel 互換や同一の操作性は目指さない。一般的なビジネスパーソンに馴染みやすい
  操作感を、実現可能な範囲で追求する。
- Excel の画像、アイコン、ロゴ、スクリーンショットその他の素材やソースコードを、
  自プロジェクトの UI の部品として流用しない。
- Excel の高度な機能群を網羅するのではなく、Refrain Sheet の用途に必要な機能を
  選ぶ。
- 紹介ページ（`site/template.html` と `site/partials/`）は、Refrain Sheet を
  「CSVを壊さず編集できる、軽い表計算ソフト」として説明し、よくある質問
  （`site/partials/faq.html`）で「Excel の代わりではない」「Excel 互換を保証しない」
  と明記している。また、メニュー優先の UI、IME への
  配慮、文字コード・区切り文字・改行コードの常時表示を製品の特徴としている。

**重要な限界：** 非商用・無料・公益目的・OSS であることは、第三者の知的財産権を
利用するための一般的な許可にはならない。

- 文化庁は、非営利目的であっても他人の著作物をインターネットで公開する場合は、
  原則として権利者の許諾が必要であると説明している〔R2〕。
- 特許法上の「業として」は営利事業に限られず、公共事業・公益事業も含むと
  解説されている〔R5〕。
- OSS ライセンスは、公開者が権利を持たない素材・特許・意匠について、第三者の
  許諾を与えるものではない。

## 2. リスクを権利ごとに切り分ける

「Excel に何％似ているか」「何ピクセル変更したか」「非営利だから大丈夫か」と
いった単一の尺度では判断しない。問題となる権利と対象を切り分けて判断する。

| 論点                 | 保護され得る対象と判断の軸                                                                                                                                                     | このプロジェクトでの対応                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 著作権               | 創作的な具体的表現。アイデアやありふれた表現そのものは対象外だが、画面・アイコン・文言・コードの具体的表現は事案ごとに問題となり得る〔R1〕。                                   | 機能や操作の目的を要件として記述し、画面・アイコン・説明文・コードは独自に制作する。色だけを変えたトレースはしない。                             |
| 意匠権               | 登録された画像意匠と、その権利範囲に含まれる類似の意匠。日本では機器の操作画像・表示画像それ自体が保護対象となり得る。ブラウザアプリであることだけでは対象外にならない〔R3〕。 | 特定の画面に似せたい場合は、完成案を日本の登録意匠と照合する。画面全体だけでなく、特徴的な部分や画面遷移も検討対象とする。                       |
| 特許権               | 有効な特許の請求項で定まる技術的範囲に、具体的な実装が含まれるか。画面の見た目や機能の数だけでは結論が出ない〔R4〕。                                                           | 固有性の高いインタラクションや処理方式を導入するときは、仕様・実装を起点に必要な範囲で調査する。色や配置の変更を特許対策とはみなさない。         |
| 商標・出所の混同     | 製品名・ロゴ・アプリアイコンなどの出所表示。周知な商品等表示との混同は不正競争防止法上の論点にもなる〔R6〕〔R7〕。                                                             | 製品名・ロゴ・アイコンは独自のものとし、Microsoft 製・公認・提携品であるという誤解を招かない。Excel への言及は事実に即した比較・説明に限定する。 |
| 不正競争防止法その他 | 周知表示との混同など、登録された権利だけでは尽きないリスクがある〔R6〕。                                                                                                       | 画面だけでなく、名称、紹介文、配布ページ、検索結果上の見え方まで一体で確認する。                                                                 |

**非商用性の評価：** 他者の素材を使用しないという前提は、著作権・ブランド面の
分かりやすいリスクを減らす。ただし、公益目的での公開や無償配布だけを根拠に、
特許・意匠の検討を省略しない。意匠についても「業として」の解釈は営利か否かだけで
決まらず、個人的・家庭的な利用との区別を含めて個別に判断する〔R2〕〔R5〕。

## 3. 設計の境界：操作は親しみやすく、表現は独自に

### 3.1 原則として採用を検討できるもの

次の項目は、**一般的な操作目的と利用者の期待**を起点に、具体的な実装は自分たちで
設計する。ただし、個別の登録権利や具体的な表現を調べずに「必ず自由に使える」と
判断する趣旨ではない〔R1〕〔R3〕〔R4〕。

- 表を格子状に表示し、行・列の見出しからセルの位置が分かること。
- 矢印キーによるセル移動、範囲選択、コピー・貼り付け、元に戻すなど、利用者が
  予測できる基本操作。
- 「ファイル」「編集」など分かりやすいメニューと、一般的に理解されるコマンド名。
- 日本語 IME の変換中に、Enter・Esc・矢印キーを編集確定やセル移動として誤って
  扱わないこと（[editing-and-ime.md](../ui/editing-and-ime.md)）。
- ブラウザ標準のキー操作と衝突しないこと。

### 3.2 意図的に独自化するもの

- 画面の情報階層、コマンドのグループ分け、ツールバー・メニューバーの構成。
- アイコンの形・線・比率、配色、タイポグラフィ、余白、ダイアログの文言と
  レイアウト（[theming-and-visual-system.md](../ui/theming-and-visual-system.md)）。
- 初回案内、保存確認、エラー表示、警告表示など、利用者が意思決定する場面。
- Refrain Sheet 固有の価値である「CSV を勝手に変更しない」ことを可視化する
  情報設計。たとえば、編集済みセルの表示、文字コード・区切り文字・改行コードの
  ステータス表示、保存時の形式選択や検証結果の説明を画面の中核に据える
  （[csv-preservation-guarantee.md](../domains/csv-preservation-guarantee.md)）。

**設計例：** Excel の利用者にも分かりやすい「ファイル」→「保存」という入口を
用意する。一方、保存ダイアログは Excel の特定の画面をなぞらず、Refrain Sheet に
必要な文字コード、BOM、改行コード、CSV の安全上の注意を独自に配置・記述する。
親しみやすい操作の入口と、独自の画面表現を両立させる。

### 3.3 採用しないもの

- Excel や Microsoft の画像、ロゴ、アプリアイコン、スクリーンショット、画面部品、
  コードの流用。Microsoft の公開ガイドラインは、製品アイコン等の利用や、第三者
  製品の UI 内での同社スクリーンショットの使用を制限している〔R7〕〔R8〕。
- 特定バージョンの Excel 画面を基準に、アイコンの並び、グループの順序、配色、
  余白、ダイアログの文言・構図をまとめて再現すること。
- 色だけを変える、アイコンの輪郭だけを描き直すなど、元の具体的表現を保ったまま
  「独自制作」として扱うこと。
- Microsoft 製、公認、提携、完全互換、全操作同一など、実態と異なる印象を与える
  表現。
- 「一般利用者向けの機能数だから特許は関係ない」「OSS だから意匠権は関係ない」
  という判断。権利の論点は、機能の数や料金だけでは決まらない〔R3〕〔R4〕〔R5〕。

## 4. 実装から公開までの運用手順

### 4.1 仕様決定時：機能と見た目を分けて記録する

UI を変更するときは、Issue または PR に少なくとも次の各項目を一行ずつ残す。

1. **利用者の困りごと：** 誰が、何を迷わず行えるようにするのか。
2. **操作要件：** キー、マウス、メニュー操作に必要な挙動は何か。
3. **表現要件：** 画面に必要な情報は何か。Excel 固有の見た目を必要条件にしない。
4. **参照元：** 参考にした製品や画面があれば、その箇所と採用理由。コピーした
   素材がないこと。
5. **独自の判断：** Refrain Sheet の CSV 保持・IME・ブラウザ環境に合わせて、
   何を変えたか。

「Excel と同じにする」は仕様ではない。利用者が達成したい操作に分解して書き直す。
例：「Excel と同じ保存画面」ではなく、「保存前に文字コードと改行コードを確認
でき、既定の保存では元ファイルの形式を不意に変更しない」。

### 4.2 デザインレビュー時：横並びで比較する

- 完成した主要画面と、最も参考にした Excel の画面を並べ、**共通する操作上の
  慣習**と**意図せず一致した具体的な表現**を分けて記録する。
- 一致する箇所が複数まとまり、画面全体が特定の画面の再現に見える場合は、色だけで
  なく、情報のまとめ方、コマンドの順序、アイコン、余白、説明文を見直す。
- 他社の素材やスクリーンショットが、アプリ、README、LP、SNS 用画像、配布物に
  紛れ込んでいないか確認する。
- 表示名と説明文から、Microsoft との関係があるように見えないか確認する。比較
  対象としての製品名への言及と、自製品の出所表示への利用とを区別する〔R6〕〔R7〕。

この比較は侵害判定の代わりにはならない。「見た目を少し変えたから安全」という
結論は出さない〔R1〕〔R3〕。

### 4.3 権利調査時：変更内容に合わせて対象を絞る

- **画像意匠：** J-PlatPat〔R9〕で関連する登録意匠を調べる。画面全体に加え、
  特徴的な部分についての登録も念頭に置く。類似性や権利の存続は、実際の登録情報で
  確認する〔R3〕。
- **特許：** 特徴的な処理や相互作用を実装するときは、UI の見た目ではなく技術的な
  仕様をもとに検索する。気になる特許が見つかったら、請求項と権利の状態を確認する
  〔R4〕。
- **商標：** 製品名やロゴを変更・拡張するときは、同じく J-PlatPat などで確認し、
  比較広告や紹介文の表示も見直す〔R7〕。
- **調査の限界：** 簡易検索で見つからないことは、非侵害の証明ではない。登録意匠に
  近く見える完成画面や、具体的な特許が見つかった機能については、専門家の判断を
  仰ぐ。

### 4.4 公開前・変更時：判断の記録を残す

公開前に、主要画面のキャプチャ、素材の作成元と利用許諾、調査した権利と確認日、
比較表示の文言、未解決の懸念を一つの記録にまとめる。外部から持ち込んだ素材の
ライセンスは、リポジトリ上で確認できるようにする（同梱ソフトウェアについては
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)）。

登録意匠に似た箇所、具体的な特許との関係、権利者からの指摘がある場合は、公開・
配布を判断する前に、知的財産実務に詳しい日本の弁護士・弁理士に相談する。

## 5. エスカレーションの条件

次のいずれかに当てはまる変更は、「一般的な操作だから問題ない」として即座に採用
しない。

- 特定の Excel 画面を見ながら、画面構成やコマンド群をほぼ一対一で再現している。
- Excel 由来の画像、スクリーンショット、デザイン素材、ソースコードの使用を提案
  された。
- 画面やアイコンが、見つかった登録画像意匠に近い。または、機能が特定の有効な
  特許の請求項に関係しそうである。
- 製品名・説明文・公開画像が、Microsoft 製品や公認製品と誤認されそうである。
- 「Excel 互換」「完全に同じ」など、現行の方針を超える訴求に変更する。
- 外部からのコントリビューションで、素材・実装の出所を確認できない。

対応としては、まず当該箇所の採用を保留し、独自の代替案を検討する。それでも採用が
必要な場合は、実際の画面・実装・権利情報をそろえて個別に確認する。エージェントに
よる作業では、root の [`CLAUDE.md`](../../CLAUDE.md) の「High-risk changes」に
従い `agent:blocked` とし、人間の判断を求める。無償・公益目的であることを、採用の
理由の代わりにしない〔R2〕〔R3〕〔R4〕〔R5〕。

## 6. 公開前チェックリスト

- [ ] 主要な操作は利用者の目的から仕様化されており、「Excel の再現」を要件に
      していない。
- [ ] アイコン、画像、文言、コードなどの出所を確認し、Excel の素材・コードを
      流用していない。
- [ ] 主要画面を横並びで比較し、特定の画面の具体的表現と重なりすぎていないことを
      確認した。
- [ ] CSV の保存、文字コード、検証結果、IME 対応など、Refrain Sheet 固有の情報
      設計を維持している。
- [ ] 製品名、LP、README、配布画面が、Microsoft 製・公認・完全互換という誤認を
      招かない。
- [ ] 必要に応じて日本の意匠・特許・商標を調査し、調査日と未解決事項を記録した。
- [ ] 専門家に確認すべき具体的な類似箇所・権利が残っていないことを、公開責任者が
      確認した。

## 7. 方針の要旨

> Refrain Sheet は、Excel の利用者を含む一般的なビジネスパーソンが、学び直しを
> 最小限にして操作できることを目指す。ただし、Excel の外観、素材、出所表示、特定の
> 独自実装を再現することは目標とせず、CSV を壊さずに扱うという製品の目的に即した
> 独自の画面と実装を設計する。非商用・公益目的・OSS であっても第三者の権利を
> 尊重し、具体的な懸念には個別の調査と専門家への確認で対応する。

## 参照資料

リンク先は制定時点のもの。判断に使う前に、各機関の最新の資料を確認すること。

- 〔R1〕文化庁「著作権テキスト」— 著作物の創作性、アイデアと表現の区別。
  <https://www.bunka.go.jp/seisaku/chosakuken/>
- 〔R2〕文化庁「著作権について知っておきたい大切なこと」— 非営利目的の公開と
  許諾。 <https://www.bunka.go.jp/seisaku/chosakuken/>
- 〔R3〕特許庁「意匠審査基準」（画像を含む意匠）— 画像意匠の保護対象。
  <https://www.jpo.go.jp/>
- 〔R4〕特許庁「特許制度の概要」— 請求項と技術的範囲。 <https://www.jpo.go.jp/>
- 〔R5〕特許庁の解説 — 「業として」の考え方（公共・公益事業を含む）。
  <https://www.jpo.go.jp/>
- 〔R6〕経済産業省「不正競争防止法の概要」— 商品等表示の混同など。
  <https://www.meti.go.jp/policy/economy/chizai/chiteki/>
- 〔R7〕Microsoft「Trademark and Brand Guidelines」— 製品名・ブランドの扱い。
  <https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks>
- 〔R8〕Microsoft「Use of Microsoft copyrighted content」— スクリーンショット等の
  素材の扱い。 <https://www.microsoft.com/en-us/legal/intellectualproperty/permissions>
- 〔R9〕INPIT「J-PlatPat」— 国内の特許・意匠・商標の検索。
  <https://www.j-platpat.inpit.go.jp/>
- プロジェクト内の紹介ページ：`site/template.html` と `site/partials/`（Excel との
  関係は FAQ で説明）。
