---
type: format-concept
title: Encrypted RSF container (RSFE)
description: The password-encrypted form of a .rsf file, with its byte layout, key hierarchy, sealing on save, the checks made before a password is asked for, refusal reasons, and limits.
sources:
  - resource: ../../../src/core/workbook/rsf-encryption.ts
  - resource: ../../../src/core/workbook/rsf-encrypted-file.ts
  - resource: ../../../tests/core/rsf-encryption.test.ts
  - resource: ../../../tests/core/rsf-encrypted-file.test.ts
status: proposed
---

# Encrypted RSF container (RSFE)

An encrypted `.rsf` file is the plain format sealed as a whole. The workbook
inside is the same JSON document the plain file carries (see
[JSON document](json-document.md)), compressed with Zstandard and encrypted with
AES-256-GCM. The container around it is the "RSFE" layout below. Releases
before this layout do not read it.

## What is protected

The whole workbook: sheets, cells, formulas, formatting, settings, version
history, and any embedded content. The file name is not stored in the
container, and no password or key is stored in the clear.

What stays visible is the header: the content lengths, the Argon2id cost and
salt, and the nonces. An observer can therefore read the approximate size of
the workbook and the cost of the password.

## Layout

Integers are little-endian u32 unless noted. Offsets are in bytes.

| Offset |   Size | Field               | Value                                                               |
| -----: | -----: | ------------------- | ------------------------------------------------------------------- |
|      0 |      4 | Frame magic         | 0x184D2A5A, the skippable-frame magic shared with RSF2              |
|      4 |      4 | Payload length      | 144 + C, where C is the compressed length                           |
|      8 |      4 | Identifier          | ASCII `RSFE`                                                        |
|     12 |      4 | Format version      | 1                                                                   |
|     16 |      4 | Cipher              | 1, AES-256-GCM                                                      |
|     20 |      4 | Uncompressed length | Length of the JSON text before compression                          |
|     24 |      4 | Compressed length   | C                                                                   |
|     28 |     12 | Content nonce       | Random, new for each seal                                           |
|     40 |      4 | KDF                 | 2, Argon2id                                                         |
|     44 |      4 | Argon2 version      | 0x13                                                                |
|     48 |      4 | Memory              | KiB                                                                 |
|     52 |      4 | Passes              |                                                                     |
|     56 |      4 | Lanes               |                                                                     |
|     60 |     16 | Salt                | Random, fixed for a password                                        |
|     76 |     12 | Wrap nonce          | Random, new for each seal                                           |
|     88 |     48 | Wrapped file key    | The 32-byte file key sealed under the KEK, then its 16-byte tag     |
|    136 | C + 16 | Content             | The compressed JSON sealed under the file key, then its 16-byte tag |

The whole file is 152 + C bytes long.

## Keys

The password is normalized to NFC and encoded as UTF-8. Argon2id, with the
salt and cost stored in the header, derives a 32-byte key-encryption key (KEK).
The KEK seals a random 32-byte file key. The file key seals the content.

## Associated data

The wrap authenticates bytes 0 to 87, which include the Argon2 cost, the salt,
and the wrap nonce. The content authenticates bytes 0 to 39, which include the
payload length, the two content lengths, and the content nonce. Changing any of
these bytes fails authentication.

## Saving

Each seal compresses the JSON text, draws a new content nonce and a new wrap
nonce, and seals under the session's file key and KEK. The salt and the file
key stay the same from save to save, so a save needs no password and no
Argon2id run.

After 2^20 seals under one file key, the file key is replaced and wrapped under
the same KEK. At that count, a repeated random 96-bit nonce under one key has a
probability of about 2^-57.

## Opening

1. A structure check runs without the password: the magic, identifier, lengths,
   version, cipher, KDF, Argon2 version, cost limits, and uncompressed length.
   A file that fails here is refused before a password is asked for, so none of
   its content is shown.
2. Argon2id with the stored cost gives the KEK. The KEK opens the wrap, the file
   key opens the content, and the content is decompressed.
3. The JSON text is packed back into the plain RSF2 layout and read by the usual
   RSF parser.

A wrong password, a changed byte, and damaged data all fail the same way
(`auth-failed`), so the opener cannot tell them apart. It asks for the password
again.

## Refusal reasons

| Reason                          | Meaning                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `bad-magic`                     | Not an encrypted RSF container                                             |
| `bad-shape`                     | The lengths or payload fields do not agree                                 |
| `unsupported-encryption`        | A version, cipher, KDF, or Argon2 version this build does not read         |
| `kdf-limit`                     | Argon2 cost above the limits: 262,144 KiB of memory, 10 passes, or 4 lanes |
| `too-large`                     | Uncompressed length above the RSF body limit                               |
| `needs-wasm`, `needs-webcrypto` | The WASM engine or WebCrypto is unavailable here                           |
| `auth-failed`                   | Wrong password, or the file has been changed                               |

## Passwords for a new encrypted file

At least 12 characters, counted after NFC normalization. At most 1024 UTF-8
bytes. Case-sensitive. There is no recovery key and no key file: a lost password
means the file cannot be opened.

New files use Argon2id at 65,536 KiB of memory, 3 passes, and 1 lane. These
defaults are not yet measured on every target device.

## Compatibility

A change to the layout takes a new format version. An existing field is never
reinterpreted. A reader that does not know a version refuses the file with
`unsupported-encryption`.

## Review points

- This is a persisted-format and cryptography change. It needs human review
  before merge.
- The Argon2id code is the `argon2` 0.5.3 crate compiled to WASM. `cargo audit`
  reports nothing against it, but that is not an independent audit.
- The default Argon2 cost has not been timed on the target devices.
- The KEK seals one wrap per save, and the 2^20 limit applies per file key. The
  number of wraps under one KEK is not bounded. At realistic save counts this is
  negligible, but a reviewer should decide whether a KEK-level bound is needed.
