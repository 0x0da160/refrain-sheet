// SPDX-License-Identifier: MIT
/**
 * Behaviour of every worksheet function: normal results, optional arguments,
 * range handling, coercion, invalid arguments, and the documented error value
 * for each failure. Formulas are evaluated through a real workbook, so these
 * exercise the same path the grid does rather than the evaluator in isolation.
 */
import { describe, expect, it } from 'vitest';
import { RsfDocument } from '../src/core/rsf-document';
import { FUNCTION_INFOS, SUPPORTED_FUNCTIONS } from '../src/core/formula';

/** Build a worksheet from `{ A1: '…' }` style cell literals. */
function sheet(cells: Record<string, string>, rows = 20, cols = 10): RsfDocument {
  const doc = RsfDocument.empty('t.rsf', rows, cols);
  for (const [ref, value] of Object.entries(cells)) {
    doc.setCell(Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65, value);
  }
  return doc;
}

/** The displayed value of a cell. */
function at(doc: RsfDocument, ref: string): string {
  return doc.getDisplayValue(Number(ref.slice(1)) - 1, ref.charCodeAt(0) - 65);
}

/** Evaluate a single formula against an optional set of data cells. */
function evaluate(formula: string, data: Record<string, string> = {}): string {
  return at(sheet({ ...data, J20: formula }), 'J20');
}

describe('registry integrity', () => {
  it('exposes one info entry per supported function, sorted and unique', () => {
    expect(FUNCTION_INFOS.map((f) => f.name)).toEqual([...SUPPORTED_FUNCTIONS]);
    expect(new Set(SUPPORTED_FUNCTIONS).size).toBe(SUPPORTED_FUNCTIONS.length);
    expect([...SUPPORTED_FUNCTIONS].sort()).toEqual([...SUPPORTED_FUNCTIONS]);
  });

  it('covers every function named in the task specification', () => {
    const required = [
      'COUNTA',
      'COUNTBLANK',
      'COUNTIF',
      'COUNTIFS',
      'SUMIF',
      'SUMIFS',
      'AVERAGEIF',
      'AVERAGEIFS',
      'AND',
      'OR',
      'NOT',
      'IFERROR',
      'ROUND',
      'ROUNDUP',
      'ROUNDDOWN',
      'ABS',
      'MOD',
      'XLOOKUP',
      'VLOOKUP',
      'INDEX',
      'MATCH',
      'LEFT',
      'RIGHT',
      'MID',
      'LEN',
      'TRIM',
      'CONCAT',
      'TEXTJOIN',
      'SUBSTITUTE',
      'REPLACE',
      'UPPER',
      'LOWER',
      'TODAY',
      'NOW',
      'DATE',
      'YEAR',
      'MONTH',
      'DAY',
      'DATEDIF',
      'MEDIAN',
      'MODE.SNGL',
      'STDEV.S',
      'STDEV.P',
      'RANK.EQ',
      'FILTER',
      'UNIQUE',
      'SORT',
      'SEQUENCE',
    ];
    for (const name of required) {
      expect(SUPPORTED_FUNCTIONS, name).toContain(name);
    }
  });

  it('reports a wrong argument count as #ERROR! rather than guessing', () => {
    expect(evaluate('=ABS()')).toBe('#ERROR!');
    expect(evaluate('=ABS(1,2)')).toBe('#ERROR!');
    expect(evaluate('=MID("abc",1)')).toBe('#ERROR!');
    expect(evaluate('=TODAY(1)')).toBe('#ERROR!');
  });
});

