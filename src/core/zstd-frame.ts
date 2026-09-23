// SPDX-License-Identifier: MIT

/**
 * The small, codec-free parts of the Zstandard frame format (RFC 8878) that
 * the `.rsf` container needs without the WebAssembly engine:
 *
 * - {@link writeRawZstdFrame} writes a standard frame made only of Raw
 *   (stored) blocks. It is uncompressed, but it is still a valid Zstandard
 *   frame that `zstd -d` and every compliant decoder read.
 * - {@link readSimpleZstdFrame} reads a frame made only of Raw and RLE
 *   blocks, and reports `'compressed'` when a block needs a real decoder
 *   (the WASM engine's `ruzstd`).
 * - {@link writeSkippableFrame} / {@link readSkippableFrame} handle a
 *   skippable frame, which standard tools ignore; the container keeps its
 *   own identifier, length, and checksum there.
 *
 * Every read is bounded: output never exceeds the caller's expected length.
 */

/** Zstandard frame magic number (little-endian on disk). */
export const ZSTD_MAGIC = 0xfd2fb528;

/** The largest block a frame may carry (RFC 8878 §3.1.1.2.3). */
const MAX_BLOCK_SIZE = 128 * 1024;

const BLOCK_RAW = 0;
const BLOCK_RLE = 1;
const BLOCK_COMPRESSED = 2;

function readU32(bytes: Uint8Array, off: number): number {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

function writeU32(bytes: Uint8Array, off: number, value: number): void {
  bytes[off] = value & 0xff;
  bytes[off + 1] = (value >>> 8) & 0xff;
  bytes[off + 2] = (value >>> 16) & 0xff;
  bytes[off + 3] = (value >>> 24) & 0xff;
}

/**
 * One Zstandard frame holding `body` in Raw blocks: a single-segment frame
 * header with a 4-byte content size, no checksum, then 128 KiB blocks.
 */
export function writeRawZstdFrame(body: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(body.length / MAX_BLOCK_SIZE));
  const out = new Uint8Array(4 + 1 + 4 + blockCount * 3 + body.length);
  writeU32(out, 0, ZSTD_MAGIC);
  // Frame header descriptor: FCS flag 2 (4-byte content size), single segment.
  out[4] = (2 << 6) | (1 << 5);
  writeU32(out, 5, body.length);
  let off = 9;
  for (let b = 0; b < blockCount; b++) {
    const start = b * MAX_BLOCK_SIZE;
    const size = Math.min(MAX_BLOCK_SIZE, body.length - start);
    const last = b === blockCount - 1 ? 1 : 0;
    const header = last | (BLOCK_RAW << 1) | (size << 3);
    out[off] = header & 0xff;
    out[off + 1] = (header >>> 8) & 0xff;
    out[off + 2] = (header >>> 16) & 0xff;
    off += 3;
    out.set(body.subarray(start, start + size), off);
    off += size;
  }
  return out;
}

/**
 * Decode one frame that uses only Raw and RLE blocks into exactly
 * `expectedLen` bytes. Returns `'compressed'` when the frame holds a
 * Compressed block (a real decoder is needed), and null when the frame is
 * malformed, uses a dictionary, has trailing bytes, or does not produce
 * exactly `expectedLen` bytes.
 */
export function readSimpleZstdFrame(
  frame: Uint8Array,
  expectedLen: number,
): Uint8Array | null | 'compressed' {
  if (frame.length < 6 || readU32(frame, 0) !== ZSTD_MAGIC) {
    return null;
  }
  const descriptor = frame[4];
  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const reserved = (descriptor >> 3) & 1;
  const hasChecksum = (descriptor >> 2) & 1;
  const dictFlag = descriptor & 3;
  if (reserved !== 0) {
    return null;
  }
  let off = 5;
  if (!singleSegment) {
    off += 1; // window descriptor
  }
  const dictSize = [0, 1, 2, 4][dictFlag];
  for (let i = 0; i < dictSize; i++) {
    if (frame[off + i] !== 0) {
      return null; // a dictionary this reader does not have
    }
  }
  off += dictSize;
  const fcsSize = fcsFlag === 0 ? singleSegment : [0, 2, 4, 8][fcsFlag];
  if (off + fcsSize > frame.length) {
    return null;
  }
  if (fcsSize > 0) {
    let size = 0;
    for (let i = Math.min(fcsSize, 6) - 1; i >= 0; i--) {
      size = size * 256 + frame[off + i];
    }
    if (fcsSize === 8 && (frame[off + 6] !== 0 || frame[off + 7] !== 0)) {
      return null;
    }
    if (fcsSize === 2) {
      size += 256;
    }
    if (size !== expectedLen) {
      return null;
    }
  }
  off += fcsSize;
  const out = new Uint8Array(expectedLen);
  let written = 0;
  for (;;) {
    if (off + 3 > frame.length) {
      return null;
    }
    const header = frame[off] | (frame[off + 1] << 8) | (frame[off + 2] << 16);
    off += 3;
    const last = header & 1;
    const type = (header >> 1) & 3;
    const size = header >>> 3;
    if (size > MAX_BLOCK_SIZE) {
      return null;
    }
    if (type === BLOCK_COMPRESSED) {
      return 'compressed';
    }
    if (written + size > expectedLen) {
      return null;
    }
    if (type === BLOCK_RAW) {
      if (off + size > frame.length) {
        return null;
      }
      out.set(frame.subarray(off, off + size), written);
      off += size;
    } else if (type === BLOCK_RLE) {
      if (off + 1 > frame.length) {
        return null;
      }
      out.fill(frame[off], written, written + size);
      off += 1;
    } else {
      return null; // reserved block type
    }
    written += size;
    if (last) {
      break;
    }
  }
  if (hasChecksum) {
    off += 4; // XXH64 low bits; the container's own CRC-32 covers integrity
  }
  return off === frame.length && written === expectedLen ? out : null;
}

/** The first skippable-frame magic; the low nibble (0-15) picks one of 16. */
const SKIPPABLE_MAGIC_BASE = 0x184d2a50;

/** A skippable frame (ignored by standard Zstandard tools) holding `payload`. */
export function writeSkippableFrame(nibble: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  writeU32(out, 0, SKIPPABLE_MAGIC_BASE + (nibble & 0xf));
  writeU32(out, 4, payload.length);
  out.set(payload, 8);
  return out;
}

/**
 * Read the skippable frame at the start of `bytes` when its magic uses
 * `nibble`: its payload and the offset right after it, or null.
 */
export function readSkippableFrame(
  bytes: Uint8Array,
  nibble: number,
): { payload: Uint8Array; next: number } | null {
  if (bytes.length < 8 || readU32(bytes, 0) !== SKIPPABLE_MAGIC_BASE + (nibble & 0xf)) {
    return null;
  }
  const size = readU32(bytes, 4);
  if (8 + size > bytes.length) {
    return null;
  }
  return { payload: bytes.subarray(8, 8 + size), next: 8 + size };
}

export { readU32, writeU32 };
