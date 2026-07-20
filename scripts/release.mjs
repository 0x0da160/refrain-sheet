// SPDX-License-Identifier: MIT
// One-command release for Refrain Sheet.
//
//   npm run release -- patch          # 0.2.4 -> 0.2.5
//   npm run release -- minor
//   npm run release -- major
//   npm run release -- v1.4.0         # explicit target version
//   npm run release -- patch --yes    # skip the confirmation prompt (CI)
//   npm run release -- patch --dry-run
//
// The script, in order:
//   1. validates the repository state and branch policy,
//   2. refuses to run with an unexpected dirty tree,
//   3. runs the full required checks (format, lint, TS tests, Rust tests,
//      security audit, production build, dist/WASM validation),
//   4. computes and validates the new SemVer version,
//   5. synchronizes package.json + package-lock.json (lockfile regenerated
//      through the approved `npm install --package-lock-only` procedure),
//   6. stages exactly the intended release files,
//   7. creates a clearly formatted release commit,
//   8. creates an annotated strict vMAJOR.MINOR.PATCH tag,
//   9. pushes the commit and the tag to the configured upstream.
//
// Safety: every git/npm call uses argument arrays (never a shell string), so
// nothing is interpolated into a shell. The script stops before any
// destructive or public step if an earlier step failed, never force-pushes,
// never overwrites or deletes tags, and never bypasses hooks. The GitHub
// Actions tag workflow remains responsible for building the GitHub Release and
// deploying Pages once the validated tag is pushed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ALLOWED_BRANCH = 'main';

function die(message, recovery) {
  console.error(`\nrelease: ERROR: ${message}`);
  if (recovery) {
    console.error(`\n${recovery}`);
  }
  process.exit(1);
}

/** Run git with an argument array; returns trimmed stdout. Never uses a shell. */
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFail) {
      return null;
    }
    die(`git ${args.join(' ')} failed:\n${err.stderr || err.message}`);
  }
}

/** Run an npm script (checks) with inherited stdio so output streams live. */
function npmRun(script, extra = []) {
  console.warn(`\nrelease: running \`npm run ${script}\`…`);
  try {
    execFileSync('npm', ['run', script, ...extra], { cwd: root, stdio: 'inherit' });
  } catch {
    die(
      `the \`${script}\` check failed. Fix it and re-run the release; nothing was committed, tagged, or pushed.`,
    );
  }
}

function parseArgs(argv) {
  const positionals = [];
  const flags = new Set();
  let remote = 'origin';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') flags.add('yes');
    else if (a === '--dry-run') flags.add('dry-run');
    else if (a === '--remote') remote = argv[++i];
    else if (a.startsWith('--remote=')) remote = a.slice('--remote='.length);
    else positionals.push(a);
  }
  return { bump: positionals[0], remote, yes: flags.has('yes'), dryRun: flags.has('dry-run') };
}

