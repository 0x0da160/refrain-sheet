// SPDX-License-Identifier: MIT
//! Byte-level CSV structure parsing, delimiter sniffing, row/field indexing,
//! and serialization planning.
//!
//! This module is a faithful port of the TypeScript byte parser in
//! `src/core/byte-csv-parser.ts` and must keep identical semantics: it reads
//! structure only (byte offsets), never decodes text, never repairs malformed
//! content, and never normalizes input bytes. Text decoding stays on the
//! JavaScript side, where cell values are materialized lazily.
//!
//! The parse result is a set of flat `u32` arrays so it can cross the WASM
//! boundary cheaply:
//!
//! - `records`, stride [`RECORD_STRIDE`]:
//!   `[start, end, term_start, term_end, field_offset, field_count]`
//! - `fields`, stride [`FIELD_STRIDE`]:
//!   `[start, end, content_start, content_end, prefix_end, suffix_start, flags]`
//! - `diagnostics`, stride [`DIAG_STRIDE`]:
//!   `[row (1-based), column (1-based), type, expected, actual]`

pub const QUOTE: u8 = 0x22;
pub const CR: u8 = 0x0d;
pub const LF: u8 = 0x0a;
pub const SPACE: u8 = 0x20;
pub const TAB: u8 = 0x09;

pub const RECORD_STRIDE: usize = 6;
pub const FIELD_STRIDE: usize = 7;
pub const DIAG_STRIDE: usize = 5;

pub const FLAG_QUOTED: u32 = 1;
pub const FLAG_MALFORMED: u32 = 2;

pub const DIAG_UNCLOSED_QUOTE: u32 = 0;
pub const DIAG_TEXT_AFTER_QUOTE: u32 = 1;
pub const DIAG_BARE_QUOTE: u32 = 2;
pub const DIAG_INCONSISTENT_FIELD_COUNT: u32 = 3;
pub const DIAG_AMBIGUOUS: u32 = 4;

/// Parsed structural index of a CSV byte sequence.
pub struct ParseOutput {
    pub records: Vec<u32>,
    pub fields: Vec<u32>,
    pub diagnostics: Vec<u32>,
    pub crlf: u32,
    pub lf: u32,
    pub cr: u32,
    pub has_final_newline: bool,
    pub bom_length: u32,
}

pub fn has_utf8_bom(bytes: &[u8]) -> bool {
    bytes.len() >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf
}

fn is_field_whitespace(byte: u8, delimiter: u8) -> bool {
    byte == SPACE || (byte == TAB && delimiter != TAB)
}

/// Guess the delimiter by counting candidate bytes outside quoted regions in
/// the first 64 KiB. Defaults to a comma. Identical to the TS heuristic.
pub fn sniff_delimiter(bytes: &[u8]) -> u8 {
    const CANDIDATES: [u8; 3] = [0x2c, 0x3b, TAB]; // ',', ';', '\t'
    let limit = bytes.len().min(64 * 1024);
    let mut counts = [0u32; 3];
    let mut in_quotes = false;
    let start = if has_utf8_bom(bytes) { 3 } else { 0 };
    for &b in &bytes[start..limit] {
        if b == QUOTE {
            in_quotes = !in_quotes;
        } else if !in_quotes {
            match b {
                0x2c => counts[0] += 1,
                0x3b => counts[1] += 1,
                TAB => counts[2] += 1,
                _ => {}
            }
        }
    }
    let mut best = 0usize;
    for d in 1..3 {
        if counts[d] > counts[best] {
            best = d;
        }
    }
    CANDIDATES[best]
}

struct FieldScan {
    /// `[start, end, content_start, content_end, prefix_end, suffix_start, flags]`
    field: [u32; FIELD_STRIDE],
    /// Position of the byte that ended the field (delimiter, CR, LF, or EOF).
    next: usize,
    diagnostics: Vec<u32>,
}

