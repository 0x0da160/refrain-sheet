# Third-Party Notices

Refrain Sheet is licensed under the MIT License (see [LICENSE](LICENSE)).

The distributed build output (`dist/`, and the release ZIP) bundles the
following third-party software. All bundled dependencies use permissive
licenses compatible with redistribution under the MIT License; no
strong-copyleft code is included.

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

## Development-only dependencies

Build and test tooling (Vite, Rollup, esbuild, TypeScript, Vitest, jsdom,
fast-check, ESLint, Prettier, and their transitive dependencies) is used only
during development and CI. It is **not** included in the distributed build
output. Their licenses (MIT, Apache-2.0, ISC, BSD) are recorded in
`package-lock.json` and in each package's `node_modules` directory after
`npm ci`.
