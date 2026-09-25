---
type: reference-concept
title: Spreadsheet shortcut comparison — Excel for the web, Google Sheets, and LibreOffice Calc
description: Design reference comparing Excel for the web, Google Sheets (default PC shortcuts), and LibreOffice Calc keyboard shortcuts, with the open questions each raises for Refrain Sheet. Not a spec, not an official list, not hands-on verified (canonical text in Japanese).
sources:
  - resource: https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel
  - resource: https://support.microsoft.com/ja-jp/accessibility/excel/keyboard-shortcuts-in-excel
  - resource: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop
  - resource: https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html
  - resource: https://help.libreoffice.org/latest/en-US/text/shared/04/01010000.html
  - resource: ../../src/app/shortcuts.ts
status: stable
stale_after: 2027-03-26
generated:
  by: claude-code
  at: 2026-09-26T00:00:00Z
---

# Spreadsheet shortcut comparison — Excel for the web, Google Sheets, and LibreOffice Calc

## English summary

A design reference for thinking about Refrain Sheet's keyboard shortcuts. It
lines up what **Excel for the web**, **Google Sheets** (the default PC
shortcut list), and **LibreOffice Calc** document for the same operations,
in that order, and notes the question each row raises for Refrain Sheet.

- **What it is not.** Not an official list for any product, and **not a
  Refrain Sheet spec**: nothing here is implemented or adopted because it
  appears in a table. The keys shipped today are defined in
  [`src/app/shortcuts.ts`](../../src/app/shortcuts.ts) and listed in the app
  under **Help > About / Keyboard Shortcuts**. Adopting a key is a separate
  design decision, recorded on its own Issue/PR with the reason.
- **Evidence level.** Every key was checked against the vendors' help pages
  (Microsoft Support's **Web** section; Google Docs Editors Help, PC
  shortcuts only; LibreOffice Help) on 2026-09-26. None was verified
  hands-on, and the pages may change — this file carries a `stale_after`
  date for that reason. Google also offers a "compatible spreadsheet
  shortcuts" setting; the tables use its defaults.
- **Rows that disagree matter most.** The same key does different things
  across products: `Ctrl + Shift + V` (Excel: paste formatting; Google: paste
  values only), `F9` (Excel/Calc: recalculate; Google: formula preview while
  typing a formula), `F4` (Google: redo outside a formula), `Ctrl + E`
  (Excel: Flash Fill; Google: collapse an expanded array), `Backspace`,
  `Ctrl + 1`, and `Ctrl + F6`. Sheet switching uses a different key in each
  product, and several keys collide with browser keys (`Ctrl + O`,
  `Ctrl + W`, `Ctrl + R`, `Ctrl + PageDown`).
- **Relation to the [IP risk policy](../decisions/ip-risk-policy.md).**
  Familiar _operation_ — including conventional key bindings — is in scope
  (§3.1). This comparison summarizes key-to-operation facts; it does not copy
  the vendors' help text, and it must not become a reason to reproduce any
  product's screens, ribbon, access-key scheme, or wording, or to claim
  "same keys as" another product in user-facing text (§3.3, §5). Refrain
  Sheet's own key-ownership rule ([accessibility](../ui/accessibility.md):
  never take tab, window, reload, or zoom keys; Ctrl+F/H/G/E and F3 are
  always the app's) outranks any row here.
- **What Refrain Sheet adopted.** The Japanese section "Refrain Sheet
  での採用状況" lists the current binding, or the reason for none, for the
  main rows.

The canonical text follows in Japanese.

---

# 表計算ソフトのショートカット：設計参考メモ

- 位置づけ：Refrain Sheet のショートカットを検討するための開発用参考資料。
  **Excel for the web → Google スプレッドシート → LibreOffice Calc** の順に操作を
  比較する。各製品の公式一覧でも、Refrain Sheet の実装済み・採用済み仕様でもない。
- 確認日：2026年9月26日（Google スプレッドシートを追加）。
- 現行の Refrain Sheet のキー割り当ては
  [`src/app/shortcuts.ts`](../../src/app/shortcuts.ts) が正であり、アプリ内の
  **Help > About / Keyboard Shortcuts** に表示される。

## 資料と表記

