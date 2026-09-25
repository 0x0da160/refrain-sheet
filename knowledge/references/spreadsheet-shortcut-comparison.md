---
type: reference-concept
title: Spreadsheet shortcut comparison — Excel for the web and LibreOffice Calc
description: Design reference comparing Excel for the web and LibreOffice Calc keyboard shortcuts, with the open questions each raises for Refrain Sheet. Not a spec, not an official list, not hands-on verified (canonical text in Japanese).
sources:
  - resource: https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel
  - resource: https://support.microsoft.com/ja-jp/accessibility/excel/keyboard-shortcuts-in-excel
  - resource: https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html
  - resource: https://help.libreoffice.org/latest/en-US/text/shared/04/01010000.html
  - resource: ../../src/app/shortcuts.ts
status: stable
stale_after: 2027-03-25
generated:
  by: claude-code
  at: 2026-09-25T00:00:00Z
---

# Spreadsheet shortcut comparison — Excel for the web and LibreOffice Calc

## English summary

A design reference for thinking about Refrain Sheet's keyboard shortcuts. It
lines up what **Excel for the web** and **LibreOffice Calc** document for the
same operations and notes the question each row raises for Refrain Sheet.

- **What it is not.** Not an official list for either product, and **not a
  Refrain Sheet spec**: nothing here is implemented or adopted because it
  appears in a table. The keys shipped today are defined in
  [`src/app/shortcuts.ts`](../../src/app/shortcuts.ts) and listed in the app
  under **Help > About / Keyboard Shortcuts**. Adopting a key is a separate
  design decision, recorded on its own Issue/PR with the reason.