describe('counting and conditional aggregation', () => {
  const data = {
    A1: '5',
    A2: '15',
    A3: 'apple',
    A4: '',
    A5: '25',
    B1: '1',
    B2: '2',
    B3: '3',
    B4: '4',
    B5: '5',
    C1: 'x',
    C2: 'y',
    C3: 'x',
    C4: 'x',
    C5: 'y',
  };

  it('COUNTA counts everything that is not blank', () => {
    expect(evaluate('=COUNTA(A1:A5)', data)).toBe('4');
    expect(evaluate('=COUNTA(A1:A5,B1:B5)', data)).toBe('9');
    expect(evaluate('=COUNTA(1,"",TRUE)')).toBe('3'); // "" is a value, not a blank
  });

  it('COUNTBLANK counts blank cells', () => {
    expect(evaluate('=COUNTBLANK(A1:A5)', data)).toBe('1');
    expect(evaluate('=COUNTBLANK(A1:A10)', data)).toBe('6');
  });

  it('COUNTIF applies comparison, text, and wildcard criteria', () => {
    expect(evaluate('=COUNTIF(A1:A5,">10")', data)).toBe('2');
    expect(evaluate('=COUNTIF(A1:A5,">=15")', data)).toBe('2');
    expect(evaluate('=COUNTIF(A1:A5,"<10")', data)).toBe('1');
    expect(evaluate('=COUNTIF(C1:C5,"x")', data)).toBe('3');
    expect(evaluate('=COUNTIF(C1:C5,"<>x")', data)).toBe('2');
    expect(evaluate('=COUNTIF(A1:A5,"app*")', data)).toBe('1');
    expect(evaluate('=COUNTIF(A1:A5,"?????")', data)).toBe('1'); // "apple"
    expect(evaluate('=COUNTIF(A1:A5,"")', data)).toBe('1'); // the blank cell
  });

  it('COUNTIFS requires every criterion and the same shape', () => {
    expect(evaluate('=COUNTIFS(C1:C5,"x",B1:B5,">1")', data)).toBe('2');
    expect(evaluate('=COUNTIFS(C1:C5,"x",B1:B4,">1")', data)).toBe('#VALUE!');
    expect(evaluate('=COUNTIFS(C1:C5,"x")', data)).toBe('3');
  });

  it('SUMIF sums the matching values, with or without a separate range', () => {
    expect(evaluate('=SUMIF(A1:A5,">10")', data)).toBe('40');
    expect(evaluate('=SUMIF(C1:C5,"x",B1:B5)', data)).toBe('8');
    expect(evaluate('=SUMIF(C1:C5,"x",B1:B4)', data)).toBe('#VALUE!');
  });

  it('SUMIFS takes the value range first', () => {
    expect(evaluate('=SUMIFS(B1:B5,C1:C5,"x",B1:B5,">1")', data)).toBe('7');
    expect(evaluate('=SUMIFS(B1:B5,C1:C5,"never")', data)).toBe('0');
  });

  it('AVERAGEIF and AVERAGEIFS report #DIV/0! when nothing qualifies', () => {
    expect(evaluate('=AVERAGEIF(C1:C5,"x",B1:B5)', data)).toBe('2.6666666666666665');
    expect(evaluate('=AVERAGEIF(C1:C5,"none",B1:B5)', data)).toBe('#DIV/0!');
    expect(evaluate('=AVERAGEIFS(B1:B5,C1:C5,"y")', data)).toBe('3.5');
    expect(evaluate('=AVERAGEIFS(B1:B5,C1:C5,"none")', data)).toBe('#DIV/0!');
  });

  it('propagates an error found inside a scanned range', () => {
    const withError = { ...data, C3: '=1/0' };
    expect(evaluate('=COUNTIF(C1:C5,"x")', withError)).toBe('#DIV/0!');
    expect(evaluate('=SUMIF(C1:C5,"x",B1:B5)', withError)).toBe('#DIV/0!');
  });
});

describe('logical functions and error handling', () => {
  it('AND / OR / NOT reduce logical values', () => {
    expect(evaluate('=AND(TRUE,TRUE)')).toBe('TRUE');
    expect(evaluate('=AND(TRUE,FALSE)')).toBe('FALSE');
    expect(evaluate('=OR(FALSE,TRUE)')).toBe('TRUE');
    expect(evaluate('=OR(FALSE,FALSE)')).toBe('FALSE');
    expect(evaluate('=NOT(TRUE)')).toBe('FALSE');
    expect(evaluate('=AND(1>0,2>1)')).toBe('TRUE');
    expect(evaluate('=NOT(0)')).toBe('TRUE'); // numbers coerce, zero is false
  });

  it('AND / OR / NOT propagate errors and reject text', () => {
    expect(evaluate('=AND(TRUE,1/0)')).toBe('#DIV/0!');
    expect(evaluate('=OR(1/0)')).toBe('#DIV/0!');
    expect(evaluate('=NOT("yes")')).toBe('#VALUE!');
    expect(evaluate('=AND("yes")')).toBe('#VALUE!');
  });

  it('IF evaluates only the branch it takes', () => {
    // The untaken branch would be #DIV/0!; lazy evaluation is what makes this
    // the conventional guard idiom rather than a trap.
    expect(evaluate('=IF(TRUE,1,1/0)')).toBe('1');
    expect(evaluate('=IF(FALSE,1/0,2)')).toBe('2');
    expect(evaluate('=IF(1>2,"big")')).toBe('FALSE');
  });

  it('IFERROR substitutes only for an error', () => {
    expect(evaluate('=IFERROR(1/0,"bad")')).toBe('bad');
    expect(evaluate('=IFERROR(6/2,"bad")')).toBe('3');
    expect(evaluate('=IFERROR(1/0,1/0)')).toBe('#DIV/0!');
    // A formula that does not parse fails before IFERROR ever runs, so an
    // unknown function name is not something IFERROR can hide.
    expect(evaluate('=IFERROR(NOSUCH(1),"x")')).toBe('#NAME?');
  });
});

