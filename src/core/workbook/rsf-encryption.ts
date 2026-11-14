// SPDX-License-Identifier: MIT
/**
 * The encrypted `.rsf` container ("RSFE", format version 1). One random file
 * key encrypts the whole workbook, and a key derived from the password with
 * Argon2id wraps that file key. The byte layout and the associated-data ranges
 * follow the encryption container spec (feature-gap-analysis, 2026-11-14).
 *
 * This module is DOM-free and reads or writes no file. Each primitive comes in
 * through {@link RsfEncryptionDeps}: Argon2id from the WASM engine, AES-256-GCM
 * from WebCrypto, Zstandard from the RSF codec, and randomness from the app.
 * So it runs unchanged in Node tests.
 *
 * Opening takes two steps. {@link readRsfEncryptionHeader} checks the structure
 * without the password, so a password prompt can appear before any content is
 * shown. {@link decryptRsfContainer} then derives the key and decrypts.
 */
import { deriveRsfKey, getRsfCodec } from '../csv/csv-engine';
import { MAX_RSF_BODY_BYTES } from './rsf-codec';
import { readU32, writeU32 } from './zstd-frame';

/** The skippable-frame magic shared with RSF2 (see zstd-frame.ts). */
const FRAME_MAGIC = 0x184d2a5a;
const IDENTIFIER_BYTES = new TextEncoder().encode('RSFE');
const FORMAT_VERSION = 1;
const CIPHER_AES_256_GCM = 1;
const KDF_ARGON2ID = 2;
const ARGON2_VERSION_0X13 = 0x13;

/** Bytes before the ciphertext: the frame header and the fixed fields. */
const HEADER_BYTES = 136;
const TAG_BYTES = 16;
/** The frame payload length is 144 + C: the header and tag, less the 8-byte frame header. */
const PAYLOAD_FIXED_BYTES = HEADER_BYTES + TAG_BYTES - 8;
/** The wrap's associated data is bytes 0 to 87; the content's is bytes 0 to 39. */
const WRAP_AAD_BYTES = 88;
const CONTENT_AAD_BYTES = 40;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
/** Seals under one file key before it is replaced (random nonces; see the spec). */
const MAX_SEALS_PER_FILE_KEY = 2 ** 20;

const OFFSET = {
  payloadLength: 4,
  identifier: 8,
  version: 12,
  cipher: 16,
  uncompressedLength: 20,
  compressedLength: 24,
  contentNonce: 28,
  kdf: 40,
  argon2Version: 44,
  memoryKiB: 48,
  passes: 52,
  lanes: 56,
  salt: 60,
  wrapNonce: 76,
  wrappedKey: 88,
  ciphertext: HEADER_BYTES,
} as const;

/** Upper bounds on the Argon2 cost; a file above them is refused before any work. */
const ARGON2_LIMITS = { maxMemoryKiB: 262_144, maxPasses: 10, maxLanes: 4 } as const;
/** The cost used for new passwords (measured on device before release). */
export const ARGON2_DEFAULTS: Argon2Params = { memoryKiB: 65_536, passes: 3, lanes: 1 };
/** Minimum password length in characters, counted after NFC normalization. */
const PASSWORD_MIN_CHARACTERS = 12;
/** Maximum password length in UTF-8 bytes after NFC normalization. */
const PASSWORD_MAX_BYTES = 1024;

export interface Argon2Params {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly lanes: number;
}

/**
 * Why an encrypted file cannot be opened, or a password cannot be set.
 * `auth-failed` covers both a wrong password and damaged data, which are not
 * told apart on purpose.
 */
export type RsfEncryptionError =
  | 'bad-magic'
  | 'bad-shape'
  | 'too-large'
  | 'unsupported-encryption'
  | 'kdf-limit'
  | 'auth-failed'
  | 'needs-wasm'
  | 'needs-webcrypto'
  | 'password-too-short'
  | 'password-too-long';

export class RsfEncryptionFailure extends Error {
  constructor(readonly reason: RsfEncryptionError) {
    super(reason);
  }
}

