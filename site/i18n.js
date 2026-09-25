// SPDX-License-Identifier: MIT
// Build-time copy dictionary, read by scripts/build-landing.mjs. Not loaded
// by the browser — the pre-rendered pages carry the text already.
export const I18N = {
  ja: {
    'meta.title': 'CSVを壊さず編集する無料エディタ｜Shift_JIS・先頭ゼロ・改行コードを保持｜Refrain Sheet',
    'meta.desc':
      'Excelで開くと変わる先頭ゼロ、文字コード、日付、引用符、BOM、改行コードを保持してCSVを編集。無編集保存は元ファイルとバイト単位で一致。ブラウザ内でローカル処理、インストール・アカウント登録不要。',

    'hero.sub': 'Shift_JIS / CP932対応。再インポート前のCSVを安全に修正する、ブラウザ完結のCSVエディタ。',
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
    'hero.h1': 'CSVを壊さず編集。先頭ゼロ・文字コード・改行コードをそのまま保つ。',
    'hero.lede':
      '会計・給与・勤怠・受発注・EC・基幹システムから出力したCSVを、Excelの自動変換なしで修正。Refrain Sheet は、変更したフィールド以外のバイトを保持して保存します。',
    'hero.forwhom':
      '取引先指定のCSV、インポート用テンプレート、商品・従業員マスタを「見た目だけでなく、データファイルとして」壊さず直したい方へ。',
    'hero.cta1': 'CSVをブラウザで開く（無料・インストール不要）',
    'hero.cta2': 'GitHubで仕様とソースを見る',
    'hero.note':
      'CSVの読み込み・編集・保存はブラウザ内で行われ、アプリ本体がファイルを外部のサーバーへ送信することはありません（Google Drive連携を使う場合を除く）。',
    'hero.badge1': '無編集保存：元ファイルとバイト単位で一致',
    'hero.badge2': 'CSV編集はローカル処理',
    'hero.badge3': 'Shift_JIS / CP932対応',
    'hero.badge4': 'インストール・アカウント不要',
    'hero.cap':
      'Shift_JIS の売上台帳を開いたところ。編集したセルだけが黄色く色づき、ステータスバーが文字コード・区切り文字・改行コードを常に表示します。',

    'stat1.k': '0 bytes',
    'stat1.v': '無編集保存での差分。元のバイト列をそのまま書き戻します',
    'stat2.k': '1 field',
    'stat2.v': '1セル編集時に再シリアライズされる範囲。ほかのバイトは動きません',
    'stat3.k': '0 requests',
    'stat3.v':
      'CSVの読み込み・編集・保存で発生する通信。CDNもテレメトリもありません（Google Drive連携の利用時を除く）',

    'why.eyebrow': 'THE PROBLEM',
    'why.h2': 'CSVは「表」ではなく、次のシステムへ渡すデータです。',
    'why.p':
      '表計算ソフトは、値を計算や表示に都合のよい形へ解釈します。そのため、郵便番号・社員番号・商品コード・口座番号の先頭ゼロが落ちる、「1-2」や「2024-01-01」が日付に変わる、16桁以上の番号の下位桁が失われる、文字コード（UTF-8とShift_JIS / CP932）の取り違えで文字化けする、引用符・カンマ・改行・BOM・空欄や「HH:mm」形式の時刻が変わる、といったことが起こり得ます。画面上は同じに見えても、次のシステムへ再インポートしたときのエラーや取り込み違いにつながります。',
    'never.title': '通常保存で勝手に変えないこと',
    'never.1': '改行コード（CRLF / LF）と区切り文字：混在していても統一しません',
    'never.2': 'ヘッダー行：レイアウトを整形しません',
    'never.3': 'セル前後の空白：足しも削りもしません',
    'never.4': '引用符（"）：不要な付け外しをしません',
    'never.5': 'BOM（ファイル先頭の文字コード識別子）：付け外ししません',
    'never.6': '壊れたCSV：勝手に修復・正規化しません',
    'never.7': '未編集フィールドのデコードできないバイト（文字化けして見える部分）：置き換えません',

    'diff.h3': '直すのは1セル。変えてよいのも、その1セルだけ。',
    'diff.p':
      '備考だけを修正しても、ほかの列や改行、引用符まで作り直しません。正確には、編集したフィールドのバイト範囲だけを再シリアライズし、未編集部分のバイトはそのまま保持します。引用されていたフィールドは引用されたまま、新しい値に必要なときだけ引用符が付きます。',
    'diff.file': 'sales.csv — Shift_JIS / CRLF',
    'diff.label_before': '編集前',
    'diff.label_after': '編集後',
    'diff.result': '書き換わるのは編集したフィールドのバイト範囲だけ。他は完全一致',

    'use.eyebrow': 'USE CASES',
    'use.h2': '再インポート前のCSVを、安心して直すために。',
    'use.lede': '業務システムの間を行き来するCSVの、よくある修正場面です。',
    'use.c1h': '会計・税務の仕訳・提出用CSV',
    'use.c1p':
      '指定された列構成や空欄、科目などのコード、Shift_JISの文字コードを保ったまま、修正した箇所だけを変更します。',
    'use.c2h': '人事・給与・勤怠の従業員CSV',
    'use.c2p':
      '社員番号・郵便番号・口座番号の先頭ゼロや「HH:mm」形式の時刻を、数値や時刻に変換せず文字列のまま扱います。',
    'use.c3h': '受発注・在庫・商品マスタCSV',
    'use.c3p':
      '商品コードやJANコード、備考を直しても、取引先指定の列順・区切り文字・引用ルールはそのまま維持します。',
    'use.c4h': '基幹システムと現場ツールの間のCSV',
    'use.c4p':
      'API連携の有無にかかわらず残る、CSV受け渡しの小さな修正作業に。直した箇所以外は元のファイルのまま渡せます。',
    'use.c5h': '原因の調査・診断が必要なCSV',
    'use.c5p': 'フィールド数の不一致や閉じていない引用符を、勝手に直さず行・列つきで確認できます。',

    'features.eyebrow': 'FEATURES',
    'features.h2': '壊さないために、勝手に推測しない。',
    'features.lede':
      '「数値に見えるから数値にする」「崩れているから直す」といった推測をせず、ファイルの状態を示して判断をユーザーに委ねます。文字コードの確認から壊れたCSVの診断、日本語入力まで、実務でCSVを扱うときにつまずきやすい点に対応しています。',

    'f1.h3': '文字コード・BOM・改行コードを確認して保存',
    'f1.p':
      'UTF-8（BOMあり／なし）、Shift_JIS / CP932、EUC-JP に対応。自動判定に加えて文字コードを指定して開き直すこともでき、開き直しても元のバイトは変わりません。保存時は文字コード・BOM・改行コードを個別に選べるので、意図して変えたいときだけ反映できます。',
    'f1.li1': 'CP932で表現できない文字があると既定で保存を中止し、影響するセルを知らせる',
    'f1.li2': '改行コードの変換は行終端だけを書き換え、末尾の改行を勝手に足さない',
    'f1.li3': 'ステータスバーに文字コード・区切り文字・改行コード・サイズを常時表示',
    'f1.cap': 'オプションを指定して保存。CSVインジェクションの注意も明示されます。',

    'f2.h3': '壊れたCSVも、自動修復せずに診断',
    'f2.p':
      '閉じていない引用符、引用符の後の余分なテキスト、フィールド数の不一致を、行・列つきの一覧で示します。自動修復も正規化も行いません。開くかどうかはユーザーが判断でき、「このまま開く」を選べば、不正な箇所は編集しない限りバイト単位で保持されます。',
    'f2.cap': 'CSV検証結果ダイアログ。何が起きているかを説明し、判断はユーザーに委ねます。',

    'f3.h3': '日本語入力と、デスクトップアプリに近い操作',
    'f3.p':
      'メニューバーからすべてのコマンドを実行でき、同じ操作にキーボードからも届きます。日本語入力は最初の1打鍵から扱えるので、ローマ字の1文字目が英字としてセルに入ることはありません。',
    'f3.li1': '変換中は Enter / Esc / 矢印キーがIMEのもの。確定してから初めてセルに届く',
    'f3.li2': 'Ctrl+W・Ctrl+T などブラウザ標準のキーは奪わない（Ctrl+F は表の操作中だけアプリ内検索）',
    'f3.li3': 'Alt+Enter でセル内改行、複数行の値もCSV・RSF・コピペを往復',
    'f3.cap': 'ファイルメニュー。ショートカットは補助であり、すべてメニューから実行できます。',
    'f8.h3': '先頭ゼロ・日付・長い番号を型推論で変えない',
    'f8.p':
      'CSVの値は書かれた文字列のまま扱います。「0123」は「0123」のまま、「2024-01-01」や16桁以上の番号も、数値や日付に変換して書き戻すことはありません。',

    'f5.h3': 'Google Drive連携は、使うときだけ',
    'f5.p':
      'ホスト版アプリで「ドライブから開く」「ドライブに保存」を選んだときだけ、Googleへのサインインと Google Drive API との通信が発生します。アクセス範囲は開いた・作成したファイルに限られ（drive.file スコープ）、アクセストークンはブラウザのメモリ上にのみ保持されます。ファイルは運営者のサーバーを経由せず、ブラウザとGoogle Driveの間で直接やり取りされます。配布版にはこの機能はありません。',
    'f6.h3': '読み取り専用から始める保護モード',
    'f6.p':
      '既存のファイルは既定で読み取り専用で開きます。編集するときは、ステータスバーのアイコンか ファイル > ドキュメント > ブックの保護を解除 で切り替えます。この設定はタブごと・セッション限りで、ファイルには保存されません。',
    'f7.h3': 'ほかにも：Markdownシート',
    'f7.p':
      'RSFのブックに Markdown シートを追加し、ソースとプレビューを並べてメモや手順書を書けます（シート > Markdownシートの追加）。MarkdownシートはCSVエクスポートの対象外です。',

    'f4.h3': '集計・比較・書式が必要なときだけ、RSFへ。',
    'f4.p':
      'CSVには、数式、複数シート、書式、コメントを完全には表せません。Refrain Sheet は、CSVを無理にスプレッドシート化しません。必要なときだけRSF（.rsf）へ明示的に変換し、CSVの正本とは役割を分けます。変換しても元の .csv は変更されません。',
    'f4.li1': '55関数：SUM・XLOOKUP・SUMIFS・TEXT・FILTER・UNIQUE ほか',
    'f4.li2': '複数ワークシート、シート間参照、絶対／相対参照、循環参照の検出',
    'f4.li3': 'フィルタと最大8階層の複数キー並べ替え。表示順が変わるだけで、データや数式は書き換わりません',
    'f4.li4': '数式エンジンは自作パーサ。eval も new Function も使いません',
    'f4.li5':
      '太字・斜体・下線・文字色・背景色・罫線。セルの値や数式には影響せず、Undoでき、.rsf に保存されます',
    'f4.li6': 'オートフィット、選択範囲の統計、CSV / XLSX エクスポート',
    'f4.li7': 'データ入力規則：選択範囲を値のリストまたは数値範囲に制限し、違反する入力を理由付きで拒否',
    'f4.li8': '条件付き書式：比較・重複・2色スケールでセルの背景色を値に応じて自動着色',
    'f4.li9': '数値の書式設定：数値・パーセント・通貨の表示形式を、小数桁数や桁区切りとともに指定',
    'f4.li10': 'SQLクエリの実行：ワークシートに対してローカルで動く読み取り専用のSELECTクエリを実行',
    'f4.li11': '比較／差分：開いている2つのタブをキー列で比較し、追加・変更・削除・キー不整合を行ごとに判定',
    'f4.li12': 'セルコメント：セルの値とは独立した短いメモを添付。ホバーで内容を表示',
    'f4.li13':
      'コメントパネル：ワークシート単位・ワークブック単位で全コメントを一覧表示。クリックでそのセルへジャンプ',

    'theme.eyebrow': 'DETAILS',
    'theme.h2': '英語UIとダークテーマも、標準装備。',
    'theme.p':
      '日本語と英語はどちらも第一級のUI言語です。テーマはシステム設定に追従し、ライト／ダークを明示指定することもできます。表示の変更がCSVのバイトやRSFのデータを書き換えることはありません。',
    'theme.cap': '英語UI × ダークテーマ。同じファイル、同じバイト。',

    'cmp.eyebrow': 'COMPARISON',
    'cmp.h2': 'Excelの代わりではなく、CSVの受け渡しを守る道具です。',
    'cmp.lede':
      '表計算ソフトは計算・集計・可視化のための道具で、CSVを別のシステムへ渡すときに求められる性質とは目的が異なります。下の表では、Refrain Sheet の挙動と、ほかの製品を選ぶときに確認したい観点を並べています。',
    'cmp.col1': '一般的な表計算ソフト',
    'cmp.col2': 'CSVエディタ（製品により異なる）',
    'cmp.col3': 'Refrain Sheet',
    'cmp.r1': '主な目的',
    'cmp.r1a': '計算、集計、可視化',
    'cmp.r1b': 'CSVの閲覧・編集',
    'cmp.r1c': 'CSVをデータファイルとして編集・保存',
    'cmp.r2': '値の扱い（先頭ゼロ・日付・長い番号）',
    'cmp.r2a': '表示・計算のため型変換が起こり得る',
    'cmp.r2b': '製品・設定により異なる',
    'cmp.r2c': '値を型推論で書き換えない',
    'cmp.r3': '無編集で開いて保存',
    'cmp.r3a': '製品・開き方・設定に依存',
    'cmp.r3b': '製品・設定により異なる',
    'cmp.r3c': '元ファイルとバイト単位で一致',
    'cmp.r4': '1セルだけの修正',
    'cmp.r4a': '製品・設定に依存',
    'cmp.r4b': '製品・設定により異なる',
    'cmp.r4c': '編集したフィールド以外のバイトを保持',
    'cmp.r5': '文字コード',
    'cmp.r5a': '製品・開き方に依存',
    'cmp.r5b': '製品により異なる',
    'cmp.r5c': 'UTF-8・Shift_JIS / CP932・EUC-JPを判定。開き直しと保存時の指定が可能',
    'cmp.r6': 'ファイルの処理場所',
    'cmp.r6a': '製品・利用形態に依存',
    'cmp.r6b': '製品・利用形態に依存',
    'cmp.r6c': '通常のCSV編集はブラウザ内でローカル処理',
    'cmp.r7': '導入',
    'cmp.r7a': '製品により異なる',
    'cmp.r7b': '製品により異なる',
    'cmp.r7c': 'ブラウザで開くだけ。配布版はHTMLファイル1つで file:// でも動作',
    'cmp.note':
      '※ 一般的な表計算ソフト・他のCSVエディタの挙動は、製品・バージョン・設定によって異なります。Refrain Sheet の挙動はリポジトリのREADMEおよびテストで定義されています。',

    'sec.eyebrow': 'SECURITY',
    'sec.h2': '機密CSVは端末内で。必要なときだけGoogle Driveと直接やり取り。',
    'sec.lede':
      'CSVの読み込み・編集・保存はブラウザ内で行います。Google Drive連携を使うときだけ、ユーザーの操作に応じてGoogleと通信します。なお、この紹介ページのアクセス解析（同意した場合のみ）は、CSVを扱うアプリ本体とは別のものです。',
    'sec.c1h': '通常のCSV編集は端末内で完結',
    'sec.c1p':
      "ファイルはブラウザ内で読み込まれ、保存先もお使いの端末です。CDN・外部フォント・アナリティクス・テレメトリはありません。配布版はCSPで connect-src 'none' を指定し、通信そのものをブロックします。",
    'sec.c2h': 'コードを実行しない',
    'sec.c2p':
      'セル内容はHTMLとして解釈されず、innerHTML・eval・new Function・マクロは一切使用しません。数式は専用エンジンで評価されます。',
    'sec.c3h': 'サプライチェーン対策',
    'sec.c3p':
      '本番依存は4パッケージのみ（推移的依存ゼロ）、lockfile固定、install スクリプト無効化。リリースにはSHA-256・SBOM・ビルド来歴の署名が付きます。',

    'start.eyebrow': 'GET STARTED',
    'start.h2': '3ステップで使いはじめる。',
    'start.s1h': 'ブラウザで開く',
    'start.s1p': '公開中のWebアプリをそのまま開くだけ。インストールもアカウント登録も不要です。',
    'start.s2h': 'CSVをドラッグ＆ドロップ',
    'start.s2p': 'ウィンドウのどこにドロップしてもOK。ファイルごとにタブが開きます。',
    'start.s3h': 'オフラインで使う',
    'start.s3p':
      'リリースZIPを展開し、index.html をダブルクリック。file:// でも動作し、ネットワークに接続しません。',
    'start.cta': 'アプリを開く',
    'start.cta2': 'リリース一覧',

    'faq.h2': 'よくある質問',
    'faq.q1': 'データは外部へ送信されますか？',
    'faq.a1':
      '通常のCSV編集では送信されません。ファイルはブラウザ内で読み込まれ、保存もお使いの端末に対して行われます。ホスト版アプリでGoogle Drive連携を使ったときだけ、ユーザーの操作に応じてブラウザとGoogle Driveの間で直接ファイルをやり取りします。配布版はCSPでネットワーク接続そのものを禁止しています。',
    'faq.q2': 'Excelの代わりになりますか？',
    'faq.a2':
      '目的が違います。Refrain Sheet はCSVを壊さずに直すためのエディタで、Excel互換を保証するものではありません。数式や書式が必要なときは、明示的にRSFスプレッドシートへ変換して使います。',
    'faq.q3': '大きなCSVを開けますか？',
    'faq.a3':
      '既定の上限は512MiBで、設定で16MiB〜2GiBに変更できます。上限を超えるファイルは読み込む前に拒否されます。表示は仮想化されていますが、数百MB級のファイルは環境によって描画・編集が重くなることがあります。',
    'faq.q4': 'どの文字コードに対応していますか？',
    'faq.a4':
      'UTF-8（BOMあり／なし）、Shift_JIS / CP932、EUC-JP に対応しています。UTF-16 と ISO-2022-JP は現行リリースでは対応しておらず、該当しそうなファイルは警告を表示したうえでベストエフォートで開きます（元のバイトは変更されません）。',
    'faq.q5': '上書き保存はできますか？',
    'faq.a5':
      'Chromium系ブラウザでは File System Access API により元ファイルへ直接上書きできます。Firefox・Safari などではダウンロード保存にフォールバックし、その旨が通知されます。',
    'faq.q6': 'CSVを編集したまま、数式や色を付けられますか？',
    'faq.a6':
      'CSVのままではできません。数式や書式（太字・色・罫線など）はRSFスプレッドシートの機能で、使うときはRSFへ明示的に変換します。CSVの正本に書式を埋め込むことはなく、書式設定はセルの値・数式の結果・CSVエクスポートを変更しません。',
    'faq.q7': 'この紹介ページ自体にアナリティクスは入っていますか？',
    'faq.a7':
      'この紹介ページ（refrain-sheet.com）のみ、訪問数を把握するために Google Analytics を使う場合があります。読み込まれるのは、ページ下部の同意バナーで「同意する」を選んだ場合のみで、フッターの「Cookie設定」からいつでも選び直せます。CSVを編集するアプリ本体（app.refrain-sheet.com）はこの紹介ページとは別に配信されており、アクセス解析は含まれません。アプリ本体が通信するのは、Google Drive連携を使う場合だけです。',
    'faq.q8': '先頭ゼロや長い番号は守れますか？',
    'faq.a8':
      'はい。値を型推論で変換しないため、「0123」や16桁以上の番号は書かれたとおりの文字列として扱われ、保存時もそのまま書き戻されます。ただし、取り込み先のシステムがその値を受け付けるかどうかは、取り込み先の仕様を事前にご確認ください。',
    'faq.q9': '壊れたCSVでも編集できますか？',
    'faq.a9':
      '開くことはできます。閉じていない引用符やフィールド数の不一致などを行・列つきで示したうえで、自動修復せずに開くかどうかを選べます。不正な箇所は編集しない限りバイト単位で保持されますが、壊れたままのデータを取り込み先のシステムが受け付けるとは限りません。',

    'cta.h2': 'まずは、再インポート前のCSVを1つ開いてみてください。',
    'cta.p':
      'インストールもアカウント登録も不要です。編集したセルは色付きで表示されるので、どこを直したかを確かめながら、必要なセルだけを修正できます。',
    'cta.b1': 'CSVをブラウザで開く',
    'cta.b2': 'GitHubで仕様とソースを見る',
    'cta.badge1': '登録不要',
    'cta.badge2': 'アップロード不要',
    'cta.badge3': 'コピーしたCSVでまず試せます',

    'footer.tagline': 'ローカルで動く、書式保持CSV・スプレッドシートエディタ',
    'footer.l1': 'Webアプリ',
    'footer.l2': 'GitHub',
    'footer.l3': 'リリース',
    'footer.l4': 'ドキュメント',
    'footer.privacy': 'Cookie設定',
    'footer.privacyPolicy': 'プライバシーポリシー',
    'footer.terms': '利用規約',
    'footer.note': 'MIT License · Refrain Sheet 公式の紹介ページです',

    'consent.text':
      'このページ（refrain-sheet.com）は、訪問状況の把握のために Google Analytics を利用します。同意した場合のみ読み込まれ、いつでも取り消せます。CSVを編集するアプリ本体（app.refrain-sheet.com）にアクセス解析は含まれません。',
    'consent.decline': '同意しない',
    'consent.accept': '同意する',

    'privacy.meta.title': 'プライバシーポリシー | Refrain Sheet',
    'privacy.meta.desc':
      'Refrain Sheetの紹介ページ（refrain-sheet.com）とホスト版アプリ（app.refrain-sheet.com）における、アクセス解析やGoogleドライブ連携などの情報の取り扱いについて説明します。',
    'privacy.h1': 'プライバシーポリシー',
    'privacy.intro.p':
      '本ページは、Refrain Sheetの紹介ページ（refrain-sheet.com）およびホスト版アプリ（app.refrain-sheet.com）における情報の取り扱いについて説明します。ダウンロードして使う配布版（ブラウザ上で完全オフライン動作する版）は、いかなるネットワーク通信も行わないため、本ポリシーの対象外です。',
    'privacy.analytics.h2': '紹介ページのアクセス解析',
    'privacy.analytics.p1':
      '紹介ページ（refrain-sheet.com）は、訪問状況を把握するためにGoogle Analyticsを利用する場合があります。読み込まれるのは、ページ下部の同意バナーで「同意する」を選んだ場合のみで、同意しない限りスクリプトは一切読み込まれません。同意はいつでもフッターの「Cookie設定」から変更できます。',
    'privacy.analytics.p2':
      '収集されうる情報は、閲覧したページ、参照元、おおよその地域、デバイスやブラウザの種類など、Google Analyticsが標準で取得する情報です。氏名やメールアドレスなど、個人を特定できる情報を本サイトが意図的に収集することはありません。',
    'privacy.analytics.googleLink': 'Google プライバシーポリシー',
    'privacy.drive.h2': 'ホスト版アプリとGoogleドライブ連携',
    'privacy.drive.p1':
      'ホスト版アプリ（app.refrain-sheet.com）では、「Googleドライブから開く」または「Googleドライブに保存」を選んだ場合のみ、Google Identity Servicesを通じてGoogleへのサインインを求めます。要求する権限（スコープ）は drive.file のみで、この機能を通じて開いた、または新規作成したファイルに限定されます。ドライブ内のそれ以外のファイルにはアクセスできません。',
    'privacy.drive.p2':
      '取得したアクセストークンはブラウザのメモリ上にのみ保持され、ページの再読み込みやタブを閉じると失われます。localStorage・Cookie・IndexedDBなど、永続する場所には保存しません。',
    'privacy.drive.p3':
      'ファイルの内容はブラウザとGoogleドライブの間で直接やり取りされ、Refrain Sheetが運営するサーバーを経由しません。Refrain Sheetにはサーバー側のバックエンドが存在しません。',
    'privacy.drive.googleLink': 'Google プライバシーポリシー',
    'privacy.app.h2': 'CSVエディタ本体の通信',
    'privacy.app.p':
      'Googleドライブ連携を使わない限り、CSVを開く・編集する・保存するといった操作は、いかなるネットワーク通信も発生させません。ファイルはすべてブラウザの中だけで処理され、外部に送信されることはありません。',
    'privacy.storage.h2': 'Cookieとローカルストレージ',
    'privacy.storage.p':
      '紹介ページの同意設定（Analyticsに同意したかどうか）は、お使いのブラウザのlocalStorageに保存されます。ブラウザの設定からいつでも削除できます。',
    'privacy.changes.h2': '本ポリシーの変更',
    'privacy.changes.p':
      '機能の追加や法令の変更に応じて、本ポリシーを更新することがあります。重要な変更がある場合は、このページの内容を更新してお知らせします。',
    'privacy.contact.h2': 'お問い合わせ',
    'privacy.contact.p':
      'プライバシーに関するご質問やご要望は、以下のGitHub Issuesからお寄せください。開発者: 0x0da160。',
    'privacy.contact.link': 'GitHub Issues',

    'terms.meta.title': '利用規約 | Refrain Sheet',
    'terms.meta.desc': 'Refrain Sheetの紹介ページおよびホスト版アプリのご利用にあたっての条件を説明します。',
    'terms.h1': '利用規約',
    'terms.intro.p':
      '本規約は、Refrain Sheetの紹介ページ（refrain-sheet.com）およびホスト版アプリ（app.refrain-sheet.com、以下「本サービス」）のご利用条件を定めるものです。本サービスをご利用いただくことで、本規約に同意したものとみなします。',
    'terms.license.h2': 'ライセンス',
    'terms.license.p':
      'Refrain Sheetのソースコードは MIT License のもとで公開されています。ダウンロードして使う配布版を含め、ソースコードの取り扱いはMIT Licenseに従います。',
    'terms.license.link': 'MIT License（LICENSEファイル）',
    'terms.asis.h2': '「現状有姿」での提供',
    'terms.asis.p':
      '本サービスは「現状有姿（AS IS）」で提供され、商品性・特定目的への適合性を含め、明示または黙示を問わずいかなる保証も行いません。本サービスの利用により生じたいかなる損害についても、開発者は責任を負いません。重要なCSVファイルなどのデータは、編集の前に必ずバックアップを取ってください。',
    'terms.prohibited.h2': '禁止事項',
    'terms.prohibited.p':
      '本サービスに対して、法令に違反する行為、本サービスや関連インフラへ過度な負荷をかける行為、脆弱性を悪用する行為、その他本サービスの通常の提供を妨げる行為を行わないでください。',
    'terms.third.h2': '第三者サービス',
    'terms.third.p':
      '本サービスは、紹介ページでのGoogle Analytics（同意時のみ）、ホスト版アプリでのGoogleドライブ連携など、第三者のサービスを利用する場合があります。これらの利用には、各サービス提供者自身の利用規約・プライバシーポリシーが別途適用されます。',
    'terms.changes.h2': '規約の変更',
    'terms.changes.p':
      '本規約は、機能の追加や法令の変更に応じて、予告なく変更されることがあります。変更後も本サービスの利用を継続した場合、変更後の規約に同意したものとみなします。',
    'terms.governing.h2': '準拠法・お問い合わせ',
    'terms.governing.p':
      '本規約は特定の国の法律や裁判管轄を指定せず、MIT Licenseと同様に簡易な内容としています。本サービスに関するご質問やご意見は、以下のGitHub Issuesからお寄せください。開発者: 0x0da160。',
    'terms.governing.link': 'GitHub Issues',
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
      'Refrain Sheet is a format-preserving CSV and spreadsheet editor that runs entirely in your browser. You edit field values; everything else — encoding, quoting, line endings, BOMs — stays exactly as it was.',
    'hero.forwhom':
      'For teams reworking CSVs from core systems, accounting, order management or e-commerce — without breaking them.',
    'hero.cta1': 'Try opening a CSV — no install',
    'hero.cta2': 'See the spec and source on GitHub',
    'hero.note':
      'CSV files are read, edited and saved inside your browser; the app itself never sends them to an outside server (unless you use the Google Drive integration).',
    'hero.badge1': 'Unedited save: byte-identical',
    'hero.badge2': 'CSV editing stays local',
    'hero.badge3': 'Shift_JIS / CP932 ready',
    'hero.badge4': 'No install, no account',
    'hero.cap':
      'A Shift_JIS ledger opened in the app. Only the edited cell is tinted, and the status bar always reports encoding, delimiter and line endings.',

    'stat1.k': '0 bytes',
    'stat1.v': 'changed on an unedited save — the original bytes are written back',
    'stat2.k': '1 field',
    'stat2.v': 're-serialized when you edit a cell — every other byte is left alone',
    'stat3.k': '0 requests',
    'stat3.v':
      'made by reading, editing and saving a CSV. No CDN, no analytics, no telemetry (Google Drive aside)',

    'why.eyebrow': 'THE PROBLEM',
    'why.h2': "A CSV isn't a table. It's data headed for the next system.",
    'why.p':
      'Spreadsheet apps interpret values so they are convenient to calculate and display. That can drop leading zeros from postal codes, employee IDs, product codes and account numbers, turn "1-2" or "2024-01-01" into dates, lose the trailing digits of 16-digit-plus numbers, garble text when UTF-8 and Shift_JIS / CP932 are mixed up, or change quotes, commas, line breaks, BOMs, empty fields and "HH:mm" times. The screen may look the same, yet the next import fails or reads the wrong values.',
    'never.title': 'What a normal save never does',
    'never.1': 'unify line-ending styles or delimiters',
    'never.2': 'alter the header layout',
    'never.3': 'add or remove whitespace',
    'never.4': 'add or remove quotes unnecessarily',
    'never.5': 'add or remove BOMs',
    'never.6': 'repair malformed CSV',
    'never.7': 'replace undecodable bytes in unmodified fields',

    'diff.h3': 'You fix one cell. Only that cell should change.',
    'diff.p':
      "Correct a single note and the other columns, line breaks and quotes are not rebuilt. Precisely: only the edited field's byte range is re-serialized, and every unedited byte is kept. A quoted field stays quoted, and an unquoted one gains quotes only when the new value truly needs them.",
    'diff.file': 'sales.csv — Shift_JIS / CRLF',
    'diff.label_before': 'before',
    'diff.label_after': 'after',
    'diff.result': "Only the edited field's byte range is rewritten — the rest is identical",

    'use.eyebrow': 'USE CASES',
    'use.h2': 'For fixing a CSV before it goes back in.',
    'use.lede': 'Common fixes for CSV files that travel between business systems.',
    'use.c1h': 'Accounting and tax journal or filing CSVs',
    'use.c1p':
      'Keep the required columns, empty fields, account codes and Shift_JIS encoding, and change only what you fix.',
    'use.c2h': 'HR, payroll and attendance employee CSVs',
    'use.c2p':
      'Employee IDs, postal codes, account numbers and "HH:mm" times stay as text, never converted to numbers or times.',
    'use.c3h': 'Order, inventory and product master CSVs',
    'use.c3p':
      "Fix product codes, JAN codes or notes while the partner's column order, delimiter and quoting rules stay intact.",
    'use.c4h': 'CSVs passed between core systems and team tools',
    'use.c4p':
      'For the small CSV fixes that remain with or without an API. Everything except what you fixed is handed on as it was.',
    'use.c5h': 'CSVs that need investigation',
    'use.c5p':
      'See field-count mismatches and unclosed quotes with their rows and columns, without an automatic repair.',

    'features.eyebrow': 'FEATURES',
    'features.h2': 'Nothing is broken, because nothing is guessed.',
    'features.lede':
      'No "it looks like a number, so make it a number" and no "it looks broken, so fix it". The app shows you the state of the file and leaves the decision to you, from encoding checks and malformed-file diagnostics to Japanese input.',

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
    'f3.li2':
      'Browser-reserved keys (Ctrl+W, Ctrl+T, reload, zoom) are never intercepted; Ctrl+F searches the sheet only while you work in the grid',
    'f3.li3':
      'Alt+Enter inserts a line break; multi-line values round-trip through CSV, RSF and the clipboard',
    'f3.cap': 'The File menu. Shortcuts are accelerators only — nothing depends on them.',
    'f8.h3': 'No type inference for leading zeros, dates or long IDs',
    'f8.p':
      'CSV values are handled as the text they are written as. "0123" stays "0123", and "2024-01-01" or a 16-digit-plus number is never converted to a number or date and written back.',

    'f5.h3': 'Google Drive, only when you use it',
    'f5.p':
      'Only when you choose Open from Drive or Save to Drive in the hosted app does it sign in to Google and talk to the Google Drive API. Access is limited to files opened or created through this feature (the drive.file scope), the access token lives only in browser memory, and file contents travel directly between your browser and Google Drive, never through a server of ours. The downloadable release does not include this feature.',
    'f6.h3': 'A protect mode that stops accidental edits',
    'f6.p':
      'Opening an existing file defaults to read-only; a status bar control or File > Document > Unprotect Book unlocks it. The setting is per-tab, session-only, and never saved with the file.',
    'f7.h3': 'Also included: Markdown sheets',
    'f7.p':
      'Add a Markdown sheet to an RSF workbook (Sheet > Add Markdown Sheet) and write notes or procedures with source and preview side by side. Markdown sheets are excluded from CSV export.',

    'f4.h3': 'RSF, only when you need to calculate, compare or format.',
    'f4.p':
      "Plain CSV can't fully hold formulas, multiple sheets, formatting or comments. Refrain Sheet doesn't force a CSV into a spreadsheet: those live in a separate .rsf document, created only by an explicit conversion, so it and the original CSV keep separate roles. The original .csv is never changed.",
    'f4.li1': '55 functions: SUM, XLOOKUP, SUMIFS, TEXT, FILTER, UNIQUE and more',
    'f4.li2': 'Multiple worksheets, cross-sheet references, absolute/relative refs, cycle detection',
    'f4.li3':
      'Filtering and a compound sort with up to 8 keys — reorders the view only, never the data or formulas',
    'f4.li4': 'A hand-written formula engine — no eval, no new Function, no macros',
    'f4.li5':
      "Bold, italic, underline, text/background color and borders. Never touches a cell's value or formula results, is undoable, and is saved in the .rsf file",
    'f4.li6': 'Auto-fit, selection statistics, CSV and XLSX export',
    'f4.li7':
      'Data Validation: restrict a range to a list or a numeric range, refusing violating edits with a reason',
    'f4.li8':
      'Conditional Formatting: auto-colors cells by comparison, duplicate values, or a two-color scale',
    'f4.li9':
      'Number Format: Number, Percent, or Currency display, with decimal places and a thousands separator',
    'f4.li10':
      'SQL Query: a local, read-only SELECT query against the worksheet, with autocomplete and saved queries',
    'f4.li11':
      'Compare / Diff: compares two open tabs by key column, classifying every row as added, modified, deleted or unchanged',
    'f4.li12': 'Cell Comment: attaches a short note to a cell, independent of its value',
    'f4.li13':
      'Comments Panel: lists every comment for the current worksheet or the whole workbook, click an entry to jump to its cell',

    'theme.eyebrow': 'DETAILS',
    'theme.h2': 'English UI and dark theme, built in.',
    'theme.p':
      'Japanese and English are both first-class UI languages. The theme follows your system by default and can be pinned to light or dark. Display state never changes CSV bytes, RSF data or formula results.',
    'theme.cap': 'English UI, dark theme. Same file, same bytes.',

    'cmp.eyebrow': 'COMPARISON',
    'cmp.h2': 'Not an Excel replacement: a tool that protects CSV handoffs.',
    'cmp.lede':
      'Spreadsheet apps are built to calculate, summarize and visualize, which is a different job from handing a CSV to another system. The table shows what Refrain Sheet does and what to check when you evaluate other products.',
    'cmp.col1': 'Typical spreadsheet apps',
    'cmp.col2': 'CSV editors (vary by product)',
    'cmp.col3': 'Refrain Sheet',
    'cmp.r1': 'Main purpose',
    'cmp.r1a': 'Calculation, summaries, charts',
    'cmp.r1b': 'Viewing and editing CSV',
    'cmp.r1c': 'Editing and saving CSV as a data file',
    'cmp.r2': 'Values (leading zeros, dates, long IDs)',
    'cmp.r2a': 'May be type-converted for display or calculation',
    'cmp.r2b': 'Varies by product and settings',
    'cmp.r2c': 'Never rewritten by type inference',
    'cmp.r3': 'Open and save, no edits',
    'cmp.r3a': 'Depends on product, import method and settings',
    'cmp.r3b': 'Varies by product and settings',
    'cmp.r3c': 'Byte-for-byte identical to the original',
    'cmp.r4': 'Fixing a single cell',
    'cmp.r4a': 'Depends on product and settings',
    'cmp.r4b': 'Varies by product and settings',
    'cmp.r4c': 'Every byte outside the edited field is kept',
    'cmp.r5': 'Character encodings',
    'cmp.r5a': 'Depends on product and import method',
    'cmp.r5b': 'Varies by product',
    'cmp.r5c': 'Detects UTF-8, Shift_JIS / CP932 and EUC-JP; reopen or choose on save',
    'cmp.r6': 'Where the file is processed',
    'cmp.r6a': 'Depends on product and deployment',
    'cmp.r6b': 'Depends on product and deployment',
    'cmp.r6c': 'Normal CSV editing happens locally in the browser',
    'cmp.r7': 'Setup',
    'cmp.r7a': 'Varies by product',
    'cmp.r7b': 'Varies by product',
    'cmp.r7c': 'Just open it in a browser; the release is one HTML file that works over file://',
    'cmp.note':
      "Behaviour of typical spreadsheet apps and other CSV editors varies by product, version and settings. Refrain Sheet's own guarantees are defined by its README and test suite.",

    'sec.eyebrow': 'SECURITY',
    'sec.h2': 'Confidential CSVs stay on your device. Google Drive only when you need it.',
    'sec.lede':
      'CSV files are read, edited and saved inside the browser. The app talks to Google only when you use the Google Drive integration. The analytics on this introduction page (only with your consent) are separate from the app that handles your CSVs.',
    'sec.c1h': 'Normal CSV editing stays on your device',
    'sec.c1p':
      "Files are read in the browser and saved to your own device. No CDN, external fonts, analytics or telemetry. The downloadable release sets connect-src 'none' in its CSP, blocking network access outright.",
    'sec.c2h': 'Nothing is executed',
    'sec.c2p':
      'Cell content is never interpreted as HTML; there is no innerHTML, eval, new Function or macro anywhere. Formulas run in a sandboxed engine.',
    'sec.c3h': 'Supply chain discipline',
    'sec.c3p':
      'Four production dependencies with zero transitive dependencies, enforced lockfiles, install scripts disabled, and releases shipped with SHA-256 checksums, an SBOM and signed build provenance.',

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
    'faq.q1': 'Is my data sent anywhere?',
    'faq.a1':
      'Not during normal CSV editing. Files are read inside the browser and saved back to your own device. Only when you use the Google Drive integration in the hosted app are files exchanged, at your request, directly between your browser and Google Drive. The downloadable release blocks network access at the CSP level.',
    'faq.q2': 'Is this an Excel replacement?',
    'faq.a2':
      'No — different purpose. Refrain Sheet fixes CSV files without damaging them; formulas and structural edits require an explicit conversion to an .rsf spreadsheet. Excel compatibility is not claimed.',
    'faq.q3': 'How large a file can it open?',
    'faq.a3':
      'The default limit is 512 MiB (adjustable from 16 MiB to 2 GiB) and oversized files are refused before their bytes are read. Rendering is virtualized, but hundred-megabyte files can still feel slow.',
    'faq.q4': 'Which encodings are supported?',
    'faq.a4':
      'UTF-8 (with or without BOM), Shift_JIS / CP932 and EUC-JP. UTF-16 and ISO-2022-JP are not supported in this release; such files still open with a best-effort interpretation and a warning, and their bytes remain untouched.',
    'faq.q5': 'Can it always overwrite the original file?',
    'faq.a5':
      'In Chromium-based browsers, yes, via the File System Access API. Firefox and Safari fall back to a download save, and the app tells you which kind of save happened.',
    'faq.q6': 'Can I add formulas or colors while keeping the file a CSV?',
    'faq.a6':
      "Not in the CSV itself. Formulas and formatting (bold, color, borders) are RSF spreadsheet features that require an explicit conversion to RSF. Formatting is never embedded in the original CSV, and it never changes a cell's value, formula results or CSV export.",
    'faq.q7': 'Does this introduction page itself use analytics?',
    'faq.a7':
      'Only this introduction page (refrain-sheet.com) may use Google Analytics, to measure visits. It loads only if you choose "Accept" in the consent banner at the bottom of the page, and you can change that choice anytime from "Cookie settings" in the footer. The app itself (app.refrain-sheet.com), where you edit CSVs, is served separately and contains no analytics; it makes network requests only when you use the Google Drive integration.',
    'faq.q8': 'Are leading zeros and long IDs preserved?',
    'faq.a8':
      'Yes. Values are never type-inferred, so "0123" or a 16-digit-plus number is handled as the text it is written as and written back unchanged on save. Whether the receiving system accepts that value is a matter of that system\'s own specification, so check it beforehand.',
    'faq.q9': 'Can I edit a malformed CSV?',
    'faq.a9':
      'You can open it. Problems such as unclosed quotes or field-count mismatches are listed with their rows and columns, and you choose whether to open the file without any automatic repair. Malformed regions are kept byte-for-byte unless you edit them, but there is no guarantee the receiving system will accept the damaged data.',

    'cta.h2': 'Open one CSV you are about to re-import.',
    'cta.p':
      'No install and no account. Edited cells are tinted, so you can check exactly what you changed while fixing only the cells that need it.',
    'cta.b1': 'Open a CSV in your browser',
    'cta.b2': 'See the spec and source on GitHub',
    'cta.badge1': 'No sign-up',
    'cta.badge2': 'Nothing uploaded',
    'cta.badge3': 'Try it first with a copy of your CSV',

    'footer.tagline': 'A local-first, format-preserving CSV and spreadsheet editor',
    'footer.l1': 'Web app',
    'footer.l2': 'GitHub',
    'footer.l3': 'Releases',
    'footer.l4': 'Docs',
    'footer.privacy': 'Cookie settings',
    'footer.privacyPolicy': 'Privacy Policy',
    'footer.terms': 'Terms of Service',
    'footer.note': 'MIT License · The official introduction page for Refrain Sheet',

    'consent.text':
      'This page (refrain-sheet.com) uses Google Analytics to understand visits. It loads only with your consent, which you can withdraw at any time. The app itself (app.refrain-sheet.com), where you edit CSVs, contains no analytics.',
    'consent.decline': 'Decline',
    'consent.accept': 'Accept',

    'privacy.meta.title': 'Privacy Policy | Refrain Sheet',
    'privacy.meta.desc':
      "How Refrain Sheet's introduction page (refrain-sheet.com) and hosted app (app.refrain-sheet.com) handle data, including analytics and the Google Drive integration.",
    'privacy.h1': 'Privacy Policy',
    'privacy.intro.p':
      "This page explains how information is handled on Refrain Sheet's introduction page (refrain-sheet.com) and hosted app (app.refrain-sheet.com). The downloadable build, which runs fully offline in the browser, makes no network requests at all and is not covered by this policy.",
    'privacy.analytics.h2': 'Analytics on the introduction page',
    'privacy.analytics.p1':
      'The introduction page (refrain-sheet.com) may use Google Analytics to understand visits. It loads only if you choose "Accept" in the consent banner at the bottom of the page; the script never loads otherwise. You can change that choice anytime from "Cookie settings" in the footer.',
    'privacy.analytics.p2':
      'The information that may be collected is whatever Google Analytics collects by default — pages viewed, referrer, approximate location, and device/browser type. This site does not intentionally collect personally identifying information such as your name or email address.',
    'privacy.analytics.googleLink': 'Google Privacy Policy',
    'privacy.drive.h2': 'The hosted app and the Google Drive integration',
    'privacy.drive.p1':
      'The hosted app (app.refrain-sheet.com) asks you to sign in to Google, via Google Identity Services, only when you choose "Open from Drive" or "Save to Drive". The requested permission (scope) is drive.file only, limited to files you opened or created through this feature — it cannot access any other file in your Drive.',
    'privacy.drive.p2':
      "The access token is kept only in the browser's memory and is gone on reload or when the tab is closed. It is never written to localStorage, cookies, or IndexedDB.",
    'privacy.drive.p3':
      'File contents pass directly between your browser and Google Drive; they never pass through a server operated by Refrain Sheet, because Refrain Sheet has no server-side backend.',
    'privacy.drive.googleLink': 'Google Privacy Policy',
    'privacy.app.h2': 'The CSV editor itself',
    'privacy.app.p':
      'Unless you use the Google Drive integration, opening, editing, and saving a CSV makes no network requests at all. Files are processed entirely inside your browser and are never sent anywhere.',
    'privacy.storage.h2': 'Cookies and local storage',
    'privacy.storage.p':
      "Your analytics consent choice on the introduction page is stored in your browser's localStorage. You can delete it at any time from your browser's settings.",
    'privacy.changes.h2': 'Changes to this policy',
    'privacy.changes.p':
      'This policy may be updated as features change or as required by law. Material changes will be reflected on this page.',
    'privacy.contact.h2': 'Contact',
    'privacy.contact.p':
      'For privacy questions or requests, please reach out via the GitHub Issues linked below. Developer: 0x0da160.',
    'privacy.contact.link': 'GitHub Issues',

    'terms.meta.title': 'Terms of Service | Refrain Sheet',
    'terms.meta.desc': "The terms for using Refrain Sheet's introduction page and hosted app.",
    'terms.h1': 'Terms of Service',
    'terms.intro.p':
      'These Terms govern your use of Refrain Sheet\'s introduction page (refrain-sheet.com) and hosted app (app.refrain-sheet.com, together "the Service"). By using the Service, you agree to these Terms.',
    'terms.license.h2': 'License',
    'terms.license.p':
      "Refrain Sheet's source code is published under the MIT License. That license governs the source code, including the downloadable build.",
    'terms.license.link': 'MIT License (LICENSE file)',
    'terms.asis.h2': 'Provided "as is"',
    'terms.asis.p':
      'The Service is provided "AS IS", without warranty of any kind, express or implied, including merchantability or fitness for a particular purpose. The developer is not liable for any damages arising from your use of the Service. Always back up important data, such as CSV files, before editing.',
    'terms.prohibited.h2': 'Prohibited use',
    'terms.prohibited.p':
      "Do not use the Service to violate any law, to place undue load on the Service or its infrastructure, to exploit a vulnerability, or to otherwise interfere with the Service's normal operation.",
    'terms.third.h2': 'Third-party services',
    'terms.third.p':
      "The Service may use third-party services, such as Google Analytics on the introduction page (only with consent) and the Google Drive integration in the hosted app. Use of those services is separately governed by each provider's own terms and privacy policy.",
    'terms.changes.h2': 'Changes to these Terms',
    'terms.changes.p':
      'These Terms may change without notice as features change or as required by law. Continuing to use the Service after a change means you accept the revised Terms.',
    'terms.governing.h2': 'Governing law and contact',
    'terms.governing.p':
      'These Terms do not name a specific governing law or jurisdiction, kept informal in the same spirit as the MIT License. For questions or feedback about the Service, please reach out via the GitHub Issues linked below. Developer: 0x0da160.',
    'terms.governing.link': 'GitHub Issues',
  },
};
