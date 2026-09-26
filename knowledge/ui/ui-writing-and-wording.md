---
type: ui-concept
title: UI writing and wording rules
description: How Refrain Sheet's in-app text is written — action-first labels, calm polite Japanese, full impact statements for save/convert/discard/encoding changes, recommended terms, and the review checklist for any string change (Japanese UI first; canonical text in Japanese).
sources:
  - resource: ../../src/locales/ja.json
  - resource: ../../src/locales/en.json
  - resource: ../../site/i18n.js
  - resource: https://learn.microsoft.com/ja-jp/windows/apps/design/style/writing-style
  - resource: https://design.digital.go.jp/dads/components/input-text/usage/
  - resource: https://design.digital.go.jp/dads/components/input-text/accessibility/
  - resource: https://design-system.service.gov.uk/components/error-message/
  - resource: https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
  - resource: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
status: stable
generated:
  by: claude-code
  at: 2026-09-26T00:00:00Z
---

# UI writing and wording rules

## English summary

Every string a user reads in the app — menus, buttons, dialogs,
notifications, errors, settings, empty states, help, and accessible names —
must let them tell **what they are operating on, what will happen to their
file, and what to do next**. For saving, converting, discarding, and
encoding changes, preventing a wrong decision beats brevity.

- **Action first.** Labels are "object + verb" ("Open CSV", "Save As")
  rather than "OK" / "Run"; a bare verb is fine only when the object is
  unambiguous on screen.
- **Calm, polite, blame-free.** Japanese explanations use です・ます; no
  exclamation-mark enthusiasm, no "Oops", no over-apologising.
- **Never omit impact on risky operations.** Say the target, what actually
  happens, and what happens to the original file. "Save" ≠ "download";
  "reopen with encoding" ≠ "convert".
- **User data is data.** Cell values, file names, encoding names, formulas,
  and problem locations are shown exactly, never paraphrased.
- **Errors state target, problem, next step**, never guess a cause, and never
  read as success. Confirmation buttons name the resulting action
  ("Discard changes" / "Keep editing"), not "Yes/No".
- **Notifications state only what was observed** (a started download is not
  a finished one; a download is not an in-place save).
- **Text carries state on its own** (never colour/icon only), and
  **Japanese and English match in meaning**, not word-for-word.

These rules apply to every new or changed string. Existing strings that
differ from them (§7) are brought in line by their own focused change, not
by a sweep. Because the primary audience is Japanese office users, the
canonical text follows in Japanese. It also applies to the landing page's
product descriptions, whose copy lives in `site/i18n.js`, without mixing
marketing copy into operational wording.

This file complements, and does not override,
[accessibility.md](accessibility.md) (ARIA, focus, non-colour cues), the
[IP risk policy](../decisions/ip-risk-policy.md) (dialog wording is
something we deliberately write ourselves), and
[bilingual-communication.md](../agent-loop/bilingual-communication.md)
(which governs agent-authored GitHub text, not in-app strings).

---

# Refrain Sheet UIライティング・ワーディングルール

- 制定日：2026年9月26日
- 対象：日本のオフィス業務で使う人に向けた日本語UI、および英語UIとの意味の整合
- 適用範囲：メニュー、ボタン、ダイアログ、通知、エラー、設定、空状態、ヘルプ、
  アクセシブルな名前。紹介ページ（LP）の説明文も原則を参照できるが、訴求文と
  操作文言を混同しない。
- 位置づけ：新しく追加・変更するすべての文言に適用する。既存の文言との差分は
  §7 に記録し、個別の変更で是正する。

## 1. 目的

利用者が「何を操作し、ファイルに何が起き、次に何をすればよいか」を迷わず判断
できる文言を書く。特に保存・変換・破棄・文字コードの変更では、短さよりも
誤操作の防止を優先する。

Refrain Sheet は、書式とバイト列を保持する CSV 編集、RSF への明示的な変換、
文字コードを指定した開き直し、診断結果を確認したうえでの「このまま開く」、
ブラウザによって異なる上書き保存／ダウンロード保存を特徴とする
（[csv-preservation-guarantee.md](../domains/csv-preservation-guarantee.md)、
[import-export-and-conversion.md](../domains/import-export-and-conversion.md)）。
文言はこれらの動作を正確に伝えなければならない。

## 2. 基本原則

1. **操作と結果を先に書く。** メニュー・ボタンは原則「対象＋動詞」にする。
   「OK」「実行」より「CSVを開く」「別名で保存」を優先する。ただし、対象が
   画面上で一意なら「保存」「閉じる」のような短い語を使える。
2. **業務向けの落ち着いた敬体にする。** 説明・通知は「です・ます」、ラベルは
   体言止めまたは動詞で統一する。「お手数ですが」「正常に処理されました」
   「Oops」や「！」の多用は避ける。利用者を責めない。
3. **危険な操作は影響を省略しない。** 保存・上書き・変換・破棄の確認では、
   対象、実際に起きること、元ファイルへの影響を示す。「保存」と
   「ダウンロード」、「開き直す」と「変換する」を同義語として扱わない。
