// SPDX-License-Identifier: MIT
// Documentation pages only: theme and density switches.
const doc = globalThis.document;
for (const group of doc.querySelectorAll('[data-switch]')) {
  const attr = 'data-' + group.dataset.switch;
  group.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    doc.documentElement.setAttribute(attr, button.dataset.value);
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button));
  });
}
