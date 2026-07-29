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

/// Build the Knuth-Morris-Pratt partial-match ("failure") table for `needle`:
/// `table[i]` is the length of the longest proper prefix of `needle[..=i]`
/// that is also a suffix of it.
fn kmp_failure_table(needle: &[u8]) -> Vec<usize> {
    let mut table = vec![0usize; needle.len()];
    let mut k = 0usize;
    for i in 1..needle.len() {
        while k > 0 && needle[i] != needle[k] {
            k = table[k - 1];
        }
        if needle[i] == needle[k] {
            k += 1;
        }
        table[i] = k;
    }
    table
}

/// Count non-overlapping occurrences of `needle` in `haystack`. Matches the JS
/// `indexOf`-loop semantics (advance past each full match). Encoding-agnostic:
/// occurrence counts of a substring are identical for the UTF-8 bytes here and
/// the UTF-16 code units JS scans.
///
/// Uses Knuth-Morris-Pratt so cost is O(haystack + needle) rather than the
/// O(haystack × needle) of a naive scan; the KMP match state resets to zero
/// after each hit (instead of falling back via the failure table) to keep
/// matches non-overlapping.
pub fn count_literal(haystack: &[u8], needle: &[u8]) -> u32 {
    let n = needle.len();
    if n == 0 || n > haystack.len() {
        return 0;
    }
    let failure = kmp_failure_table(needle);
    let mut count = 0u32;
    let mut k = 0usize;
    for &byte in haystack {
        while k > 0 && byte != needle[k] {
            k = failure[k - 1];
        }
        if byte == needle[k] {
            k += 1;
        }
        if k == n {
            count += 1;
            k = 0;
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

    #[test]
    fn counts_literals_at_edges_and_with_self_overlapping_needles() {
        // Needle spans the entire haystack.
        assert_eq!(count_literal(b"abab", b"abab"), 1);
        // Needle longer than haystack.
        assert_eq!(count_literal(b"ab", b"abab"), 0);
        // Empty haystack.
        assert_eq!(count_literal(b"", b"a"), 0);
        // Self-overlapping needle: only non-overlapping hits count.
        assert_eq!(count_literal(b"aaaaa", b"aaa"), 1);
        assert_eq!(count_literal(b"aaaaaa", b"aaa"), 2);
        // A needle whose failure table has a non-trivial fallback.
        assert_eq!(count_literal(b"abcabcabcabx", b"abcabx"), 1);
    }

    #[test]
    fn counts_literals_in_unicode_bytes() {
        // Multi-byte UTF-8 needle ("é") repeated and overlapping ASCII text.
        assert_eq!(count_literal("café café".as_bytes(), "é".as_bytes()), 2);
        // CJK text: 3-byte UTF-8 code points, non-overlapping repeats.
        assert_eq!(count_literal("こんにちはこんにちは".as_bytes(), "こんにちは".as_bytes()), 2);
        assert_eq!(count_literal("🎉🎉🎉".as_bytes(), "🎉".as_bytes()), 3);
    }

    #[test]
    fn counts_literals_in_large_haystack() {
        // Confirms correctness at a scale where a naive O(haystack × needle)
        // scan would be markedly slower than the KMP-based implementation.
        let haystack = "ab".repeat(200_000);
        assert_eq!(count_literal(haystack.as_bytes(), b"ab"), 200_000);

        let mut padded = "x".repeat(100_000);
        padded.push_str("needle");
        padded.push_str(&"x".repeat(100_000));
        assert_eq!(count_literal(padded.as_bytes(), b"needle"), 1);
    }
}
