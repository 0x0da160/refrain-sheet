// SPDX-License-Identifier: MIT
// Minimal ambient declarations for the Node builtins used by tests, so tsc
// resolves them without adding @types/node (this project pins types to
// vite/client). Node provides the real modules at test runtime.
declare module 'fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