- **Excel 側：** Microsoft Support「Keyboard shortcuts in Excel」の
  [英語版](https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel)
  の **Web** セクションを主資料とし（確認時に保存した本文と照合）、
  [日本語版](https://support.microsoft.com/ja-jp/accessibility/excel/keyboard-shortcuts-in-excel)
  も参照した。
- **Google 側：** Google ドキュメント エディタ ヘルプ
  「[Keyboard shortcuts for Google Sheets](https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop)」
  の **PC shortcuts** を参照した。PC は Windows を想定し、Mac・Chrome OS の
  キーは表に混ぜない。Google には「Enable compatible spreadsheet
  shortcuts」（他社製の表計算ソフトと互換のショートカット）という設定もあるが、
  表は既定の一覧で比較し、互換モードでの再割り当てまでは保証しない。
- **Calc 側：**
  [表計算のショートカット](https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html)
  と
  [LibreOffice 共通ショートカット](https://help.libreoffice.org/latest/en-US/text/shared/04/01010000.html)
  を主資料とした。英語ヘルプの OS 共用表記（`CommandCtrl` など）は Windows/Linux
  の `Ctrl`、`Alt` に正規化した。
- **環境の違い：** Excel と Google はブラウザー版、Calc はデスクトップ版。OS、
  ブラウザー、言語・キーボード配列、フォーカス、設定で結果が変わる。公開ページは
  将来変わりうる。
- **キー表記：** `Ctrl + C` は同時押し、`Alt + Windows, H` は最初の組み合わせの
  後に `H` を押す。米国英語配列を基準とする。
- **`—` の意味：** 参照したヘルプで対応キーを確認していない。機能が存在しない
  という意味ではない。
- **検証の水準：** 表のキーは資料との照合済みだが、実機での動作検証は未実施。
  各サイトの説明文・一覧は転載せず、設計に必要なキーと操作の対応を独自に要約した。

## 編集・入力

| 操作・論点                 | Excel for the web                                     | Google スプレッドシート（PC）                                              | LibreOffice Calc                                 | Refrain Sheet での検討                    |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| コピー／切り取り／貼り付け | `Ctrl + C`／`Ctrl + X`／`Ctrl + V`                    | `Ctrl + C`／`Ctrl + X`／`Ctrl + V`                                         | `Ctrl + C`／`Ctrl + X`／`Ctrl + V`               | クリップボードとブラウザーの既定動作      |
| 元に戻す／やり直す         | `Ctrl + Z`／`Ctrl + Y`                                | `Ctrl + Z`／`Ctrl + Y`（`Ctrl + Shift + Z`、セル編集外の `F4` もやり直し） | `Ctrl + Z`／`Ctrl + Y`                           | 操作履歴の単位                            |
| 選択セルを編集             | `F2`                                                  | —（`F2` は**数式入力中**の参照範囲の選択切り替えとして掲載）               | `F2`                                             | 同じキーでも対象の状態が違う              |
| 内容を消去                 | `Delete`                                              | —（PC 一覧にセル消去の項目なし）                                           | `Delete`（ダイアログなしで消去）                 | 書式まで消去するか                        |
| `Backspace`                | 選択セルを消去して編集を開始                          | —                                                                          | 「内容の削除」ダイアログを開く                   | **同じキーでも動作が異なる**              |
| 下／上へ確定               | `Enter`／`Shift + Enter`                              | —（PC 一覧は確定方向を明記しない）                                         | `Enter`／`Shift + Enter`（設定や選択状態に注意） | 確定後の移動先                            |
| 右／左へ確定               | `Tab`／`Shift + Tab`                                  | —                                                                          | —                                                | フォーカス移動との競合                    |
| 入力を取り消す             | `Esc`                                                 | —                                                                          | `Esc`（ダイアログの取り消しなど）                | 編集値の復元範囲                          |
| セル内で改行               | `Alt + Enter`                                         | —（この一覧に記載なし）                                                    | 入力行で `Ctrl + Enter`                          | セル編集時のキー処理                      |
| 範囲を同じ値で埋める       | —                                                     | `Ctrl + Enter`                                                             | —                                                | セル内改行・入力確定との区別              |
| 下／右方向にコピー         | —（Web セクションで確認できず）                       | `Ctrl + D`／`Ctrl + R`                                                     | —                                                | `Ctrl + R` はブラウザーの再読み込み       |
| 値だけ貼り付け             | —                                                     | `Ctrl + Shift + V`                                                         | —                                                | **Google は「値だけ」**                   |
| 書式を貼り付け             | `Ctrl + Shift + V`                                    | —（同じキーは「値だけ」）                                                  | —                                                | **同じキーで意味が異なる**                |
| 今日の日付／現在時刻を入力 | `Ctrl + ;`／`Ctrl + Shift + ;`                        | `Ctrl + ;`／`Ctrl + Shift + ;`（一部の地域では別キーも案内）               | —                                                | 記号キーの配列差・ロケール差              |
| 上のセルの数式／値をコピー | `Ctrl + '`／`Ctrl + Shift + '`                        | —                                                                          | —                                                | 値と式を区別するか                        |
| 関数を挿入・入力支援       | `Shift + F3`（同じ Web セクションに検索としても記載） | `F1`／`Shift + F1` は**数式入力中**のヘルプ表示の切り替え                  | `Ctrl + F2`（関数ウィザード）                    | コマンド名だけで同じキーと見なさない      |
| 数式の引数を入力           | `Ctrl + Shift + A`                                    | —                                                                          | —                                                | 関数入力支援との関係                      |
| 数式の参照形式を切り替える | 数式内の参照を選択して `F4`                           | 数式入力中の `F4`                                                          | `F4`                                             | Google の `F4` は通常状態では「やり直し」 |

Excel の `Shift + F3` は、Web セクションの「よく使われるショートカット」では
**Find**、「セルの編集」では **Insert a function** と記されている。どちらか一方の
記載を採って他方を無視せず、UI の状態を変えて検証する。

## 書式・リンク

| 操作・論点           | Excel for the web                                               | Google スプレッドシート（PC）               | LibreOffice Calc                   | Refrain Sheet での検討               |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- | ------------------------------------ |
| 太字／斜体／下線     | `Ctrl + B`／`Ctrl + I`／`Ctrl + U`                              | `Ctrl + B`／`Ctrl + I`／`Ctrl + U`          | `Ctrl + B`／`Ctrl + I`／`Ctrl + U` | 値と書式の保持方針                   |
| ハイパーリンクを挿入 | `Ctrl + K`                                                      | `Ctrl + K`                                  | `Ctrl + K`（共通ヘルプ）           | CSV 上で表現できる範囲               |
| 数値／時刻／日付形式 | `Ctrl + Shift + 1`／`2`／`3`                                    | `Ctrl + Shift + 1`／`2`／`3`                | —                                  | 数字・記号キーの配列差               |
| 通貨／割合／指数形式 | `Ctrl + Shift + 4`／`5`／`6`                                    | `Ctrl + Shift + 4`／`5`／`6`                | —                                  | CSV の表示と保存内容の区別           |
| `Ctrl + 1`           | 数値形式のダイアログ                                            | —（PC 一覧に記載なし）                      | セルの書式設定ダイアログ           | **同じキーでも開く UI の範囲が違う** |
| 外枠の罫線           | `Ctrl + Shift + 7`（Web 記載）。`Ctrl + Shift + &` も輪郭の罫線 | `Alt + Shift + 7` または `Ctrl + Shift + 7` | —                                  | OS・配列による違い                   |
| 書式を消去           | —                                                               | `Ctrl + \`                                  | —                                  | 値を残すか                           |

## 移動・選択・検索・シート

| 操作・論点               | Excel for the web                                      | Google スプレッドシート（PC）                                          | LibreOffice Calc                   | Refrain Sheet での検討                           |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| 1 セルずつ移動           | 方向キー                                               | —                                                                      | 方向キー                           | 編集中は文字カーソル移動との切り替え             |
| 行の先頭／A1 へ移動      | `Home`／`Ctrl + Home`                                  | `Home`／`Ctrl + Home`                                                  | `Home`／`Ctrl + Home`              | 選択とスクロールの同期                           |
| 使用範囲の終端           | `Ctrl + End`                                           | `Ctrl + End`（シートの終端）                                           | `Ctrl + End`                       | 「終端」の定義の差                               |
| データ領域の端           | `Ctrl + ←`／`Ctrl + →`（Web の表の記載）               | —（PC 一覧に通常のセル移動の詳細なし）                                 | `Ctrl + 方向キー`                  | 空白をまたぐ境界の定義                           |
| 1 画面下／上             | `PageDown`／`PageUp`（資料では約 28 行）               | —                                                                      | —                                  | 表示領域による差                                 |
| 1 セルずつ範囲を広げる   | `Shift + 方向キー`                                     | —                                                                      | —                                  | 選択アンカーの扱い                               |
| 列／行全体を選択         | `Ctrl + Space`／`Shift + Space`                        | `Ctrl + Space`／`Shift + Space`                                        | `Ctrl + Space`／`Shift + Space`    | IME・OS の予約キーとの競合                       |
| 次／前のシートへ         | `Ctrl + Alt + PageDown`／`Ctrl + Alt + PageUp`         | `Alt + ↓`／`Alt + ↑`                                                   | `Ctrl + PageDown`／`Ctrl + PageUp` | **3 製品で異なる**。ブラウザーのタブ移動との競合 |
| シートを挿入             | `Shift + F11`                                          | `Shift + F11`                                                          | —                                  | シート機能の有無と増設方法                       |
| セル番地へ移動           | `Ctrl + G`                                             | —（PC 欄に明記なし。Mac 欄の `Ctrl + G` は転用しない）                 | —                                  | ジャンプの UI                                    |
| 検索                     | `Ctrl + F` または `Shift + F3`（上記の二重記載に注意） | `Ctrl + F`                                                             | `Ctrl + F`                         | ブラウザー内検索との競合                         |
| 検索と置換               | —                                                      | `Ctrl + H`                                                             | —                                  | 検索との UI の区別                               |
| 次／前を検索             | `Shift + F4`／`Ctrl + Shift + F4`                      | —                                                                      | —                                  | 検索状態とフォーカス                             |
| 列・行・セルを挿入／削除 | `Ctrl + +`／`Ctrl + -`                                 | `Ctrl + Alt + =`／`Ctrl + Alt + -`（選択に応じて挿入／削除のメニュー） | `Ctrl + +`／`Ctrl + -`             | 選択の単位、即実行かメニュー表示か               |
| 行を非表示／再表示       | `Ctrl + 9`／`Ctrl + Shift + 9`                         | `Ctrl + Alt + 9`／`Ctrl + Shift + 9`                                   | —                                  | **非表示のキーが異なる**                         |
| 列を非表示／再表示       | `Ctrl + 0`／`Ctrl + Shift + 0`                         | `Ctrl + Alt + 0`／`Ctrl + Shift + 0`                                   | —                                  | OS 側で予約される場合がある                      |

Excel は **Microsoft Teams 内、または Chrome 以外のブラウザー**で、シート移動の
代替として `Ctrl + PageDown`／`PageUp` も記載する。ブラウザーの条件を伏せて
単一のキーとして案内しない。

## 計算・製品固有の操作

| 操作・論点                     | Excel for the web                                     | Google スプレッドシート（PC）                                                                       | LibreOffice Calc                                                | Refrain Sheet での検討                       |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| `F9`                           | ブックの計算・更新                                    | **数式入力中**に計算結果のプレビューを切り替え                                                      | 変更された数式の再計算                                          | **同じキーでも全く違う**。状態と処理量を区別 |
| 全体を再計算                   | `Ctrl + Shift + Alt + F9`                             | —                                                                                                   | `Ctrl + Shift + F9`                                             | 重い処理と確認 UI の要否                     |
| オート SUM／クイック集計       | `Alt + =`                                             | `Alt + Shift + Q`（選択範囲の集計へ移る。操作は同一ではない）                                       | —                                                               | 数式の挿入と集計表示の区別                   |
| `Ctrl + E`                     | フラッシュフィル                                      | **展開された配列数式を折りたたむ**（数式の項目）                                                    | —                                                               | 他製品の既存の割り当てと競合                 |
| 数式表示の切り替え             | —                                                     | `Ctrl + ~`                                                                                          | `` Ctrl + ` ``                                                  | 記号キーとキーボード配列                     |
| 数式入力行へ移動               | —                                                     | —                                                                                                   | `Ctrl + Shift + F2`                                             | 数式バーの設計                               |
| 外部データの更新／すべて更新   | `Alt + F5`／`Ctrl + Alt + F5`                         | —                                                                                                   | —                                                               | インポートとの違い                           |
| メニュー・機能の検索           | `Alt + Windows`（リボン）、`Alt + Windows, Q`（検索） | `Alt + /`（ツールの検索）。メニューは Chrome で `Alt + 文字`、他のブラウザーで `Alt + Shift + 文字` | デスクトップのメニュー。一律の対応キーなし                      | ブラウザーごとの処理                         |
| コマンド領域とシートの間を移動 | `Ctrl + F6`                                           | グリッドの外へ `Ctrl + Alt + Shift + M`                                                             | `F6`／`Shift + F6` はサブウィンドウ間、`Ctrl + F6` は文書領域へ | **同じキーでもフォーカス先が異なる**         |
| ショートカット一覧             | [ヘルプ] → [キーボード ショートカット]                | `Ctrl + /`                                                                                          | —                                                               | アプリ内での見つけやすさ                     |
| 閲覧モードから編集モードへ     | `Alt + Windows, Z, M, E`                              | —                                                                                                   | 該当なし                                                        | 表示／編集モードの状態                       |
| アクセシビリティメニュー       | `Alt + Shift + A`                                     | —                                                                                                   | 該当なし                                                        | キーボードだけで使える経路                   |

Excel のリボンの各タブは `Alt + Windows, F/H/N/A/R/W` と案内され、`Ctrl + F1` は
リボンの表示切り替え。Mac のアクセスキーは `Control + Option` で始まるが、表全体の
`Ctrl` を機械的に置き換えてよいという意味ではない。

## 衝突・確認事項

- **ブラウザーが優先するキー：** Microsoft は `F1` と `Ctrl + O` をブラウザーに
  適用されるキーの例とする一方、Web 版の「よく使われるショートカット」には
  `Ctrl + O` をブックを開くキーとして載せている。`Ctrl + W` もブックを閉じるキー
  として掲載され、タブを閉じるキーと競合しうる。Excel には「Override browser
  shortcuts」設定がある。Google の `Ctrl + O` も公式一覧に載るが、実際の
  ブラウザーの動作とあわせて確認する。
- **Google の互換ショートカット設定：** Google は [ヘルプ] → [キーボード
  ショートカット] に「Enable compatible spreadsheet shortcuts」を案内している。
  比較表は既定の PC 一覧に基づく。
- **`Ctrl + Shift + V`：** Excel for the web は「書式を貼り付け」、Google は
  「値だけ貼り付け」。採用する場合は、コピー元の書式とデータのどちらを貼るかを
  先に決める。
- **`F9` と `F4`：** Google の `F9` は数式編集中のプレビュー、Excel／Calc は
  再計算。Google の `F4` は通常状態ではやり直し、数式入力中は参照形式の切り替え。
  キーだけでなく状態を記録する。
- **Excel の Web セクションで確認できたもの・できなかったもの：** 日付・時刻の
  入力、`F4` による参照形式の切り替え、`Ctrl + Y`、数値形式のキー、`Shift + F3`
  の関数挿入、`Ctrl + Alt + PageDown`／`PageUp` は、英語版の Web セクションに明記
  されている（デスクトップ版との混同ではない）。一方、`Shift + F9`（アクティブ
  シートの再計算）と `Ctrl + D`／`Ctrl + R` は Web セクションで確認できなかった
  ため、Excel の列には入れていない。
- **日本語配列と OS の差：** `;`、`~`、バッククォート、`+`、`-` は、米国配列の
  表記を機械的に日本語配列へ当てはめない。Google 公式も、言語やキーボードによって
  使えないキーがあると注意している。
- **実機未検証：** 資料に載っていても、編集／閲覧モード、セル編集中かどうか、
  ブラウザー、OS、キーボード配列で結果が変わりうる。Calc もデスクトップ環境が
  キーを予約する場合があり、キー割り当てを利用者が変更できる。
- **比較の限界：** 製品ごとに機能の範囲が違う。名前やキーが同じだからといって、
  挙動も同じだと推定しない。

## Refrain Sheet の方針との関係

- **ブラウザーに必要なキーは奪わない：** タブ・ウィンドウ操作（`Ctrl + W`、
  `Ctrl + T`、`Ctrl + Tab`、`Ctrl + PageUp`／`PageDown`、`Ctrl + 1`〜`9`）、
  再読み込み、印刷、開発者ツール、そして弱視の利用者が頼る**ズーム**
  （`Ctrl + +`／`-`／`0`）は横取りしない。すべてのコマンドはメニューからも実行
  できる（[`src/app/shortcuts.ts`](../../src/app/shortcuts.ts)、
  [accessibility](../ui/accessibility.md)）。この表で他製品がそれらのキーを使って
  いても、その規則が優先する。
- **表計算キーはブラウザーより優先：** ブラウザーも使うが表計算での意味が期待
  されるキー（`Ctrl + F`／`H`／`G`／`E`、`F3`）は、フォーカスの位置にかかわらず
  **常に**アプリが使う。グリッドは画面外の行を描画しないため、ブラウザー検索では
  そもそも見つからない。macOS の `Cmd + H` は OS が使うため、置換は
  `Cmd + Shift + H` とする。
- **IME の安全性：** IME の変換中はどのショートカットも発火しない
  （[editing-and-ime](../ui/editing-and-ime.md)）。日本語配列の記号キーを含む行は、
  この前提の上で検討する。
- **IP リスク方針：** 一般的なキー操作の慣習に合わせることは「近い操作感」として
  検討できる（[IP リスク方針](../decisions/ip-risk-policy.md) §3.1）。ただし、
  この資料を根拠に Excel のリボン、アクセスキー体系、画面、説明文を再現しない。
  ヘルプ本文は引用せず、キーと操作の対応だけを設計用に要約している。ユーザー向けの
  ヘルプや紹介文で「Excel と同じキー操作」と表現しない（同 §3.3、§5）。

### Refrain Sheet での採用状況（2026年9月26日）

上の表の主な行について、現在の割り当てと、採用しなかった理由をまとめる。正は
[`src/app/shortcuts.ts`](../../src/app/shortcuts.ts) とアプリ内の
**Help > About / Keyboard Shortcuts**。

| 操作                 | Refrain Sheet                                                     | 備考                                                                                                          |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 検索                 | `Ctrl + F`（常に）、`Ctrl + Shift + F` も可                       | 「検索と置換」サイドパネルを開く                                                                              |
| 置換                 | `Ctrl + H`（macOS は `Cmd + Shift + H`）、`Ctrl + Shift + H` も可 | 検索と同じパネルで置換欄にフォーカス                                                                          |
| 次／前を検索         | `F3`／`Shift + F3`（常に）、検索欄で `Enter`／`Shift + Enter`     | パネルの「すべて検索」で結果一覧を表示。Excel の `Shift + F4` は採用しない                                    |
| セル番地へ移動       | `Ctrl + G`                                                        | 常にアプリ                                                                                                    |
| フラッシュフィル     | `Ctrl + E`                                                        | 常にアプリ。Google では同じキーが配列数式の折りたたみ                                                         |
| 再計算               | `F9`                                                              | スプレッドシート文書のみ。全体再計算の別キーは設けない。Google の `F9` は数式入力中のプレビュー               |
| 次／前のシート       | `F7`／`Shift + F7`、`Ctrl + Alt + PageDown`／`PageUp`             | 3 製品でキーが異なる。`Ctrl + PageDown`／`PageUp` はブラウザーのタブ移動のため使えない                        |
| 太字／斜体／下線     | `Ctrl + B`／`I`／`U`                                              | 採用済み                                                                                                      |
| 切り取り             | 未実装                                                            | `Ctrl + X` は 3 製品共通。コマンド自体がないため機能追加として検討する                                        |
| 下方向にコピー       | `Ctrl + D`                                                        | 採用済み。右方向の `Ctrl + R`（Google）はブラウザーの再読み込みのため使えない                                 |
| 値だけ貼り付け       | 未実装                                                            | `Ctrl + Shift + V` は Google では値だけ、Excel for the web では書式の貼り付け。意味が割れるため採用時に決める |
| セル内で改行         | `Alt + Enter`                                                     | 採用済み                                                                                                      |
| 下／上、右／左へ移動 | `Enter`／`Shift + Enter`、`Tab`／`Shift + Tab`                    | 選択中も編集中も同じ。行の端の `Tab` はブラウザーに渡し、グリッドから抜けられるようにする                     |
| シートを挿入         | `Shift + F11`                                                     | Excel・Google と同じ。`F11` 単独はブラウザーの全画面表示のまま                                                |
| 書式を消去           | `Ctrl + \`                                                        | Google と同じ。日本語配列の `¥` キーでも動く                                                                  |
| ショートカット一覧   | `Ctrl + /`                                                        | Google と同じ                                                                                                 |
| 参照形式の切り替え   | 数式入力中の `F4`                                                 | 3 製品と同じ。数式入力中以外の `F4` は「新規作成」のまま                                                      |
| 数値／通貨／割合形式 | `Ctrl + Shift + 1`／`4`／`5`                                      | Excel・Google と同じキー。日付・時刻・指数の形式（`2`／`3`／`6`）は表示形式自体がない。macOS でも `Ctrl`      |
| 列・行の挿入／削除   | なし（メニュー・右クリック）                                      | `Ctrl + +`／`-` はブラウザーのズームで、アクセシビリティ上奪わない                                            |
| 列／行全体を選択     | なし（見出しのクリック）                                          | `Ctrl + Space` は IME 切り替え、`Shift + Space` は入力と衝突しうる                                            |
| セルの書式設定       | なし（メニュー）                                                  | `Ctrl + 1` はブラウザーのタブ移動                                                                             |
| データ領域の端へ移動 | 未実装                                                            | `Ctrl + 方向キー` は別の機能追加として検討する                                                                |
| 今日の日付／現在時刻 | 未実装                                                            | 入力コマンド自体がないため、機能追加として別途検討する                                                        |
| リボン・アクセスキー | 採用しない                                                        | リボンがなく、Excel 固有の操作体系を再現しない（IP リスク方針）                                               |

注意：数式入力中以外の `F4` は Refrain Sheet では「新規作成」であり、Google の
「やり直し」とも意味が異なる。数式入力中の `F4` は 3 製品と同じく参照形式の
切り替え。

## 検証チェックリスト

1. Excel for the web、Google スプレッドシート、LibreOffice Calc、Refrain Sheet
   のそれぞれで、OS、ブラウザー、アプリのバージョン、キーボード配列、設定
   （Google の互換ショートカットを含む）を記録する。
2. セル選択中／編集中／数式入力中、検索欄の表示中、閲覧／編集モード、コピー直後
   などの状態を分けて確認する。
3. `Ctrl + Shift + V`、`F9`、`F4`、`Ctrl + E`、`Shift + F3`、`Backspace`、
   シート移動、セル内改行、`Ctrl + O`、日本語配列の記号キーを優先して検証する。
4. Refrain Sheet に採用するキーとその理由は、個別の Issue／PR で設計決定として
   記録する（IP リスク方針 §4.1 の項目を含む）。検証前の行を、製品の仕様や
   ユーザー向けヘルプとして流用しない。

## 出典

リンク先は確認日時点のもの。判断に使う前に、最新の内容を確認すること。

- [Microsoft Support（英語）：Keyboard shortcuts in Excel](https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel)
  — **Web** セクション。本文の引用ではなく、キーと操作の関係を設計用に要約した。
- [Microsoft Support（日本語）：Excel のキーボード ショートカット](https://support.microsoft.com/ja-jp/accessibility/excel/keyboard-shortcuts-in-excel)
  — 対応する日本語の参照先。
- [Google Docs Editors Help：Keyboard shortcuts for Google Sheets](https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop)
  — **PC shortcuts**。Mac・Chrome OS の表とは分けて確認する。
- [LibreOffice Help：Shortcut Keys for Spreadsheets](https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html)
  — Calc 固有のキー。
- [LibreOffice Help：General Shortcut Keys in LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/04/01010000.html)
  — コピー・書式・検索などの共通キー。
