// SPDX-License-Identifier: MIT
// Bilingual release summary for the manual release workflow.
//
// Writes the English-then-Japanese result block that
// `.github/workflows/manual-release.yml` puts in the run summary. It exists as a
// checked-in script so both the validation path and the post-release path render
// the SAME block from one implementation, and so the rendering can be tested
// locally without running a workflow:
//
//   RESULT=dry-run PR_NUMBER=42 RELEASE_TYPE=patch SOURCE_SHA=abc123 \
//     VERSION_TAG=v0.5.1 node scripts/release-summary.mjs
//
// Every field arrives through the environment; nothing is interpolated into a
// shell, and the script never reads a secret, a token, or a log.

const RESULTS = {
  released: ['released', 'リリース完了'],
  'dry-run': ['dry run passed', 'dry run成功'],
  'already-released': ['already released', '既にリリース済み'],
  stopped: ['stopped', '停止'],
};

/** Read an env var, returning a placeholder when it is unset or empty. */
function field(name, fallbackEn, fallbackJa = fallbackEn) {
  const value = (process.env[name] ?? '').trim();
  return value ? [value, value] : [fallbackEn, fallbackJa];
}

/** Wrap a value in backticks unless it is a placeholder. */
function code(value, placeholder) {
  return value === placeholder ? value : `\`${value}\``;
}

const resultKey = (process.env.RESULT ?? '').trim();
const [resultEn, resultJa] = RESULTS[resultKey] ?? RESULTS.stopped;

const [prEn] = field('PR_NUMBER', 'unknown', '不明');
const [typeEn] = field('RELEASE_TYPE', 'unknown', '不明');
const [shaEn, shaJa] = field('SOURCE_SHA', 'not resolved', '未解決');
const [tagEn, tagJa] = field('VERSION_TAG', 'not determined', '未確定');
const [relEn, relJa] = field('RELEASE_URL', 'not created', '未作成');
const [pagesEn, pagesJa] = field('PAGES_URL', 'not deployed', '未デプロイ');
const [actionEn] = field('ACTION_EN', 'None.');
const [actionJa] = field('ACTION_JA', 'なし。');

process.stdout.write(
  [
    '## English',
    '',
    '### Release recovery result',
    `- PR: #${prEn}`,
    `- Release type: \`${typeEn}\``,
    `- Source commit: ${code(shaEn, 'not resolved')}`,
    `- Result: ${resultEn}`,
    `- Version/tag: ${code(tagEn, 'not determined')}`,
    `- GitHub Release: ${relEn}`,
    `- Pages: ${pagesEn}`,
    `- Required action: ${actionEn}`,
    '',
    '## 日本語',
    '',
    '### リリース復旧の結果',
    `- PR: #${prEn}`,
    `- リリース種別: \`${typeEn}\``,
    `- ソースコミット: ${code(shaJa, '未解決')}`,
    `- 結果: ${resultJa}`,
    `- バージョン／タグ: ${code(tagJa, '未確定')}`,
    `- GitHub Release: ${relJa}`,
    `- Pages: ${pagesJa}`,
    `- 必要な対応: ${actionJa}`,
    '',
  ].join('\n'),
);
