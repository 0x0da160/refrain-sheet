// SPDX-License-Identifier: MIT
// Build-time copy dictionary, read by scripts/build-landing.mjs. Not loaded
// by the browser — the pre-rendered pages carry the text already. A "\n" in
// a value becomes a <br> in the page. The hero demo's app labels are not
// here: they come from src/locales, exactly as the app shows them.
export const I18N = {
  ja: {
    'meta.title': 'CSVを壊さず編集できる無料の表計算ソフト｜Refrain Sheet',
    'meta.desc':
      '先頭ゼロ・文字コード・改行コードを変えずにCSVを編集できる、無料の表計算ソフト。数式やフィルタでの集計にも対応。ブラウザで開くだけで、インストールも登録も不要です。',
    'a11y.skip': '本文へスキップ',
    'nav.features': '機能',
    'nav.csv': 'CSVの保持',
    'nav.security': 'セキュリティ',
    'nav.faq': 'よくある質問',
    'nav.cta': '無料で開く',
    'hero.eyebrow': 'ブラウザで開くだけ。無料・インストール不要',
    'hero.h1': 'CSVを壊さず\n編集できる、\n軽い表計算ソフト',
    'hero.lead':
      '先頭の「0」も、文字コードも、改行コードも、開いたときのまま。数式やフィルタを使った集計もできます。データはパソコンの外に出ません。',
    'hero.cta1': 'ブラウザで開いてみる',
    'hero.cta2': 'オフライン版をダウンロード',
    'hero.badge1': 'Shift_JIS対応',
    'hero.badge2': 'オフラインでも動く',
    'hero.badge3': 'オープンソース（MIT）',
    'demo.file.csv': 'uriage.csv',
    'demo.file.rsf': 'uriage.rsf',
    'demo.h.name': '商品名',
    'demo.h.qty': '数量',
    'demo.h.sales': '売上',
    'demo.h.unit': '単価',
    'demo.r1': '抹茶 ラテベース',
    'demo.r2': '抹茶 セレモニアル',
    'demo.r3': 'ほうじ茶 パウダー',
    'demo.n1': '1',
    'demo.n4': '4',
    'demo.step1': 'Shift_JIS・CRLF のCSVを開く',
    'demo.step2': 'セルに数式を入力する',
    'demo.step3': 'RSFスプレッドシートに変換する',
    'demo.step4': '計算できた。元のCSVファイルはそのまま',
    'demo.pause': 'デモを一時停止',
    'demo.play': 'デモを再生',
    'pillars.p1h': 'CSVを壊さない',
    'pillars.p1p':
      '先頭の「0」も、文字コードも、改行コードも、開いたときのまま。変わるのは、直したセルだけです。',
    'pillars.p2h': '表計算ソフトとして使える',
    'pillars.p2p': '数式、フィルタ、条件付き書式、複数のシート。よく使う機能に絞った、軽い表計算ソフトです。',
    'pillars.p3h': 'データを外に出さない',
    'pillars.p3p':
      'ブラウザの中だけで動くので、ファイルをサーバーに送る必要がありません。1つのHTMLファイルで、オフラインでも使えます。',
    'feat.h2': '集計も、整理も、見比べも。\n表計算ソフトとして、ここまでできます。',
    'feat.lead':
      '大きな表計算ソフトの代わりではありません。手元のデータを、安全に、手早く扱うための表計算ソフトです。',
    'feat.f1h': '数式と55の関数',
    'feat.f1p': 'SUMIFS、XLOOKUP、FILTER、UNIQUE など。シートをまたぐ参照にも対応しています。',
    'feat.f2h': '並べ替えとフィルタ',
    'feat.f2p': '必要な行だけを絞り込み、見たい順に並べられます。',
    'feat.f3h': '入力規則と条件付き書式',
    'feat.f3p': '入力できる値を決めたり、条件に合うセルに色をつけたりできます。',
    'feat.f4h': 'SQLで集計',
    'feat.f4p': '表にSQLで問い合わせて、結果を読み取り専用で表示します。',
    'feat.f5h': '2つの表の比較',
    'feat.f5p': 'タブを並べて、どこが違うかを確かめられます。',
    'feat.f6h': 'コメントと版の履歴',
    'feat.f6p': 'セルにメモを残し、前の版を確かめて元に戻せます。',
    'feat.f7h': 'XLSX・JSONの読み書き',
    'feat.f7p': 'CSV・JSON・XLSXを読み込み、書き出せます（書き出しは値のみ）。',
    'feat.f8h': 'メモや設定のシート',
    'feat.f8p': 'Markdown・JSON・YAML・テキストのシートを、同じファイルにまとめられます。',
    'csv.h2': 'CSVを直すのは1セル。\n変わるのも、その1セルだけ。',
    'csv.p':
      '文字化けしない、先頭ゼロが消えない。会計や給与、受発注のシステムに取り込み直すCSVも、開いたときのまま保存します。何も変えずに保存すれば、元のファイルとバイト単位で同じです。',
    'csv.k1': '先頭ゼロ：そのまま',
    'csv.k2': '文字コード：そのまま',
    'csv.k3': '改行コード：そのまま',
    'csv.k4': '変わるのは、直したセルだけ',
    'csv.alt': 'Refrain Sheet の画面。Shift_JIS のCSVを開き、編集したセルだけが色づいている',
    'csv.cap':
      'Shift_JIS の売上台帳を開いたところ。編集したセルだけが色づき、ステータスバーには文字コード・区切り文字・改行コードが表示されます。',
    'use.h2': '業務のCSVで、よくある困りごとに。',
    'use.c1t': '経理・税務',
    'use.c1h': '科目コードの「0」が消えて、取り込みでエラーになる',
    'use.c1p':
      'コードは文字列のまま保つので、指定された列構成や Shift_JIS の文字コードを崩さずに、仕訳や提出用のCSVを直せます。',
    'use.c2t': '人事・給与',
    'use.c2h': '社員番号や時刻が、勝手に数値や日付に変わる',
    'use.c2p':
      '値を型推論で変換しないので、社員番号・郵便番号の先頭ゼロや「HH:mm」の時刻も、書かれたとおりの文字のままです。',
    'use.c3t': '受発注・EC',
    'use.c3h': 'JANコードが 4.9E+12 のような表記になる',
    'use.c3p':
      '長い番号も数値として扱わないので、指数表記になりません。取引先が指定した列の順・区切り文字・引用符もそのままです。',
    'use.c4t': '集計・確認',
    'use.c4h': '書き出したCSVを、ちょっと集計して確かめたい',
    'use.c4p':
      'RSFスプレッドシートに変換すれば、数式やフィルタ、SQLで集計できます。元のCSVファイルは変更しません。',
    'use.c5t': '原因の調査',
    'use.c5h': 'どこが壊れているのか分からないCSVがある',
    'use.c5p': '閉じていない引用符やフィールド数の違いを、自動で直さずに、行と列の位置つきで確かめられます。',
    'sec.h2': '社外秘のデータも、パソコンの外に出さずに。',
    'sec.lead':
      '送信しない、実行しない、隠さない。社内のルールに照らして判断するための材料を、ひとつずつ確かめられます。',
    'sec.c1h': 'サーバーに送信しない',
    'sec.c1p':
      '開いたファイルは、ブラウザの中だけで処理します。Google ドライブ連携を使う場合を除き、外部には送信しません。',
    'sec.c2h': 'スクリプトを実行しない',
    'sec.c2p':
      'セルの内容は、常に文字として表示します。ファイルにHTMLやスクリプトが紛れ込んでいても、動き出すことはありません。',
    'sec.c3h': 'ソースコードを公開',
    'sec.c3p':
      'オープンソース（MIT ライセンス）なので、誰でも中身を確認できます。1つのHTMLファイルとして配布しています。',
    'sec.c4h': '配布版はネットワークに接続しない',
    'sec.c4p':
      'ダウンロードして使うオフライン版は、Content Security Policy でネットワーク接続そのものを禁止しています。',
    'sec.c5h': '依存を減らし、出どころを示す',
    'sec.c5p':
      '外部ライブラリは最小限に絞り、インストール時のスクリプトは実行しません。リリースには SHA-256、SBOM、ビルドの来歴の署名が付きます。',
    'faq.h2': 'よくある質問',
    'faq.q10': '無料で使えますか？',
    'faq.a10':
      'はい、無料です。MIT ライセンスのオープンソースで、アカウントの登録もいりません。ブラウザで開くWebアプリと、ダウンロードして使うオフライン版があります。',
    'faq.q2': 'Excelの代わりになりますか？',
    'faq.a2':
      '目的が違います。Refrain Sheet は手元のデータを壊さずに扱うための軽い表計算ソフトで、Excel 互換を保証するものではありません。CSVはそのまま編集し、数式や書式を使うときは RSF スプレッドシートに変換します。',
    'faq.q8': 'CSVの先頭の0が消えないようにできますか？',
    'faq.a8':
      'はい。値を型推論で変換しないため、「0123」や16桁以上の番号は書かれたとおりの文字列として扱われ、保存時もそのまま書き戻されます。ただし、取り込み先のシステムがその値を受け付けるかどうかは、取り込み先の仕様を事前にご確認ください。',
    'faq.q4': 'Shift_JISのCSVが文字化けしませんか？',
    'faq.a4':
      '開くときに文字コードを判定し、保存するときも同じ文字コードで書き戻します。判定と違う場合は、文字コードを指定して開き直せます。対応しているのは UTF-8（BOMあり／なし）、Shift_JIS / CP932、EUC-JP です。UTF-16 と ISO-2022-JP には対応しておらず、該当しそうなファイルは警告を表示したうえでベストエフォートで開きます（元のバイトは変更されません）。',
    'faq.q6': 'CSVのまま数式や色を付けられますか？',
    'faq.a6':
      'CSVのままではできません。数式や書式（太字・色・罫線など）はRSFスプレッドシートの機能で、使うときはRSFへ明示的に変換します。変換しても元のCSVファイルは変更されず、書式設定はセルの値・数式の結果・CSVの書き出しを変えません。',
    'faq.q1': 'データは外部へ送信されますか？',
    'faq.a1':
      '通常の編集では送信されません。ファイルはブラウザ内で読み込まれ、保存もお使いの端末に対して行われます。Webアプリで Google ドライブ連携を使ったときだけ、操作に応じてブラウザと Google ドライブの間で直接ファイルをやり取りします。',
    'faq.q11': 'インターネットにつながっていないパソコンで使えますか？',
    'faq.a11':
      '使えます。リリースページからオフライン版（ZIP）をダウンロードして展開し、index.html をブラウザで開くだけです。file:// でも動き、ネットワークには接続しません。',
    'faq.q3': '大きなCSVを開けますか？',
    'faq.a3':
      '既定の上限は512MiBで、設定で16MiB〜2GiBに変更できます。上限を超えるファイルは読み込む前に拒否されます。表示は仮想化されていますが、数百MB級のファイルは環境によって描画・編集が重くなることがあります。',
    'faq.q9': '壊れたCSVでも開けますか？',
    'faq.a9':
      '開けます。閉じていない引用符やフィールド数の不一致などを行・列つきで示したうえで、自動修復せずに開くかどうかを選べます。不正な箇所は編集しない限りバイト単位で保持されますが、壊れたままのデータを取り込み先のシステムが受け付けるとは限りません。',
    'faq.q5': '元のファイルに上書き保存できますか？',
    'faq.a5':
      'Chromium系のブラウザ（Chrome・Edge など）では、元のファイルに直接上書きできます。Firefox・Safari ではダウンロードでの保存になり、その旨が通知されます。',
    'faq.q7': 'この紹介ページにアクセス解析は入っていますか？',
    'faq.a7':
      'この紹介ページ（refrain-sheet.com）のみ、訪問数を把握するために Google Analytics を使う場合があります。読み込まれるのは、ページ下部の同意バナーで「同意する」を選んだ場合のみで、フッターの「Cookie設定」からいつでも選び直せます。CSVを編集するアプリ本体（app.refrain-sheet.com）はこの紹介ページとは別に配信されており、アクセス解析は含まれません。',
    'start.h2': '使いはじめは、3ステップ。',
    'start.s1h': 'ブラウザで開く',
    'start.s1p': 'インストールも登録もいりません。',
    'start.s2h': 'CSVをドラッグ＆ドロップ',
    'start.s2p': '文字コードを確かめて開きます。ファイルはパソコンの外に送られません。',
    'start.s3h': '直して、保存',
    'start.s3p': '変わるのは、直したところだけです。',
    'start.cta1': 'ブラウザで開いてみる',
    'start.cta2': 'オフライン版をダウンロード',
    'start.cta3': 'GitHubでソースコードを見る',
    'footer.tagline': 'CSVを壊さず編集できる、軽い表計算ソフト',
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
    'meta.title': 'Free CSV Editor & Lightweight Spreadsheet | Refrain Sheet',
    'meta.desc':
      'Edit CSV files without losing leading zeros, encoding or line endings. A free, lightweight spreadsheet with formulas and filters that runs in your browser — nothing to install.',
    'a11y.skip': 'Skip to main content',
    'nav.features': 'Features',
    'nav.csv': 'CSV',
    'nav.security': 'Security',
    'nav.faq': 'FAQ',
    'nav.cta': 'Open free',
    'hero.eyebrow': 'Runs in your browser. Free, nothing to install.',
    'hero.h1': 'A lightweight spreadsheet that edits CSV without breaking it',
    'hero.lead':
      'Leading zeros, encoding and line endings stay exactly as they were. Sort, filter and total your data with formulas. Your files never leave your computer.',
    'hero.cta1': 'Open in your browser',
    'hero.cta2': 'Download the offline version',
    'hero.badge1': 'UTF-8, Shift_JIS & more',
    'hero.badge2': 'Works offline',
    'hero.badge3': 'Open source (MIT)',
    'demo.file.csv': 'sales.csv',
    'demo.file.rsf': 'sales.rsf',
    'demo.h.name': 'Product',
    'demo.h.qty': 'Qty',
    'demo.h.sales': 'Sales',
    'demo.h.unit': 'Unit price',
    'demo.r1': 'Matcha latte base',
    'demo.r2': 'Ceremonial matcha',
    'demo.r3': 'Hojicha powder',
    'demo.n1': '1',
    'demo.n4': '4',
    'demo.step1': 'Open a Shift_JIS CSV with CRLF line endings',
    'demo.step2': 'Type a formula into a cell',
    'demo.step3': 'Convert it to an RSF spreadsheet',
    'demo.step4': 'Calculated — the original CSV file is unchanged',
    'demo.pause': 'Pause the demo',
    'demo.play': 'Play the demo',
    'pillars.p1h': 'Never breaks your CSV',
    'pillars.p1p':
      'Leading zeros, encoding and line endings stay as they were. Only the cells you edit change.',
    'pillars.p2h': 'A real spreadsheet, kept light',
    'pillars.p2p':
      'Formulas, filters, conditional formatting and multiple sheets. Just the features you use most.',
    'pillars.p3h': 'Your data stays with you',
    'pillars.p3p':
      'It runs entirely in your browser, so your files never need to be uploaded. One HTML file that works offline.',
    'feat.h2': 'Total it, tidy it, compare it —\nall in a lightweight spreadsheet.',
    'feat.lead':
      "It isn't meant to replace a full office suite. It's for working with the data in front of you, safely and quickly.",
    'feat.f1h': 'Formulas and 55 functions',
    'feat.f1p': '55 functions including SUMIFS, XLOOKUP, FILTER and UNIQUE, with references across sheets.',
    'feat.f2h': 'Sort and filter',
    'feat.f2p': 'Narrow down to the rows you need and put them in the order you want.',
    'feat.f3h': 'Data validation and conditional formatting',
    'feat.f3p': 'Limit what can be entered, and color the cells that match a rule.',
    'feat.f4h': 'Totals with SQL',
    'feat.f4p': 'Query your tables with SQL and see the results in a read-only view.',
    'feat.f5h': 'Compare two tables',
    'feat.f5p': 'Put two tabs side by side and see exactly what differs.',
    'feat.f6h': 'Comments and version history',
    'feat.f6p': 'Leave notes on cells, review earlier versions and restore them.',
    'feat.f7h': 'XLSX and JSON in and out',
    'feat.f7p': 'Import and export CSV, JSON and XLSX (exports contain values only).',
    'feat.f8h': 'Notes and settings sheets',
    'feat.f8p': 'Keep Markdown, JSON, YAML and plain-text sheets in the same file.',
    'csv.h2': 'Edit one cell,\nand only that cell changes.',
    'csv.p':
      'No garbled text, no lost leading zeros. CSV files headed back into accounting, payroll or ordering systems are saved just as they were opened. Save without editing and you get a byte-for-byte identical file.',
    'csv.k1': 'Leading zeros: kept',
    'csv.k2': 'Encoding: kept',
    'csv.k3': 'Line endings: kept',
    'csv.k4': 'Only the cells you edit change',
    'csv.alt': 'Refrain Sheet with a Shift_JIS CSV open; only the edited cell is highlighted',
    'csv.cap':
      'A Shift_JIS sales ledger open in Refrain Sheet. Only the edited cell is highlighted, and the status bar shows the encoding, delimiter and line endings.',
    'use.h2': 'For the everyday trouble with business CSV files.',
    'use.c1t': 'Accounting and tax',
    'use.c1h': 'Account codes lose their leading zero and the import fails',
    'use.c1p':
      'Codes stay as text, so you can fix journal and filing CSVs without disturbing the required columns or the Shift_JIS encoding.',
    'use.c2t': 'HR and payroll',
    'use.c2h': 'Employee IDs and times turn into numbers or dates',
    'use.c2p':
      'Values are never type-inferred, so leading zeros in employee IDs and postal codes, and "HH:mm" times, stay exactly as written.',
    'use.c3t': 'Orders and e-commerce',
    'use.c3h': 'A barcode number shows up as 4.9E+12',
    'use.c3p':
      'Long numbers are never treated as numbers, so they never switch to scientific notation. Your partner’s column order, delimiter and quoting stay as they were.',
    'use.c4t': 'Totals and checks',
    'use.c4h': 'You want to total an exported CSV to check it',
    'use.c4p':
      'Convert it to an RSF spreadsheet and total it with formulas, filters or SQL. The original CSV file is not changed.',
    'use.c5t': 'Troubleshooting',
    'use.c5h': 'A CSV is broken and you can’t tell where',
    'use.c5p':
      'See unclosed quotes and mismatched field counts with their row and column, without any automatic repair.',
    'sec.h2': 'Keep confidential data on your own computer.',
    'sec.lead':
      "Nothing uploaded, nothing executed, nothing hidden. Everything you need to check it against your company's policies.",
    'sec.c1h': 'Nothing is uploaded',
    'sec.c1p':
      'Files are processed inside your browser. Nothing is sent anywhere unless you choose to use Google Drive.',
    'sec.c2h': 'No scripts are run',
    'sec.c2p': 'Cell contents are always shown as plain text. HTML or scripts hidden in a file never run.',
    'sec.c3h': 'Open source',
    'sec.c3p':
      'Open source under the MIT license, so anyone can inspect it. Distributed as a single HTML file.',
    'sec.c4h': 'The offline version never connects',
    'sec.c4p':
      'The downloadable offline version blocks every network connection with its Content Security Policy.',
    'sec.c5h': 'Few dependencies, known origins',
    'sec.c5p':
      'Third-party libraries are kept to a minimum and no install scripts are run. Releases come with SHA-256 checksums, an SBOM and signed build provenance.',
    'faq.h2': 'Questions',
    'faq.q10': 'Is it free?',
    'faq.a10':
      'Yes. It is open source under the MIT license, with no account needed. Use the web app in your browser, or download the offline version.',
    'faq.q2': 'Is it a replacement for Excel?',
    'faq.a2':
      'No — it has a different purpose. Refrain Sheet is a lightweight spreadsheet for handling your data without breaking it, and Excel compatibility is not claimed. CSV files are edited as they are; for formulas and formatting you convert to an RSF spreadsheet.',
    'faq.q8': 'How do I keep leading zeros in a CSV file?',
    'faq.a8':
      'You don’t have to do anything. Values are never type-inferred, so "0123" or a number of 16 digits or more is handled as the text it is written as and written back unchanged on save. Whether the receiving system accepts that value depends on that system, so check its specification beforehand.',
    'faq.q4': 'Will a Shift_JIS CSV turn into garbled text?',
    'faq.a4':
      'No. The encoding is detected when the file opens, and the file is written back in the same encoding; if the detection is wrong, you can reopen the file with a chosen encoding. Supported encodings are UTF-8 (with or without BOM), Shift_JIS / CP932 and EUC-JP. UTF-16 and ISO-2022-JP are not supported; such files still open with a best-effort interpretation and a warning, and their bytes remain untouched.',
    'faq.q6': 'Can I add formulas or colors while keeping the file a CSV?',
    'faq.a6':
      'Not in the CSV itself. Formulas and formatting (bold, color, borders) are RSF spreadsheet features that require an explicit conversion to RSF. The original CSV file is not changed by the conversion, and formatting never changes a cell’s value, formula results or CSV export.',
    'faq.q1': 'Is my data sent anywhere?',
    'faq.a1':
      'Not during normal editing. Files are read inside the browser and saved back to your own device. Only when you use the Google Drive integration in the web app are files exchanged, at your request, directly between your browser and Google Drive.',
    'faq.q11': 'Can I use it on a computer that isn’t connected to the internet?',
    'faq.a11':
      'Yes. Download the offline version (ZIP) from the releases page, unzip it and open index.html in your browser. It works from file:// and never connects to the network.',
    'faq.q3': 'How large a file can it open?',
    'faq.a3':
      'The default limit is 512 MiB (adjustable from 16 MiB to 2 GiB) and oversized files are refused before their bytes are read. Rendering is virtualized, but files of hundreds of megabytes can still feel slow.',
    'faq.q9': 'Can I open a broken CSV file?',
    'faq.a9':
      'Yes. Problems such as unclosed quotes or field-count mismatches are listed with their rows and columns, and you choose whether to open the file without any automatic repair. Broken regions are kept byte-for-byte unless you edit them, but there is no guarantee the receiving system will accept the damaged data.',
    'faq.q5': 'Can it overwrite the original file?',
    'faq.a5':
      'In Chromium-based browsers (Chrome, Edge and others), yes. Firefox and Safari save by downloading instead, and the app tells you which kind of save happened.',
    'faq.q7': 'Does this introduction page use analytics?',
    'faq.a7':
      'Only this introduction page (refrain-sheet.com) may use Google Analytics, to measure visits. It loads only if you choose "Accept" in the consent banner at the bottom of the page, and you can change that choice anytime from "Cookie settings" in the footer. The app itself (app.refrain-sheet.com), where you edit CSVs, is served separately and contains no analytics.',
    'start.h2': 'Get started in three steps.',
    'start.s1h': 'Open it in your browser',
    'start.s1p': 'Nothing to install, no account to create.',
    'start.s2h': 'Drag and drop a CSV file',
    'start.s2p': 'The encoding is checked as it opens. Your file never leaves your computer.',
    'start.s3h': 'Edit and save',
    'start.s3p': 'Only what you changed is changed.',
    'start.cta1': 'Open in your browser',
    'start.cta2': 'Download the offline version',
    'start.cta3': 'View the source on GitHub',
    'footer.tagline': 'A lightweight spreadsheet that edits CSV without breaking it',
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
