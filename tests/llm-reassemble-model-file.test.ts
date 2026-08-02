// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { ModelPayloadIntegrityError, reassembleAndVerify } from '../src/app/llm/reassemble-model-file';
import type { ModelFileEntry } from '../src/app/llm/model-file-entry';

// Base64 for "hello wllama gguf test payload" (30 bytes), split across two
// chunks the same way scripts/embed-model.mjs splits a real model file.
const VALID_ENTRY: ModelFileEntry = {
  name: 'fixture.gguf',
  byteLength: 30,
  sha256: '39da836158336b9e939eba4aab2b6283be32d5ddbdc893c647b9f450cfe7b047',
  chunks: ['aGVsbG8gd2xsYW1hIGdndWYg', 'dGVzdCBwYXlsb2Fk'],
};

describe('reassembleAndVerify', () => {
  it('decodes and concatenates every chunk, verifying the result against its recorded sha256', async () => {
    const bytes = await reassembleAndVerify(VALID_ENTRY);
    expect(new TextDecoder().decode(bytes)).toBe('hello wllama gguf test payload');
  });

  it('throws ModelPayloadIntegrityError when a chunk is corrupted (sha256 mismatch)', async () => {
    const corrupted: ModelFileEntry = {
      ...VALID_ENTRY,
      // Flip one character in the second chunk's Base64 without changing its decoded length.
      chunks: [VALID_ENTRY.chunks[0], 'dGVzdCBwYXlsb2Fl'],
    };
    await expect(reassembleAndVerify(corrupted)).rejects.toBeInstanceOf(ModelPayloadIntegrityError);
  });

  it('throws ModelPayloadIntegrityError when the reassembled length does not match byteLength (truncated payload)', async () => {
    const truncated: ModelFileEntry = { ...VALID_ENTRY, chunks: [VALID_ENTRY.chunks[0]] };
    await expect(reassembleAndVerify(truncated)).rejects.toBeInstanceOf(ModelPayloadIntegrityError);
  });

  it('names the file that failed verification', async () => {
    const corrupted: ModelFileEntry = { ...VALID_ENTRY, chunks: [VALID_ENTRY.chunks[0]] };
    await expect(reassembleAndVerify(corrupted)).rejects.toThrow('fixture.gguf');
  });
});
