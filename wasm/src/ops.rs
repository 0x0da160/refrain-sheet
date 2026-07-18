// SPDX-License-Identifier: MIT
//! Data-parallel primitives that accelerate selection statistics and literal
//! search. Each has a byte-exact JavaScript fallback in `src/core/*.ts`; the
//! parity is covered by tests. Number parsing (JS `Number()` semantics) and
//! Unicode-aware / regex matching intentionally stay in JavaScript — only the
//! order-stable numeric reduction and the byte-level literal scan move here.

/// Reduce finite numbers to `[sum, min, max]`. The caller supplies the values
/// already parsed and filtered to finite numbers, in cell order, so the
/// floating-point summation order (and therefore the result) matches the JS
/// fallback exactly. Returns `[0, 0, 0]` for an empty slice.
pub fn aggregate(values: &[f64]) -> [f64; 3] {
    if values.is_empty() {
        return [0.0, 0.0, 0.0];
    }
    let mut sum = 0.0;
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for &v in values {
        sum += v;
        if v < min {
            min = v;
        }
        if v > max {
            max = v;
        }
    }
    [sum, min, max]
}

/// Count non-overlapping occurrences of `needle` in `haystack`. Matches the JS
/// `indexOf`-loop semantics (advance past each full match). Encoding-agnostic:
/// occurrence counts of a substring are identical for the UTF-8 bytes here and
/// the UTF-16 code units JS scans.
pub fn count_literal(haystack: &[u8], needle: &[u8]) -> u32 {
    let n = needle.len();
    if n == 0 || n > haystack.len() {
        return 0;
    }
    let mut count = 0u32;
    let mut i = 0usize;
    while i + n <= haystack.len() {
        if &haystack[i..i + n] == needle {
            count += 1;
            i += n;
        } else {
            i += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_finite_values() {
        assert_eq!(aggregate(&[1.0, 2.0, 3.0]), [6.0, 1.0, 3.0]);
        assert_eq!(aggregate(&[-5.0]), [-5.0, -5.0, -5.0]);
        assert_eq!(aggregate(&[]), [0.0, 0.0, 0.0]);
    }

    #[test]
    fn counts_non_overlapping_literals() {
        assert_eq!(count_literal(b"aaaa", b"aa"), 2);
        assert_eq!(count_literal(b"ababab", b"ab"), 3);
        assert_eq!(count_literal(b"abc", b""), 0);
        assert_eq!(count_literal(b"abc", b"xyz"), 0);
    }
}
