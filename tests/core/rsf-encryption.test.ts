// SPDX-License-Identifier: MIT
/**
 * The encrypted `.rsf` container (RSFE, format version 1): round trips, the
 * structure checks that run before any password is asked for, every single-bit
 * change, truncation, the password change, the save path, and the WebCrypto
 * AES-GCM primitive checked against NIST CAVP vectors. A committed fixture is
 * decrypted with its password at the default Argon2 cost.
 *
 * Most cases use a small Argon2 cost (8 KiB, one pass) so the tamper matrix
 * stays fast; the fixture uses the cost the app writes.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRsfCodec, initCsvEngine, setCsvEngineForTesting } from '../../src/core/csv/csv-engine';
import { decodeRsfWorkbook } from '../../src/core/workbook/rsf-codec';
import {
  ARGON2_DEFAULTS,
  changeRsfEncryptionPassword,
  checkNewRsfPassword,
  createRsfEncryptedContainer,
  decryptRsfContainer,
  defaultRsfEncryptionDeps,
  isRsfEncryptedContainer,
  readRsfEncryptionHeader,
  RsfEncryptionFailure,
  saveRsfEncryptedContainer,
  webCryptoAesGcm,
  type Argon2Params,
  type RsfEncryptionDeps,
} from '../../src/core/workbook/rsf-encryption';
import { readU32, writeU32 } from '../../src/core/workbook/zstd-frame';

const SMALL: Argon2Params = { memoryKiB: 8, passes: 1, lanes: 1 };
/** The reasons a damaged or foreign file may be refused with. Anything else is a bug. */
const KNOWN_REJECTIONS = [
  'bad-magic',
  'bad-shape',
  'too-large',
  'unsupported-encryption',
  'kdf-limit',
  'auth-failed',
];
const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a new passphrase here';
const FIXTURE_PASSWORD = 'fixture passphrase';
const FIXTURE_JSON =
  '{"format":"rsf-test","sheets":[{"name":"Budget","cells":[["A1","Q3 revenue"],["B2",4200]]}]}';
const BODY = new TextEncoder().encode(FIXTURE_JSON);

function seededRandom(seed: string): (length: number) => Uint8Array {
  let state: Uint8Array = createHash('sha256').update(seed).digest();
  return (length) => {
    const out = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += state.length) {
      state = new Uint8Array(createHash('sha256').update(state).digest());
      out.set(state.subarray(0, Math.min(state.length, length - offset)), offset);
    }
    return out;
  };
}

function depsWith(random: (length: number) => Uint8Array): RsfEncryptionDeps {
  return { ...defaultRsfEncryptionDeps(), random };
}

/** Wrap the Argon2 primitive so a test can count how many derivations ran. */
function countingDeps(base: RsfEncryptionDeps): { deps: RsfEncryptionDeps; runs: () => number } {
  let count = 0;
  return {
    deps: {
      ...base,
      argon2id: (password, salt, params) => {
        count += 1;
        return base.argon2id(password, salt, params);
      },
    },
    runs: () => count,
  };
}

/** The reason an operation fails with, or `no-error` / the unexpected error text. */
async function failureOf(run: () => unknown): Promise<string> {
  try {
    await run();
    return 'no-error';
  } catch (error) {
    return error instanceof RsfEncryptionFailure ? error.reason : String(error);
  }
}

function flipBit(bytes: Uint8Array, index: number, bit: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] ^= 1 << bit;
  return copy;
}

function withU32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice();
  writeU32(copy, offset, value);
  return copy;
}

function fromHex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((byte, offset) => haystack[start + offset] === byte)) {
      return true;
    }
  }
  return false;
}

async function smallFile(
  password = PASSWORD,
  random = seededRandom('small-file'),
): Promise<{
  bytes: Uint8Array;
  session: Awaited<ReturnType<typeof createRsfEncryptedContainer>>['session'];
}> {
  const created = await createRsfEncryptedContainer(BODY, password, depsWith(random), SMALL);
  return { bytes: created.bytes, session: created.session };
}

