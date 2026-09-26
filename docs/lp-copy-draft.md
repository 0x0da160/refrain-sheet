# LP copy draft (JA / EN) / LPコピー案（日英対訳）

**Status: English copy approved by the maintainer (2026-09-26); blocks not yet written are listed in §7. Source for `site/i18n.js` in phase 2; no landing-page code is changed by this document.**

## English (summary)

Japanese and English copy for the renewed landing page, block by block,
following [`lp-renewal-requirements.md`](lp-renewal-requirements.md) §1.1
(messaging) and §4.6 (copy and SEO). The English is written for English
readers, not translated word for word: it keeps the same meaning,
claims and limits, and uses the terms English speakers search with
("CSV editor", "leading zeros", "encoding", "spreadsheet"). Every claim
must match the implementation; exceptions such as Google Drive are
never dropped.

## 日本語

リニューアル後のLPのコピーを、ブロックごとに日英で並べた案です。
[`lp-renewal-requirements.md`](lp-renewal-requirements.md) の §1.1（訴求戦略）と
§4.6（ライティングとSEO）に従います。英語は逐語訳せず、意味・主張・制約を揃えたうえで、
英語で検索される言葉（CSV editor、leading zeros、encoding、spreadsheet）を使います。

### 英語の呼び方

| 日本語        | 英語                      | 理由                                                                                        |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| 表計算ソフト  | spreadsheet (app)         | 英語の "spreadsheet" は特定の製品を指さない一般名詞。"app" はブラウザで動くソフトとして自然 |
| 軽い          | lightweight               | 機能の少なさではなく、軽く速く動くことを表す                                                |
| CSVを壊さない | without breaking / intact | "break" は利用者が実際に使う言い方。技術的な説明では "byte-for-byte identical" を使う       |
| 文字コード    | encoding                  | "character encoding" は長いので、見出しでは "encoding"                                      |

## 1. メタ情報

