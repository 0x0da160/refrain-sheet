// SPDX-License-Identifier: MIT
//! Compression and integrity primitives for the binary `.rcsv` container.
//!
//! The container framing (magic bytes, header, checksum) lives on the
//! JavaScript side in `src/core/rcsv-codec.ts`; this module provides only the
//! CPU-heavy primitives: the pure-Rust compression codecs and a CRC-32
//! checksum. Every decompressor is bounded by an explicit output limit so a
//! malicious "decompression bomb" cannot exhaust memory.
//!
//! Codecs (all pure Rust, no C toolchain, `wasm32-unknown-unknown`-clean):
//!
//!   * DEFLATE (RFC 1951) — `miniz_oxide` — container method `0x01`.
//!   * Zstandard          — `ruzstd`      — container method `0x02` (default).
//!   * LZ4 Frame          — `lz4_flex`    — container method `0x03`.
//!
//! Method `0x00` (store / uncompressed) is handled entirely on the JS side.

use std::io::{Read, Write};

use lz4_flex::frame::{FrameDecoder as Lz4FrameDecoder, FrameEncoder as Lz4FrameEncoder};
use miniz_oxide::deflate::compress_to_vec;
use miniz_oxide::inflate::decompress_to_vec_with_limit;
use ruzstd::decoding::StreamingDecoder;
use ruzstd::encoding::{compress_to_vec as zstd_compress_to_vec, CompressionLevel};

/// Read a bounded stream to a `Vec`, refusing to produce more than `max_len`
/// bytes of output. `take(max_len + 1)` caps the work and the allocation, and
/// any overflow past `max_len` is treated as a decompression bomb (`None`).
fn read_bounded<R: Read>(reader: R, max_len: usize) -> Option<Vec<u8>> {
    let cap = (max_len as u64).saturating_add(1);
    let mut out = Vec::new();
    reader.take(cap).read_to_end(&mut out).ok()?;
    if out.len() > max_len {
        return None; // exceeded the declared uncompressed length
    }
    Some(out)
}

/// Raw DEFLATE compress at a fixed level (6: a balanced default).
pub fn deflate(bytes: &[u8]) -> Vec<u8> {
    compress_to_vec(bytes, 6)
}

/// Raw DEFLATE decompress, refusing to allocate more than `max_len` bytes of
/// output. Returns `None` when the stream is corrupt or exceeds the limit.
pub fn inflate(bytes: &[u8], max_len: usize) -> Option<Vec<u8>> {
    decompress_to_vec_with_limit(bytes, max_len).ok()
}

/// Zstandard compress into a standard `.zst` frame.
///
/// `ruzstd`'s encoder implements `Fastest` (≈ zstd level 1) and `Uncompressed`;
/// its higher levels are not yet implemented, so `Fastest` is the moderate
/// default the RCSV container writes for method `0x02`. The output is a
/// conformant Zstandard frame readable by any compliant decoder.
pub fn zstd(bytes: &[u8]) -> Vec<u8> {
    zstd_compress_to_vec(bytes, CompressionLevel::Fastest)
}

/// Zstandard decompress, bounded by `max_len` output bytes (bomb guard).
/// Returns `None` on a corrupt/truncated frame or when the limit is exceeded.
pub fn unzstd(bytes: &[u8], max_len: usize) -> Option<Vec<u8>> {
    let decoder = StreamingDecoder::new(bytes).ok()?;
    read_bounded(decoder, max_len)
}

/// LZ4 Frame compress (the framed `.lz4` format, not a raw block).
pub fn lz4(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = Lz4FrameEncoder::new(Vec::new());
    // Writing into an in-memory Vec cannot fail; a broken pipe is impossible.
    encoder.write_all(bytes).expect("lz4 frame write to Vec");
    encoder.finish().expect("lz4 frame finish")
}

/// LZ4 Frame decompress, bounded by `max_len` output bytes (bomb guard).
/// Returns `None` on a corrupt/truncated frame or when the limit is exceeded.
pub fn unlz4(bytes: &[u8], max_len: usize) -> Option<Vec<u8>> {
    read_bounded(Lz4FrameDecoder::new(bytes), max_len)
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

    fn sample() -> Vec<u8> {
        b"hello, hello, hello, world; the quick brown fox jumps over 123456".repeat(64)
    }

    #[test]
    fn round_trips_deflate() {
        let data = sample();
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
    fn round_trips_zstd() {
        let data = sample();
        let packed = zstd(&data);
        assert!(packed.len() < data.len(), "zstd should shrink repetitive data");
        let back = unzstd(&packed, data.len() + 16).expect("unzstd");
        assert_eq!(back, data);
    }

    #[test]
    fn zstd_round_trips_empty_and_binary() {
        for data in [Vec::new(), (0u8..=255).cycle().take(5000).collect::<Vec<u8>>()] {
            let packed = zstd(&data);
            let back = unzstd(&packed, data.len() + 64).expect("unzstd");
            assert_eq!(back, data);
        }
    }

    #[test]
    fn unzstd_respects_the_limit() {
        let data = vec![7u8; 8192];
        let packed = zstd(&data);
        assert!(unzstd(&packed, 100).is_none());
    }

    #[test]
    fn unzstd_rejects_corruption() {
        assert!(unzstd(b"not a zstd frame at all", 4096).is_none());
        let mut packed = zstd(&sample());
        packed.truncate(packed.len() / 2);
        assert!(unzstd(&packed, 1 << 20).is_none());
    }

    #[test]
    fn round_trips_lz4() {
        let data = sample();
        let packed = lz4(&data);
        assert!(packed.len() < data.len(), "lz4 should shrink repetitive data");
        let back = unlz4(&packed, data.len() + 16).expect("unlz4");
        assert_eq!(back, data);
    }

    #[test]
    fn unlz4_respects_the_limit() {
        let data = vec![9u8; 8192];
        let packed = lz4(&data);
        assert!(unlz4(&packed, 100).is_none());
    }

    #[test]
    fn unlz4_rejects_corruption() {
        assert!(unlz4(b"\x00\x01\x02 not lz4", 4096).is_none());
    }

    #[test]
    fn crc32_known_vector() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }
}