/** The structure of an encrypted file, readable without the password. */
export interface RsfEncryptionHeader {
  readonly uncompressedLength: number;
  readonly compressedLength: number;
  readonly contentNonce: Uint8Array;
  readonly argon2: Argon2Params;
  readonly salt: Uint8Array;
  readonly wrapNonce: Uint8Array;
}

/**
 * The keys of an open encrypted file, kept in memory while it is open. A
 * normal save reuses them, so it runs no Argon2. Dropping the references is
 * the only way to close the file: JavaScript cannot wipe memory.
 */
export interface RsfEncryptionSession {
  fileKey: Uint8Array;
  readonly kek: Uint8Array;
  readonly salt: Uint8Array;
  readonly argon2: Argon2Params;
  sealCount: number;
}

export interface RsfEncryptionResult {
  readonly bytes: Uint8Array;
  readonly session: RsfEncryptionSession;
}

export interface RsfDecryptResult {
  /** The uncompressed workbook JSON, to be read by the RSF JSON reader. */
  readonly json: Uint8Array;
  readonly header: RsfEncryptionHeader;
  readonly session: RsfEncryptionSession;
}

/** AES-256-GCM. A null result means the input has a wrong length or a tag does not verify. */
export interface RsfAesGcm {
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<Uint8Array | null>;
  open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Promise<Uint8Array | null>;
}

/** Every primitive the container needs, so the logic stays testable without a browser. */
export interface RsfEncryptionDeps {
  readonly aes: RsfAesGcm;
  /** Argon2id; `'needs-wasm'` when only the JS engine is active. */
  argon2id(password: Uint8Array, salt: Uint8Array, params: Argon2Params): Uint8Array | null | 'needs-wasm';
  /** One standard Zstandard frame holding the JSON body. */
  compress(body: Uint8Array): Uint8Array;
  /** One frame decoded to exactly `expectedLength` bytes, or null. */
  decompress(frame: Uint8Array, expectedLength: number): Uint8Array | null | 'needs-wasm';
  /** Cryptographically random bytes (`crypto.getRandomValues` in the app). */
  random(length: number): Uint8Array;
}

/**
 * AES-256-GCM through WebCrypto (`crypto.subtle`), with the 128-bit tag at the
 * end of the sealed bytes. Keys are imported as non-extractable CryptoKeys.
 * Throws `needs-webcrypto` when the page has no `crypto.subtle` (a non-secure
 * context), so encryption is refused rather than silently skipped.
 */
/** WebCrypto takes ArrayBuffer-backed views, so the bytes are copied into one first. */
function bufferOf(view: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(view);
}

export function webCryptoAesGcm(subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): RsfAesGcm {
  const api = (): SubtleCrypto => {
    if (!subtle) {
      throw new RsfEncryptionFailure('needs-webcrypto');
    }
    return subtle;
  };
  const algorithm = (iv: Uint8Array, aad: Uint8Array): AesGcmParams => ({
    name: 'AES-GCM',
    iv: bufferOf(iv),
    additionalData: bufferOf(aad),
    tagLength: TAG_BYTES * 8,
  });
  return {
    async seal(key, nonce, aad, plaintext) {
      if (key.length !== KEY_BYTES || nonce.length !== NONCE_BYTES) {
        return null;
      }
      const subtleApi = api();
      const cryptoKey = await subtleApi.importKey('raw', bufferOf(key), { name: 'AES-GCM' }, false, [
        'encrypt',
      ]);
      return new Uint8Array(await subtleApi.encrypt(algorithm(nonce, aad), cryptoKey, bufferOf(plaintext)));
    },
    async open(key, nonce, aad, sealed) {
      if (key.length !== KEY_BYTES || nonce.length !== NONCE_BYTES || sealed.length < TAG_BYTES) {
        return null;
      }
      const subtleApi = api();
      const cryptoKey = await subtleApi.importKey('raw', bufferOf(key), { name: 'AES-GCM' }, false, [
        'decrypt',
      ]);
      try {
        return new Uint8Array(await subtleApi.decrypt(algorithm(nonce, aad), cryptoKey, bufferOf(sealed)));
      } catch {
        return null;
      }
    },
  };
}

