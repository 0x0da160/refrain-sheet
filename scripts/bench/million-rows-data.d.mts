// SPDX-License-Identifier: MIT
export declare const FULL_ROWS: number;
export declare const DEFAULT_SEED: number;
export declare const SHEET_DETAIL: string;
export declare const SHEET_MASTER: string;
export declare const SHEET_SUMMARY: string;
export declare const DETAIL_HEADER: string[];
export declare const DEPARTMENTS: Array<{ name: string; weight: number }>;
export declare const CATEGORIES: Array<{ name: string; min: number; max: number }>;
export declare const PRODUCT_COUNT: number;
export declare const FIRST_DAY: string;
export declare const LAST_DAY: string;
export interface DemoProduct {
  code: string;
  name: string;
  category: number;
  price: number;
}
export interface DemoData {
  rows: number;
  products: DemoProduct[];
  days: string[];
  day: Uint16Array;
  product: Uint16Array;
  dept: Uint8Array;
  qty: Uint8Array;
  price: Uint32Array;
}
export interface DemoConditions {
  from?: string;
  to?: string;
  before?: string;
  dept?: string;
  category?: string;
  product?: string;
}
export interface DemoTotals {
  sales: number;
  count: number;
  quantity: number;
}
export declare function monthStarts(): string[];
export declare function buildRows(rows?: number, seed?: number): DemoData;
export declare function detailRow(data: DemoData, i: number): string[];
export declare function aggregate(
  data: DemoData,
  conditions?: DemoConditions,
  overrides?: Map<number, number>,
): DemoTotals;
export declare const SUMMARY: {
  from: string;
  to: string;
  dept: string;
  category: string;
  sales: string;
  count: string;
  average: string;
  quantity: string;
  deptFirstRow: number;
  categoryFirstRow: number;
  monthFirstRow: number;
  productCode: string;
  productName: string;
  productCategory: string;
  productPrice: string;
  productSales: string;
  productCount: string;
};
export declare function summaryRows(rows?: number): string[][];
