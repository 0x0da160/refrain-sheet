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
      'Refrain Sheet は、ブラウザだけで動く書式保持CSV・スプレッドシートエディタです。編集するのはセルの値だけ。文字コード、引用符、改行コード、BOMなど、それ以外のバイトはそのまま残します。',
    'hero.forwhom': '対象：基幹システム・会計・受発注・ECから出力したCSVを、壊さずに直したい方へ。',
    'hero.cta1': 'CSVを開いて試す（インストール不要）',
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
    'stat2.k': '1 field',
    'stat2.v': '1セル編集時に再シリアライズされる範囲。ほかのバイトは動きません',
    'stat3.k': '0 requests',
    'stat3.v': '実行時のネットワーク通信。CDNもテレメトリもありません',

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

    'use.eyebrow': 'USE CASES',
    'use.h2': 'こんなときに使えます。',
    'use.lede': '実務で繰り返し起きる、CSVがらみの困りごとに向けて作っています。',
    'use.c1h': '基幹システムのCSVを一部だけ直す',
    'use.c1p': '商品名・備考・ステータスといった一部の列だけを書き換え、それ以外は一切触りません。',
    'use.c2h': '取引先指定の形式を保ったまま返却',
    'use.c2p': '改行コードや引用符を変えずに、指定されたCSV形式のまま出力します。',
    'use.c3h': '先頭ゼロ・日付・長い番号を守る',
    'use.c3p': 'ほかのソフトなら勝手に変換されがちな値も、文字列としてそのまま保持します。',
    'use.c4h': '壊れたCSVを、直さずにまず確認',
    'use.c4p': '自動修復はせず、問題のある行・列を提示してから、開くかどうかを判断できます。',
    'use.c5h': '機密データをアップロードしない',
    'use.c5p': '顧客・受注データなどをブラウザ内だけで処理し、どこにも送信しません。',

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
      '本番依存は3パッケージのみ（推移的依存ゼロ）、lockfile固定、install スクリプト無効化。リリースにはSHA-256・SBOM・ビルド来歴の署名が付きます。',

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
    'faq.q7': 'この紹介ページ自体にアナリティクスは入っていますか？',
    'faq.a7':
      'この紹介ページ（refrain-sheet.com）のみ、訪問数を把握するために Google Analytics を使う場合があります。読み込まれるのは、ページ下部の同意バナーで「同意する」を選んだ場合のみで、フッターの「Cookie設定」からいつでも選び直せます。CSVを編集するアプリ本体（app.refrain-sheet.com）はこの紹介ページとは別に配信されており、実行時のネットワーク通信は今後も一切行いません。',

    'cta.h2': 'まずは手元のCSVを、1つ開いてみてください。',
    'cta.p': 'インストール不要。数秒で、保存しても差分が出ないことを確認できます。',
    'cta.b1': 'アプリを開く',
    'cta.b2': 'GitHubで見る',
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
      'このページ（refrain-sheet.com）は、訪問状況の把握のために Google Analytics を利用します。同意した場合のみ読み込まれ、いつでも取り消せます。CSVを編集するアプリ本体（app.refrain-sheet.com）は引き続き通信を一切行いません。',
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
    'stat2.k': '1 field',
    'stat2.v': 're-serialized when you edit a cell — every other byte is left alone',
    'stat3.k': '0 requests',
    'stat3.v': 'at runtime. No CDN, no analytics, no telemetry',

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

    'use.eyebrow': 'USE CASES',
    'use.h2': 'Built for moments like these.',
    'use.lede': 'Made for the CSV problems that keep coming back in real operations.',
    'use.c1h': 'Patch one field in a core-system export',
    'use.c1p': 'Rewrite just the product name, note or status column — everything else stays untouched.',
    'use.c2h': "Return a partner's exact CSV format",
    'use.c2p': 'Keep their line endings and quoting exactly as specified.',
    'use.c3h': 'Protect leading zeros, dates and long IDs',
    'use.c3p': "Values another tool would silently reinterpret stay exactly as they're written.",
    'use.c4h': 'Inspect a malformed CSV before touching it',
    'use.c4p': 'See the exact rows and columns at fault instead of getting a silent auto-repair.',
    'use.c5h': 'Keep sensitive data off the network',
    'use.c5p': 'Customer and order data are processed in the browser and never uploaded.',

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
      'Three production dependencies with zero transitive dependencies, enforced lockfiles, install scripts disabled, and releases shipped with SHA-256 checksums, an SBOM and signed build provenance.',

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
    'faq.q7': 'Does this introduction page itself use analytics?',
    'faq.a7':
      'Only this introduction page (refrain-sheet.com) may use Google Analytics, to measure visits. It loads only if you choose "Accept" in the consent banner at the bottom of the page, and you can change that choice anytime from "Cookie settings" in the footer. The app itself (app.refrain-sheet.com), where you edit CSVs, is served separately and continues to make no network connections at runtime.',

    'cta.h2': 'Open one of your own CSVs.',
    'cta.p': 'No install. In a few seconds you can confirm that saving produces no diff at all.',
    'cta.b1': 'Open the app',
    'cta.b2': 'View on GitHub',
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
      'This page (refrain-sheet.com) uses Google Analytics to measure visits. It only loads if you accept, and you can withdraw that choice at any time. The app itself (app.refrain-sheet.com), where you edit CSVs, continues to make no network connections at all.',
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