/** The app's dependencies: the WASM Argon2id, the active RSF codec, WebCrypto, and crypto.getRandomValues. */
export function defaultRsfEncryptionDeps(): RsfEncryptionDeps {
  return {
    aes: webCryptoAesGcm(),
    argon2id: (password, salt, params) =>
      deriveRsfKey(password, salt, params.memoryKiB, params.passes, params.lanes),
    compress: (body) => getRsfCodec().compress(body),
    decompress: (frame, expectedLength) => getRsfCodec().decompress(frame, expectedLength),
    random: (length) => {
      const out = new Uint8Array(length);
      globalThis.crypto.getRandomValues(out);
      return out;
    },
  };
}

/** True when the bytes start with the RSFE frame; the RSF2 path handles everything else. */
export function isRsfEncryptedContainer(bytes: Uint8Array): boolean {
  if (bytes.length < OFFSET.identifier + IDENTIFIER_BYTES.length || readU32(bytes, 0) !== FRAME_MAGIC) {
    return false;
  }
  return IDENTIFIER_BYTES.every((byte, index) => bytes[OFFSET.identifier + index] === byte);
}

/** The UTF-8 bytes of the password after NFC normalization. */
function rsfPasswordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFC'));
}

/** Null when the password may be set; otherwise the reason it may not. */
export function checkNewRsfPassword(password: string): 'password-too-short' | 'password-too-long' | null {
  const normalized = password.normalize('NFC');
  if (Array.from(normalized).length < PASSWORD_MIN_CHARACTERS) {
    return 'password-too-short';
  }
  if (new TextEncoder().encode(normalized).length > PASSWORD_MAX_BYTES) {
    return 'password-too-long';
  }
  return null;
}

/** The Argon2 limits from the spec: above the top is `kdf-limit`; below RFC 9106's floor is `bad-shape`. */
function argon2Problem(params: Argon2Params): RsfEncryptionError | null {
  if (
    params.memoryKiB > ARGON2_LIMITS.maxMemoryKiB ||
    params.passes > ARGON2_LIMITS.maxPasses ||
    params.lanes > ARGON2_LIMITS.maxLanes
  ) {
    return 'kdf-limit';
  }
  if (params.passes < 1 || params.lanes < 1 || params.memoryKiB < 8 * params.lanes) {
    return 'bad-shape';
  }
  return null;
}

function fail(reason: RsfEncryptionError): never {
  throw new RsfEncryptionFailure(reason);
}

/**
 * Check an encrypted file's structure without the password. Steps follow the
 * spec's order: magic and identifier, lengths, version and algorithm ids, the
 * Argon2 limits, then the uncompressed size. Throws {@link RsfEncryptionFailure}.
 */
export function readRsfEncryptionHeader(bytes: Uint8Array): RsfEncryptionHeader {
  if (!isRsfEncryptedContainer(bytes)) {
    fail('bad-magic');
  }
  if (bytes.length < OFFSET.ciphertext + TAG_BYTES) {
    fail('bad-shape');
  }
  const compressedLength = readU32(bytes, OFFSET.compressedLength);
  if (
    readU32(bytes, OFFSET.payloadLength) !== PAYLOAD_FIXED_BYTES + compressedLength ||
    bytes.length !== OFFSET.ciphertext + compressedLength + TAG_BYTES
  ) {
    fail('bad-shape');
  }
  if (
    readU32(bytes, OFFSET.version) !== FORMAT_VERSION ||
    readU32(bytes, OFFSET.cipher) !== CIPHER_AES_256_GCM ||
    readU32(bytes, OFFSET.kdf) !== KDF_ARGON2ID ||
    readU32(bytes, OFFSET.argon2Version) !== ARGON2_VERSION_0X13
  ) {
    fail('unsupported-encryption');
  }
  const argon2: Argon2Params = {
    memoryKiB: readU32(bytes, OFFSET.memoryKiB),
    passes: readU32(bytes, OFFSET.passes),
    lanes: readU32(bytes, OFFSET.lanes),
  };
  const problem = argon2Problem(argon2);
  if (problem) {
    fail(problem);
  }
  const uncompressedLength = readU32(bytes, OFFSET.uncompressedLength);
  if (uncompressedLength > MAX_RSF_BODY_BYTES) {
    fail('too-large');
  }
  return {
    uncompressedLength,
    compressedLength,
    contentNonce: bytes.slice(OFFSET.contentNonce, OFFSET.contentNonce + NONCE_BYTES),
    argon2,
    salt: bytes.slice(OFFSET.salt, OFFSET.salt + SALT_BYTES),
    wrapNonce: bytes.slice(OFFSET.wrapNonce, OFFSET.wrapNonce + NONCE_BYTES),
  };
}