describe('math and rounding', () => {
  it('ROUND rounds halves away from zero', () => {
    expect(evaluate('=ROUND(2.5,0)')).toBe('3');
    expect(evaluate('=ROUND(-2.5,0)')).toBe('-3');
    expect(evaluate('=ROUND(2.675,2)')).toBe('2.68');
    expect(evaluate('=ROUND(1234,-2)')).toBe('1200');
    expect(evaluate('=ROUND(1.4)')).toBe('1');
  });

  it('ROUNDUP and ROUNDDOWN move away from and toward zero', () => {
    expect(evaluate('=ROUNDUP(2.1,0)')).toBe('3');
    expect(evaluate('=ROUNDUP(-2.1,0)')).toBe('-3');
    expect(evaluate('=ROUNDDOWN(2.9,0)')).toBe('2');
    expect(evaluate('=ROUNDDOWN(-2.9,0)')).toBe('-2');
    expect(evaluate('=ROUNDDOWN(1.239,2)')).toBe('1.23');
  });

  it('ABS and MOD, with MOD taking the divisor sign', () => {
    expect(evaluate('=ABS(-4.5)')).toBe('4.5');
    expect(evaluate('=MOD(7,3)')).toBe('1');
    expect(evaluate('=MOD(-3,2)')).toBe('1');
    expect(evaluate('=MOD(3,-2)')).toBe('-1');
    expect(evaluate('=MOD(7,0)')).toBe('#DIV/0!');
  });

  it('rejects values that cannot be numbers', () => {
    expect(evaluate('=ABS("apple")')).toBe('#VALUE!');
    expect(evaluate('=ROUND("x",2)')).toBe('#VALUE!');
    expect(evaluate('=ABS(1/0)')).toBe('#DIV/0!');
  });
});

