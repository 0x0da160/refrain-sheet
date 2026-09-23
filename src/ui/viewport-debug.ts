// SPDX-License-Identifier: MIT
import { t } from '../app/i18n';
import { APP_VERSION_DISPLAY } from '../app/version';
import { el } from './dom';
import { onKeyboardOpenChange, onKeyboardResize } from './popup';

/** The URL hash that turns the diagnostic display on. */
const DEBUG_HASH = '#debug-viewport';
/** How long after any event every animation frame is sampled too. */
const SAMPLE_WINDOW_MS = 1500;
/** The log keeps only the most recent entries. */
const MAX_LOG_LINES = 800;

function rect(node: Element | null): string {
  if (!node) {
    return '-';
  }
  const r = node.getBoundingClientRect();
  return `${Math.round(r.top)}+${Math.round(r.height)}`;
}

function describe(node: Element | null): string {
  if (!node) {
    return '-';
  }
  const cls =
    typeof node.className === 'string' && node.className ? `.${node.className.split(/\s+/).join('.')}` : '';
  return `${node.tagName.toLowerCase()}${cls}`;
}

/**
 * One line of measurements: the visual viewport, the page, `#app`, the grid
 * scroller, and its editor (the sink). Values are CSS pixels, rounded.
 */
function sample(): string {
  const doc = globalThis.document;
  const root = doc.documentElement;
  const vv = globalThis.visualViewport;
  const r = (n: number | undefined): string => (n === undefined ? '-' : String(Math.round(n * 10) / 10));
  const grid = doc.querySelector('.grid-container');
  const sink = doc.querySelector('.grid-sink');
  const sinkState = sink?.classList.contains('cell-editor') ? 'E' : '';
  return [
    `vv=${r(vv?.height)}@${r(vv?.offsetTop)}/${r(vv?.pageTop)}x${r(vv?.scale)}`,
    `ih=${globalThis.innerHeight}`,
    `ch=${root.clientHeight}`,
    `sy=${r(globalThis.scrollY)}`,
    `kb=${root.dataset.keyboardOpen === undefined ? 0 : 1}`,
    `app=${rect(doc.getElementById('app'))}`,
    grid ? `grid=${rect(grid)} ch${grid.clientHeight} st${grid.scrollTop} sh${grid.scrollHeight}` : 'grid=-',
    `sink=${rect(sink)}${sinkState}`,
    `ae=${describe(doc.activeElement)}`,
  ].join(' ');
}

/**
 * On-device diagnostics for how the on-screen keyboard changes the viewport
 * (#582). Installed only when the URL hash is `#debug-viewport`; otherwise it
 * adds nothing. Records a timeline of viewport, scroll, focus, and keyboard
 * events — plus every animation frame for a short while after each — each
 * with the measurements from `sample()`, logging a line only when those
 * changed. A small panel shows the latest line and a Copy button for the
 * whole log.
 */
export function installViewportDebug(): void {
  const doc = globalThis.document;
  if (!doc || globalThis.location?.hash !== DEBUG_HASH) {
    return;
  }
  const start = performance.now();
  const lines: string[] = [];
  let last = '';
  let sampleUntil = 0;
  let sampling = false;

  const current = el('div', { className: 'viewport-debug-current' });
  const status = el('span', { className: 'viewport-debug-status' });
  const copy = el('button', {
    className: 'viewport-debug-button',
    text: t('viewportDebug.copy'),
    attrs: { type: 'button' },
  });
  const clear = el('button', {
    className: 'viewport-debug-button',
    text: t('viewportDebug.clear'),
    attrs: { type: 'button' },
  });
  const output = el('textarea', { className: 'viewport-debug-output', attrs: { readonly: '', rows: '6' } });
  output.hidden = true;
  const panel = el('div', { className: 'viewport-debug' }, [
    current,
    el('div', { className: 'viewport-debug-actions' }, [copy, clear, status]),
    output,
  ]);
  doc.body.append(panel);

  const log = (event: string, force = false): void => {
    const values = sample();
    if (!force && values === last) {
      return;
    }
    last = values;
    const line = `${Math.round(performance.now() - start)} ${event} ${values}`;
    lines.push(line);
    if (lines.length > MAX_LOG_LINES) {
      lines.shift();
    }
    current.textContent = line;
  };
  const frame = (): void => {
    log('raf');
    if (performance.now() < sampleUntil) {
      requestAnimationFrame(frame);
    } else {
      sampling = false;
    }
  };
  const record = (event: string): void => {
    log(event, true);
    sampleUntil = performance.now() + SAMPLE_WINDOW_MS;
    if (!sampling) {
      sampling = true;
      requestAnimationFrame(frame);
    }
  };

  const vv = globalThis.visualViewport;
  vv?.addEventListener('resize', () => record('vv-resize'));
  vv?.addEventListener('scroll', () => record('vv-scroll'));
  globalThis.addEventListener('scroll', () => record('win-scroll'));
  // Capturing on the document catches every element's scroll (the grid's too).
  doc.addEventListener(
    'scroll',
    (e) => {
      if (e.target !== doc) {
        record(`scroll:${describe(e.target as Element)}`);
      }
    },
    true,
  );
  doc.addEventListener('focusin', (e) => record(`focusin:${describe(e.target as Element)}`), true);
  doc.addEventListener('focusout', (e) => record(`focusout:${describe(e.target as Element)}`), true);
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (!panel.contains(e.target as Node)) {
        record(`tap:${e.pointerType}@${Math.round(e.clientY)}`);
      }
    },
    true,
  );
  onKeyboardOpenChange((open) => record(open ? 'kb-open' : 'kb-close'));
  onKeyboardResize(() => record('kb-resize'));

  copy.addEventListener('click', () => {
    const text = [
      `Refrain Sheet ${APP_VERSION_DISPLAY}`,
      navigator.userAgent,
      `dpr=${globalThis.devicePixelRatio}`,
      ...lines,
    ].join('\n');
    output.value = text;
    const showForManualCopy = (): void => {
      output.hidden = false;
      output.select();
      status.textContent = t('viewportDebug.copyFailed');
    };
    if (!navigator.clipboard) {
      showForManualCopy();
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      status.textContent = t('viewportDebug.copied', { count: lines.length });
    }, showForManualCopy);
  });
  clear.addEventListener('click', () => {
    lines.length = 0;
    last = '';
    output.hidden = true;
    status.textContent = '';
    log('clear', true);
  });
  log('start', true);
}
