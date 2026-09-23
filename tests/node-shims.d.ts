// SPDX-License-Identifier: MIT
// Minimal ambient declarations for the Node builtins used by tests, so tsc
// resolves them without adding @types/node (this project pins types to
// vite/client). Node provides the real modules at test runtime.
declare module 'fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function readFileSync(path: string | URL): Uint8Array;
  export function writeFileSync(path: string | URL, data: Uint8Array): void;
  export function existsSync(path: string | URL): boolean;
  export function mkdirSync(path: string | URL, options: { recursive: true }): void;
}