- **Evidence level.** Every key was checked against the vendors' help pages
  (Microsoft Support's **Web** section; LibreOffice Help) on 2026-09-25. None
  was verified hands-on, and the pages may change — this file carries a
  `stale_after` date for that reason.
- **Rows that disagree matter most.** The same key does different things in
  the two products (`Backspace`, `Ctrl + 1`, `F9`, `Ctrl + F6`), Excel's own
  page lists `Shift + F3` as both Find and Insert Function, and several Excel
  keys collide with browser keys (sheet switching, `Ctrl + O`, `Ctrl + W`).
- **Relation to the [IP risk policy](../decisions/ip-risk-policy.md).**
  Familiar _operation_ — including conventional key bindings — is in scope
  (§3.1). This comparison summarizes key-to-operation facts; it does not copy
  the vendors' help text, and it must not become a reason to reproduce Excel's
  screens, ribbon, access-key scheme, or wording, or to claim "same keys as
  Excel" in user-facing text (§3.3, §5). Refrain Sheet's own rule that app
  shortcuts never override browser keys
  ([accessibility](../ui/accessibility.md)) outranks any row here.

The canonical text follows in Japanese.

---

# 表計算ソフトのショートカット：設計参考メモ

- 位置づけ：Refrain Sheet のショートカットを検討するための開発用参考資料。
  **Excel for the web** と **LibreOffice Calc** の操作を比較する。両製品の公式
  一覧でも、Refrain Sheet の実装済み・採用済み仕様でもない。
- 確認日：2026年9月25日。
- 現行の Refrain Sheet のキー割り当ては
  [`src/app/shortcuts.ts`](../../src/app/shortcuts.ts) が正であり、アプリ内の
  **Help > About / Keyboard Shortcuts** に表示される。

## 資料と表記

- **Excel 側：** Microsoft Support「Keyboard shortcuts in Excel」の
  [英語版](https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel)
  の **Web** セクションを主資料とし（確認日に保存した本文と照合）、
  [日本語版](https://support.microsoft.com/ja-jp/accessibility/excel/keyboard-shortcuts-in-excel)
  も参照した。公開ページは将来変わりうる。
- **Calc 側：**
  [表計算のショートカット](https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html)
  と
  [LibreOffice 共通ショートカット](https://help.libreoffice.org/latest/en-US/text/shared/04/01010000.html)
  を主資料とした。Calc はデスクトップアプリ、Excel はブラウザー版なので、環境差を
  前提とする。
- **キー表記：** 主に Windows キーボードを想定する。`Ctrl + C` は同時押し、
  `Alt + Windows, H` は最初の組み合わせの後に `H` を押す。Microsoft は米国英語
  配列を基準とする。Calc の英語ヘルプには OS に応じた `CommandCtrl` などの複合
  表記があるため、表では Windows/Linux の `Ctrl` に正規化した。日本語配列、
  macOS、ブラウザー、OS のキー割り当ては別途確認する。
- **`—` の意味：** 参照したヘルプで対応キーを確認していない。機能が存在しない
  という意味ではない。
- **検証の水準：** 表のキーは資料との照合済みだが、実機での動作検証は未実施。

## 編集・入力・書式

| 操作・論点                 | Excel for the web                  | LibreOffice Calc                                 | Refrain Sheet での検討                                                               |
| -------------------------- | ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| コピー／切り取り／貼り付け | `Ctrl + C`／`Ctrl + X`／`Ctrl + V` | `Ctrl + C`／`Ctrl + X`／`Ctrl + V`               | クリップボードとブラウザーの既定動作                                                 |
| 元に戻す／やり直す         | `Ctrl + Z`／`Ctrl + Y`             | `Ctrl + Z`／`Ctrl + Y`                           | 操作履歴の単位                                                                       |
| 選択セルを編集             | `F2`                               | `F2`                                             | 編集状態と選択状態の切り替え                                                         |
| 内容を消去                 | `Delete`                           | `Delete`（ダイアログなしで消去）                 | 書式まで消去するか                                                                   |
| `Backspace`                | 選択セルを消去して編集を開始       | 「内容の削除」ダイアログを開く                   | **同じキーでも動作が異なる**                                                         |
| 下／上へ確定               | `Enter`／`Shift + Enter`           | `Enter`／`Shift + Enter`（設定や選択状態に注意） | 確定後の移動先                                                                       |
| 右／左へ確定               | `Tab`／`Shift + Tab`               | —                                                | フォーカス移動との競合                                                               |
| 入力を取り消す             | `Esc`                              | `Esc`（ダイアログの取り消しなど）                | 編集値の復元範囲                                                                     |
| セル内で改行               | `Alt + Enter`                      | 入力行で `Ctrl + Enter`                          | セル編集時のキー処理                                                                 |
| 太字／斜体／下線           | `Ctrl + B`／`Ctrl + I`／`Ctrl + U` | `Ctrl + B`／`Ctrl + I`／`Ctrl + U`               | 値と書式の保持方針                                                                   |
| ハイパーリンクを挿入       | `Ctrl + K`                         | `Ctrl + K`（共通ヘルプ）                         | CSV 上で表現できる範囲                                                               |
| 関数を挿入                 | `Shift + F3`                       | `Ctrl + F2`（関数ウィザード）                    | **Excel は検索にも `Shift + F3` を掲げる**（下記）。文脈に依存するため実機確認が必要 |
| 数式の参照形式を切り替える | 数式内の参照を選択して `F4`        | `F4`                                             | 数式編集中だけを想定するか                                                           |
| 今日の日付／現在時刻を入力 | `Ctrl + ;`／`Ctrl + Shift + ;`     | —                                                | 記号キーの配列差                                                                     |
| 上のセルの数式／値をコピー | `Ctrl + '`／`Ctrl + Shift + '`     | —                                                | 値と式を区別するか                                                                   |
| 数式の引数を入力           | `Ctrl + Shift + A`                 | —                                                | 関数入力支援との関係                                                                 |
| 書式を貼り付け             | `Ctrl + Shift + V`                 | —                                                | Calc などの「形式を選択して貼り付け」と混同しない                                    |
| 数値／時刻／日付形式       | `Ctrl + Shift + 1`／`2`／`3`       | —                                                | 数字・記号キーの配列差                                                               |
| 通貨／割合／指数形式       | `Ctrl + Shift + 4`／`5`／`6`       | —                                                | CSV の表示と保存内容の区別                                                           |
| セルの書式設定             | `Ctrl + 1`（数値形式のダイアログ） | `Ctrl + 1`（セルの書式設定ダイアログ）           | **同じキーでも開く UI の範囲が違う**                                                 |

Excel の `Shift + F3` は、Web セクションの「よく使われるショートカット」では
**Find**、「セルの編集」では **Insert a function** と記されている。どちらか一方の
記載を採って他方を無視せず、UI の状態を変えて検証する。

## 移動・選択・シート

| 操作・論点               | Excel for the web                                                                        | LibreOffice Calc                   | Refrain Sheet での検討                 |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| 1 セルずつ移動           | 方向キー                                                                                 | 方向キー                           | 編集中は文字カーソル移動との切り替え   |
| 行の先頭／A1 へ移動      | `Home`／`Ctrl + Home`                                                                    | `Home`／`Ctrl + Home`              | 選択とスクロールの同期                 |
| 使用範囲の終端           | `Ctrl + End`                                                                             | `Ctrl + End`                       | 使用範囲の定義                         |
| データ領域の端           | `Ctrl + ←`／`Ctrl + →`（Web の表の記載）                                                 | `Ctrl + 方向キー`                  | 空白をまたぐ境界の定義                 |
| 1 画面下／上             | `PageDown`／`PageUp`（資料では約 28 行）                                                 | —                                  | 表示領域による差                       |
| 1 セルずつ範囲を広げる   | `Shift + 方向キー`                                                                       | —                                  | 選択アンカーの扱い                     |
| 列／行全体を選択         | `Ctrl + Space`／`Shift + Space`                                                          | `Ctrl + Space`／`Shift + Space`    | IME・OS の予約キーとの競合             |
| 次／前のシートへ         | `Ctrl + Alt + PageDown`／`Ctrl + Alt + PageUp`                                           | `Ctrl + PageDown`／`Ctrl + PageUp` | **ブラウザーのタブ移動との競合**       |
| 代替のシート移動         | `Ctrl + PageDown`／`Ctrl + PageUp`（Microsoft Teams 内、または Chrome 以外のブラウザー） | 上と同じ                           | ブラウザーの条件を固定せずに案内しない |
| シートを挿入             | `Shift + F11`                                                                            | —                                  | シート機能の有無と増設方法             |
| セル番地へ移動           | `Ctrl + G`                                                                               | —                                  | ジャンプの UI                          |
| 検索                     | `Ctrl + F` または `Shift + F3`（上記の矛盾に注意）                                       | `Ctrl + F`                         | ブラウザー内検索との競合               |
| 次／前を検索             | `Shift + F4`／`Ctrl + Shift + F4`                                                        | —                                  | 検索状態とフォーカス                   |
| 列・行・セルを挿入／削除 | `Ctrl + +`／`Ctrl + -`                                                                   | `Ctrl + +`／`Ctrl + -`             | 日本語配列での記号入力                 |
| 行を非表示／再表示       | `Ctrl + 9`／`Ctrl + Shift + 9`                                                           | —                                  | CSV の構造との関係                     |
| 列を非表示／再表示       | `Ctrl + 0`／`Ctrl + Shift + 0`                                                           | —                                  | OS 側で予約される場合がある            |

## 計算・製品固有の操作

| 操作・論点                   | Excel for the web                                          | LibreOffice Calc                                                | Refrain Sheet での検討               |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------ |
| 再計算                       | `F9`（ブックの計算・更新）                                 | `F9`（変更された数式の再計算）                                  | **再計算の範囲が異なる**             |
| 全体を再計算                 | `Ctrl + Shift + Alt + F9`                                  | `Ctrl + Shift + F9`                                             | 重い処理と確認 UI の要否             |
| オート SUM                   | `Alt + =`                                                  | —                                                               | 自動挿入の対象範囲                   |
| フラッシュフィル             | `Ctrl + E`                                                 | —                                                               | Excel 固有の機能として区別           |
| 外部データの更新／すべて更新 | `Alt + F5`／`Ctrl + Alt + F5`                              | —                                                               | インポートとの違い                   |
| リボンとシートの間を移動     | `Ctrl + F6`                                                | `F6`／`Shift + F6` はサブウィンドウ間、`Ctrl + F6` は文書領域へ | **同じキーでもフォーカス先が異なる** |
| リボンのアクセスキー         | `Alt + Windows` で開始（例：`, H` はホーム、`, N` は挿入） | 該当なし                                                        | Web アプリのナビゲーション設計       |
| 閲覧モードから編集モードへ   | `Alt + Windows, Z, M, E`                                   | 該当なし                                                        | 表示／編集モードの状態               |
| アクセシビリティメニュー     | `Alt + Shift + A`                                          | 該当なし                                                        | キーボードだけで使える経路           |
| 数式入力行へ移動             | —                                                          | `Ctrl + Shift + F2`                                             | 数式バーの設計                       |
| 数式表示の切り替え           | —                                                          | `` Ctrl + ` ``                                                  | 記号キーとキーボード配列             |

Excel の検索欄は `Alt + Windows, Q`、ファイル・ホーム・挿入・データ・校閲・表示の
各タブは `Alt + Windows, F/H/N/A/R/W` と案内されている。`Ctrl + F1` はリボンの
表示切り替え。Mac のアクセスキーは `Control + Option` で始まるが、表全体の `Ctrl`
を機械的に置き換えてよいという意味ではない。

## 衝突・確認事項

- **ブラウザーが優先するキー：** Microsoft は `F1` と `Ctrl + O` をブラウザーに
  適用されるキーの例とする一方、Web 版の「よく使われるショートカット」には
  `Ctrl + O` をブックを開くキーとして載せている。`Ctrl + W` もブックを閉じるキー
  として掲載されている。挙動が矛盾・競合しうるため、検証時はブラウザーと
  「Override browser shortcuts」の設定を記録する。
- **Web セクションで確認できたもの・できなかったもの：** 日付・時刻の入力、
  `F4` による参照形式の切り替え、`Ctrl + Y`、数値形式のキー、`Shift + F3` の
  関数挿入、`Ctrl + Alt + PageDown`／`PageUp` は、英語版の Web セクションに明記
  されている（デスクトップ版との混同ではない）。一方、`Shift + F9`（アクティブ
  シートの再計算）と `Ctrl + D`／`Ctrl + R` は Web セクションで確認できなかった
  ため、この表には入れていない。
- **実機未検証：** 資料に載っていても、Excel for the web の編集／閲覧モード、
  セル編集中かどうか、ブラウザー、OS、キーボード配列で結果が変わりうる。Calc も
  デスクトップ環境がキーを予約する場合があり、キー割り当てを利用者が変更できる。
- **比較の限界：** Excel の Web の表には、再計算やコメントなど、Calc や Refrain
  Sheet と機能の範囲が異なる操作がある。名前やキーが同じだからといって、挙動も
  同じだと推定しない。

## Refrain Sheet の方針との関係

- **ブラウザーのキーを奪わない：** Refrain Sheet のアプリショートカットは、
  ブラウザー・OS・支援技術が使うキー（`Ctrl + W`、`Ctrl + H`、
  `Ctrl + PageUp`／`PageDown` など）を横取りしない。衝突するコマンドには代替キーを
  割り当て、すべてのコマンドはメニューからも実行できる
  （[`src/app/shortcuts.ts`](../../src/app/shortcuts.ts)、
  [accessibility](../ui/accessibility.md)）。この表で他製品がそれらのキーを使って
  いても、その規則が優先する。唯一の例外は `Ctrl + F` で、グリッドは画面外の行を
  描画しないためブラウザー検索では見つからないことから、グリッドにフォーカスが
  あるときだけアプリの検索を開く。入力欄やページの他の場所では `Ctrl + F` は
  ブラウザーのままで、`F3` は常にブラウザー検索に届く。
- **IME の安全性：** IME の変換中はどのショートカットも発火しない
  （[editing-and-ime](../ui/editing-and-ime.md)）。日本語配列の記号キーを含む行は、
  この前提の上で検討する。
- **IP リスク方針：** 一般的なキー操作の慣習に合わせることは「近い操作感」として
  検討できる（[IP リスク方針](../decisions/ip-risk-policy.md) §3.1）。ただし、
  この資料を根拠に Excel のリボン、アクセスキー体系、画面、説明文を再現しない。
  ヘルプ本文は引用せず、キーと操作の対応だけを設計用に要約している。ユーザー向けの
  ヘルプや紹介文で「Excel と同じキー操作」と表現しない（同 §3.3、§5）。

## 検証チェックリスト

1. Excel for the web、LibreOffice Calc、Refrain Sheet のそれぞれで、OS、
   ブラウザー、アプリのバージョン、キーボード配列、設定を記録する。
2. セル選択中／編集中、閲覧／編集モード、検索欄の表示中、コピー直後などの状態を
   分けて確認する。
3. `Shift + F3`、`Backspace`、`F9`、シート移動、セル内改行、`Ctrl + O`、日本語
   配列の記号キーを優先して検証する。
4. Refrain Sheet に採用するキーとその理由は、個別の Issue／PR で設計決定として
   記録する（IP リスク方針 §4.1 の項目を含む）。検証前の行を、製品の仕様や
   ユーザー向けヘルプとして流用しない。

## 出典

リンク先は確認日時点のもの。判断に使う前に、最新の内容を確認すること。

- [Microsoft Support（英語）：Keyboard shortcuts in Excel](https://support.microsoft.com/en-us/accessibility/excel/keyboard-shortcuts-in-excel)
  — **Web** セクション。本文の引用ではなく、キーと操作の関係を設計用に要約した。
- [Microsoft Support（日本語）：Excel のキーボード ショートカット](https://support.microsoft.com/ja-jp/accessibility/excel/keyboard-shortcuts-in-excel)
  — 対応する日本語の参照先。
- [LibreOffice Help：Shortcut Keys for Spreadsheets](https://help.libreoffice.org/latest/en-US/text/scalc/04/01020000.html)
  — Calc 固有のキー。
- [LibreOffice Help：General Shortcut Keys in LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/04/01010000.html)
  — コピー・書式・検索などの共通キー。