function computeVersion(current, bump) {
  if (!bump) {
    die('missing release argument. Use one of: patch | minor | major | vX.Y.Z');
  }
  // Explicit target version (with or without a leading `v`).
  const explicit = bump.startsWith('v') ? bump.slice(1) : /^\d+\.\d+\.\d+$/.test(bump) ? bump : null;
  if (explicit) {
    if (!SEMVER.test(explicit)) {
      die(`explicit version "${bump}" is not a strict MAJOR.MINOR.PATCH SemVer`);
    }
    return explicit;
  }
  const m = SEMVER.exec(current);
  if (!m) {
    die(`current package.json version "${current}" is not valid SemVer`);
  }
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      die(`unknown release argument "${bump}". Use: patch | minor | major | vX.Y.Z`);
  }
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  const { bump, remote, yes, dryRun } = parseArgs(process.argv.slice(2));

  // ----- 1. Repository state and branch policy -----
  if (git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) !== 'true') {
    die('not inside a git repository.');
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') {
    die('HEAD is detached. Check out the release branch first.');
  }
  if (branch !== ALLOWED_BRANCH) {
    die(`releases must run from "${ALLOWED_BRANCH}", not "${branch}".`);
  }
  const remotes = (git(['remote']) || '').split('\n').filter(Boolean);
  if (!remotes.includes(remote)) {
    die(`remote "${remote}" is not configured. Remotes: ${remotes.join(', ') || '(none)'}`);
  }

  // ----- 2. Clean tree (no unrelated changes before we stage version files) -----
  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    die(
      'the working tree has uncommitted changes. Commit or stash them first so the release commit contains only the version bump.\n\n' +
        dirty,
    );
  }

  // Up-to-date check against upstream (never release behind the remote).
  git(['fetch', remote, ALLOWED_BRANCH]);
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true });
  if (upstream) {
    const behind = git(['rev-list', '--count', `HEAD..${upstream}`]);
    if (behind !== '0') {
      die(`local ${branch} is ${behind} commit(s) behind ${upstream}. Pull first.`);
    }
  } else {
    console.warn(`release: note: ${branch} has no upstream; the push will set it.`);
  }

  // ----- 4. Compute and validate the target version -----
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const current = pkg.version;
  const version = computeVersion(current, bump);
  const tag = `v${version}`;

  if (version === current && !bump.startsWith('v')) {
    die(`computed version ${version} equals the current version.`);
  }
  // Tag must not already exist locally or on the remote.
  if (git(['tag', '--list', tag])) {
    die(`tag ${tag} already exists locally. Releases never overwrite tags.`);
  }
  if (git(['ls-remote', '--tags', remote, tag])) {
    die(`tag ${tag} already exists on ${remote}. Releases never overwrite tags.`);
  }

  const commitMessage = `Release ${tag}`;
  console.warn(
    [
      '',
      'release: plan',
      `  branch:  ${branch}`,
      `  remote:  ${remote}`,
      `  version: ${current} -> ${version}`,
      `  commit:  ${commitMessage}`,
      `  tag:     ${tag} (annotated)`,
      dryRun ? '  mode:    DRY RUN (no changes will be made)' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // ----- 3. Full required checks BEFORE any mutation -----
  npmRun('check:versions');
  npmRun('format:check');
  npmRun('lint');
  npmRun('test');
  npmRun('test:rust');
  npmRun('audit:ci');
  npmRun('build');
  npmRun('check:dist');

  if (dryRun) {
    console.warn('\nrelease: dry run complete — all checks passed. No files were changed.');
    return;
  }

  // ----- Confirmation gate before any staging/commit/tag/push -----
  if (!yes) {
    const proceed = await confirm(
      `\nType "yes" to bump to ${version}, commit "${commitMessage}", tag ${tag}, and push to ${remote}: `,
    );
    if (!proceed) {
      die('aborted by user. Nothing was changed.');
    }
  }

  // ----- 5. Synchronize version sources -----
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  // Regenerate the lockfile through the approved reproducible procedure only.
  try {
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch {
    // Roll back the package.json change so the tree is left clean.
    git(['checkout', '--', 'package.json'], { allowFail: true });
    die('failed to regenerate package-lock.json. package.json was restored; nothing was committed.');
  }
  // Confirm the two version sources now agree before committing.
  npmRun('check:versions', ['--', '--tag', tag]);

  // ----- 6. Stage exactly the intended files -----
  git(['add', '--', 'package.json', 'package-lock.json']);
  const staged = git(['diff', '--cached', '--name-only']);
  if (staged !== 'package.json\npackage-lock.json' && staged !== 'package.json') {
    die(`unexpected staged files:\n${staged}\nAborting before commit.`);
  }

  // ----- 7. Release commit -----
  git(['commit', '-m', commitMessage]);
  const commitSha = git(['rev-parse', 'HEAD']);
  console.warn(`release: committed ${commitSha.slice(0, 12)} "${commitMessage}"`);

  // ----- 8. Annotated tag (only after the commit succeeded) -----
  git(['tag', '-a', tag, '-m', `Refrain Sheet ${tag}`]);
  console.warn(`release: created annotated tag ${tag}`);

  // ----- 9. Push commit, then tag (never with --force) -----
  const recovery =
    `The release commit and tag exist LOCALLY but were not pushed. To finish:\n` +
    `  git push ${remote} ${branch}\n` +
    `  git push ${remote} ${tag}\n` +
    `To undo the local release instead:\n` +
    `  git tag -d ${tag}\n` +
    `  git reset --hard HEAD~1`;

  try {
    execFileSync('git', ['push', remote, branch], { cwd: root, stdio: 'inherit' });
  } catch {
    die('failed to push the release commit.', recovery);
  }
  try {
    execFileSync('git', ['push', remote, tag], { cwd: root, stdio: 'inherit' });
  } catch {
    die(
      'the commit was pushed but pushing the tag failed.',
      `Finish with:\n  git push ${remote} ${tag}\nTo undo the local tag:\n  git tag -d ${tag}`,
    );
  }

  console.warn(
    `\nrelease: done. Pushed ${commitMessage} and ${tag} to ${remote}.\n` +
      `The GitHub Actions release workflow now validates the tag, publishes the\n` +
      `GitHub Release (ZIP + SHA-256 + SBOM + provenance), and deploys Pages.`,
  );
}

main().catch((err) => die(err?.stack || String(err)));
