// SPDX-License-Identifier: MIT

export interface ElOptions {
  className?: string;
  /** Set via textContent only — never interpreted as HTML. */
  text?: string;
  attrs?: Record<string, string>;
}

/**
 * Small DOM builder. All text goes through textContent, so untrusted CSV
 * content, filenames, and search terms are always rendered as plain text.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function clearChildren(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}