fn scan_field(bytes: &[u8], pos: usize, delimiter: u8) -> FieldScan {
    let len = bytes.len();
    let start = pos;
    let mut diags: Vec<u32> = Vec::new();
    let mut i = pos;
    while i < len && is_field_whitespace(bytes[i], delimiter) {
        i += 1;
    }

    if i < len && bytes[i] == QUOTE {
        let prefix_end = i;
        let content_start = i + 1;
        let mut j = content_start;
        let mut closed = false;
        while j < len {
            if bytes[j] == QUOTE {
                if j + 1 < len && bytes[j + 1] == QUOTE {
                    j += 2;
                    continue;
                }
                closed = true;
                break;
            }
            j += 1;
        }
        if !closed {
            // Unclosed quote: the rest of the file belongs to this field.
            diags.push(DIAG_UNCLOSED_QUOTE);
            if bytes[content_start..len].iter().any(|&b| b == CR || b == LF) {
                diags.push(DIAG_AMBIGUOUS);
            }
            return FieldScan {
                field: [
                    start as u32,
                    len as u32,
                    content_start as u32,
                    len as u32,
                    prefix_end as u32,
                    len as u32,
                    FLAG_QUOTED | FLAG_MALFORMED,
                ],
                next: len,
                diagnostics: diags,
            };
        }
        let content_end = j;
        let suffix_start = j + 1;
        let mut end = suffix_start;
        let mut junk = false;
        while end < len && bytes[end] != delimiter && bytes[end] != CR && bytes[end] != LF {
            if !is_field_whitespace(bytes[end], delimiter) {
                junk = true;
            }
            end += 1;
        }
        if junk {
            diags.push(DIAG_TEXT_AFTER_QUOTE);
        }
        let flags = FLAG_QUOTED | if junk { FLAG_MALFORMED } else { 0 };
        return FieldScan {
            field: [
                start as u32,
                end as u32,
                content_start as u32,
                content_end as u32,
                prefix_end as u32,
                suffix_start as u32,
                flags,
            ],
            next: end,
            diagnostics: diags,
        };
    }

    // Unquoted field: everything up to the delimiter or record terminator,
    // including surrounding whitespace, is part of the raw value.
    let mut end = i;
    let mut bare_quote = false;
    while end < len && bytes[end] != delimiter && bytes[end] != CR && bytes[end] != LF {
        if bytes[end] == QUOTE {
            bare_quote = true;
        }
        end += 1;
    }
    if bare_quote {
        diags.push(DIAG_BARE_QUOTE);
    }
    FieldScan {
        field: [
            start as u32,
            end as u32,
            start as u32,
            end as u32,
            start as u32,
            end as u32,
            if bare_quote { FLAG_MALFORMED } else { 0 },
        ],
        next: end,
        diagnostics: diags,
    }
}

/// Parse CSV structure at the byte level into a flat index. The structural
/// bytes `"`, the delimiter, CR, and LF never occur inside multibyte
/// characters in UTF-8, CP932, or EUC-JP, so structure is tracked without
/// decoding any text. Parsing never modifies the input and never repairs
/// malformed content.
pub fn parse(bytes: &[u8], delimiter: u8, treat_utf8_bom: bool) -> ParseOutput {
    let bom_length: usize = if treat_utf8_bom && has_utf8_bom(bytes) { 3 } else { 0 };
    let len = bytes.len();
    let mut records: Vec<u32> = Vec::new();
    let mut fields: Vec<u32> = Vec::new();
    let mut diagnostics: Vec<u32> = Vec::new();
    let (mut crlf, mut lf_count, mut cr_count) = (0u32, 0u32, 0u32);

    let mut pos = bom_length;
    let mut record_count: u32 = 0;
    while pos < len {
        let record_start = pos;
        let field_offset = (fields.len() / FIELD_STRIDE) as u32;
        let mut field_count: u32 = 0;
        let (term_start, term_end) = loop {
            let scan = scan_field(bytes, pos, delimiter);
            let column_number = field_count + 1;
            fields.extend_from_slice(&scan.field);
            field_count += 1;
            for ty in scan.diagnostics {
                diagnostics.extend_from_slice(&[record_count + 1, column_number, ty, 0, 0]);
            }
            pos = scan.next;
            if pos >= len {
                break (len, len);
            }
            let b = bytes[pos];
            if b == delimiter {
                pos += 1;
                if pos >= len {
                    // Trailing delimiter at EOF implies a final empty field.
                    let l = len as u32;
                    fields.extend_from_slice(&[l, l, l, l, l, l, 0]);
                    field_count += 1;
                    break (len, len);
                }
                continue;
            }
            let term_start = pos;
            let term_end = if b == CR && pos + 1 < len && bytes[pos + 1] == LF {
                crlf += 1;
                pos + 2
            } else {
                if b == CR {
                    cr_count += 1;
                } else {
                    lf_count += 1;
                }
                pos + 1
            };
            pos = term_end;
            break (term_start, term_end);
        };
        // The loop always scans at least one field, so the record end is the
        // end offset of the field most recently pushed.
        let record_end = fields[fields.len() - FIELD_STRIDE + 1];
        records.extend_from_slice(&[
            record_start as u32,
            record_end,
            term_start as u32,
            term_end as u32,
            field_offset,
            field_count,
        ]);
        record_count += 1;
    }

    if record_count > 1 {
        let expected = records[5];
        for r in 1..record_count as usize {
            let actual = records[r * RECORD_STRIDE + 5];
            if actual != expected {
                diagnostics.extend_from_slice(&[
                    (r as u32) + 1,
                    1,
                    DIAG_INCONSISTENT_FIELD_COUNT,
                    expected,
                    actual,
                ]);
            }
        }
    }

    let has_final_newline = record_count > 0 && {
        let last = (record_count as usize - 1) * RECORD_STRIDE;
        records[last + 2] < records[last + 3]
    };

    ParseOutput {
        records,
        fields,
        diagnostics,
        crlf,
        lf: lf_count,
        cr: cr_count,
        has_final_newline,
        bom_length: bom_length as u32,
    }
}

