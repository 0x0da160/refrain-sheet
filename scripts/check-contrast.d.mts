// SPDX-License-Identifier: MIT
export declare function hexToLinearSrgb(hex: string): [number, number, number];
export declare function relativeLuminance(hex: string): number;
export declare function contrastRatio(a: string, b: string): number;
export declare function extractBlockTokens(css: string, selector: string): Map<string, string>;
