# EOL plan

## English

**Reviewed 2026-09-26. Next review due by 2026-12-27** (`npm run check:eol`
fails after that date). Built from the full SBOM (`npm run sbom:full`: 362
components: 327 npm packages, 17 Rust crates, 7 toolchain entries — two
Node.js lines, Debian, Rust, rustup, wasm-pack, wasm-bindgen-cli — and 11
GitHub Action majors; the 42 direct and toolchain components each have a
lifecycle entry). The machine-readable source of truth is
[`eol-register.json`](eol-register.json); the policy is in
[`knowledge/operations/dependency-lifecycle.md`](../knowledge/operations/dependency-lifecycle.md).

### Done in this review

| Component                 | Before                                                                 | After                  | Why                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Vitest                    | 3.2                                                                    | 5.0                    | GHSA-82fw-gwwq-j7x9 (moderate) is fixed only in 5.x; 3.x is unsupported                               |
| Vite                      | 6.4                                                                    | 8.3 (Rolldown)         | 6 is two majors behind (security fixes only)                                                          |
| ESLint / @eslint/js       | 9                                                                      | 10                     | 9 left maintenance six months after 10                                                                |
| TypeScript                | 5.9                                                                    | 6.0                    | 5.x no longer updated; 7.x blocked on typescript-eslint                                               |
| jsdom / fast-check        | 26 / 3                                                                 | 30 / 4                 | Only the newest major is maintained                                                                   |
| Node.js (CI, Docker)      | 22                                                                     | 24                     | 24 is Active LTS (EOL 2028-04-30); 22 ends 2027-04-30                                                 |
| Debian (Docker base)      | 12 bookworm                                                            | 13 trixie              | bookworm left regular security support on 2026-06-10                                                  |
| Rust toolchain            | 1.84.1                                                                 | 1.98.1                 | 14 releases behind; unlocked ruzstd 0.9                                                               |
| wasm-pack / wasm-bindgen  | 0.13.1 / 0.2.100                                                       | 0.15.0 / 0.2.129       | Current releases; wasm-bindgen moved to github.com/wasm-bindgen                                       |
| miniz_oxide / ruzstd      | 0.8.0 / 0.8.1                                                          | 0.9.1 / 0.9.0          | Current releases; frozen `.rsf` fixtures unchanged                                                    |
| CI actions                | checkout/setup-node v5, cache/upload-artifact v4, dependency-review v4 | v7 / v7 / v6 / v7 / v5 | The replaced cache, upload-artifact and dependency-review majors ran on the deprecated node20 runtime |
| Runtime npm (patch/minor) | sql.js 1.14.1, lucide 1.28.0, encoding-japanese 2.3.0                  | 1.14.2, 1.48.0, 2.4.0  | Routine updates; `@types/encoding-japanese` dropped (types now bundled)                               |

### Approved, not yet applied (to do)

The maintainer approved every open item on 2026-09-26 (「承認するので全て実施して」).
The agent session could not apply them: its permission policy denied editing
the release/deploy workflows and querying the npm registry. Pick these up
next, in this order:

1. **Release/deploy workflows** — one commit over `release.yml`,
   `manual-release.yml`, `release-docs.yml`: `node-version: 22` → `24`,
   `checkout@v5` → `v7`, `setup-node@v5` → `v7`, `upload-pages-artifact@v3`
   → `v5`, `attest-build-provenance@v2` → `v4`, `configure-pages@v5` → `v6`,
   `deploy-pages@v4` → `v5`. Pre-checked: no `permissions` change is needed
   (attest v4 creates a storage record only with `push-to-registry: true`);
   `dist-hosted/` has no dotfiles, so upload-pages-artifact's hidden-file
   exclusion does not matter; checkout v6+ keeps `git push` and
   `--force-with-lease` working. Then in `eol-register.json` remove
   `generic:nodejs@22`, `github:actions/checkout@5`, `setup-node@5`,
   `configure-pages@5`, `deploy-pages@4`, `upload-pages-artifact@3` and
   `attest-build-provenance@2`, and add `github:actions/configure-pages@6`,
   `deploy-pages@5`, `upload-pages-artifact@5`, `attest-build-provenance@4`.
   Verify with `npm run check:eol` and the first tag release after merging.
