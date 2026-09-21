// SPDX-License-Identifier: MIT
export declare function oklchToLinearSrgb(L: number, C: number, Hdeg: number): [number, number, number];
export declare function relativeLuminance(L: number, C: number, H: number): number;
export declare function contrastRatio(a: [number, number, number], b: [number, number, number]): number;
export declare function extractBlockTokens(css: string, selector: string): Map<string, string>;
export declare function resolveOklch(raw: string, hues: Record<string, number>): [number, number, number];
