// SPDX-License-Identifier: MIT
//! Argon2id key derivation for the encrypted `.rsf` container ("RSFE", format
//! version 1).
//!
//! Argon2id (RFC 9106, version 0x13) turns the password into a 32-byte
//! key-encryption key (KEK). AES-256-GCM is not implemented here: the container
//! uses WebCrypto (`crypto.subtle`) for it, so this crate adds no cipher
//! dependency. Salts come from `crypto.getRandomValues` on the JavaScript side,
//! which keeps this crate free of a random-number dependency and its outputs
//! reproducible in tests.
//!
//! The cost parameters come from a file the user opened, so they are checked
//! here as well as in TypeScript. A bad call returns `None` before any large
//! allocation happens.

use argon2::{Algorithm, Argon2, Params, Version};

/// Length of the Argon2id output, which is the key-encryption key.
pub const KEY_LEN: usize = 32;
/// Length of the Argon2 salt.
pub const SALT_LEN: usize = 16;
/// Upper bounds on the Argon2 cost: memory in KiB (256 MiB), passes and lanes.
/// The lower bounds (m >= 8p, t >= 1, p >= 1) come from RFC 9106 and are enforced
/// by `argon2::Params::new`.
pub const MAX_MEMORY_KIB: u32 = 262_144;
pub const MAX_PASSES: u32 = 10;
pub const MAX_LANES: u32 = 4;

/// Derive the 32-byte key-encryption key from `password` with Argon2id.
///
/// Returns `None` when the salt is not [`SALT_LEN`] bytes, a cost parameter is
/// above its upper bound, or Argon2 rejects the combination (for example zero
/// passes, or `m_kib < 8 * lanes`).
pub fn argon2id(password: &[u8], salt: &[u8], m_kib: u32, passes: u32, lanes: u32) -> Option<[u8; KEY_LEN]> {
    if salt.len() != SALT_LEN || m_kib > MAX_MEMORY_KIB || passes > MAX_PASSES || lanes > MAX_LANES {
        return None;
    }
    let params = Params::new(m_kib, passes, lanes, Some(KEY_LEN)).ok()?;
    let context = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    context.hash_password_into(password, salt, &mut key).ok()?;
    Some(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use argon2::{AssociatedData, ParamsBuilder};

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// RFC 9106 section 5.3: Argon2id, m = 32 KiB, t = 3, p = 4, 32-byte output.
    /// This uses the crate's full API (secret and associated data), which the
    /// container never uses. It checks that this crate build matches the RFC.
    #[test]
    fn argon2id_matches_rfc9106_section_5_3() {
        let password = [0x01u8; 32];
        let salt = [0x02u8; 16];
        let secret = [0x03u8; 8];
        let associated = [0x04u8; 12];
        let params = ParamsBuilder::new()
            .m_cost(32)
            .t_cost(3)
            .p_cost(4)
            .output_len(32)
            .data(AssociatedData::new(&associated).expect("associated data length"))
            .build()
            .expect("RFC 9106 parameters");
        let context = Argon2::new_with_secret(&secret, Algorithm::Argon2id, Version::V0x13, params)
            .expect("secret length");
        let mut tag = [0u8; 32];
        context.hash_password_into(&password, &salt, &mut tag).expect("hash");
        assert_eq!(hex(&tag), "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
    }

    #[test]
    fn argon2id_is_deterministic_and_salt_sensitive() {
        let salt = [0x11u8; SALT_LEN];
        let other_salt = [0x12u8; SALT_LEN];
        let first = argon2id(b"correct horse", &salt, 8, 1, 1).expect("derive");
        let again = argon2id(b"correct horse", &salt, 8, 1, 1).expect("derive");
        let other = argon2id(b"correct horse", &other_salt, 8, 1, 1).expect("derive");
        assert_eq!(first, again);
        assert_ne!(first, other);
    }

    #[test]
    fn argon2id_rejects_bad_inputs_without_computing() {
        let salt = [0x11u8; SALT_LEN];
        assert!(argon2id(b"pw", &salt[..15], 8, 1, 1).is_none(), "short salt");
        assert!(argon2id(b"pw", &[0u8; 17], 8, 1, 1).is_none(), "long salt");
        assert!(argon2id(b"pw", &salt, MAX_MEMORY_KIB + 1, 1, 1).is_none(), "memory above limit");
        assert!(argon2id(b"pw", &salt, 8, 0, 1).is_none(), "zero passes");
        assert!(argon2id(b"pw", &salt, 8, MAX_PASSES + 1, 1).is_none(), "passes above limit");
        assert!(argon2id(b"pw", &salt, 8, 1, 0).is_none(), "zero lanes");
        assert!(argon2id(b"pw", &salt, 8, 1, MAX_LANES + 1).is_none(), "lanes above limit");
        assert!(argon2id(b"pw", &salt, 8, 1, 2).is_none(), "memory below 8 times lanes");
    }
}