2. **sql.js** — check for a release newer than 1.14.2 and the SQLite it
   embeds (`npm view sql.js version`); record the result on `npm:sql.js@1`.
3. **TypeScript 7** — check whether typescript-eslint's peer range accepts
   `typescript@7` (`npm view typescript-eslint peerDependencies`); upgrade if it does.
4. **wasm-pack** — open an Issue to decide whether to replace it with
   cargo + wasm-bindgen-cli.

### Open plan

| Due        | Component                                                                                             | Action                                                                                                                      | Approval        |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 2026-10-31 | configure-pages@5, deploy-pages@4, upload-pages-artifact@3, attest-build-provenance@2 (`release.yml`) | Move to v6 / v5 / v5 / v4 — these run on the deprecated node20 Actions runtime                                              | Human (deploy)  |
| 2026-12-31 | Node.js 22, checkout@5, setup-node@5 (release workflows)                                              | Move `release.yml`, `manual-release.yml`, `release-docs.yml` to Node.js 24, checkout@v7, setup-node@v7                      | Human (release) |
| 2026-12-31 | sql.js 1.x (embeds SQLite 3.49.1)                                                                     | Check whether sql.js ships a newer SQLite; if advisories apply and it lags, open an Issue on building SQLite WASM ourselves | Issue           |
| 2027-01-15 | Rust 1.98                                                                                             | Bump to the current stable (policy: never more than four releases behind), rebuild the WASM payload                         | Normal PR       |
| 2027-03-31 | TypeScript 6.0                                                                                        | Move to 7.x once typescript-eslint supports it                                                                              | Normal PR       |
| 2027-03-31 | wasm-pack 0.15                                                                                        | Decide whether to drop wasm-pack for cargo + wasm-bindgen-cli (rustwasm org archived in 2025)                               | Issue           |

### Horizon (no action yet)

- **Node.js 24 → 26:** 26 becomes LTS on 2026-10-28; plan the move at the
  2027 Q2 review, well before 24's end of life (2028-04-30).
- **Debian 13 trixie:** regular security support until about 2028-08; LTS to
  2030-06-30.

## 日本語

**2026-09-26 にレビュー実施。次回レビュー期限は 2026-12-27**（期限を過ぎると
`npm run check:eol` が失敗します）。フル SBOM（`npm run sbom:full`：362
コンポーネント：npm パッケージ 327、Rust クレート 17、ツールチェーン 7 件
（Node.js 2 系列・Debian・Rust・rustup・wasm-pack・wasm-bindgen-cli）、GitHub
Actions のメジャー 11 件。直接依存とツールチェーンの 42 件すべてにライフサイクル
エントリあり）を基に作成しました。機械可読な正本は
[`eol-register.json`](eol-register.json)、方針は
[`knowledge/operations/dependency-lifecycle.md`](../knowledge/operations/dependency-lifecycle.md)
にあります。

### 今回のレビューで実施済み

| コンポーネント                | 変更前                      | 変更後           | 理由                                                                                              |
| ----------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| Vitest                        | 3.2                         | 5.0              | GHSA-82fw-gwwq-j7x9（moderate）の修正は 5.x のみ。3.x はサポート外                                |
| Vite                          | 6.4                         | 8.3（Rolldown）  | 6 は 2 メジャー遅れ（セキュリティ修正のみ）                                                       |
| ESLint / @eslint/js           | 9                           | 10               | 9 は 10 のリリース後 6 か月で保守終了                                                             |
| TypeScript                    | 5.9                         | 6.0              | 5.x は更新終了。7.x は typescript-eslint の対応待ち                                               |
| jsdom / fast-check            | 26 / 3                      | 30 / 4           | 最新メジャーのみ保守                                                                              |
| Node.js（CI・Docker）         | 22                          | 24               | 24 は Active LTS（EOL 2028-04-30）。22 は 2027-04-30 に EOL                                       |
| Debian（Docker ベース）       | 12 bookworm                 | 13 trixie        | bookworm は 2026-06-10 に通常のセキュリティサポート終了                                           |
| Rust ツールチェーン           | 1.84.1                      | 1.98.1           | 14 リリース遅れ。ruzstd 0.9 の前提                                                                |
| wasm-pack / wasm-bindgen      | 0.13.1 / 0.2.100            | 0.15.0 / 0.2.129 | 最新版。wasm-bindgen は github.com/wasm-bindgen へ移管                                            |
| miniz_oxide / ruzstd          | 0.8.0 / 0.8.1               | 0.9.1 / 0.9.0    | 最新版。固定 `.rsf` フィクスチャのバイト列は不変                                                  |
| CI の Actions                 | checkout/setup-node v5 ほか | v7 など          | 置き換えた cache・upload-artifact・dependency-review のメジャーは非推奨の node20 ランタイムで動作 |
| 実行時 npm（パッチ/マイナー） | sql.js 1.14.1 ほか          | 1.14.2 ほか      | 定常更新。`@types/encoding-japanese` は同梱型定義に置き換え削除                                   |

