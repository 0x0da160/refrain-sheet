// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiAssistantAvailable,
  aiAssistantBuilt,
  aiRuntimeFiles,
  setAiAssistantAvailableForTests,
} from '../../src/app/ai/model';
import { aiAssistantInput, aiSheetContext, applyAiPlan } from '../../src/app/commands/ai-assistant';
import { Commands, type UiPort } from '../../src/app/commands';
import { AppState } from '../../src/app/state';
import { parseAiPlan, type AiPlanChange } from '../../src/core/ai-plan';
import { RsfDocument } from '../../src/core/workbook/rsf-document';
import { doc } from '../helpers';

function changes(text: string): AiPlanChange[] {
  const plan = parseAiPlan(`PLAN: ${text}`);
  if (!plan.ok) throw new Error(plan.reason);
  return plan.changes;
}

function csvState(text: string): AppState {
  const state = new AppState();
  state.addTab('data.csv', doc(text), null);
  return state;
}

afterEach(() => setAiAssistantAvailableForTests(null));

describe('applyAiPlan', () => {
  it('changes CSV cells as one undoable edit and skips cells outside the file', () => {
    const state = csvState('a,b\n1,2\n');
    const tab = state.activeTab!;
    const result = applyAiPlan(
      state,
      changes('{"changes":[{"ref":"A2","value":"10"},{"ref":"B2","value":"20"},{"ref":"Z99","value":"x"}]}'),
    );
    expect(result).toEqual({ applied: 2, skipped: 1 });
    expect(tab.doc.getValue(1, 0)).toBe('10');
    expect(tab.doc.getValue(1, 1)).toBe('20');
    expect(tab.history.canUndo).toBe(true);
    state.undo(tab);
    expect(tab.doc.getValue(1, 0)).toBe('1');
    expect(tab.doc.getValue(1, 1)).toBe('2');
  });

  it('writes values and formulas to a workbook sheet in one undo step', () => {
    const state = new AppState();
    const tab = state.addTab('book.rsf', RsfDocument.blank('book.rsf'), null);
    const result = applyAiPlan(
      state,
      changes(
        '{"changes":[{"ref":"A1","value":"5"},{"ref":"A2","value":"7"},{"ref":"A3","value":"=SUM(A1:A2)"}]}',
      ),
    );
    expect(result).toEqual({ applied: 3, skipped: 0 });
    expect(tab.doc.getDisplayValue(2, 0)).toBe('12');
    state.undo(tab);
    expect(tab.doc.getValue(0, 0)).toBe('');
    expect(tab.doc.getValue(2, 0)).toBe('');
  });

  it('changes nothing when every value is already there', () => {
    const state = csvState('a,b\n');
    expect(applyAiPlan(state, changes('{"changes":[{"ref":"A1","value":"a"}]}'))).toEqual({
      applied: 0,
      skipped: 0,
    });
    expect(state.activeTab!.history.canUndo).toBe(false);
  });

  it('applies nothing without an open sheet of cells', () => {
    const state = new AppState();
    expect(applyAiPlan(state, changes('{"changes":[{"ref":"A1","value":"1"}]}'))).toEqual({
      applied: 0,
      skipped: 1,
    });
  });
});

describe('aiSheetContext', () => {
  it('describes the active CSV and its selection', () => {
    const state = csvState('name,qty\ntea,3\n');
    const tab = state.activeTab!;
    state.setSelection(tab, { row: 1, col: 1 });
    const text = aiSheetContext(state)!;
    expect(text).toContain('Sheet: data.csv (2 rows x 2 columns)');
    expect(text).toContain('Selected: B2');
    expect(text).toContain('| 2 | tea | 3 |');
  });

  it('describes only the used part of a workbook sheet', () => {
    const state = new AppState();
    const tab = state.addTab('book.rsf', RsfDocument.blank('book.rsf'), null);
    if (tab.doc.kind !== 'rsf') throw new Error('unreachable');
    tab.doc.setCell(0, 0, 'x');
    tab.doc.setCell(1, 1, 'y');
    expect(aiSheetContext(state)).toContain('(2 rows x 2 columns)');
  });

  it('is null with no tab open, and read live through the panel input', () => {
    const state = new AppState();
    const input = aiAssistantInput(state);
    expect(input.sheetContext()).toBeNull();
    state.addTab('data.csv', doc('a\n'), null);
    expect(input.sheetContext()).toContain('data.csv');
  });
});

describe('where the AI assistant exists', () => {
  it('is built into every build but the offline one (tests build the full app)', () => {
    expect(aiAssistantBuilt()).toBe(true);
  });

  it('is offered only over http(s), never from a local file', () => {
    expect(location.protocol).toBe('http:');
    expect(aiAssistantAvailable()).toBe(true);
    setAiAssistantAvailableForTests(false);
    expect(aiAssistantAvailable()).toBe(false);
  });

  it('names its runtime files by version under ai-runtime/', () => {
    const files = aiRuntimeFiles();
    for (const path of Object.values(files)) {
      expect(path).toMatch(/^ai-runtime\/wllama(-compat)?-\d+\.\d+\.\d+\.(wasm|js)$/);
    }
  });

  it('View ▸ AI Assistant opens the panel only where it is available', () => {
    const showAiAssistant = vi.fn();
    const ui = new Proxy({ showAiAssistant } as Partial<UiPort>, {
      get: (target, key) => (target as Record<string | symbol, unknown>)[key] ?? vi.fn(),
    }) as UiPort;
    const commands = new Commands(new AppState(), ui, document);
    setAiAssistantAvailableForTests(false);
    expect(commands.isEnabled('view.aiAssistant')).toBe(false);
    void commands.run('view.aiAssistant');
    expect(showAiAssistant).not.toHaveBeenCalled();
    setAiAssistantAvailableForTests(true);
    expect(commands.isEnabled('view.aiAssistant')).toBe(true);
    void commands.run('view.aiAssistant');
    expect(showAiAssistant).toHaveBeenCalledTimes(1);
  });
});