describe('lookup and reference', () => {
  const table = {
    A1: 'ann',
    A2: 'bob',
    A3: 'cid',
    A4: 'dot',
    B1: '10',
    B2: '20',
    B3: '30',
    B4: '40',
    C1: 'x',
    C2: 'y',
    C3: 'z',
    C4: 'w',
  };

  it('XLOOKUP finds exact matches and honours if_not_found', () => {
    expect(evaluate('=XLOOKUP("bob",A1:A4,B1:B4)', table)).toBe('20');
    expect(evaluate('=XLOOKUP("BOB",A1:A4,B1:B4)', table)).toBe('20'); // case-insensitive
    expect(evaluate('=XLOOKUP("zoe",A1:A4,B1:B4)', table)).toBe('#N/A');
    expect(evaluate('=XLOOKUP("zoe",A1:A4,B1:B4,"none")', table)).toBe('none');
  });

  it('XLOOKUP supports wildcard mode and reverse search only', () => {
    expect(evaluate('=XLOOKUP("b*",A1:A4,B1:B4,,2)', table)).toBe('20');
    const dupes = { ...table, A3: 'bob' };
    expect(evaluate('=XLOOKUP("bob",A1:A4,B1:B4,,0,-1)', dupes)).toBe('30');
    expect(evaluate('=XLOOKUP("bob",A1:A4,B1:B4,,0,1)', dupes)).toBe('20');
    // Unsupported modes are refused, never silently downgraded.
    expect(evaluate('=XLOOKUP("bob",A1:A4,B1:B4,,-1)', table)).toBe('#VALUE!');
    expect(evaluate('=XLOOKUP("bob",A1:A4,B1:B4,,0,2)', table)).toBe('#VALUE!');
  });

  it('XLOOKUP rejects a mismatched return array', () => {
    expect(evaluate('=XLOOKUP("bob",A1:A4,B1:B3)', table)).toBe('#VALUE!');
    expect(evaluate('=XLOOKUP("bob",A1:B4,B1:B4)', table)).toBe('#VALUE!'); // 2-D lookup array
  });

  it('VLOOKUP does exact and approximate lookups', () => {
    expect(evaluate('=VLOOKUP("cid",A1:C4,3,FALSE)', table)).toBe('z');
    expect(evaluate('=VLOOKUP("zoe",A1:C4,3,FALSE)', table)).toBe('#N/A');
    expect(
      evaluate('=VLOOKUP(25,A1:B4,2,TRUE)', { A1: '10', A2: '20', A3: '30', B1: 'a', B2: 'b', B3: 'c' }),
    ).toBe('b');
    expect(evaluate('=VLOOKUP("cid",A1:C4,4,FALSE)', table)).toBe('#REF!');
    expect(evaluate('=VLOOKUP("cid",A1:C4,0,FALSE)', table)).toBe('#VALUE!');
  });

  it('MATCH returns 1-based positions', () => {
    expect(evaluate('=MATCH("cid",A1:A4,0)', table)).toBe('3');
    expect(evaluate('=MATCH("zoe",A1:A4,0)', table)).toBe('#N/A');
    // Approximate: the last value not exceeding 25 in an ascending array…
    expect(evaluate('=MATCH(25,A1:A3,1)', { A1: '10', A2: '20', A3: '30' })).toBe('2');
    // …and the last value not below 20 in a descending one.
    expect(evaluate('=MATCH(20,A1:A3,-1)', { A1: '30', A2: '20', A3: '10' })).toBe('2');
    expect(evaluate('=MATCH(25,A1:A3,-1)', { A1: '30', A2: '20', A3: '10' })).toBe('1');
    expect(evaluate('=MATCH("cid",A1:C4,0)', table)).toBe('#VALUE!'); // 2-D
    expect(evaluate('=MATCH("cid",A1:A4,7)', table)).toBe('#VALUE!');
  });

  it('INDEX addresses cells, rows, and columns', () => {
    expect(evaluate('=INDEX(A1:C4,2,3)', table)).toBe('y');
    expect(evaluate('=INDEX(A1:A4,3)', table)).toBe('cid');
    expect(evaluate('=INDEX(A1:A4,9)', table)).toBe('#REF!');
    expect(evaluate('=INDEX(A1:C4,5,1)', table)).toBe('#REF!');
    // INDEX/MATCH, the idiom the two exist for.
    expect(evaluate('=INDEX(B1:B4,MATCH("dot",A1:A4,0))', table)).toBe('40');
  });

  it('looks up across worksheets', () => {
    const doc = RsfDocument.empty('t.rsf', 10, 5);
    const second = doc.createWorksheet('Data');
    doc.insertSheetAt(1, second);
    doc.setCellOn(second.id, 0, 0, 'key');
    doc.setCellOn(second.id, 0, 1, '99');
    doc.setCell(0, 0, '=XLOOKUP("key",Data!A1:A5,Data!B1:B5)');
    expect(at(doc, 'A1')).toBe('99');
  });
});