function deriveKek(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
  deps: RsfEncryptionDeps,
): Uint8Array {
  const kek = deps.argon2id(rsfPasswordBytes(password), salt, params);
  if (kek === 'needs-wasm') {
    fail('needs-wasm');
  }
  if (kek === null || kek.length !== KEY_BYTES) {
    fail('bad-shape');
  }
  return kek;
}

/**
 * Write a container around `session`. The content is compressed, sealed with
 * the file key, and the file key is wrapped with the KEK, under fresh nonces.
 * The file key is replaced after {@link MAX_SEALS_PER_FILE_KEY} seals.
 */
async function sealContainer(
  session: RsfEncryptionSession,
  body: Uint8Array,
  deps: RsfEncryptionDeps,
): Promise<Uint8Array> {
  if (session.sealCount >= MAX_SEALS_PER_FILE_KEY) {
    session.fileKey = deps.random(KEY_BYTES);
    session.sealCount = 0;
  }
  const compressed = deps.compress(body);
  const header = new Uint8Array(HEADER_BYTES);
  writeU32(header, 0, FRAME_MAGIC);
  writeU32(header, OFFSET.payloadLength, PAYLOAD_FIXED_BYTES + compressed.length);
  header.set(IDENTIFIER_BYTES, OFFSET.identifier);
  writeU32(header, OFFSET.version, FORMAT_VERSION);
  writeU32(header, OFFSET.cipher, CIPHER_AES_256_GCM);
  writeU32(header, OFFSET.uncompressedLength, body.length);
  writeU32(header, OFFSET.compressedLength, compressed.length);
  header.set(deps.random(NONCE_BYTES), OFFSET.contentNonce);
  writeU32(header, OFFSET.kdf, KDF_ARGON2ID);
  writeU32(header, OFFSET.argon2Version, ARGON2_VERSION_0X13);
  writeU32(header, OFFSET.memoryKiB, session.argon2.memoryKiB);
  writeU32(header, OFFSET.passes, session.argon2.passes);
  writeU32(header, OFFSET.lanes, session.argon2.lanes);
  header.set(session.salt, OFFSET.salt);
  header.set(deps.random(NONCE_BYTES), OFFSET.wrapNonce);

  const wrapped = await deps.aes.seal(
    session.kek,
    header.slice(OFFSET.wrapNonce, OFFSET.wrapNonce + NONCE_BYTES),
    header.slice(0, WRAP_AAD_BYTES),
    session.fileKey,
  );
  if (wrapped === null) {
    fail('bad-shape');
  }
  header.set(wrapped, OFFSET.wrappedKey);

  const sealed = await deps.aes.seal(
    session.fileKey,
    header.slice(OFFSET.contentNonce, OFFSET.contentNonce + NONCE_BYTES),
    header.slice(0, CONTENT_AAD_BYTES),
    compressed,
  );
  if (sealed === null) {
    fail('bad-shape');
  }
  session.sealCount += 1;
  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  out.set(header, 0);
  out.set(sealed, HEADER_BYTES);
  return out;
}

/**
 * Turn on encryption for a workbook: a new salt, a new file key, and one
 * Argon2id run. Refuses a password that is too short or too long.
 */
