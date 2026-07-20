// SPDX-License-Identifier: MIT
// Guards the release + GitHub Pages workflow so a refactor can't silently
// deploy on the wrong trigger, drop a required check, widen permissions, or
// stop uploading the built dist/. The workflow is validated as text (no YAML
// dependency): the assertions are deliberately structural and phrased to
// survive incidental formatting changes.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// Paths are relative to the project root (vitest's working directory).
const release = readFileSync('.github/workflows/release.yml', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const dependencyReview = readFileSync('.github/workflows/dependency-review.yml', 'utf8');
const allWorkflows = [release, ci, dependencyReview];

describe('release + Pages workflow triggers', () => {
  it('triggers only on version tags — never on branches or pull requests', () => {
    // A tags filter exists; no branch/PR triggers live in the release workflow.
    expect(release).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:/);
    expect(release).not.toMatch(/^\s*pull_request:/m);
    expect(release).not.toMatch(/^\s*branches:/m);
  });

  it('restricts the tag filter to a numeric vMAJOR.MINOR.PATCH glob', () => {
    // The filter must be numeric, not a broad "v*" that would fire on any tag.
    const filter = /tags:\s*\n(?:\s*#[^\n]*\n)*\s*-\s*'([^']+)'/.exec(release)?.[1];
    expect(filter).toBe('v[0-9]+.[0-9]+.[0-9]+');
    expect(release).not.toMatch(/-\s*'v\*'/);
  });

  it('re-validates the tag with a strict semantic-version regex', () => {
    // Defense in depth: extract the guard regex and prove it accepts real
    // version tags and rejects malformed / non-version ones.
    const raw = /grep -Eq '(\^v[^']+\$)'/.exec(release)?.[1];
    expect(raw).toBeTruthy();
    const re = new RegExp(raw!);
    for (const good of ['v0.1.1', 'v0.2.2', 'v10.20.30']) {
      expect(re.test(good)).toBe(true);
    }
    for (const bad of ['v1.2', 'v1.2.3.4', 'v1.2.x', 'nightly', 'release-1', 'v1', '1.2.3']) {
      expect(re.test(bad)).toBe(false);
    }
  });
});

describe('release + Pages workflow permissions and jobs', () => {
  it('defaults to read-only and grants contents:write only to the release job', () => {
    // Top-level permissions are read-only.
    expect(release).toMatch(/^permissions:\s*\n\s*contents:\s*read\s*$/m);
    // The release job is the only place contents:write appears.
    const writes = release.match(/contents:\s*write/g) ?? [];
    expect(writes).toHaveLength(1);
  });

  it('builds and uploads the built dist/ as the Pages artifact after checks', () => {
    // Every check + build precedes the artifact upload.
    const formatAt = release.indexOf('npm run format:check');
    const lintAt = release.indexOf('npm run lint');
    const testAt = release.indexOf('npm run test');
    const buildAt = release.indexOf('npm run build');
    const uploadAt = release.indexOf('actions/upload-pages-artifact');
    for (const at of [formatAt, lintAt, testAt, buildAt, uploadAt]) {
      expect(at).toBeGreaterThan(-1);
    }
    expect(buildAt).toBeGreaterThan(Math.max(formatAt, lintAt, testAt));
    expect(uploadAt).toBeGreaterThan(buildAt);
    // The artifact is the production dist/ directory.
    expect(release).toMatch(/uses:\s*actions\/upload-pages-artifact@v\d+\s*\n\s*with:\s*\n\s*path:\s*dist/);
  });

  it('deploys via a job that depends on the release job and uses the Pages actions', () => {
    const deploy = release.slice(release.indexOf('deploy-pages:'));
    expect(deploy).toMatch(/deploy-pages:\s*\n\s*needs:\s*release/);
    expect(deploy).toContain('actions/configure-pages@');
    expect(deploy).toContain('actions/deploy-pages@');
  });

  it('grants the deploy job only pages:write + id-token:write and no secrets', () => {
    const deploy = release.slice(release.indexOf('deploy-pages:'));
    expect(deploy).toMatch(/permissions:\s*\n\s*pages:\s*write\s*\n\s*id-token:\s*write/);
    // The Pages actions authenticate with the run token/OIDC — no secrets.
    expect(release).not.toContain('secrets.');
  });

  it('uses the github-pages environment and exposes the deployed URL as output', () => {
    const deploy = release.slice(release.indexOf('deploy-pages:'));
    expect(deploy).toMatch(/environment:\s*\n\s*name:\s*github-pages/);
    // The live URL is surfaced both on the environment and as a job output.
    expect(deploy).toMatch(/url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/);
    expect(deploy).toMatch(
      /outputs:\s*\n\s*page_url:\s*\$\{\{\s*steps\.deployment\.outputs\.page_url\s*\}\}/,
    );
  });
});

