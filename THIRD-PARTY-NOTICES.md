# Third-Party Notices

Refrain Sheet is licensed under the MIT License (see [LICENSE](LICENSE)).

The distributed build output (`dist/`, and the release ZIP) bundles the
following third-party software. No strong-copyleft code is included. All
dependencies use permissive licenses compatible with redistribution under
the MIT License.

## encoding-japanese

- Version: 2.x
- Author: polygonplanet
- Source: https://github.com/polygonplanet/encoding.js
- Purpose: Japanese character-encoding detection and conversion
  (Shift_JIS / CP932 and EUC-JP encoding), bundled locally into the build
  output. No network access is involved.
- License: MIT

```text
MIT License

Copyright (c) 2012 polygonplanet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## sql.js (and SQLite)

- Version: 1.14.1
- Author: sql.js authors
- Source: https://github.com/sql-js/sql.js
- Purpose: the execution engine behind **Data > Run SQL Query…**
  (`src/core/sql-engine.ts`) — SQLite compiled to WebAssembly. The compiled
  `sql-wasm.wasm` binary is Base64-embedded into the build output at build
  time (`scripts/embed-sqljs.mjs` → `src/wasm-gen/sqljs-wasm-payload.ts`) and
  instantiated locally from those decoded bytes only (sql.js's `wasmBinary`
  option); `locateFile()` is never set, so no `.wasm` asset is fetched over
  the network and `file://` usage keeps working. No network access is
  involved.
- License: MIT (the sql.js project itself). sql.js statically links SQLite,
  which is dedicated to the public domain (no license text required, but see
  https://www.sqlite.org/copyright.html).

```text
MIT license
===========

Copyright (c) 2017 sql.js authors (see https://github.com/sql-js/sql.js/blob/master/AUTHORS)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## lucide

- Version: 1.28.0
- Author: Lucide Contributors
- Source: https://github.com/lucide-icons/lucide
- Purpose: UI icons (menu toggle, close/add buttons, checkmarks, file actions,
  warnings). Only the individual icon modules actually imported are bundled
  into the build output (tree-shaken, `sideEffects: false`); nothing is
  fetched from an icon font or CDN at runtime.
- License: ISC (package), with a subset of icons derived from the Feather
  project under the MIT License (both permissive).

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## WebAssembly core (Rust crates)

The embedded `refrain_csv_core` WebAssembly binary (bundled as Base64 in the
build output) statically links the following pure-Rust crates. Exact versions
are pinned in [`wasm/Cargo.lock`](wasm/Cargo.lock). All are permissively
licensed and build for `wasm32-unknown-unknown` with no C/C++ toolchain.

| Crate          | Version | Purpose                             | SPDX license                |
| -------------- | ------- | ----------------------------------- | --------------------------- |
| `wasm-bindgen` | 0.2.100 | JS ⇄ WASM bindings                  | `MIT OR Apache-2.0`         |
| `miniz_oxide`  | 0.8.0   | DEFLATE codec (RSF method `0x01`)   | `MIT OR Zlib OR Apache-2.0` |
| `ruzstd`       | 0.8.1   | Zstandard encoder+decoder (`0x02`)  | `MIT`                       |
| `lz4_flex`     | 0.14.0  | LZ4 Frame codec (RSF method `0x03`) | `MIT`                       |
| `twox-hash`    | 1.6/2.1 | xxHash checksums used by the codecs | `MIT`                       |
| `adler2`       | 2.0.1   | Adler-32 (miniz_oxide dependency)   | `0BSD OR MIT OR Apache-2.0` |

`ruzstd` is pinned to `0.8.1` — the version whose pure-Rust Zstandard **encoder**
(added in 0.8.0) still builds on the pinned Rust toolchain; 0.8.2+ requires a
newer compiler. Each of `ruzstd`, `lz4_flex`, and `miniz_oxide` provides both
compression and decompression. Their MIT license text (representative below for
`ruzstd`; `lz4_flex` and `twox-hash` are identical in substance) permits
redistribution under this project's MIT license.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development-only dependencies

Build and test tooling (Vite, Rollup, esbuild, TypeScript, Vitest, jsdom,
fast-check, ESLint, Prettier, and their transitive dependencies) is used only
during development and CI. It is **not** included in the distributed build
output. Their licenses (MIT, Apache-2.0, ISC, BSD) are recorded in
`package-lock.json` and in each package's `node_modules` directory after
`npm ci`.