export async function createRsfEncryptedContainer(
  body: Uint8Array,
  password: string,
  deps: RsfEncryptionDeps,
  params: Argon2Params = ARGON2_DEFAULTS,
): Promise<RsfEncryptionResult> {
  const problem = checkNewRsfPassword(password);
  if (problem) {
    fail(problem);
  }
  if (body.length > MAX_RSF_BODY_BYTES) {
    fail('too-large');
  }
  const limit = argon2Problem(params);
  if (limit) {
    fail(limit);
  }
  const salt = deps.random(SALT_BYTES);
  const session: RsfEncryptionSession = {
    fileKey: deps.random(KEY_BYTES),
    kek: deriveKek(password, salt, params, deps),
    salt,
    argon2: params,
    sealCount: 0,
  };
  return { bytes: await sealContainer(session, body, deps), session };
}

/**
 * Open an encrypted file with its password. Derives the KEK (one Argon2id
 * run), unwraps the file key, decrypts the content and decompresses it. A wrong
 * password and damaged data both throw `auth-failed`, and no content is returned.
 */
export async function decryptRsfContainer(
  bytes: Uint8Array,
  password: string,
  deps: RsfEncryptionDeps,
): Promise<RsfDecryptResult> {
  const header = readRsfEncryptionHeader(bytes);
  const kek = deriveKek(password, header.salt, header.argon2, deps);
  const fileKey = await deps.aes.open(
    kek,
    header.wrapNonce,
    bytes.slice(0, WRAP_AAD_BYTES),
    bytes.slice(OFFSET.wrappedKey, OFFSET.ciphertext),
  );
  if (fileKey === null || fileKey.length !== KEY_BYTES) {
    fail('auth-failed');
  }
  const frame = await deps.aes.open(
    fileKey,
    header.contentNonce,
    bytes.slice(0, CONTENT_AAD_BYTES),
    bytes.slice(OFFSET.ciphertext),
  );
  if (frame === null) {
    fail('auth-failed');
  }
  const json = deps.decompress(frame, header.uncompressedLength);
  if (json === 'needs-wasm') {
    fail('needs-wasm');
  }
  if (json === null) {
    fail('bad-shape');
  }
  return {
    json,
    header,
    session: { fileKey, kek, salt: header.salt, argon2: header.argon2, sealCount: 0 },
  };
}

/**
 * A normal save of an open encrypted file: new content and wrap nonces under
 * the session's keys. No Argon2 run, so saving stays fast.
 */
export async function saveRsfEncryptedContainer(
  session: RsfEncryptionSession,
  body: Uint8Array,
  deps: RsfEncryptionDeps,
): Promise<Uint8Array> {
  if (body.length > MAX_RSF_BODY_BYTES) {
    fail('too-large');
  }
  return sealContainer(session, body, deps);
}

/**
 * Change the password of an encrypted file. The current password is checked
 * first (one Argon2id run). The file is then built again: a new salt, a new
 * file key, and the content sealed again, with a second Argon2id run for the
 * new password. The old file key opens nothing in the new file, so the file
 * key is replaced on every password change, as decided in review.
 */
export async function changeRsfEncryptionPassword(
  bytes: Uint8Array,
  currentPassword: string,
  newPassword: string,
  deps: RsfEncryptionDeps,
  params: Argon2Params = ARGON2_DEFAULTS,
): Promise<RsfEncryptionResult> {
  const problem = checkNewRsfPassword(newPassword);
  if (problem) {
    fail(problem);
  }
  const limit = argon2Problem(params);
  if (limit) {
    fail(limit);
  }
  const opened = await decryptRsfContainer(bytes, currentPassword, deps);
  const salt = deps.random(SALT_BYTES);
  const session: RsfEncryptionSession = {
    fileKey: deps.random(KEY_BYTES),
    kek: deriveKek(newPassword, salt, params, deps),
    salt,
    argon2: params,
    sealCount: 0,
  };
  return { bytes: await sealContainer(session, opened.json, deps), session };
}
