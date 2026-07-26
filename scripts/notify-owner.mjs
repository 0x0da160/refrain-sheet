// SPDX-License-Identifier: MIT
// Bilingual owner-mention notice renderer for `.github/actions/notify-owner`.
//
// Renders one action-required notice: an `@`-mention of the repository owner,
// followed by a bilingual (English-then-Japanese) body the caller already
// composed, followed by a stable HTML marker used for de-duplication. It is a
// pure text renderer — no network access, no secrets, no `gh` calls — so the
// composite action can call it, and it can be exercised locally:
//
//   NOTIFY_OWNER=example NOTIFY_EVENT=blocked NOTIFY_RUN_ID=123 \
//     NOTIFY_BODY_EN="Body." NOTIFY_BODY_JA="本文。" \
//     node scripts/notify-owner.mjs
//
// Every field arrives through the environment; nothing here is interpolated
// into a shell, and the caller is responsible for keeping issue/PR/comment
// text out of these values (only workflow-controlled strings — URLs, labels,
// short statuses — belong in a mention notice).

/** Read a required env var, failing loudly if it is missing or empty. */
function required(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    process.stderr.write(`notify-owner: missing required env var ${name}\n`);
    process.exit(1);
  }
  return value;
}

const owner = required('NOTIFY_OWNER');
const event = required('NOTIFY_EVENT');
const runId = required('NOTIFY_RUN_ID');
const bodyEn = required('NOTIFY_BODY_EN');
const bodyJa = required('NOTIFY_BODY_JA');

process.stdout.write(
  [
    `@${owner}`,
    '',
    '## English',
    '',
    bodyEn.trim(),
    '',
    '## 日本語',
    '',
    bodyJa.trim(),
    '',
    `<!-- agent-notice:v1 type=${event} run=${runId} -->`,
    '',
  ].join('\n'),
);
