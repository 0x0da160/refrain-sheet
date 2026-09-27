// SPDX-License-Identifier: MIT
export interface InventoryComponent {
  name: string;
  version: string;
  cycle: string;
  ecosystem: 'npm' | 'cargo' | 'github' | 'generic';
  scope: 'direct' | 'toolchain' | 'transitive';
  dev?: boolean;
  license?: string;
  sources: string[];
}
export declare function cycleOf(version: string): string;
export declare function collectInventory(root?: string): {
  name: string;
  version: string;
  components: InventoryComponent[];
};
export declare function buildSbom(inventory: ReturnType<typeof collectInventory>): {
  bomFormat: 'CycloneDX';
  specVersion: string;
  components: Array<{
    name: string;
    version: string;
    purl: string;
    properties: Array<{ name: string; value: string }>;
  }>;
};
