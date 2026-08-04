// SPDX-License-Identifier: MIT
// Build-time copy dictionary, read by scripts/build-landing.mjs. Not loaded
// by the browser — the pre-rendered pages carry the text already.
export const I18N = {
  ja: {
    'meta.title': 'Refrain Sheet — CSVを壊さない、書式保持のブラウザCSVエディタ',
    'meta.desc':
      'Shift_JIS / CP932・BOM・改行・引用符をバイト単位で保持する、ローカル完結の書式保持CSVエディタ。数式・書式設定はRSFスプレッドシートで。無編集保存は元ファイルとバイト単位で完全一致。インストール不要・通信ゼロ・MIT。',

    'hero.sub': 'Shift_JIS対応・ブラウザ完結の書式保持CSVエディタ',
    'a11y.skip': '本文へスキップ',
    'hero.alt': 'Refrain Sheet の画面。Shift_JIS のCSVを開き、編集したセルだけが黄色く表示されている',
    'f1.alt': '「オプションを指定して保存」ダイアログ。文字コード・BOM・改行コードを選択できる',
    'f2.alt':
      'CSV検証結果ダイアログ。閉じ引用符の後の不正なテキストやフィールド数の不一致が行・列つきで一覧表示されている',
    'f3.alt':
      'ファイルメニューを開いた画面。新規スプレッドシート、文字コードを指定して開き直す、オプションを指定して保存などの項目が並ぶ',
    'theme.alt': '英語UI・ダークテーマで同じCSVを開いた Refrain Sheet の画面',

    'nav.principle': 'Refrain原則',
    'nav.features': '機能',
    'nav.rsf': 'スプレッドシート',
    'nav.compare': '比較',
    'nav.start': '使いはじめる',
    'nav.cta': 'アプリを開く',

    'hero.eyebrow': 'LOCAL-FIRST CSV EDITOR',
    'hero.h1': 'CSVを、勝手に書き換えない。',
    'hero.lede':
      'Refrain Sheet は、ブラウザだけで動く書式保持CSV・スプレッドシートエディタです。編集するのはセルの値だけ。区切り文字、引用符、前後の空白、改行コード、文字コード、BOM、デコードできないバイト、そして壊れたCSVの領域まで、そのまま残します。',
    'hero.cta1': 'ブラウザで開く（インストール不要）',
    'hero.cta2': 'GitHub リポジトリ',
    'hero.note': '無編集で保存すれば、出力は元ファイルとバイト単位で完全一致。',
    'hero.badge1': '完全オフライン',
    'hero.badge2': 'サーバー・アカウント不要',
    'hero.badge3': 'Shift_JIS / CP932 対応',
    'hero.badge4': 'MITライセンス',
    'hero.cap':
      'Shift_JIS の売上台帳を開いたところ。編集したセルだけが黄色く色づき、ステータスバーが文字コード・区切り文字・改行コードを常に表示します。',

    'stat1.k': '0 bytes',
    'stat1.v': '無編集保存での差分。元のバイト列をそのまま書き戻します',
    'stat2.k': '0 requests',
    'stat2.v': '実行時のネットワーク通信。CDNもテレメトリもありません',
    'stat3.k': '55 functions',
    'stat3.v': 'RSFスプレッドシートで使える関数（XLOOKUP・FILTER ほか）',
    'stat4.k': '1 dependency',
    'stat4.v': '本番依存パッケージは1つだけ（推移的依存ゼロ）',

    'why.eyebrow': 'THE PROBLEM',
    'why.h2': '「開いて保存しただけ」で壊れるCSV。',
    'why.p':
      '一般的な表計算ソフトでCSVを開くと、文字コードが変わり、引用符が付き外れし、改行コードが統一され、先頭ゼロや日付が別物になります。差分は本来1セルのはずが、ファイル全体に広がる。Refrain Sheet はその逆をやります。',
    'never.title': '通常保存で「絶対にやらないこと」',
    'never.1': '改行コードや区切り文字を統一する',
    'never.2': 'ヘッダーのレイアウトを変える',
    'never.3': '空白を足す・削る',
    'never.4': '不要な引用符を足す・外す',
    'never.5': 'BOMを足す・外す',
    'never.6': '壊れたCSVを勝手に修復する',
    'never.7': '未編集フィールドのデコード不能バイトを置き換える',

    'diff.h3': '編集は、そのフィールドのバイト範囲だけ',
    'diff.p':
      '1セルを書き換えても、再シリアライズされるのはその1フィールドだけ。ほかのバイトは一切動きません。引用されていたフィールドは引用されたまま、必要になったときだけ引用符が付きます。',
    'diff.file': 'sales.csv — Shift_JIS / CRLF',
    'diff.label_before': '編集前',
    'diff.label_after': '編集後',
    'diff.result': '書き換わるのは編集したフィールドのバイト範囲だけ。他は完全一致',

    'features.eyebrow': 'FEATURES',
    'features.h2': '日本の現場のCSVに、ちゃんと向き合う。',
    'features.lede':
      '文字コードの自動判定から、壊れたCSVの診断、IME入力の安全性まで。実務でCSVを触る人が困るところを、ひとつずつ潰しています。',

    'f1.h3': '文字コードと保存オプション',
    'f1.p':
      'UTF-8（BOM有無）、Shift_JIS / CP932、EUC-JP に対応。自動判定に加えて「文字コードを指定して開き直す」もでき、開き直しても元バイトは変化しません。保存時は文字コード・BOM・改行コードを個別に選べます。',
    'f1.li1': 'CP932で表現できない文字は既定で保存を中止し、影響セルを報告',
    'f1.li2': '改行コードの変換は行終端だけを書き換え、末尾の改行を勝手に足さない',
    'f1.li3': 'ステータスバーに文字コード・区切り文字・改行コード・サイズを常時表示',
    'f1.cap': 'オプションを指定して保存。CSVインジェクションの注意も明示されます。',

    'f2.h3': '壊れたCSVも、直さずに開く',
    'f2.p':
      '閉じられていない引用符、引用符の後の余分なテキスト、フィールド数の不一致——問題は行・列つきの一覧で提示されます。自動修復も正規化も行いません。「このまま開く」を選べば、不正な領域は編集しない限りバイト単位で保持されます。',
    'f2.cap': 'CSV検証結果ダイアログ。何が起きているかを説明し、判断はユーザーに委ねます。',

    'f3.h3': 'メニュー優先のUIと、日本語入力の安全性',
    'f3.p':
      'デスクトップアプリのようなメニューバーがコマンドの唯一の一覧。すべての操作はキーボードからも届きます。日本語入力は最初の一打鍵から安全で、ローマ字の1文字目が英字として漏れることはありません。',
    'f3.li1': '変換中は Enter / Esc / 矢印キーがIMEのもの。確定してから初めてセルに届く',
    'f3.li2': 'Ctrl+W・Ctrl+F・Ctrl+T などブラウザ標準のキーは奪わない',
    'f3.li3': 'Alt+Enter でセル内改行、複数行の値もCSV・RSF・コピペを往復',
    'f3.cap': 'ファイルメニュー。ショートカットは補助であり、すべてメニューから実行できます。',

    'f4.h3': 'スプレッドシートが必要なときは RSF',
    'f4.p':
      '数式・行列の挿入・メタデータはプレーンCSVでは表現できません。だから別形式（.rsf）に明示的に変換したときだけ有効になります。元の .csv は指一本触れません。',
    'f4.li1': '55関数：SUM・XLOOKUP・SUMIFS・TEXT・FILTER・UNIQUE ほか',
    'f4.li2': '複数ワークシート、シート間参照、絶対／相対参照、循環参照の検出',
    'f4.li3': 'フィルタと最大8階層の複数キー並べ替え。表示順が変わるだけで、データや数式は書き換わりません',
    'f4.li4': '数式エンジンは自作パーサ。eval も new Function も使いません',
    'f4.li5': '太字・斜体・下線・文字色・背景色・罫線。セルの値や数式には影響せず、Undoでき、.rsf に保存されます',
    'f4.li6': 'オートフィット、選択範囲の統計、CSV / XLSX エクスポート',

    'theme.eyebrow': 'DETAILS',
    'theme.h2': '英語UIとダークテーマも、標準装備。',
    'theme.p':
      '日本語と英語はどちらも第一級のUI言語です。テーマはシステム設定に追従し、ライト／ダークを明示指定することもできます。表示の変更がCSVのバイトやRSFのデータを書き換えることは決してありません。',
    'theme.cap': '英語UI × ダークテーマ。同じファイル、同じバイト。',

    'cmp.eyebrow': 'COMPARISON',
    'cmp.h2': '一般的な表計算ソフトとの違い。',
    'cmp.lede':
      'Refrain Sheet は Excel の置き換えではありません。「CSVというファイルそのものを壊さずに直す」ための道具です。',
    'cmp.col1': 'Excel / 一般的な表計算ソフト',
    'cmp.col2': 'オンラインCSVエディタ',
    'cmp.col3': 'Refrain Sheet',
    'cmp.r1': '無編集で開いて保存',
    'cmp.r1a': '文字コード・引用符・改行が書き換わることがある',
    'cmp.r1b': '多くは再シリアライズされる',
    'cmp.r1c': 'バイト単位で完全一致',
    'cmp.r2': '1セルだけの編集',
    'cmp.r2a': 'ファイル全体が再出力される',
    'cmp.r2b': 'ファイル全体が再出力される',
    'cmp.r2c': 'そのフィールドのバイト範囲だけ',
    'cmp.r3': 'Shift_JIS / CP932',
    'cmp.r3a': '環境依存。文字化けや自動変換が起きやすい',
    'cmp.r3b': '非対応のものが多い',
    'cmp.r3c': '自動判定＋開き直し＋保存時に選択可',
    'cmp.r4': '壊れたCSV',
    'cmp.r4a': '黙って修復・正規化される',
    'cmp.r4b': '読み込みエラーになりやすい',
    'cmp.r4c': '診断を提示し、保持したまま開く',
    'cmp.r5': '先頭ゼロ・日付・長い数値',
    'cmp.r5a': '型推論で勝手に変換されることがある',
    'cmp.r5b': '実装により異なる',
    'cmp.r5c': '値は文字列として保持。推論による書き換えなし',
    'cmp.r6': 'データの送信先',
    'cmp.r6a': 'ローカル（クラウド版はサーバー）',
    'cmp.r6b': 'サーバーへアップロード',
    'cmp.r6c': 'どこにも送信しない（通信ゼロ）',
    'cmp.r7': '導入',
    'cmp.r7a': 'ライセンス・インストールが必要',
    'cmp.r7b': 'アカウント登録が必要な場合も',
    'cmp.r7c': 'HTMLファイル1つ。file:// でも動く',
    'cmp.note':
      '※ 比較は一般的な利用シーンでの傾向をまとめたものです。Refrain Sheet の挙動はリポジトリのREADMEおよびテストで定義されています。',

    'sec.eyebrow': 'SECURITY',
    'sec.h2': '外に出ていかない、という設計。',
    'sec.lede': '機密を含むCSVを扱う前提で作られています。実行時のネットワーク接続は一切ありません。',
    'sec.c1h': '通信ゼロ',
    'sec.c1p':
      "CSPで default-src 'none' / connect-src 'none' を指定。CDN・外部フォント・API・アナリティクス・テレメトリのいずれもありません。",
    'sec.c2h': 'コードを実行しない',
    'sec.c2p':
      'セル内容はHTMLとして解釈されず、innerHTML・eval・new Function・マクロは一切使用しません。数式は専用エンジンで評価されます。',
    'sec.c3h': 'サプライチェーン対策',
    'sec.c3p':
      '本番依存は1パッケージのみ、lockfile固定、install スクリプト無効化。リリースにはSHA-256・SBOM・ビルド来歴の署名が付きます。',

    'start.eyebrow': 'GET STARTED',
    'start.h2': '3ステップで使いはじめる。',
    'start.s1h': 'ブラウザで開く',
    'start.s1p': '公開中のWebアプリをそのまま開くだけ。インストールもアカウント登録も不要です。',
    'start.s2h': 'CSVをドラッグ＆ドロップ',
    'start.s2p': 'ウィンドウのどこにドロップしてもOK。ファイルごとにタブが開きます。',
    'start.s3h': 'オフラインで使う',
    'start.s3p': 'リリースZIPを展開し、index.html をダブルクリック。file:// でも完全に動作します。',
    'start.cta': 'アプリを開く',
    'start.cta2': 'リリース一覧',

    'faq.h2': 'よくある質問',
    'faq.q1': 'アップロードしたデータはどこに送られますか？',
    'faq.a1':
      'どこにも送られません。ファイルはブラウザ内で読み込まれ、保存もお使いの端末に対して行われます。実行時のネットワーク接続はCSPレベルで禁止されています。',
    'faq.q2': 'Excelの代わりになりますか？',
    'faq.a2':
      '目的が違います。Refrain Sheet はCSVを壊さずに直すためのエディタで、数式や行列の挿入が必要なときは明示的に .rsf スプレッドシートへ変換します。Excel互換を保証するものではありません。',
    'faq.q3': '大きなファイルも開けますか？',
    'faq.a3':
      '既定の上限は512MiB（設定で16MiB〜2GiBに変更可）で、上限を超えるファイルは読み込む前に拒否されます。表示は仮想化されていますが、数百MB級のファイルは描画・編集が重くなることがあります。',
    'faq.q4': '対応していない文字コードはありますか？',
    'faq.a4':
      '現行リリースでは UTF-16 と ISO-2022-JP に対応していません。該当しそうなファイルは警告が出たうえで、ベストエフォートで開かれます（バイトは変更されません）。',
    'faq.q5': 'オーバーライト保存は必ずできますか？',
    'faq.a5':
      'Chromium系ブラウザでは File System Access API により元ファイルへ直接上書きできます。Firefox・Safari などではダウンロード保存にフォールバックし、その旨が通知されます。',
    'faq.q6': 'セルの書式設定（太字・色・罫線など）はCSVのバイトを変えますか？',
    'faq.a6':
      '変えません。書式設定はRSFスプレッドシート専用の見た目だけの機能で、セルの値・数式の結果・並べ替えやフィルタの動作・CSVエクスポートのいずれも変更しません。プレーンCSVのままでは書式設定自体を使えません。',

    'cta.h2': 'まずは手元のCSVを、1つ開いてみてください。',
    'cta.p': 'インストール不要。数秒で、保存しても差分が出ないことを確認できます。',
    'cta.b1': 'アプリを開く',
    'cta.b2': 'GitHubで見る',

    'footer.tagline': 'ローカルで動く、書式保持CSV・スプレッドシートエディタ',
    'footer.l1': 'Webアプリ',
    'footer.l2': 'GitHub',
    'footer.l3': 'リリース',
    'footer.l4': 'ドキュメント',
    'footer.note': 'MIT License · Refrain Sheet 公式の紹介ページです',
  },

  en: {
    'meta.title': 'Refrain Sheet — byte-preserving CSV editor for the browser',
    'meta.desc':
      'A local-first, format-preserving CSV editor. Encodings, BOMs, line endings and quoting stay byte-for-byte intact; convert to RSF for formulas, sorting and formatting.',

    'hero.sub': 'Browser-only, format-preserving CSV editor with Shift_JIS support',
    'a11y.skip': 'Skip to main content',
    'hero.alt': 'Refrain Sheet showing a Shift_JIS CSV file with only the edited cell highlighted in amber',
    'f1.alt': 'The Save with Options dialog, offering character encoding, BOM and line-ending choices',
    'f2.alt':
      'The CSV validation dialog listing unbalanced quotes and field-count mismatches with row and column numbers',
    'f3.alt': 'The File menu open, showing New spreadsheet, Reopen with encoding and Save with options',
    'theme.alt': 'Refrain Sheet with the English UI and dark theme, showing the same CSV file',

    'nav.principle': 'The principle',
    'nav.features': 'Features',
    'nav.rsf': 'Spreadsheet',
    'nav.compare': 'Compare',
    'nav.start': 'Get started',
    'nav.cta': 'Open the app',

    'hero.eyebrow': 'LOCAL-FIRST CSV EDITOR',
    'hero.h1': 'Edit the values. Leave the file alone.',
    'hero.lede':
      'Refrain Sheet is a format-preserving CSV and spreadsheet editor that runs entirely in your browser. You edit field values; delimiters, quoting, surrounding whitespace, line endings, encodings, BOMs, undecodable bytes and malformed regions all stay exactly as they were.',
    'hero.cta1': 'Open the web app — no install',
    'hero.cta2': 'GitHub repository',
    'hero.note': 'Open and save with no edits, and the output is byte-for-byte identical.',
    'hero.badge1': 'Fully offline',
    'hero.badge2': 'No server, no account',
    'hero.badge3': 'Shift_JIS / CP932 ready',
    'hero.badge4': 'MIT licensed',
    'hero.cap':
      'A Shift_JIS ledger opened in the app. Only the edited cell is tinted, and the status bar always reports encoding, delimiter and line endings.',

    'stat1.k': '0 bytes',
    'stat1.v': 'changed on an unedited save — the original bytes are written back',
    'stat2.k': '0 requests',
    'stat2.v': 'at runtime. No CDN, no analytics, no telemetry',
    'stat3.k': '55 functions',
    'stat3.v': 'in RSF spreadsheets, including XLOOKUP, SUMIFS and FILTER',
    'stat4.k': '1 dependency',
    'stat4.v': 'in production, with zero transitive dependencies',

    'why.eyebrow': 'THE PROBLEM',
    'why.h2': 'Most editors damage a CSV just by opening it.',
    'why.p':
      'Open a CSV in a normal spreadsheet app and the encoding shifts, quotes appear and disappear, line endings get unified, leading zeros and dates turn into something else. A one-cell change becomes a whole-file diff. Refrain Sheet does the opposite.',
    'never.title': 'What a normal save never does',
    'never.1': 'unify line-ending styles or delimiters',
    'never.2': 'alter the header layout',
    'never.3': 'add or remove whitespace',
    'never.4': 'add or remove quotes unnecessarily',
    'never.5': 'add or remove BOMs',
    'never.6': 'repair malformed CSV',
    'never.7': 'replace undecodable bytes in unmodified fields',

    'diff.h3': "An edit touches one field's byte range",
    'diff.p':
      'Change a cell and only that field is reserialized. Every other byte is left alone. A quoted field stays quoted, and an unquoted one gains quotes only when the new value truly needs them.',
    'diff.file': 'sales.csv — Shift_JIS / CRLF',
    'diff.label_before': 'before',
    'diff.label_after': 'after',
    'diff.result': "Only the edited field's byte range is rewritten — the rest is identical",

    'features.eyebrow': 'FEATURES',
    'features.h2': 'Built for the messy CSVs people actually get.',
    'features.lede':
      'Encoding detection, honest diagnostics for malformed files, IME-safe editing — the parts that usually go wrong, handled deliberately.',

    'f1.h3': 'Encodings and save options',
    'f1.p':
      'UTF-8 (with or without BOM), Shift_JIS / CP932 and EUC-JP are supported, detected automatically, and reinterpretable at any time via Reopen with Encoding — which never alters the original bytes. On save you choose encoding, BOM and line endings independently.',
    'f1.li1':
      "Characters the target encoding can't represent cancel the save by default, with a per-cell report",
    'f1.li2': 'Line-ending conversion rewrites terminators only — a missing final newline is never added',
    'f1.li3': 'The status bar always shows encoding, delimiter, line endings and file size',
    'f1.cap': 'Save with Options, including an explicit CSV-injection warning.',

    'f2.h3': 'Malformed CSV opens — unrepaired',
    'f2.p':
      "Unclosed quotes, invalid text after a closing quote, inconsistent field counts — every problem is listed with its row, column and a plain explanation. Nothing is normalized. Choose Open Anyway and malformed regions are preserved byte-for-byte as long as you don't edit them.",
    'f2.cap': 'The CSV Validation Results dialog explains the damage and leaves the decision to you.',

    'f3.h3': 'Menu-first UI, IME-safe editing',
    'f3.p':
      'A desktop-style menu bar is the single visible set of commands, and every one of them is reachable from the keyboard. Japanese and CJK input is safe from the very first keystroke — the first Romaji character joins the composition instead of leaking as a Latin letter.',
    'f3.li1': 'While composing, Enter / Esc / arrows belong to the IME, never to the cell',
    'f3.li2': 'Browser-reserved keys (Ctrl+W, Ctrl+F, Ctrl+T, reload, zoom) are never intercepted',
    'f3.li3':
      'Alt+Enter inserts a line break; multi-line values round-trip through CSV, RSF and the clipboard',
    'f3.cap': 'The File menu. Shortcuts are accelerators only — nothing depends on them.',

    'f4.h3': "When you need a spreadsheet, there's RSF",
    'f4.p':
      "Plain CSV can't hold formulas, structural edits or metadata without breaking the guarantee. So those live in a separate .rsf document, created only by an explicit conversion that never touches the original .csv.",
    'f4.li1': '55 functions: SUM, XLOOKUP, SUMIFS, TEXT, FILTER, UNIQUE and more',
    'f4.li2': 'Multiple worksheets, cross-sheet references, absolute/relative refs, cycle detection',
    'f4.li3':
      'Filtering and a compound sort with up to 8 keys — reorders the view only, never the data or formulas',
    'f4.li4': 'A hand-written formula engine — no eval, no new Function, no macros',
    'f4.li5':
      "Bold, italic, underline, text/background color and borders. Never touches a cell's value or formula results, is undoable, and is saved in the .rsf file",
    'f4.li6': 'Auto-fit, selection statistics, CSV and XLSX export',

    'theme.eyebrow': 'DETAILS',
    'theme.h2': 'English UI and dark theme, built in.',
    'theme.p':
      'Japanese and English are both first-class UI languages. The theme follows your system by default and can be pinned to light or dark. Display state never changes CSV bytes, RSF data or formula results.',
    'theme.cap': 'English UI, dark theme. Same file, same bytes.',

    'cmp.eyebrow': 'COMPARISON',
    'cmp.h2': 'How it differs from a normal spreadsheet app.',
    'cmp.lede':
      'Refrain Sheet is not an Excel replacement. It is a tool for fixing a CSV without damaging the file it lives in.',
    'cmp.col1': 'Excel / typical spreadsheet apps',
    'cmp.col2': 'Online CSV editors',
    'cmp.col3': 'Refrain Sheet',
    'cmp.r1': 'Open and save, no edits',
    'cmp.r1a': 'Encoding, quoting and line endings may all change',
    'cmp.r1b': 'Usually reserialized in full',
    'cmp.r1c': 'Byte-for-byte identical',
    'cmp.r2': 'Editing a single cell',
    'cmp.r2a': 'The whole file is rewritten',
    'cmp.r2b': 'The whole file is rewritten',
    'cmp.r2c': "Only that field's byte range",
    'cmp.r3': 'Shift_JIS / CP932',
    'cmp.r3a': 'Environment-dependent; mojibake and silent conversion are common',
    'cmp.r3b': 'Often unsupported',
    'cmp.r3c': 'Detected, reinterpretable, and selectable on save',
    'cmp.r4': 'Malformed CSV',
    'cmp.r4a': 'Silently repaired and normalized',
    'cmp.r4b': 'Frequently fails to load',
    'cmp.r4c': 'Diagnosed, then opened with the damage preserved',
    'cmp.r5': 'Leading zeros, dates, long numbers',
    'cmp.r5a': 'Type inference can rewrite them',
    'cmp.r5b': 'Varies by implementation',
    'cmp.r5c': 'Values stay as written — no inference',
    'cmp.r6': 'Where your data goes',
    'cmp.r6a': 'Local (server for cloud editions)',
    'cmp.r6b': 'Uploaded to a server',
    'cmp.r6c': 'Nowhere. Zero network access',
    'cmp.r7': 'Setup',
    'cmp.r7a': 'License and installation',
    'cmp.r7b': 'Sometimes an account',
    'cmp.r7c': 'One HTML file — works over file://',
    'cmp.note':
      "Comparisons describe typical behaviour in common setups. Refrain Sheet's own guarantees are defined by its README and test suite.",

    'sec.eyebrow': 'SECURITY',
    'sec.h2': 'Designed so nothing leaves the page.',
    'sec.lede':
      'Built on the assumption that your CSV is confidential. There are no runtime network connections at all.',
    'sec.c1h': 'Zero network access',
    'sec.c1p':
      "The CSP sets default-src 'none' and connect-src 'none'. No CDN, external fonts, APIs, analytics or telemetry.",
    'sec.c2h': 'Nothing is executed',
    'sec.c2p':
      'Cell content is never interpreted as HTML; there is no innerHTML, eval, new Function or macro anywhere. Formulas run in a sandboxed engine.',
    'sec.c3h': 'Supply chain discipline',
    'sec.c3p':
      'One production dependency, enforced lockfiles, install scripts disabled, and releases shipped with SHA-256 checksums, an SBOM and signed build provenance.',

    'start.eyebrow': 'GET STARTED',
    'start.h2': 'Three steps.',
    'start.s1h': 'Open it in a browser',
    'start.s1p': 'Just open the hosted web app. No installation, no account, no setup.',
    'start.s2h': 'Drag and drop a CSV',
    'start.s2p': 'Drop files anywhere in the window; each one opens in its own tab.',
    'start.s3h': 'Or run it offline',
    'start.s3p': 'Download a release ZIP, extract it, and double-click index.html. It works over file://.',
    'start.cta': 'Open the app',
    'start.cta2': 'All releases',

    'faq.h2': 'Questions',
    'faq.q1': 'Where does my data go?',
    'faq.a1':
      'Nowhere. Files are read inside the browser and saved back to your own device. Runtime network access is blocked at the CSP level.',
    'faq.q2': 'Is this an Excel replacement?',
    'faq.a2':
      'No — different purpose. Refrain Sheet fixes CSV files without damaging them; formulas and structural edits require an explicit conversion to an .rsf spreadsheet. Excel compatibility is not claimed.',
    'faq.q3': 'How large a file can it open?',
    'faq.a3':
      'The default limit is 512 MiB (adjustable from 16 MiB to 2 GiB) and oversized files are refused before their bytes are read. Rendering is virtualized, but hundred-megabyte files can still feel slow.',
    'faq.q4': 'Which encodings are unsupported?',
    'faq.a4':
      'UTF-16 and ISO-2022-JP are not supported in this release. Such files still open with a best-effort interpretation and a warning, and their bytes remain untouched.',
    'faq.q5': 'Can it always overwrite the original file?',
    'faq.a5':
      'In Chromium-based browsers, yes, via the File System Access API. Firefox and Safari fall back to a download save, and the app tells you which kind of save happened.',
    'faq.q6': 'Does cell formatting (bold, color, borders) change the CSV bytes?',
    'faq.a6':
      "No. Formatting is a purely visual, RSF-only feature — it never changes a cell's value, formula results, sort/filter behavior, or CSV export. Plain CSV documents cannot use formatting at all.",

    'cta.h2': 'Open one of your own CSVs.',
    'cta.p': 'No install. In a few seconds you can confirm that saving produces no diff at all.',
    'cta.b1': 'Open the app',
    'cta.b2': 'View on GitHub',

    'footer.tagline': 'A local-first, format-preserving CSV and spreadsheet editor',
    'footer.l1': 'Web app',
    'footer.l2': 'GitHub',
    'footer.l3': 'Releases',
    'footer.l4': 'Docs',
    'footer.note': 'MIT License · The official introduction page for Refrain Sheet',
  },
};