pub const PLAN_COPY: u32 = 0;
pub const PLAN_PAYLOAD: u32 = 1;

/// Serialization planning: given replacement ranges over the original bytes
/// (`ranges` as `[start, end]` pairs) and the lengths of the replacement
/// payloads, produce the ordered output plan as `[kind, a, b]` triples:
///
/// - `kind == PLAN_COPY`: copy original bytes `a..b` verbatim,
/// - `kind == PLAN_PAYLOAD`: emit payload bytes `a..b` (offsets into the
///   concatenated payload buffer).
///
/// Every byte outside a replaced range is copied from the original input, so
/// unmodified regions are preserved byte-for-byte. Replacements are applied
/// in order of their start offset (stable for equal starts, matching the
/// TypeScript serializer).
pub fn plan_replacements(bytes_len: u32, ranges: &[u32], payload_lens: &[u32]) -> Vec<u32> {
    let n = ranges.len() / 2;
    let mut payload_offsets: Vec<u32> = Vec::with_capacity(n);
    let mut off: u32 = 0;
    for i in 0..n {
        payload_offsets.push(off);
        off += payload_lens[i];
    }
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| ranges[i * 2]);

    let mut plan: Vec<u32> = Vec::new();
    let mut src: u32 = 0;
    for &i in &order {
        let (start, end) = (ranges[i * 2], ranges[i * 2 + 1]);
        if start > src {
            plan.extend_from_slice(&[PLAN_COPY, src, start]);
        }
        if payload_lens[i] > 0 {
            plan.extend_from_slice(&[PLAN_PAYLOAD, payload_offsets[i], payload_offsets[i] + payload_lens[i]]);
        }
        src = end;
    }
    if bytes_len > src {
        plan.extend_from_slice(&[PLAN_COPY, src, bytes_len]);
    }
    plan
}

