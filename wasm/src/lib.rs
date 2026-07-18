// SPDX-License-Identifier: MIT
//! WebAssembly bindings for the Refrain CSV byte-level core.
//!
//! The exported surface mirrors `src/core/csv-engine.ts` on the JavaScript
//! side: parsing returns flat `u32` index arrays (copied out of WASM memory
//! once per parse), and serialization is expressed as byte-range replacement
//! plans over the original bytes so unmodified regions stay byte-identical.

pub mod csv;

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
