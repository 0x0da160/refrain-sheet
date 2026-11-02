// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  AI_CONTEXT_MAX_CELL_CHARS,
  AI_CONTEXT_MAX_COLS,
  AI_CONTEXT_MAX_ROWS,
  AI_HISTORY_TURNS,
  AI_SYSTEM_PROMPT,
  buildAiMessages,
  buildAiSheetContext,
  type AiChatMessage,
  type AiSheetView,
} from '../../src/core/ai-prompt';
import { parseAiPlan } from '../../src/core/ai-plan';

function sheet(rows: string[][], extra: Partial<AiSheetView> = {}): AiSheetView {
  return {
    name: 'Sales',
    rowCount: rows.length,
    columnCount: Math.max(0, ...rows.map((r) => r.length)),
    getValue: (r, c) => rows[r]?.[c] ?? '',
    getDisplayValue: (r, c) => (rows[r]?.[c] === '=SUM(B2:B3)' ? '30' : (rows[r]?.[c] ?? '')),
    active: null,
    range: null,
    ...extra,
  };
}

describe('buildAiSheetContext', () => {
  it('shows the cells as a table with column letters and row numbers', () => {
    const text = buildAiSheetContext(
      sheet(
        [
          ['Item', 'Price'],
          ['Tea', '10'],
          ['Cake', '20'],
          ['Total', '=SUM(B2:B3)'],
        ],
        { active: { row: 1, col: 1 } },
      ),
    );
    expect(text).toContain('Sheet: Sales (4 rows x 2 columns)');
    expect(text).toContain('Selected: B2');
    expect(text).toContain('| | A | B |');
    expect(text).toContain('| 2 | Tea | 10 |');
    // A formula shows both what it is and what it shows.
    expect(text).toContain('| 4 | Total | =SUM(B2:B3) → 30 |');
  });

  it('names a selected range', () => {
    const text = buildAiSheetContext(
      sheet([['a', 'b']], { active: { row: 0, col: 1 }, range: { top: 0, left: 0, bottom: 0, right: 1 } }),
    );
    expect(text).toContain('Selected: A1:B1 (active cell B1)');
  });

  it('keeps each cell on one line, without breaking the table', () => {
    const long = 'x'.repeat(AI_CONTEXT_MAX_CELL_CHARS + 20);
    const text = buildAiSheetContext(sheet([['line 1\nline 2', 'a|b', long]]));
    expect(text).toContain('| 1 | line 1 line 2 | a/b | ');
    expect(text).toContain(`${'x'.repeat(AI_CONTEXT_MAX_CELL_CHARS - 1)}…`);
    expect(text).not.toContain('x'.repeat(AI_CONTEXT_MAX_CELL_CHARS));
  });

  it('shows a bounded window that follows the active cell and keeps the header row', () => {
    const rows = Array.from({ length: 500 }, (_, r) => Array.from({ length: 30 }, (_, c) => `r${r}c${c}`));
    const text = buildAiSheetContext(sheet(rows, { active: { row: 300, col: 20 } }));
    const tableRows = text.split('\n').filter((line) => /^\| \d+ \|/.test(line));
    expect(tableRows).toHaveLength(AI_CONTEXT_MAX_ROWS);
    expect(tableRows[0]).toMatch(/^\| 1 \|/);
    expect(text).toContain('r300c20');
    expect(text).toContain('Showing part of the sheet');
    const header = text.split('\n').find((line) => line.startsWith('| | '))!;
    expect(header.split('|').length - 3).toBe(AI_CONTEXT_MAX_COLS);
  });

  it('says when the sheet is empty', () => {
    expect(buildAiSheetContext(sheet([]))).toContain('The sheet is empty.');
  });
});

describe('buildAiMessages', () => {
  it('sends the prompt with the sheet, the last few turns, and the question', () => {
    const history: AiChatMessage[] = [];
    for (let i = 0; i < AI_HISTORY_TURNS + 2; i++) {
      history.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
    }
    const messages = buildAiMessages('Sheet: X', history, 'new question');
    expect(messages[0]).toEqual({ role: 'system', content: `${AI_SYSTEM_PROMPT}\n\nSheet: X` });
    expect(messages).toHaveLength(1 + AI_HISTORY_TURNS * 2 + 1);
    expect(messages[1]).toEqual({ role: 'user', content: 'q2' });
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'new question' });
  });

  it('tells the model when no sheet of cells is open', () => {
    expect(buildAiMessages(null, [], 'hi')[0].content).toContain('no cell can be changed');
  });

  it('teaches a plan format that the plan parser reads', () => {
    const example = AI_SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('PLAN: '));
    expect(example.length).toBeGreaterThan(0);
    for (const line of example) {
      expect(parseAiPlan(line).ok).toBe(true);
    }
  });
});
