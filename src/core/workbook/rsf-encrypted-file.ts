// SPDX-License-Identifier: MIT
/**
 * Whole-file encryption joined to the plain `.rsf` format. The container
 * (`rsf-encryption.ts`) seals the workbook's JSON text, and everything the app
 * edits stays the plain `.rsf` bytes that `RsfDocument` reads and writes. This
 * module converts between the two, so the open and save paths never see the
 * container's layout. DOM-free: it reads and writes no file.
 */
import { packRsfJsonText, unpackRsfJsonText } from './rsf-codec';
import {
  decryptRsfContainer,
  RsfEncryptionFailure,
  saveRsfEncryptedContainer,
  type RsfEncryptionDeps,
  type RsfEncryptionError,
  type RsfEncryptionSession,
} from './rsf-encryption';

/** An encrypted file opened with its password: the plain `.rsf` bytes and the keys to save it again. */
export type OpenedEncryptedRsf =
  | { readonly ok: true; readonly plain: Uint8Array; readonly session: RsfEncryptionSession }
  | { readonly ok: false; readonly error: RsfEncryptionError };

/**
 * Open an encrypted `.rsf` file with its password (one Argon2id run). A wrong
 * password and damaged data both come back as `auth-failed`, and no content is
 * returned. On success `plain` is a plain `.rsf` file, ready for
 * `RsfDocument.fromBytes`, and `session` seals later saves under the same keys.
 */
export async function openEncryptedRsf(
  bytes: Uint8Array,
  password: string,
  deps: RsfEncryptionDeps,
): Promise<OpenedEncryptedRsf> {
  try {
    const opened = await decryptRsfContainer(bytes, password, deps);
    const text = new TextDecoder().decode(opened.json);
    return { ok: true, plain: packRsfJsonText(text), session: opened.session };
  } catch (err) {
    if (err instanceof RsfEncryptionFailure) {
      return { ok: false, error: err.reason };
    }
    throw err;
  }
}

/**
 * The bytes to write for an open encrypted file: `plain` (a plain `.rsf` file)
 * sealed under the keys the file was opened with. This is a normal save, so no
 * Argon2id run happens. Throws {@link RsfEncryptionFailure} when sealing is
 * refused, and nothing is returned then.
 */
export async function sealPlainRsf(
  session: RsfEncryptionSession,
  plain: Uint8Array,
  deps: RsfEncryptionDeps,
): Promise<Uint8Array> {
  const text = unpackRsfJsonText(plain);
  if (text === null) {
    throw new RsfEncryptionFailure('bad-shape');
  }
  return saveRsfEncryptedContainer(session, new TextEncoder().encode(text), deps);
}
