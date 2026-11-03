// SPDX-License-Identifier: MIT
/**
 * What the AI assistant is told: the system prompt, and a compact text view
 * of the active sheet so the model can answer questions about its data and
 * name the cells an edit should change. Pure and DOM-free: the caller passes
 * a read-only view of the sheet, and nothing here can write to it.
 *
 * The model is small (Qwen2.5-0.5B-Instruct by default), so both are kept
 * short and literal: one format rule, one worked example, and a bounded
 * window of cells rather than the whole sheet.
 */
import type { CellRange } from './clipboard';
import { cellLabel, columnLabel } from './formula';

/**
 * System prompt. A reply that changes the sheet ends with one
 * `PLAN: {"changes":[...]}` line that `parseAiPlan` (./ai-plan.ts) reads;
 * a plain question gets a plain answer. Written in English, which a small
 * multilingual model follows most reliably, and told to answer in the
 * user's own language.
 */
export const AI_SYSTEM_PROMPT = [
  'You are the assistant built into Refrain Sheet, a spreadsheet app.',
  "Answer briefly, in the same language as the user's message.",
  'The current sheet is shown below as a table: column letters on top, row numbers on the left.',
  'If the user only asks a question, answer it and do not write a PLAN line.',
  'If the user asks you to change cells, explain the change in one sentence, then write exactly one last line in this format:',
  'PLAN: {"changes":[{"ref":"A1","value":"new content"}]}',
  '"ref" is a cell reference such as B2. "value" is the new content of that cell: text, a number, or a formula starting with =.',
  'Example: to put 100 in B2 and the total of B2:B5 in B6, the last line is',
  'PLAN: {"changes":[{"ref":"B2","value":"100"},{"ref":"B6","value":"=SUM(B2:B5)"}]}',
].join('\n');

/** The read-only view of a sheet the context builder needs. */
export interface AiSheetView {
  /** The sheet (or CSV file) name shown to the model. */
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  /** The cell's stored content (a formula stays a formula). */
  getValue(row: number, col: number): string;
  /** What the cell shows (a formula's result). */
  getDisplayValue(row: number, col: number): string;
  /** The active cell, if any. */
  readonly active: { row: number; col: number } | null;
  /** The selected range, if more than one cell is selected. */
  readonly range: CellRange | null;
}

/** How much of the sheet goes into one prompt, so it fits the model's context. */
export const AI_CONTEXT_MAX_ROWS = 40;
export const AI_CONTEXT_MAX_COLS = 12;
/** Longer cell contents are cut, with an ellipsis. */
export const AI_CONTEXT_MAX_CELL_CHARS = 60;

/** One cell's text for the table: one line, no column separators, bounded length. */
function cellText(raw: string): string {
  const oneLine = raw.replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '/');
  const chars = Array.from(oneLine);
  return chars.length > AI_CONTEXT_MAX_CELL_CHARS
    ? `${chars.slice(0, AI_CONTEXT_MAX_CELL_CHARS - 1).join('')}…`
    : oneLine;
}

/**
 * The first index of a window of `size` items out of `count` that keeps
 * `focus` in view: the start of the sheet when the focus is near it,
 * otherwise a window that begins a few items before the focus.
 */
function windowStart(count: number, size: number, focus: number | null): number {
  if (focus === null || focus < size) {
    return 0;
  }
  return Math.max(0, Math.min(count - size, focus - Math.floor(size / 4)));
}

/** The sheet description sent to the model with every question. */
export function buildAiSheetContext(sheet: AiSheetView): string {
  const rows = Math.max(0, sheet.rowCount);
  const cols = Math.max(0, sheet.columnCount);
  const lines: string[] = [`Sheet: ${cellText(sheet.name)} (${rows} rows x ${cols} columns)`];
  if (sheet.active) {
    const at = cellLabel(sheet.active.row, sheet.active.col);
    const range = sheet.range;
    lines.push(
      range && (range.top !== range.bottom || range.left !== range.right)
        ? `Selected: ${cellLabel(range.top, range.left)}:${cellLabel(range.bottom, range.right)} (active cell ${at})`
        : `Selected: ${at}`,
    );
  }
  if (rows === 0 || cols === 0) {
    lines.push('The sheet is empty.');
    return lines.join('\n');
  }

  const rowCount = Math.min(rows, AI_CONTEXT_MAX_ROWS);
  const colCount = Math.min(cols, AI_CONTEXT_MAX_COLS);
  const top = windowStart(rows, rowCount, sheet.active?.row ?? null);
  const left = windowStart(cols, colCount, sheet.active?.col ?? null);
  const colIndexes = Array.from({ length: colCount }, (_, i) => left + i);
  // Row 1 usually holds the headers, so it stays even when the window scrolls down.
  const rowIndexes = Array.from({ length: rowCount }, (_, i) => top + i);
  if (top > 0) {
    rowIndexes.splice(0, 1, 0);
  }

  if (rowCount < rows || colCount < cols) {
    const last = cellLabel(rowIndexes[rowIndexes.length - 1], colIndexes[colIndexes.length - 1]);
    lines.push(`Showing part of the sheet, up to ${last}.`);
  }
  lines.push('', `| | ${colIndexes.map((c) => columnLabel(c)).join(' | ')} |`);
  lines.push(`|---|${colIndexes.map(() => '---').join('|')}|`);
  for (const r of rowIndexes) {
    const cells = colIndexes.map((c) => {
      const value = sheet.getValue(r, c);
      const shown = value.startsWith('=') ? `${value} → ${sheet.getDisplayValue(r, c)}` : value;
      return cellText(shown);
    });
    lines.push(`| ${r + 1} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** One turn of the conversation, as the engine takes it. */
export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** How many earlier question/answer pairs go with a new question. */
export const AI_HISTORY_TURNS = 3;

/**
 * The messages for one question: the system prompt with the sheet as it is
 * now, the last few turns, and the new question.
 */
export function buildAiMessages(
  sheetContext: string | null,
  history: readonly AiChatMessage[],
  question: string,
): AiChatMessage[] {
  const system = sheetContext
    ? `${AI_SYSTEM_PROMPT}\n\n${sheetContext}`
    : `${AI_SYSTEM_PROMPT}\n\nNo sheet of cells is open, so no cell can be changed.`;
  const recent = history.filter((m) => m.role !== 'system').slice(-AI_HISTORY_TURNS * 2);
  return [{ role: 'system', content: system }, ...recent, { role: 'user', content: question }];
}