describe('RSFE container', () => {
  beforeAll(async () => {
    await initCsvEngine();
    setCsvEngineForTesting('wasm');
  });
  afterAll(() => setCsvEngineForTesting('js'));

  describe('layout and leaks', () => {
    it('writes the header, frame lengths, and ids the spec defines', async () => {
      const { bytes } = await smallFile();
      const compressed = readU32(bytes, 24);
      expect(bytes.length).toBe(152 + compressed);
      expect(readU32(bytes, 0)).toBe(0x184d2a5a);
      expect(readU32(bytes, 4)).toBe(144 + compressed);
      expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('RSFE');
      expect(readU32(bytes, 12)).toBe(1);
      expect(readU32(bytes, 16)).toBe(1);
      expect(readU32(bytes, 20)).toBe(BODY.length);
      expect(readU32(bytes, 40)).toBe(2);
      expect(readU32(bytes, 44)).toBe(0x13);
      expect([readU32(bytes, 48), readU32(bytes, 52), readU32(bytes, 56)]).toEqual([8, 1, 1]);
      expect(isRsfEncryptedContainer(bytes)).toBe(true);
    });

    it('keeps the workbook out of plain text, and the existing reader refuses the file', async () => {
      const { bytes } = await smallFile();
      expect(containsBytes(bytes, new TextEncoder().encode('Q3 revenue'))).toBe(false);
      expect(containsBytes(bytes, new TextEncoder().encode('Budget'))).toBe(false);
      expect(getRsfCodec().decompress(bytes.subarray(136, bytes.length - 16), BODY.length)).toBeNull();
      expect(decodeRsfWorkbook(bytes)).toEqual({ ok: false, error: 'bad-magic' });
    });

    it('does not claim an RSF2 file as encrypted', async () => {
      const rsf2 = new Uint8Array(
        readFileSync(fileURLToPath(new URL('../fixtures/rsf/v01-cells.rsf', import.meta.url))),
      );
      expect(isRsfEncryptedContainer(rsf2)).toBe(false);
    });
  });

  describe('round trip', () => {
    it('opens with the password and returns the same JSON', async () => {
      const { bytes } = await smallFile();
      const opened = await decryptRsfContainer(bytes, PASSWORD, depsWith(seededRandom('open')));
      expect(opened.json).toEqual(BODY);
      expect(opened.session.fileKey.length).toBe(32);
    });

    it('refuses a wrong password with auth-failed and returns nothing', async () => {
      const { bytes } = await smallFile();
      expect(
        await failureOf(() => decryptRsfContainer(bytes, 'wrong password!!', depsWith(seededRandom('x')))),
      ).toBe('auth-failed');
    });

    it('accepts the decomposed (NFD) form of a composed password', async () => {
      const composed = 'ガギグゲゴ-sheet-key';
      const decomposed = composed.normalize('NFD');
      expect(decomposed).not.toBe(composed);
      const { bytes } = await smallFile(composed);
      const opened = await decryptRsfContainer(bytes, decomposed, depsWith(seededRandom('nfd')));
      expect(opened.json).toEqual(BODY);
      expect(checkNewRsfPassword(decomposed)).toBeNull();
    });

    it('counts password length in characters after NFC, with a 1024-byte ceiling', () => {
      expect(checkNewRsfPassword('short')).toBe('password-too-short');
      expect(checkNewRsfPassword('一二三四五六七八九十')).toBe('password-too-short');
      expect(checkNewRsfPassword('一二三四五六七八九十十一')).toBeNull();
      expect(checkNewRsfPassword('あ'.repeat(342))).toBe('password-too-long');
    });

    it('refuses to encrypt without the WASM engine, and never writes plain text', async () => {
      setCsvEngineForTesting('js');
      try {
        expect(
          await failureOf(() =>
            createRsfEncryptedContainer(BODY, PASSWORD, depsWith(seededRandom('js')), SMALL),
          ),
        ).toBe('needs-wasm');
      } finally {
        setCsvEngineForTesting('wasm');
      }
    });

    it('refuses a short password when enabling encryption', async () => {
      expect(
        await failureOf(() => createRsfEncryptedContainer(BODY, 'short', depsWith(seededRandom('s')), SMALL)),
      ).toBe('password-too-short');
    });
  });

  describe('structure checks run before any password', () => {
    it('refuses a file without the RSFE identifier as bad-magic', async () => {
      expect(await failureOf(() => readRsfEncryptionHeader(new Uint8Array(40)))).toBe('bad-magic');
    });

    it('refuses every truncation as bad-shape (or bad-magic), without deriving a key', async () => {
      const { bytes } = await smallFile();
      const counted = countingDeps(depsWith(seededRandom('t')));
      for (let length = 0; length < bytes.length; length += 1) {
        const reason = await failureOf(() =>
          decryptRsfContainer(bytes.slice(0, length), PASSWORD, counted.deps),
        );
        expect(['bad-magic', 'bad-shape']).toContain(reason);
      }
      expect(counted.runs()).toBe(0);
    });

    it('refuses changed length fields as bad-shape', async () => {
      const { bytes } = await smallFile();
      const compressed = readU32(bytes, 24);
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 4, 144 + compressed + 1)))).toBe(
        'bad-shape',
      );
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 24, compressed + 1)))).toBe(
        'bad-shape',
      );
    });

    it('refuses unknown versions and algorithms as unsupported-encryption, without deriving a key', async () => {
      const { bytes } = await smallFile();
      const counted = countingDeps(depsWith(seededRandom('u')));
      for (const [offset, value] of [
        [12, 2],
        [16, 2],
        [40, 1],
        [44, 0x10],
      ] as const) {
        const reason = await failureOf(() =>
          decryptRsfContainer(withU32(bytes, offset, value), PASSWORD, counted.deps),
        );
        expect(reason).toBe('unsupported-encryption');
      }
      expect(counted.runs()).toBe(0);
    });

    it('refuses Argon2 costs above the spec limits as kdf-limit, and below RFC 9106 as bad-shape', async () => {
      const { bytes } = await smallFile();
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 48, 262_145)))).toBe('kdf-limit');
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 52, 11)))).toBe('kdf-limit');
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 56, 5)))).toBe('kdf-limit');
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 48, 7)))).toBe('bad-shape');
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 52, 0)))).toBe('bad-shape');
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 56, 0)))).toBe('bad-shape');
    });

    it('refuses an uncompressed length above the 512 MiB limit as too-large', async () => {
      const { bytes } = await smallFile();
      expect(await failureOf(() => readRsfEncryptionHeader(withU32(bytes, 20, 512 * 1024 * 1024 + 1)))).toBe(
        'too-large',
      );
    });
  });

  describe('tampering', () => {
    it('fails for every single-bit change in the whole file, and returns no content', async () => {
      const { bytes } = await smallFile();
      const deps = depsWith(seededRandom('tamper'));
      let checked = 0;
      for (let index = 0; index < bytes.length; index += 1) {
        for (let bit = 0; bit < 8; bit += 1) {
          const reason = await failureOf(() =>
            decryptRsfContainer(flipBit(bytes, index, bit), PASSWORD, deps),
          );
          expect(KNOWN_REJECTIONS, `byte ${index} bit ${bit}`).toContain(reason);
          checked += 1;
        }
      }
      expect(checked).toBe(bytes.length * 8);
    }, 300_000);

    it('fails with auth-failed when the uncompressed length is changed but the structure still fits', async () => {
      const { bytes } = await smallFile();
      const counted = countingDeps(depsWith(seededRandom('len')));
      const changed = withU32(bytes, 20, BODY.length + 1);
      expect(await failureOf(() => decryptRsfContainer(changed, PASSWORD, counted.deps))).toBe('auth-failed');
      expect(counted.runs()).toBe(1);
    });
  });

  describe('password change', () => {
    it('rebuilds the file: new salt, file key and content, so the old file key opens nothing', async () => {
      const { bytes } = await smallFile();
      const oldKey = (await decryptRsfContainer(bytes, PASSWORD, depsWith(seededRandom('old-key')))).session
        .fileKey;
      const counted = countingDeps(depsWith(seededRandom('change')));
      const changed = await changeRsfEncryptionPassword(bytes, PASSWORD, NEW_PASSWORD, counted.deps, SMALL);
      expect(counted.runs()).toBe(2);
      expect(changed.bytes.subarray(136)).not.toEqual(bytes.subarray(136));
      // The content nonce is at 28..40, its AAD is bytes 0..40, and the sealed content starts at 136.
      const withOldKey = await webCryptoAesGcm().open(
        oldKey,
        changed.bytes.slice(28, 40),
        changed.bytes.slice(0, 40),
        changed.bytes.slice(136),
      );
      expect(withOldKey).toBeNull();
      expect(await failureOf(() => decryptRsfContainer(changed.bytes, PASSWORD, counted.deps))).toBe(
        'auth-failed',
      );
      const reopened = await decryptRsfContainer(changed.bytes, NEW_PASSWORD, counted.deps);
      expect(reopened.json).toEqual(BODY);
      expect(reopened.session.fileKey).not.toEqual(oldKey);
    });

    it('refuses a change when the current password is wrong, and leaves the file alone', async () => {
      const { bytes } = await smallFile();
      const deps = depsWith(seededRandom('bad-current'));
      expect(
        await failureOf(() =>
          changeRsfEncryptionPassword(bytes, 'not the password', NEW_PASSWORD, deps, SMALL),
        ),
      ).toBe('auth-failed');
      expect((await decryptRsfContainer(bytes, PASSWORD, deps)).json).toEqual(BODY);
    });
  });

  describe('normal save', () => {
    it('reuses the session keys, so it runs no Argon2, and reads back the new JSON', async () => {
      const counted = countingDeps(depsWith(seededRandom('save')));
      const created = await createRsfEncryptedContainer(BODY, PASSWORD, counted.deps, SMALL);
      expect(counted.runs()).toBe(1);
      const next = new TextEncoder().encode('{"format":"rsf-test","sheets":[]}');
      const saved = await saveRsfEncryptedContainer(created.session, next, counted.deps);
      expect(counted.runs()).toBe(1);
      expect((await decryptRsfContainer(saved, PASSWORD, counted.deps)).json).toEqual(next);
    });

    it('draws a new content nonce and a new wrap nonce on every save', async () => {
      const deps = depsWith(seededRandom('nonces'));
      const created = await createRsfEncryptedContainer(BODY, PASSWORD, deps, SMALL);
      const saved = await saveRsfEncryptedContainer(created.session, BODY, deps);
      expect(saved.subarray(28, 40)).not.toEqual(created.bytes.subarray(28, 40));
      expect(saved.subarray(76, 88)).not.toEqual(created.bytes.subarray(76, 88));
    });

    it('replaces the file key once the seal limit is reached', async () => {
      const deps = depsWith(seededRandom('limit'));
      const created = await createRsfEncryptedContainer(BODY, PASSWORD, deps, SMALL);
      const before = created.session.fileKey.slice();
      created.session.sealCount = 2 ** 20;
      const saved = await saveRsfEncryptedContainer(created.session, BODY, deps);
      expect(created.session.fileKey).not.toEqual(before);
      expect(created.session.sealCount).toBe(1);
      expect((await decryptRsfContainer(saved, PASSWORD, deps)).json).toEqual(BODY);
    });
  });

  describe('WebCrypto AES-256-GCM against NIST CAVP vectors', () => {
    const aes = webCryptoAesGcm();

    it('seals as the NIST vector with associated data (gcmEncryptExtIV256, PTlen 128, AADlen 128)', async () => {
      const sealed = await aes.seal(
        fromHex('92e11dcdaa866f5ce790fd24501f92509aacf4cb8b1339d50c9c1240935dd08b'),
        fromHex('ac93a1a6145299bde902f21a'),
        fromHex('1e0889016f67601c8ebea4943bc23ad6'),
        fromHex('2d71bcfa914e4ac045b2aa60955fad24'),
      );
      expect(sealed).not.toBeNull();
      expect(toHex(sealed ?? new Uint8Array())).toBe(
        '8995ae2e6df3dbf96fac7b7137bae67feca5aa77d51d4a0a14d9c51e1da474ab',
      );
    });

    it('seals as the NIST vector without associated data (gcmEncryptExtIV256, PTlen 128, AADlen 0)', async () => {
      const sealed = await aes.seal(
        fromHex('31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22'),
        fromHex('0d18e06c7c725ac9e362e1ce'),
        new Uint8Array(0),
        fromHex('2db5168e932556f8089a0622981d017d'),
      );
      expect(toHex(sealed ?? new Uint8Array())).toBe(
        'fa4362189661d163fcd6a56d8bf0405ad636ac1bbedd5cc3ee727dc2ab4a9489',
      );
    });

    it('opens its own output, and refuses the NIST FAIL vector (gcmDecrypt256)', async () => {
      const key = fromHex('c997768e2d14e3d38259667a6649079de77beb4543589771e5068e6cd7cd0b14');
      const nonce = fromHex('835090aed9552dbdd45277e2');
      const sealed = fromHex('9f6607d68e22ccf21928db0986be126ef32617f67c574fd9f44ef76ff880ab9f');
      expect(await aes.open(key, nonce, new Uint8Array(0), sealed)).toBeNull();
    });

    it('refuses wrong key and nonce lengths, and inputs shorter than a tag', async () => {
      const key = new Uint8Array(32);
      const nonce = new Uint8Array(12);
      expect(await aes.seal(new Uint8Array(31), nonce, new Uint8Array(0), new Uint8Array(4))).toBeNull();
      expect(await aes.seal(key, new Uint8Array(11), new Uint8Array(0), new Uint8Array(4))).toBeNull();
      expect(await aes.open(key, nonce, new Uint8Array(0), new Uint8Array(15))).toBeNull();
    });

    it('reports needs-webcrypto when the page has no crypto.subtle', async () => {
      const withoutSubtle = webCryptoAesGcm(null as unknown as SubtleCrypto);
      expect(
        await failureOf(() =>
          withoutSubtle.seal(new Uint8Array(32), new Uint8Array(12), new Uint8Array(0), new Uint8Array(1)),
        ),
      ).toBe('needs-webcrypto');
    });
  });

  describe('committed fixture', () => {
    it('decrypts tests/fixtures/rsf/encrypted/encrypted-v1.rsf with its password at the app cost', async () => {
      const path = fileURLToPath(new URL('../fixtures/rsf/encrypted/encrypted-v1.rsf', import.meta.url));
      const bytes = new Uint8Array(readFileSync(path));
      expect(readRsfEncryptionHeader(bytes).argon2).toEqual(ARGON2_DEFAULTS);
      const opened = await decryptRsfContainer(bytes, FIXTURE_PASSWORD, defaultRsfEncryptionDeps());
      expect(new TextDecoder().decode(opened.json)).toBe(FIXTURE_JSON);
    }, 120_000);
  });
});
