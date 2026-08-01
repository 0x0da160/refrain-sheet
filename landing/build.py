# SPDX-License-Identifier: MIT
"""Build the Refrain Sheet landing page.

Generates a fully pre-rendered page per language (crawlable without JS):
    index.html      Japanese
    en/index.html   English

Also writes robots.txt, and — when a public site URL is passed — canonical
tags, hreflang alternates, absolute OG URLs and sitemap.xml.

    python3 build.py                      # relative URLs (preview)
    python3 build.py https://example.com/ # production
"""
import json
import os
import re
import sys
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = sys.argv[1].rstrip("/") + "/" if len(sys.argv) > 1 else None

APP = "https://0x0da160.github.io/refrain-sheet/"
REPO = "https://github.com/0x0da160/refrain-sheet"
OG_IMG = "assets/refrain-sheet-og-image.png"
PAGES = {"ja": "index.html", "en": "en/index.html"}


def load_dict():
    """Evaluate i18n.js with node and hand the dictionaries back as JSON."""
    import subprocess
    js = (
        "global.window={};require(%r);"
        "process.stdout.write(JSON.stringify(window.I18N));" % os.path.join(ROOT, "i18n.js")
    )
    return json.loads(subprocess.check_output(["node", "-e", js], text=True))


FEATURES = {
    "ja": [
        "無編集で保存すると元ファイルとバイト単位で完全一致",
        "編集時に再シリアライズされるのは該当フィールドのバイト範囲だけ",
        "UTF-8 / Shift_JIS / CP932 / EUC-JP の自動判定と、文字コードを指定した開き直し",
        "保存時に文字コード・BOM・改行コードを個別に指定",
        "壊れたCSVを修復せず、行・列つきの診断を提示して開く",
        "RSFスプレッドシート（55関数・複数シート・XLSXエクスポート）",
        "完全オフライン動作。実行時のネットワーク通信ゼロ",
    ],
    "en": [
        "Byte-identical output when a file is saved without edits",
        "Only the edited field's byte range is re-serialized",
        "Automatic detection of UTF-8, Shift_JIS, CP932 and EUC-JP, plus reopen with a chosen encoding",
        "Choose character encoding, BOM and line endings independently when saving",
        "Opens malformed CSV without repairing it, with row/column diagnostics",
        "RSF spreadsheet mode with 55 functions, multiple sheets and XLSX export",
        "Runs fully offline with zero network requests at runtime",
    ],
}
OG_ALT = {
    "ja": "Refrain Sheet で Shift_JIS のCSVを開いた画面",
    "en": "Refrain Sheet showing a Shift_JIS CSV file",
}
LOCALE = {"ja": "ja_JP", "en": "en_US"}


def rel(path, depth):
    return ("../" * depth) + path


def abs_or_rel(path, depth):
    return SITE + path if SITE else rel(path, depth)


