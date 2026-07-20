// SPDX-License-Identifier: MIT
//! WebAssembly bindings for Refrain Sheet's byte-level CSV core.
//!
//! The exported surface mirrors `src/core/csv-engine.ts` on the JavaScript
//! side: parsing returns flat `u32` index arrays (copied out of WASM memory
//! once per parse), and serialization is expressed as byte-range replacement
//! plans over the original bytes so unmodified regions stay byte-identical.

pub mod compress;
pub mod csv;
pub mod ops;

use wasm_bindgen::prelude::*;

/// Structural index of one parsed CSV byte sequence. See `csv.rs` for the
/// array layouts (record/field/diagnostic strides).
#[wasm_bindgen]
pub struct ParseIndex {
    inner: csv::ParseOutput,
}

#[wasm_bindgen]
impl ParseIndex {
    #[wasm_bindgen(getter)]
    pub fn records(&self) -> Vec<u32> {
        self.inner.records.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn fields(&self) -> Vec<u32> {
        self.inner.fields.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn diagnostics(&self) -> Vec<u32> {
        self.inner.diagnostics.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn crlf(&self) -> u32 {
        self.inner.crlf
    }

    #[wasm_bindgen(getter)]
    pub fn lf(&self) -> u32 {
        self.inner.lf
    }

    #[wasm_bindgen(getter)]
    pub fn cr(&self) -> u32 {
        self.inner.cr
    }

    #[wasm_bindgen(getter, js_name = hasFinalNewline)]
    pub fn has_final_newline(&self) -> bool {
        self.inner.has_final_newline
    }

    #[wasm_bindgen(getter, js_name = bomLength)]
    pub fn bom_length(&self) -> u32 {
        self.inner.bom_length
    }
}

/// Parse CSV structure at the byte level. Never modifies or normalizes the
/// input; text decoding stays on the JavaScript side.
#[wasm_bindgen(js_name = parseCsv)]
pub fn parse_csv(bytes: &[u8], delimiter: u8, treat_utf8_bom: bool) -> ParseIndex {
    ParseIndex {
        inner: csv::parse(bytes, delimiter, treat_utf8_bom),
    }
}

/// Delimiter sniffing over the first 64 KiB (outside quoted regions).
#[wasm_bindgen(js_name = sniffDelimiter)]
pub fn sniff_delimiter(bytes: &[u8]) -> u8 {
    csv::sniff_delimiter(bytes)
}

/// Serialization planning: ordered `[kind, a, b]` triples describing the
/// output as verbatim copies of the original bytes plus payload segments.
#[wasm_bindgen(js_name = planReplacements)]
pub fn plan_replacements(bytes_len: u32, ranges: &[u32], payload_lens: &[u32]) -> Vec<u32> {
    csv::plan_replacements(bytes_len, ranges, payload_lens)
}

/// Apply byte-range replacements to the original bytes. Bytes outside the
/// replaced ranges are copied verbatim.
#[wasm_bindgen(js_name = applyReplacements)]
pub fn apply_replacements(bytes: &[u8], ranges: &[u32], payload: &[u8], payload_lens: &[u32]) -> Vec<u8> {
    csv::apply_replacements(bytes, ranges, payload, payload_lens)
}

// ----- Binary .rcsv container primitives (see compress.rs) -----

/// Raw DEFLATE compression for the `.rcsv` container payload.
#[wasm_bindgen(js_name = rcsvDeflate)]
pub fn rcsv_deflate(bytes: &[u8]) -> Vec<u8> {
    compress::deflate(bytes)
}

/// Raw DEFLATE decompression, bounded by `max_len` output bytes (a
/// decompression-bomb guard). Returns an empty array on failure; the caller
/// distinguishes "empty payload" via the container's stored length.
#[wasm_bindgen(js_name = rcsvInflate)]
pub fn rcsv_inflate(bytes: &[u8], max_len: u32) -> Option<Vec<u8>> {
    compress::inflate(bytes, max_len as usize)
}

/// Zstandard compression (method 0x02) for the `.rcsv` container payload.
#[wasm_bindgen(js_name = rcsvZstd)]
pub fn rcsv_zstd(bytes: &[u8]) -> Vec<u8> {
    compress::zstd(bytes)
}

/// Zstandard decompression, bounded by `max_len` output bytes (bomb guard).
#[wasm_bindgen(js_name = rcsvUnzstd)]
pub fn rcsv_unzstd(bytes: &[u8], max_len: u32) -> Option<Vec<u8>> {
    compress::unzstd(bytes, max_len as usize)
}

/// LZ4 Frame compression (method 0x03) for the `.rcsv` container payload.
#[wasm_bindgen(js_name = rcsvLz4)]
pub fn rcsv_lz4(bytes: &[u8]) -> Vec<u8> {
    compress::lz4(bytes)
}

/// LZ4 Frame decompression, bounded by `max_len` output bytes (bomb guard).
#[wasm_bindgen(js_name = rcsvUnlz4)]
pub fn rcsv_unlz4(bytes: &[u8], max_len: u32) -> Option<Vec<u8>> {
    compress::unlz4(bytes, max_len as usize)
}

/// CRC-32 (IEEE) checksum of the container's uncompressed body.
#[wasm_bindgen(js_name = rcsvCrc32)]
pub fn rcsv_crc32(bytes: &[u8]) -> u32 {
    compress::crc32(bytes)
}

// ----- Selection statistics and literal search (see ops.rs) -----

/// Reduce finite numbers to `[sum, min, max]` for selection statistics.
#[wasm_bindgen(js_name = statsAggregate)]
pub fn stats_aggregate(values: &[f64]) -> Vec<f64> {
    ops::aggregate(values).to_vec()
}

/// Count non-overlapping occurrences of `needle` in `haystack` (literal search).
#[wasm_bindgen(js_name = countLiteral)]
pub fn count_literal(haystack: &[u8], needle: &[u8]) -> u32 {
    ops::count_literal(haystack, needle)
}
