// SPDX-License-Identifier: MIT
/**
 * Whole-file encryption joined to the plain `.rsf` format: an encrypted file
 * opens to the workbook it was sealed from, a save seals under the keys the
 * file was opened with (no password, no Argon2 run), a wrong or changed file
 * opens nothing, and the sealed bytes hold none of the workbook's text. Uses the
 * small Argon2 cost so the cases stay fast.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initCsvEngine } from '../../src/core/csv/csv-engine';
import { unpackRsfJsonText } from '../../src/core/workbook/rsf-codec';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { openEncryptedRsf, sealPlainRsf } from '../../src/core/workbook/rsf-encrypted-file';
import {
  type Argon2Params,
  createRsfEncryptedContainer,
  defaultRsfEncryptionDeps,
  isRsfEncryptedContainer,
  RsfEncryptionFailure,
} from '../../src/core/workbook/rsf-encryption';

const SMALL: Argon2Params = { memoryKiB: 8, passes: 1, lanes: 1 };
const PASSWORD = 'correct horse battery';
const MARKER = 'Q3 revenue 4200';

function plainBook(text: string): Uint8Array {
  return RsfDocument.fromSheetValues('book.rsf', [
    { name: 'Budget', rows: [[text, '4200']], columnCount: 2 },
  ]).toBytes();
}

function jsonOf(plain: Uint8Array): string {
  const text = unpackRsfJsonText(plain);
  if (text === null) {
    throw new Error('the fixture is not a plain .rsf file');
  }
  return text;
}

function contains(haystack: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((byte, i) => haystack[start + i] === byte)) {
      return true;
    }
  }
  return false;
}

beforeAll(async () => {
  await initCsvEngine();
});

describe('an encrypted .rsf file', () => {
  it('opens back to the same workbook it was sealed from', async () => {
    const deps = defaultRsfEncryptionDeps();
    const plain = plainBook(MARKER);
    const created = await createRsfEncryptedContainer(
      new TextEncoder().encode(jsonOf(plain)),
      PASSWORD,
      deps,
      SMALL,
    );
    const opened = await openEncryptedRsf(created.bytes, PASSWORD, deps);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(jsonOf(opened.plain)).toBe(jsonOf(plain));
    }
  });

  it('holds none of the workbook text in its bytes', async () => {
    const deps = defaultRsfEncryptionDeps();
    const created = await createRsfEncryptedContainer(
      new TextEncoder().encode(jsonOf(plainBook(MARKER))),
      PASSWORD,
      deps,
      SMALL,
    );
    expect(isRsfEncryptedContainer(created.bytes)).toBe(true);
    expect(contains(created.bytes, MARKER)).toBe(false);
    expect(contains(created.bytes, 'Budget')).toBe(false);
  });

  it('opens with the same password typed in another Unicode form', async () => {
    const deps = defaultRsfEncryptionDeps();
    const composed = 'café passphrase here';
    const decomposed = 'café passphrase here';
    const created = await createRsfEncryptedContainer(
      new TextEncoder().encode(jsonOf(plainBook(MARKER))),
      composed,
      deps,
      SMALL,
    );
    expect((await openEncryptedRsf(created.bytes, decomposed, deps)).ok).toBe(true);
  });

  it('refuses a wrong password and a changed byte alike, with no content', async () => {
    const deps = defaultRsfEncryptionDeps();
    const created = await createRsfEncryptedContainer(
      new TextEncoder().encode(jsonOf(plainBook(MARKER))),
      PASSWORD,
      deps,
      SMALL,
    );
    expect(await openEncryptedRsf(created.bytes, 'not the password here', deps)).toEqual({
      ok: false,
      error: 'auth-failed',
    });
    const changed = created.bytes.slice();
    changed[changed.length - 1] ^= 0x01;
    expect(await openEncryptedRsf(changed, PASSWORD, deps)).toEqual({ ok: false, error: 'auth-failed' });
  });

  it('is refused as not encrypted when it is a plain .rsf file', async () => {
    const deps = defaultRsfEncryptionDeps();
    expect(await openEncryptedRsf(plainBook(MARKER), PASSWORD, deps)).toEqual({
      ok: false,
      error: 'bad-magic',
    });
  });

  it('is saved under the keys it was opened with, without a password', async () => {
    const deps = defaultRsfEncryptionDeps();
    const created = await createRsfEncryptedContainer(
      new TextEncoder().encode(jsonOf(plainBook(MARKER))),
      PASSWORD,
      deps,
      SMALL,
    );
    const opened = await openEncryptedRsf(created.bytes, PASSWORD, deps);
    if (!opened.ok) {
      throw new Error('the fixture did not open');
    }
    const edited = plainBook(`${MARKER} edited`);
    const sealed = await sealPlainRsf(opened.session, edited, deps);
    expect(isRsfEncryptedContainer(sealed)).toBe(true);
    expect(contains(sealed, `${MARKER} edited`)).toBe(false);
    const reopened = await openEncryptedRsf(sealed, PASSWORD, deps);
    expect(reopened.ok && jsonOf(reopened.plain)).toBe(jsonOf(edited));
  });

  it('refuses to seal bytes that are not a plain .rsf file', async () => {
    const deps = defaultRsfEncryptionDeps();
    const created = await createRsfEncryptedContainer(
      new TextEncoder().encode(jsonOf(plainBook(MARKER))),
      PASSWORD,
      deps,
      SMALL,
    );
    const opened = await openEncryptedRsf(created.bytes, PASSWORD, deps);
    if (!opened.ok) {
      throw new Error('the fixture did not open');
    }
    await expect(sealPlainRsf(opened.session, new Uint8Array([1, 2, 3]), deps)).rejects.toBeInstanceOf(
      RsfEncryptionFailure,
    );
  });
});