def build(lang, dicts):
    d = dicts[lang]
    depth = PAGES[lang].count("/")
    soup = BeautifulSoup(open(os.path.join(ROOT, "template.html"), encoding="utf-8").read(), "html.parser")
    soup.html["lang"] = lang

    # ---------- copy ----------
    for el in soup.select("[data-i18n]"):
        key = el["data-i18n"]
        if key not in d:
            raise SystemExit("missing key: " + key)
        attr = el.get("data-i18n-attr")
        if attr:
            el[attr] = d[key]
        elif el.find(True) is None:
            el.string = d[key]

    # ---------- language switcher ----------
    hrefs = {"ja": {"ja": "./", "en": "en/"}, "en": {"ja": "../", "en": "./"}}[lang]
    for a in soup.select(".lang a"):
        code = a["data-lang"]
        a["href"] = hrefs[code]
        if code == lang:
            a["aria-current"] = "page"
        else:
            a.attrs.pop("aria-current", None)

    # ---------- relative asset paths ----------
    if depth:
        for el in soup.find_all(["link", "script", "img"]):
            attr = "href" if el.name == "link" else "src"
            v = el.get(attr)
            if v and not re.match(r"^(https?:|#|/|\.\.)", v):
                el[attr] = rel(v, depth)

    # ---------- head ----------
    head = soup.head
    for el in head.select('[data-seo="1"]'):
        el.decompose()

    def meta(**kw):
        t = soup.new_tag("meta")
        for k, v in kw.items():
            t[k.replace("_", ":") if k.startswith("og_") or k.startswith("twitter_") else k] = v
        t["data-seo"] = "1"
        head.append(t)

    def prop(name, content):
        t = soup.new_tag("meta")
        t["property"] = name
        t["content"] = content
        t["data-seo"] = "1"
        head.append(t)

    def named(name, content):
        t = soup.new_tag("meta")
        t["name"] = name
        t["content"] = content
        t["data-seo"] = "1"
        head.append(t)

    def link(**kw):
        t = soup.new_tag("link")
        for k, v in kw.items():
            t[k] = v
        t["data-seo"] = "1"
        head.append(t)

    soup.title.string = d["meta.title"]
    desc = head.select_one('meta[name="description"]')
    desc["content"] = d["meta.desc"]

    named("robots", "index,follow,max-image-preview:large,max-snippet:-1")
    named("theme-color", "#1f7a4a")
    named("author", "0x0da160")

    if SITE:
        page_url = SITE + ("" if lang == "ja" else "en/")
        link(rel="canonical", href=page_url)
        link(rel="alternate", hreflang="ja", href=SITE)
        link(rel="alternate", hreflang="en", href=SITE + "en/")
        link(rel="alternate", hreflang="x-default", href=SITE)
        prop("og:url", page_url)

    prop("og:type", "website")
    prop("og:site_name", "Refrain Sheet")
    prop("og:title", d["meta.title"])
    prop("og:description", d["meta.desc"])
    prop("og:image", abs_or_rel(OG_IMG, depth))
    prop("og:image:width", "1200")
    prop("og:image:height", "630")
    prop("og:image:alt", OG_ALT[lang])
    prop("og:locale", LOCALE[lang])
    prop("og:locale:alternate", LOCALE["en" if lang == "ja" else "ja"])
    named("twitter:card", "summary_large_image")
    named("twitter:title", d["meta.title"])
    named("twitter:description", d["meta.desc"])
    named("twitter:image", abs_or_rel(OG_IMG, depth))
    named("twitter:image:alt", OG_ALT[lang])

    # ---------- structured data ----------
    app = {
        "@context": "https://schema.org",
        "@type": ["SoftwareApplication", "WebApplication"],
        "name": "Refrain Sheet",
        "applicationCategory": "BusinessApplication",
        "applicationSubCategory": "CSV editor",
        "operatingSystem": "Web browser (Chromium, Firefox, Safari)",
        "browserRequirements": "Requires JavaScript. File System Access API needed for in-place overwrite (Chromium).",
        "description": d["meta.desc"],
        "url": APP,
        "installUrl": APP,
        "downloadUrl": REPO + "/releases/",
        "sameAs": [REPO],
        "license": "https://opensource.org/licenses/MIT",
        "isAccessibleForFree": True,
        "inLanguage": ["ja", "en"],
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "JPY"},
        "author": {"@type": "Person", "name": "0x0da160", "url": "https://github.com/0x0da160"},
        "featureList": FEATURES[lang],
        "screenshot": {
            "@type": "ImageObject",
            "contentUrl": abs_or_rel("assets/refrain-sheet-shift-jis-csv-editor.webp", depth),
            "caption": d["hero.alt"],
        },
        "image": abs_or_rel(OG_IMG, depth),
    }
    graph = [app]
    if SITE:
        graph.append({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "Refrain Sheet",
            "url": SITE,
            "inLanguage": lang,
        })
    for obj in graph:
        s = soup.new_tag("script", type="application/ld+json")
        s["data-seo"] = "1"
        s.string = json.dumps(obj, ensure_ascii=False, indent=2)
        head.append(s)

    out = os.path.join(ROOT, PAGES[lang])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(str(soup))
    return out


def main():
    dicts = load_dict()
    for lang in PAGES:
        print("built", build(lang, dicts))

    robots = "User-agent: *\nAllow: /\n"
    if SITE:
        robots += "\nSitemap: %ssitemap.xml\n" % SITE
    open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write(robots)

    sm = os.path.join(ROOT, "sitemap.xml")
    if SITE:
        urls = []
        for lang in PAGES:
            loc = SITE + ("" if lang == "ja" else "en/")
            alts = "".join(
                '\n    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (l, SITE + ("" if l == "ja" else "en/"))
                for l in ("ja", "en")
            )
            alts += '\n    <xhtml:link rel="alternate" hreflang="x-default" href="%s"/>' % SITE
            urls.append("  <url>\n    <loc>%s</loc>%s\n  </url>" % (loc, alts))
        open(sm, "w", encoding="utf-8").write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(urls) + "\n</urlset>\n"
        )
        print("built sitemap.xml")
    elif os.path.exists(sm):
        os.remove(sm)


if __name__ == "__main__":
    main()