4. **表示名とデータを区別する。** セル値、ファイル名、文字コード名、数式、
   問題の位置は、ユーザーのデータまたは技術情報である。表示上の都合で
   言い換えたり、値が変更されたかのように書いたりしない。
5. **専門語は必要な場所だけで使う。** 日常の操作では「文字コード」「改行コード」
   を使い、`CP932`、`BOM`、`CRLF`、`RSF` などは選択肢・詳細・ヘルプで正確に
   示す。技術語だけでは分からない場合は、意味を短く添える。
6. **エラーは「対象・問題・次の行動」で書く。** 原因を特定できない場合は推測
   しない。利用者が直せる入力エラーと、アプリ側・環境側の問題を区別する。
   失敗したのに成功したかのように書かない。
7. **確認の選択肢を具体化する。** 見出しに判断事項、本文に影響、ボタンに選択後
   の動作を書く。「はい／いいえ」ではなく「変更を破棄／編集を続ける」のように
   書く。
8. **通知は達成した事実だけを書く。** 「保存しました」は保存先と保存方法が
   明らかな場合に限る。ダウンロードした場合は、実際に観測できた結果に合わせて
   書く。
9. **文字だけで状態が伝わるようにする。** 色・アイコン・記号だけでエラーや変更
   を伝えない。入力欄のラベルとエラーを対応づけ、セル位置は「3行目、B列」の
   ように文章としても理解できる形にする。読み上げは通知の表示方法に応じて設計
   し、検証する（[accessibility.md](accessibility.md)）。
10. **日英UIは意味を揃え、逐語訳しない。** 両言語で操作、結果、危険性を一致
    させる。文言を追加・変更したら、もう一方の言語、表示幅、アクセシブルな
    名前も確認する。

## 3. 表記の既定値

- ラベルとボタンの末尾には句点を付けない。説明文には「。」を付ける。
- 実装やファイル形式が定める英数字、拡張子、数式、文字コード名は正確に保つ。
- 日付、容量、桁数には単位や解釈条件を添える。容量の単位は実装の表示と
  一致させる。
- 文字数の一律上限は設けない。狭い画面、拡大表示、日英切り替えで実画面を
  確認する。
- 入力欄のプレースホルダーを、常に必要なラベルや説明の代わりにしない。
- 成功・警告・エラーの強さは実際の影響に合わせる。「必ず」「完全」などの断定
  は、対応範囲と検証結果が一致する場合だけ使う。

## 4. 推奨用語

| 概念                   | 推奨表記                               | 注意点                                            |
| ---------------------- | -------------------------------------- | ------------------------------------------------- |
| ファイルを読み込む     | CSVを開く                              | 端末外へ送信しないなら「アップロード」は使わない  |
| 解釈だけを変更する     | 文字コードを指定して開き直す           | 出力ファイルを変える「変換」と区別する            |
| 保存形式を選ぶ         | オプションを指定して保存               | 選択で変わる文字コード・BOM・改行コードを明示する |
| 元の場所へ書き込む     | 元のファイルに上書き保存               | ダウンロード保存を一律に「上書き保存」と書かない  |
| 別形式にする           | RSFスプレッドシートに変換              | 元のCSVを変更しない場合は、その点を確認画面で示す |
| 診断付きで続行する     | このまま開く                           | 自動修復しないこと、問題の位置を併記する          |
| 保存できない文字を示す | この文字コードで表せない文字があります | 「不正な文字」「保存エラー」だけで終わらせない    |

「アップロード」は、Google ドライブ同期のように実際に端末外へ送信する場合に
限って使う。

公開済みのラベルと異なる表記を採用するときは、メニュー、ダイアログ、ヘルプ、
ショートカット一覧の表記を同じ変更で揃える。

## 5. 状況別の書き方と文例

以下は文例である。採用する前に、表示条件・取得できる情報・実際の動作を実装と
テストで確認する。

### 5.1 操作と確認

- メニュー：「CSVを開く」「文字コードを指定して開き直す」
  「オプションを指定して保存」
- 未保存で閉じる：見出し「変更を保存せずに閉じますか？」、本文「変更は保存
  されません。」、ボタン「変更を破棄」「編集を続ける」
- CSV から RSF へ：見出し「RSFスプレッドシートに変換しますか？」、本文
  「RSFスプレッドシートとして保存します。元のCSVは変更しません。」、ボタン
  「変換して保存」「キャンセル」

### 5.2 エラーと診断

- 保存できない文字：「B4の文字『①』は、選択した文字コードでは保存できません。
  文字を変更するか、別の文字コードを選んでください。」
- 列数が異なるCSV：「12行目は、ほかの行と列数が異なります。内容を確認するか、
  このまま開いてください。ファイルは自動修復しません。」
- 原因が特定できない失敗：「ファイルを保存できませんでした。保存先と空き容量を
  確認して、もう一度お試しください。」――確認事項は、実際に起こり得る原因に
  限る。

### 5.3 保存結果とブラウザ差