/// Execute a serialization plan: apply byte-range replacements to the
/// original bytes. `ranges` holds `[start, end]` pairs, `payload` the
/// concatenated replacement bytes, `payload_lens` each replacement's length.
pub fn apply_replacements(bytes: &[u8], ranges: &[u32], payload: &[u8], payload_lens: &[u32]) -> Vec<u8> {
    let plan = plan_replacements(bytes.len() as u32, ranges, payload_lens);
    let mut total = 0usize;
    for step in plan.chunks_exact(3) {
        total += (step[2] - step[1]) as usize;
    }
    let mut out: Vec<u8> = Vec::with_capacity(total);
    for step in plan.chunks_exact(3) {
        let (a, b) = (step[1] as usize, step[2] as usize);
        if step[0] == PLAN_COPY {
            out.extend_from_slice(&bytes[a..b]);
        } else {
            out.extend_from_slice(&payload[a..b]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field<'a>(out: &'a ParseOutput, row: usize, col: usize) -> &'a [u32] {
        let rec = &out.records[row * RECORD_STRIDE..(row + 1) * RECORD_STRIDE];
        let idx = (rec[4] as usize + col) * FIELD_STRIDE;
        &out.fields[idx..idx + FIELD_STRIDE]
    }

    fn value_bytes<'a>(bytes: &'a [u8], f: &[u32]) -> &'a [u8] {
        &bytes[f[2] as usize..f[3] as usize]
    }

    fn record_count(out: &ParseOutput) -> usize {
        out.records.len() / RECORD_STRIDE
    }

    fn field_count(out: &ParseOutput, row: usize) -> usize {
        out.records[row * RECORD_STRIDE + 5] as usize
    }

    #[test]
    fn parses_simple_csv() {
        let bytes = b"a,b,c\n1,2,3\n";
        let out = parse(bytes, b',', true);
        assert_eq!(record_count(&out), 2);
        assert_eq!(field_count(&out, 0), 3);
        assert_eq!(field_count(&out, 1), 3);
        assert_eq!(value_bytes(bytes, field(&out, 0, 0)), b"a");
        assert_eq!(value_bytes(bytes, field(&out, 1, 2)), b"3");
        assert!(out.diagnostics.is_empty());
        assert_eq!((out.crlf, out.lf, out.cr), (0, 2, 0));
        assert!(out.has_final_newline);
        assert_eq!(out.bom_length, 0);
    }

    #[test]
    fn quoted_fields_and_escaped_quotes() {
        let bytes = b"\"a,b\",\"x\"\"y\"\n";
        let out = parse(bytes, b',', true);
        assert_eq!(field_count(&out, 0), 2);
        let f0 = field(&out, 0, 0);
        assert_eq!(f0[6] & FLAG_QUOTED, FLAG_QUOTED);
        assert_eq!(value_bytes(bytes, f0), b"a,b");
        // Escaped quotes stay raw in the content span; unescaping happens on decode.
        assert_eq!(value_bytes(bytes, field(&out, 0, 1)), b"x\"\"y");
        assert!(out.diagnostics.is_empty());
    }

    #[test]
    fn whitespace_around_quotes_is_tracked() {
        let bytes = b"  \"v\"  ,w\n";
        let out = parse(bytes, b',', true);
        let f0 = field(&out, 0, 0);
        // start..prefix_end == leading whitespace, suffix_start..end == trailing.
        assert_eq!(f0[0], 0);
        assert_eq!(f0[4], 2);
        assert_eq!(f0[5], 5);
        assert_eq!(f0[1], 7);
        assert_eq!(value_bytes(bytes, f0), b"v");
    }

    #[test]
    fn unclosed_quote_takes_rest_of_file_and_reports_ambiguous() {
        let bytes = b"a,\"open\nrest,of file";
        let out = parse(bytes, b',', true);
        assert_eq!(record_count(&out), 1);
        assert_eq!(field_count(&out, 0), 2);
        let f = field(&out, 0, 1);
        assert_eq!(f[6], FLAG_QUOTED | FLAG_MALFORMED);
        assert_eq!(f[1] as usize, bytes.len());
        let diags: Vec<&[u32]> = out.diagnostics.chunks_exact(DIAG_STRIDE).collect();
        assert_eq!(diags.len(), 2);
        assert_eq!(diags[0][2], DIAG_UNCLOSED_QUOTE);
        assert_eq!(diags[1][2], DIAG_AMBIGUOUS);
        assert_eq!(diags[0][..2], [1, 2]);
        assert!(!out.has_final_newline);
    }

    #[test]
    fn unclosed_quote_without_newline_is_not_ambiguous() {
        let bytes = b"\"open";
        let out = parse(bytes, b',', true);
        let diags: Vec<&[u32]> = out.diagnostics.chunks_exact(DIAG_STRIDE).collect();
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0][2], DIAG_UNCLOSED_QUOTE);
    }

    #[test]
    fn text_after_closing_quote_is_malformed() {
        let bytes = b"\"v\"junk,b\n";
        let out = parse(bytes, b',', true);
        let f = field(&out, 0, 0);
        assert_eq!(f[6], FLAG_QUOTED | FLAG_MALFORMED);
        // suffix_start..end covers the junk text.
        assert_eq!(&bytes[f[5] as usize..f[1] as usize], b"junk");
        let diags: Vec<&[u32]> = out.diagnostics.chunks_exact(DIAG_STRIDE).collect();
        assert_eq!(diags[0][2], DIAG_TEXT_AFTER_QUOTE);
    }

    #[test]
    fn bare_quote_in_unquoted_field() {
        let bytes = b"a\"b,c\n";
        let out = parse(bytes, b',', true);
        let f = field(&out, 0, 0);
        assert_eq!(f[6], FLAG_MALFORMED);
        let diags: Vec<&[u32]> = out.diagnostics.chunks_exact(DIAG_STRIDE).collect();
        assert_eq!(diags[0][2], DIAG_BARE_QUOTE);
    }

    #[test]
    fn trailing_delimiter_at_eof_creates_empty_field() {
        let bytes = b"a,b,";
        let out = parse(bytes, b',', true);
        assert_eq!(field_count(&out, 0), 3);
        let f = field(&out, 0, 2);
        assert_eq!(f[0] as usize, bytes.len());
        assert_eq!(f[1] as usize, bytes.len());
        assert!(!out.has_final_newline);
    }

    #[test]
    fn line_ending_stats_and_mixed_endings() {
        let bytes = b"a\r\nb\nc\rd";
        let out = parse(bytes, b',', true);
        assert_eq!(record_count(&out), 4);
        assert_eq!((out.crlf, out.lf, out.cr), (1, 1, 1));
        assert!(!out.has_final_newline);
        let last = &out.records[3 * RECORD_STRIDE..4 * RECORD_STRIDE];
        assert_eq!(last[2], last[3]); // no terminator on the final record
    }

    #[test]
    fn utf8_bom_is_skipped_only_when_requested() {
        let bytes = b"\xef\xbb\xbfa,b\n";
        let with = parse(bytes, b',', true);
        assert_eq!(with.bom_length, 3);
        assert_eq!(value_bytes(bytes, field(&with, 0, 0)), b"a");
        let without = parse(bytes, b',', false);
        assert_eq!(without.bom_length, 0);
        assert_eq!(value_bytes(bytes, field(&without, 0, 0)), b"\xef\xbb\xbfa");
    }

    #[test]
    fn inconsistent_field_counts_are_reported_against_row_one() {
        let bytes = b"a,b\n1\n2,3,4\n";
        let out = parse(bytes, b',', true);
        let diags: Vec<&[u32]> = out.diagnostics.chunks_exact(DIAG_STRIDE).collect();
        assert_eq!(diags.len(), 2);
        assert_eq!(diags[0], &[2, 1, DIAG_INCONSISTENT_FIELD_COUNT, 2, 1]);
        assert_eq!(diags[1], &[3, 1, DIAG_INCONSISTENT_FIELD_COUNT, 2, 3]);
    }

    #[test]
    fn empty_input_has_no_records() {
        let out = parse(b"", b',', true);
        assert_eq!(record_count(&out), 0);
        assert!(!out.has_final_newline);
    }

    #[test]
    fn crlf_split_across_fields_is_not_merged() {
        // CR at end of file directly after a field, then EOF.
        let bytes = b"a\r";
        let out = parse(bytes, b',', true);
        assert_eq!(record_count(&out), 1);
        assert_eq!(out.cr, 1);
        assert!(out.has_final_newline);
    }

    #[test]
    fn sniffs_delimiters() {
        assert_eq!(sniff_delimiter(b"a,b,c\n1,2,3\n"), b',');
        assert_eq!(sniff_delimiter(b"a;b;c\n1;2;3\n"), b';');
        assert_eq!(sniff_delimiter(b"a\tb\tc\n"), b'\t');
        // Quoted delimiters do not count.
        assert_eq!(sniff_delimiter(b"\"a;b;c;d;e\",x\n1,2\n"), b',');
        // Ties keep the comma default.
        assert_eq!(sniff_delimiter(b"plain text"), b',');
        // BOM is skipped.
        assert_eq!(sniff_delimiter(b"\xef\xbb\xbfa;b\n"), b';');
    }

    #[test]
    fn tab_delimiter_treats_tab_as_data_not_whitespace() {
        let bytes = b"a\t\"v\"\tb\n";
        let out = parse(bytes, b'\t', true);
        assert_eq!(field_count(&out, 0), 3);
        assert_eq!(value_bytes(bytes, field(&out, 0, 1)), b"v");
    }

    #[test]
    fn plan_and_apply_replacements() {
        let bytes = b"hello world";
        // Replace "hello" -> "goodbye" and "world" -> "wasm".
        let ranges = [0u32, 5, 6, 11];
        let payload = b"goodbyewasm";
        let lens = [7u32, 4];
        let plan = plan_replacements(bytes.len() as u32, &ranges, &lens);
        assert_eq!(
            plan,
            vec![
                PLAN_PAYLOAD, 0, 7, // "goodbye"
                PLAN_COPY, 5, 6, // " "
                PLAN_PAYLOAD, 7, 11, // "wasm"
            ]
        );
        let out = apply_replacements(bytes, &ranges, payload, &lens);
        assert_eq!(out, b"goodbye wasm");
    }

    #[test]
    fn apply_replacements_sorts_by_start_and_handles_inserts_and_deletes() {
        let bytes = b"abcdef";
        // Out of order: delete "de" (3..5), insert "XX" at 1..1.
        let ranges = [3u32, 5, 1, 1];
        let payload = b"XX";
        let lens = [0u32, 2];
        let out = apply_replacements(bytes, &ranges, payload, &lens);
        assert_eq!(out, b"aXXbcf");
    }

    #[test]
    fn apply_replacements_with_no_ranges_is_identity() {
        let bytes = b"unchanged";
        let out = apply_replacements(bytes, &[], &[], &[]);
        assert_eq!(out, bytes);
    }
}
