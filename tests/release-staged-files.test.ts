// SPDX-License-Identifier: MIT
// Guards the release script's staged-files safety check. `git diff --cached
// --name-only` lists staged paths alphabetically, so package-lock.json
// (hyphen sorts before dot) is reported before package.json — the check
// must accept either order and still reject any unexpected file.
import { describe, expect, it } from 'vitest';
import { isStagedFilesAllowed } from '../scripts/release.mjs';

describe('isStagedFilesAllowed', () => {
  it('accepts package.json and package-lock.json regardless of listed order', () => {
    expect(isStagedFilesAllowed('package.json\npackage-lock.json')).toBe(true);
    expect(isStagedFilesAllowed('package-lock.json\npackage.json')).toBe(true);
  });

  it('accepts package.json alone when the lockfile did not change', () => {
    expect(isStagedFilesAllowed('package.json')).toBe(true);
  });

  it('rejects package-lock.json alone (package.json must always be staged)', () => {
    expect(isStagedFilesAllowed('package-lock.json')).toBe(false);
  });

  it('rejects an empty staged set', () => {
    expect(isStagedFilesAllowed('')).toBe(false);
  });

  it('rejects any unexpected staged file, even alongside the expected ones', () => {
    expect(isStagedFilesAllowed('package.json\npackage-lock.json\nsrc/app.ts')).toBe(false);
    expect(isStagedFilesAllowed('src/app.ts')).toBe(false);
  });
});