- 上書きできずダウンロードする場合：「このブラウザでは元のファイルに直接上書き
  できません。変更後のファイルをダウンロードします。」
- ダウンロード完了を確認できる場合：「変更後のファイルをダウンロードしました。」
  ――完了を確認できない場合は「ダウンロードを開始しました」など、観測できた
  状態に合わせる。
- 上書き保存を確認できる場合：「元のファイルに保存しました。」――ダウンロード
  保存では使わない。

### 5.4 注意書き

CSV インジェクションなどの注意書きは、該当する条件、想定される影響、利用者が
取れる対処を具体的に書く。注意文を理由にセル値を自動で書き換えるかのような
表現は避ける（Refrain Sheet はセル値を自動で書き換えない）。

## 6. 文言変更時のレビュー

文言を追加・変更する PR では、次の観点を確認する。

- **事実**：表示条件、保存先、元ファイルへの影響が実装・テストと一致するか。
- **判断**：実行前に必要な情報があり、選択肢から結果を予測できるか。
- **復旧**：エラーの対象・位置・次の行動が分かり、入力内容が不用意に失われ
  ないか。
- **一貫性**：同じ概念に同じ語を使い、日本語と英語で意味が一致するか。
- **表示と操作**：狭い画面、拡大表示、キーボード、日本語 IME、スクリーン
  リーダーで意味が伝わるか。

影響の大きい文言（保存・変換・破棄・文字コード）の提案では、可能な範囲で
「表示条件／日本語／英語／押した後の動作／元ファイルへの影響」を PR 本文に
記録する。

文言の編集元は次のとおり。

- アプリ：`src/locales/ja.json` と `src/locales/en.json`。両者のキー集合は
  一致させる（`tests/i18n.test.ts` が検査する）。
- 紹介ページ：`site/i18n.js`。`npm run build:landing` が生成する
  `landing/index.html` と `landing/en/index.html` は直接編集しない。

## 7. 現行文言との差分（2026年9月26日時点の棚卸し）

本ルール制定時に `src/locales/ja.json` と照合し、次の差分を確認した。いずれも
既存の公開済み文言であり、本ルールの制定だけを理由に一括で書き換えない。是正は
対象ごとに個別の Issue／PR で行い、§4 の最後の段落に従ってメニュー・ダイアログ・
ヘルプを同時に揃える。

| キー                                               | 現行の日本語                                            | 本ルールとの差分                                                               |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `dialog.unsaved.title`                             | 未保存の変更                                            | 見出しが判断事項になっていない（§2-7、§5.1）                                   |
| `dialog.unsaved.discard` / `dialog.unsaved.cancel` | 破棄 / キャンセル                                       | 選択後の動作が具体的でない（「変更を破棄」「編集を続ける」）（§2-7）           |
| `dialog.unrepresentable.message`                   | 選択した文字コード（{encoding}）では表現できない文字が… | 対象セルは別行で示されるが、次の行動が書かれていない（§2-6、§5.2）             |
| `notify.saveFailed`                                | 保存に失敗しました: {error}                             | 対象と次の行動がなく、技術的なエラー文だけになり得る（§2-6）                   |
| `notify.savedDownload`                             | ダウンロードとして「{name}」を保存しました。…           | ダウンロードの完了を観測できているかを確認し、観測範囲に合わせる（§2-8、§5.3） |
| `dialog.sheetName.ok` / `dialog.ok`                | OK                                                      | 対象＋動詞にできるか確認する（§2-1）                                           |
| `diag.text-after-quote` / `find.invalidRegex` など | 「不正な」「不正です」                                  | 利用者を責める印象を避け、問題と次の行動を書けるか確認する（§2-2、§2-6）       |

一方、「文字コードを指定して開き直す…」「オプションを指定して保存…」
「このまま開く」、開き直しの警告文（バイト列を変更しないことの明示）、
変換確認の注記（元のCSVを変更しないことの明示）は、すでに本ルールに沿っている。

## 8. 参考資料

- [Microsoft Learn「記述スタイル」](https://learn.microsoft.com/ja-jp/windows/apps/design/style/writing-style)：
  分かりやすい表現と、利用者を責めないエラーの考え方。
- [デジタル庁デザインシステム「インプットテキスト（使い方）」](https://design.digital.go.jp/dads/components/input-text/usage/)・
  [同「アクセシビリティ」](https://design.digital.go.jp/dads/components/input-text/accessibility/)：
  入力ラベル、補助説明、エラー表示、プレースホルダーの扱い。
- [GOV.UK Design System「Error message」](https://design-system.service.gov.uk/components/error-message/)：
  問題と修正方法を伝えるエラー文。
- [W3C WCAG 2.2「Error Identification」](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)・
  [「Status Messages」](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)：
  エラーの識別と状態通知のアクセシビリティ。

これらはルールを検討するための参考資料であり、各組織の表記や実装パターンを
そのまま製品に適用するものではない。文言そのものは Refrain Sheet 独自に書く
（[IP リスク方針](../decisions/ip-risk-policy.md) §3.2）。