describe('CI workflow never deploys', () => {
  it('runs on PRs/main but performs no Pages deployment', () => {
    expect(ci).toMatch(/pull_request:/);
    expect(ci).not.toContain('actions/deploy-pages');
    expect(ci).not.toContain('actions/upload-pages-artifact');
  });

  it('is read-only and runs the supply-chain gates', () => {
    expect(ci).toMatch(/^permissions:\s*\n\s*contents:\s*read\s*$/m);
    expect(ci).not.toMatch(/:\s*write\b/); // no permission is granted write in CI
    // Install disables lifecycle scripts; the security/consistency gates run.
    expect(ci).toContain('npm ci --ignore-scripts');
    expect(ci).toContain('npm run check:versions');
    expect(ci).toContain('npm run audit:ci');
    // A clean-tree assertion guards against drifting lockfiles / stray output.
    expect(ci).toContain('git status --porcelain');
  });
});

describe('supply-chain hardening', () => {
  it('never installs with lifecycle scripts enabled (no bare `npm ci`)', () => {
    for (const wf of [release, ci]) {
      // Every `npm ci` must carry --ignore-scripts.
      const bare = wf.match(/npm ci(?! --ignore-scripts)/g) ?? [];
      expect(bare).toHaveLength(0);
    }
  });

  it('never uses the dangerous pull_request_target trigger', () => {
    for (const wf of allWorkflows) {
      expect(wf).not.toContain('pull_request_target');
    }
  });

  it('pins any non-official action to a full commit SHA', () => {
    // Policy: official GitHub-maintained actions/* may use a version tag; any
    // other (third-party) action must be pinned to a 40-hex commit SHA.
    for (const wf of allWorkflows) {
      const uses = [...wf.matchAll(/uses:\s*([^\s@]+)@(\S+)/g)];
      for (const [, action, ref] of uses) {
        if (!action.startsWith('actions/')) {
          expect(ref, `${action} must be SHA-pinned`).toMatch(/^[0-9a-f]{40}$/);
        }
      }
    }
  });

  it('release job produces an SBOM and a build-provenance attestation', () => {
    const releaseJob = release.slice(0, release.indexOf('deploy-pages:'));
    expect(releaseJob).toContain('npm run --silent sbom');
    expect(releaseJob).toContain('actions/attest-build-provenance@');
    // The provenance permissions live on the release job only.
    expect(releaseJob).toMatch(/attestations:\s*write/);
  });

  it('re-checks version consistency (package.json ⇄ lockfile ⇄ tag) on release', () => {
    expect(release).toMatch(/npm run check:versions -- --tag/);
  });
});

describe('dependency-review workflow', () => {
  it('runs on pull_request (never pull_request_target) with least privilege', () => {
    expect(dependencyReview).toMatch(/on:\s*\n\s*pull_request:/);
    expect(dependencyReview).not.toContain('pull_request_target');
    expect(dependencyReview).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    // No contents:write / packages / id-token — it only reads the diff.
    expect(dependencyReview).not.toMatch(/contents:\s*write/);
  });

  it('uses the official dependency-review action and fails on high severity', () => {
    expect(dependencyReview).toContain('actions/dependency-review-action@');
    expect(dependencyReview).toMatch(/fail-on-severity:\s*high/);
  });
});