### 承認済み・未実施（要対応）

2026-09-26 に全項目が承認済み（「承認するので全て実施して」）。エージェント
セッションの権限ポリシーにより、リリース/デプロイ系ワークフローの編集と npm
レジストリの照会が拒否されたため未実施です。次の順に対応します。

1. **リリース/デプロイ系ワークフロー** — `release.yml`・`manual-release.yml`・
   `release-docs.yml` を 1 コミットで更新：`node-version: 22` → `24`、
   `checkout@v5` → `v7`、`setup-node@v5` → `v7`、`upload-pages-artifact@v3`
   → `v5`、`attest-build-provenance@v2` → `v4`、`configure-pages@v5` → `v6`、
   `deploy-pages@v4` → `v5`。事前確認済み：`permissions` の変更は不要（attest
   v4 のストレージレコードは `push-to-registry: true` のときのみ）、`dist-hosted/`
   にドットファイルはなく、checkout v6 以降も `git push` と `--force-with-lease`
   は動作します。あわせて `eol-register.json` の旧キー（上記 English 参照）を
   削除し新キーを追加、`npm run check:eol` とマージ後最初のタグリリースで確認。
2. **sql.js** — 1.14.2 より新しい版と内蔵 SQLite を確認し
   （`npm view sql.js version`）、`npm:sql.js@1` に結果を記録。
3. **TypeScript 7** — typescript-eslint の peer 範囲が `typescript@7` を含むか確認
   （`npm view typescript-eslint peerDependencies`）し、対応済みなら更新。
4. **wasm-pack** — cargo + wasm-bindgen-cli への置き換えを判断する Issue を作成。

### 未完了の計画

| 期限       | 対象                                                                                                   | 対応                                                                                                | 承認             |
| ---------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------- |
| 2026-10-31 | `release.yml` の configure-pages@5・deploy-pages@4・upload-pages-artifact@3・attest-build-provenance@2 | v6 / v5 / v5 / v4 へ（非推奨の node20 ランタイム）                                                  | 人間（デプロイ） |
| 2026-12-31 | リリース系ワークフローの Node.js 22・checkout@5・setup-node@5                                          | `release.yml`・`manual-release.yml`・`release-docs.yml` を Node.js 24・v7 へ                        | 人間（リリース） |
| 2026-12-31 | sql.js 1.x（SQLite 3.49.1 を内包）                                                                     | 新しい SQLite を含む版の有無を確認。遅れていて該当アドバイザリがあれば自前ビルドを Issue 化         | Issue            |
| 2027-01-15 | Rust 1.98                                                                                              | 最新安定版へ（方針：安定版から 4 リリース以上遅れない）。WASM ペイロード再ビルド                    | 通常 PR          |
| 2027-03-31 | TypeScript 6.0                                                                                         | typescript-eslint の対応後に 7.x へ                                                                 | 通常 PR          |
| 2027-03-31 | wasm-pack 0.15                                                                                         | wasm-pack を廃し cargo + wasm-bindgen-cli に置き換えるか判断（rustwasm org は 2025 年にアーカイブ） | Issue            |

### 先の見通し（現時点で対応不要）

- **Node.js 24 → 26:** 26 は 2026-10-28 に LTS 入り。24 の EOL（2028-04-30）
  より十分前、2027 年 Q2 のレビューで移行を計画します。
- **Debian 13 trixie:** 通常のセキュリティサポートは 2028-08 頃まで、LTS は
  2030-06-30 まで。
