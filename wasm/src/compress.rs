// SPDX-License-Identifier: MIT
//! Compression and integrity primitives for the binary `.rcsv` container.
//!
//! The container framing (magic bytes, header, checksum) lives on the
//! JavaScript side in `src/core/rcsv-codec.ts`; this module provides only the
//! CPU-heavy primitives: raw DEFLATE (RFC 1951) compression/decompression and
//! a CRC-32 checksum. Decompression is bounded by an explicit output limit so
//! a malicious "decompression bomb" cannot exhaust memory.

use miniz_oxide::deflate::compress_to_vec;
use miniz_oxide::inflate::decompress_to_vec_with_limit;

/// Raw DEFLATE compress at a fixed level (6: a balanced default).
pub fn deflate(bytes: &[u8]) -> Vec<u8> {
    compress_to_vec(bytes, 6)
}

/// Raw DEFLATE decompress, refusing to allocate more than `max_len` bytes of
/// output. Returns `None` when the stream is corrupt or exceeds the limit.
pub fn inflate(bytes: &[u8], max_len: usize) -> Option<Vec<u8>> {
    decompress_to_vec_with_limit(bytes, max_len).ok()
}

/// CRC-32 (IEEE 802.3, polynomial 0xEDB88320), matching the JS fallback.
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_deflate() {
        let data = b"hello, hello, hello, world; the quick brown fox".repeat(20);
        let packed = deflate(&data);
        assert!(packed.len() < data.len());
        let back = inflate(&packed, data.len() + 16).expect("inflate");
        assert_eq!(back, data);
    }

    #[test]
    fn inflate_respects_the_limit() {
        let data = vec![0u8; 4096];
        let packed = deflate(&data);
        assert!(inflate(&packed, 100).is_none());
    }

    #[test]
    fn crc32_known_vector() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }
}