| キー        | 日本語                                                                                                                                                              | English                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`   | CSVを壊さず編集できる無料の表計算ソフト｜Refrain Sheet                                                                                                              | Free CSV Editor & Lightweight Spreadsheet \| Refrain Sheet                                                                                                                       |
| description | 先頭ゼロ・文字コード・改行コードを変えずにCSVを編集できる、無料の表計算ソフト。数式やフィルタでの集計にも対応。ブラウザで開くだけで、インストールも登録も不要です。 | Edit CSV files without losing leading zeros, encoding or line endings. A free, lightweight spreadsheet with formulas and filters that runs in your browser — nothing to install. |

## 2. ファーストビュー

| 要素        | 日本語                                                                                                                              | English                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 短い説明    | ブラウザで開くだけ。無料・インストール不要                                                                                          | Runs in your browser. Free, nothing to install.                                                                                                           |
| h1          | CSVを壊さず編集できる、軽い表計算ソフト                                                                                             | A lightweight spreadsheet that edits CSV without breaking it                                                                                              |
| 本文        | 先頭の「0」も、文字コードも、改行コードも、開いたときのまま。数式やフィルタを使った集計もできます。データはパソコンの外に出ません。 | Leading zeros, encoding and line endings stay exactly as they were. Sort, filter and total your data with formulas. Your files never leave your computer. |
| 主CTA       | ブラウザで開いてみる                                                                                                                | Open in your browser                                                                                                                                      |
| 副CTA       | オフライン版をダウンロード                                                                                                          | Download the offline version                                                                                                                              |
| バッジ      | Shift_JIS対応／オフラインでも動く／オープンソース（MIT）                                                                            | UTF-8, Shift_JIS & more / Works offline / Open source (MIT)                                                                                               |
| ヘッダーCTA | 無料で開く                                                                                                                          | Open free                                                                                                                                                 |

## 3. 3つの柱

| 日本語（h2 / 本文）                                                                                                                            | English (h2 / body)                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSVを壊さない** — 先頭の「0」も、文字コードも、改行コードも、開いたときのまま。変わるのは、直したセルだけです。                              | **Never breaks your CSV** — Leading zeros, encoding and line endings stay as they were. Only the cells you edit change.                     |
| **表計算ソフトとして使える** — 数式、フィルタ、条件付き書式、複数のシート。よく使う機能に絞った、軽い表計算ソフトです。                        | **A real spreadsheet, kept light** — Formulas, filters, conditional formatting and multiple sheets. Just the features you use most.         |
| **データを外に出さない** — ブラウザの中だけで動くので、ファイルをサーバーに送る必要がありません。1つのHTMLファイルで、オフラインでも使えます。 | **Your data stays with you** — It runs entirely in your browser, so your files never need to be uploaded. One HTML file that works offline. |

## 4. 表計算の機能

| 要素                   | 日本語                                                                                               | English                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| h2                     | 集計も、整理も、見比べも。表計算ソフトとして、ここまでできます。                                     | Total it, tidy it, compare it — all in a lightweight spreadsheet.                                                  |
| 本文                   | 大きな表計算ソフトの代わりではありません。手元のデータを、安全に、手早く扱うための表計算ソフトです。 | It isn't meant to replace a full office suite. It's for working with the data in front of you, safely and quickly. |
| 数式と55の関数         | SUMIFS、XLOOKUP、FILTER、UNIQUE など。シートをまたぐ参照にも対応しています。                         | 55 functions including SUMIFS, XLOOKUP, FILTER and UNIQUE, with references across sheets.                          |
| 並べ替えとフィルタ     | 必要な行だけを絞り込み、見たい順に並べられます。                                                     | Narrow down to the rows you need and put them in the order you want.                                               |
| 入力規則と条件付き書式 | 入力できる値を決めたり、条件に合うセルに色をつけたりできます。                                       | Limit what can be entered, and color the cells that match a rule.                                                  |
| SQLで集計              | 表にSQLで問い合わせて、結果を読み取り専用で表示します。                                              | Query your tables with SQL and see the results in a read-only view.                                                |
| 2つの表の比較          | タブを並べて、どこが違うかを確かめられます。                                                         | Put two tabs side by side and see exactly what differs.                                                            |
| コメントと版の履歴     | セルにメモを残し、前の版を確かめて元に戻せます。                                                     | Leave notes on cells, review earlier versions and restore them.                                                    |
| XLSX・JSONの読み書き   | CSV・JSON・XLSXを読み込み、書き出せます（書き出しは値のみ）。                                        | Import and export CSV, JSON and XLSX (exports contain values only).                                                |
| メモや設定のシート     | Markdown・JSON・YAML・テキストのシートを、同じファイルにまとめられます。                             | Keep Markdown, JSON, YAML and plain-text sheets in the same file.                                                  |

## 5. CSVの保持

| 要素 | 日本語                                                                                                                                                                        | English                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| h2   | CSVを直すのは1セル。変わるのも、その1セルだけ。                                                                                                                               | Edit one cell, and only that cell changes.                                                                                                                                                                      |
| 本文 | 文字化けしない、先頭ゼロが消えない。会計や給与、受発注のシステムに取り込み直すCSVも、開いたときのまま保存します。何も変えずに保存すれば、元のファイルとバイト単位で同じです。 | No garbled text, no lost leading zeros. CSV files headed back into accounting, payroll or ordering systems are saved just as they were opened. Save without editing and you get a byte-for-byte identical file. |
| 表示 | 差分 1セル／先頭ゼロ：そのまま／文字コード：そのまま／改行コード：そのまま                                                                                                    | 1 cell changed / Leading zeros: kept / Encoding: kept / Line endings: kept                                                                                                                                      |

## 6. セキュリティ・オフライン

| 要素                   | 日本語                                                                                                           | English                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| h2                     | 社外秘のデータも、パソコンの外に出さずに。                                                                       | Keep confidential data on your own computer.                                                                         |
| 本文                   | 送信しない、実行しない、隠さない。社内のルールに照らして判断するための材料を、ひとつずつ確かめられます。         | Nothing uploaded, nothing executed, nothing hidden. Everything you need to check it against your company's policies. |
| サーバーに送信しない   | 開いたファイルは、ブラウザの中だけで処理します。Google ドライブ連携を使う場合を除き、外部には送信しません。      | Files are processed inside your browser. Nothing is sent anywhere unless you choose to use Google Drive.             |
| スクリプトを実行しない | セルの内容は、常に文字として表示します。ファイルにHTMLやスクリプトが紛れ込んでいても、動き出すことはありません。 | Cell contents are always shown as plain text. HTML or scripts hidden in a file never run.                            |
| ソースコードを公開     | オープンソース（MIT ライセンス）なので、誰でも中身を確認できます。1つのHTMLファイルとして配布しています。        | Open source under the MIT license, so anyone can inspect it. Distributed as a single HTML file.                      |

## 7. 未作成のブロック

用途別の事例、比較・FAQ、最後のCTA（3ステップ）は、モックアップを作るときに同じ形式で追加する。
FAQ は §4.6 に従い、実際に検索される質問の形で書く。