describe('statistics', () => {
  const nums = { A1: '1', A2: '2', A3: '2', A4: '10', A5: '7' };

  it('MEDIAN handles odd and even counts', () => {
    expect(evaluate('=MEDIAN(A1:A5)', nums)).toBe('2');
    expect(evaluate('=MEDIAN(A1:A4)', nums)).toBe('2');
    expect(evaluate('=MEDIAN(1,3)')).toBe('2');
    expect(evaluate('=MEDIAN(A6:A9)', nums)).toBe('#NUM!'); // no numbers at all
  });

  it('MODE.SNGL reports #N/A when nothing repeats', () => {
    expect(evaluate('=MODE.SNGL(A1:A5)', nums)).toBe('2');
    expect(evaluate('=MODE.SNGL(1,2,3)')).toBe('#N/A');
  });

  it('STDEV.S needs a sample, STDEV.P accepts one value', () => {
    expect(Number(evaluate('=STDEV.S(2,4,4,4,5,5,7,9)'))).toBeCloseTo(2.13809, 4);
    expect(Number(evaluate('=STDEV.P(2,4,4,4,5,5,7,9)'))).toBeCloseTo(2, 9);
    expect(evaluate('=STDEV.S(5)')).toBe('#DIV/0!');
    expect(evaluate('=STDEV.P(5)')).toBe('0');
    expect(evaluate('=STDEV.P(A9:A12)', nums)).toBe('#DIV/0!');
  });

  it('STDEV stays accurate on large-magnitude values', () => {
    // The naive sum-of-squares formula loses this to cancellation and can
    // even return NaN; Welford's algorithm does not.
    expect(Number(evaluate('=STDEV.S(1000000001,1000000002,1000000003)'))).toBeCloseTo(1, 6);
  });

  it('RANK.EQ ranks descending by default and shares ties', () => {
    expect(evaluate('=RANK.EQ(10,A1:A5)', nums)).toBe('1');
    expect(evaluate('=RANK.EQ(2,A1:A5)', nums)).toBe('3');
    expect(evaluate('=RANK.EQ(2,A1:A5,1)', nums)).toBe('2');
    expect(evaluate('=RANK.EQ(99,A1:A5)', nums)).toBe('#N/A');
  });
});

describe('value model and coercion', () => {
  it('blanks are zero in arithmetic but skipped inside ranges', () => {
    expect(evaluate('=Z1+1')).toBe('1');
    expect(evaluate('=AVERAGE(A1:A3)', { A1: '2', A3: '4' })).toBe('3');
    expect(evaluate('=COUNT(A1:A3)', { A1: '2', A3: '4' })).toBe('2');
  });

  it('text never coerces to a boolean in a logical position', () => {
    expect(evaluate('=NOT("TRUE")')).toBe('#VALUE!');
    expect(evaluate('=IF("TRUE",1,2)')).toBe('#VALUE!');
  });

  it('non-finite results become #NUM!', () => {
    // Exponent notation is not formula syntax, but a cell may hold it and the
    // literal reader parses it — which is how a value big enough to overflow
    // gets into a formula at all.
    expect(evaluate('=A1*1', { A1: '1e308' })).toBe('1e+308');
    expect(evaluate('=A1*10', { A1: '1e308' })).toBe('#NUM!');
    expect(evaluate('=A1*A1', { A1: '1e308' })).toBe('#NUM!');
  });

  it('an error typed into a cell stays text and does not propagate', () => {
    expect(evaluate('=COUNTA(A1:A1)', { A1: '#REF!' })).toBe('1');
    expect(evaluate('=A1&""', { A1: '#REF!' })).toBe('#ERROR!'); // & is not an operator here
  });

  it('boolean literals parse and compare', () => {
    expect(evaluate('=TRUE')).toBe('TRUE');
    expect(evaluate('=false')).toBe('FALSE');
    expect(evaluate('=TRUE=TRUE')).toBe('TRUE');
  });
});

describe('resource limits', () => {
  it('refuses an oversized dynamic array rather than allocating it', () => {
    expect(evaluate('=SEQUENCE(100000,1000)')).toBe('#NUM!');
    expect(evaluate('=SEQUENCE(0)')).toBe('#VALUE!');
    expect(evaluate('=SEQUENCE(-1)')).toBe('#VALUE!');
  });

  it('bounds produced text length', () => {
    // Four 9,000-character cells joined exceed the 32,767-character cap. The
    // source text stays short, so this tests the *output* bound and not the
    // separate formula-length bound.
    const long = { A1: 'x'.repeat(9000) };
    expect(evaluate('=LEN(CONCAT(A1,A1,A1))', long)).toBe('27000');
    expect(evaluate('=CONCAT(A1,A1,A1,A1)', long)).toBe('#VALUE!');
    expect(evaluate('=TEXTJOIN("",TRUE,A1,A1,A1,A1)', long)).toBe('#VALUE!');
  });

  it('caps the number of criteria pairs', () => {
    const pairs = Array.from({ length: 33 }, () => 'A1:A2,">0"').join(',');
    expect(evaluate(`=COUNTIFS(${pairs})`)).toBe('#NUM!');
  });
});
