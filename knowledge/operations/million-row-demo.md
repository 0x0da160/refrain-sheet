---
type: operations-concept
title: Million-row demo workbook and browser benchmark
description: The deterministic sales-analysis workbook (one million detail rows, a product master, a summary), how to generate it, how the real-operation browser benchmark measures it, and the before/after numbers of the 2026-11 recalculation work. Time-sensitive — re-run before relying on the numbers.
sources:
  - resource: ../../scripts/bench/million-rows-data.mjs
  - resource: ../../scripts/bench/million-rows-workbook.mjs
  - resource: ../../scripts/bench/generate-million-rows.mjs
  - resource: ../../scripts/bench/million-rows-browser.mjs
  - resource: ../../src/core/workbook/recalc-engine.ts
  - resource: ../../tests/tooling/million-rows-demo.test.ts
status: stable
stale_after: 2027-05-15T00:00:00Z
generated:
  by: claude-code
  at: 2026-11-15T15:00:00Z
---

# Million-row demo workbook and browser benchmark

`npm run bench` measures data-processing cost in Node
([performance-measurements.md](performance-measurements.md)). It cannot say
whether a person can _work_ on a large workbook: open it, look around,
search, filter, change a condition, edit a row, undo, save, reopen. This
page describes the workbook and the benchmark that answer that, and records
what they showed before and after the recalculation work of 2026-11.

## The workbook

A sales ledger with a product master and a summary, built only from
existing features. Everything is a pure function of the row count and a
seed (`scripts/bench/million-rows-data.mjs`): no clock, no `Math.random`,
no locale. The published measurements use 1,000,000 data rows and seed 20261115.

**売上明細** (the detail sheet): one header row, then one row per sale.

| Column | Header     | Content                                                                | Length | Distribution                                                                           |
| ------ | ---------- | ---------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| A      | 日付       | ISO date, text                                                         | 10     | 730 days, 2024-04-01 to 2026-03-31, ascending; weekday, month and year-on-year weights |
| B      | 伝票番号   | `SL-` and a 7-digit number                                             | 10     | unique, ascending                                                                      |
| C      | 商品コード | `P` and a 4-digit number                                               | 5      | 500 products, long-tailed popularity (weight 1/(rank+8)^0.85)                          |
| D      | 部門       | department name                                                        | 5–8    | 8 departments, weights 24, 18, 12, 9, 7, 6, 5, 19                                      |
| E      | 数量       | whole number                                                           | 1–2    | 1–24, mostly small (1 + ⌊−ln(1−u)·3.2⌋)                                                |
| F      | 単価       | whole number of yen                                                    | 2–5    | list price × 1, 0.95, 0.9 or 0.8 (70 %, 15 %, 10 %, 5 % of rows)                       |
| G      | 売上       | formula `=E2*F2`, filled down                                          |        | one per row                                                                            |
| H      | カテゴリ   | formula `=VLOOKUP(C2,'商品マスター'!$A$2:$D$501,3,FALSE)`, filled down |        | one per row; 10 categories                                                             |

**商品マスター** (the product master): a header and 500 rows of code, name
(11–18 characters), category and list price. No formulas.

**集計** (the summary): the conditions in B3:B6 (start date, end date,
department, category; `*` means all) and 93 formulas that read the whole
detail range — a total, a count, an average and a quantity under the
conditions; a table by department (8 rows), by category (10 rows) and by
month (24 rows), each a `SUMIFS` and a `COUNTIFS` with the period, the
department and the category as criteria; and a product panel with three
`VLOOKUP`s into the master and a `SUMIFS`/`COUNTIFS` by product code.

At 1,000,000 data rows the workbook holds 8,000,008 non-empty detail cells
and 2,000,093 formulas (2,000,000 on the detail sheet). Every summary
formula depends on up to five whole columns of the detail sheet, two of
which are themselves formulas; column H depends on the master. The JSON
document is 147.0 MB and the `.rsf` file 15.4 MB.

## Generating it

```sh
npm run bench:million-rows:generate -- --rows 1000000
```

writes the file into `bench/data/` (untracked) as
`sales-analysis-<rows>.rsf`, with a `.json` manifest beside it: the counts,
the SHA-256 of the JSON document (the file's identity — the compressed
bytes may differ between Node releases) and the totals a correct
application must show. `--rows` takes any size from 1 to 1,999,999 and
`--seed` another seed; the same arguments always give the same document.
The file is written straight from the format specification, not through
the application's writer, so any revision under test opens the same input.
`tests/tooling/million-rows-demo.test.ts` checks, on a small workbook, that
the generator is deterministic, that the application opens what it writes,
and that the application's results equal the manifest's totals.

## The benchmark

```sh
npm run build
npm run bench:million-rows -- --rows 1000000 --label after
```

`scripts/bench/million-rows-browser.mjs` opens the built application from
disk (`file://`) in Chromium and works on the file the way a person does,
with real key presses and clicks: open; move to the last, the middle and
the first row; search for one slip number and for a department name;
filter by a department and clear the filter; show the summary; change each
of the four conditions; edit one quantity in the middle of the detail
sheet; undo; redo; save; reopen the saved file. `--dist` selects the build
to measure (to compare two revisions, build each into its own folder), and
`--out` the result file (JSON, one entry per step).

- **A step ends when the right content is on screen.** The clock runs from
  the input event to the first animation frame in which every expected
  value is in the document. Expected values come from
  `scripts/bench/million-rows-data.mjs`, which recomputes them with plain
  arithmetic — never from the application under test. There is no fixed
  wait, and a step that shows a wrong value, times out or crashes is
  recorded as failed with what it showed.
- **Whole-sheet steps are marked.** Each step says whether the application
  had to process every row (`all`: open, search, filter, every summary
  result, save, reopen) or only what is on screen (`view`: moving, the
  edited row itself).
- **Accepting input is measured apart from finishing.** After opening, a
  key press is timed on its own; an edit is timed to its own row first and
  to the summary's new totals second.
- **Measured:** time per step (resolution one frame, about 17 ms); the
  browser's long tasks (main-thread tasks over 50 ms) overlapping the
  step; the JavaScript heap after the step; the renderer process's
  resident memory and its peak during the step (Linux `/proc`); startup
  time; the size of the build.
- **Not measured:** memory on other operating systems; energy; anything
  on a second browser engine. The File System Access pickers are removed
  before the page loads, so Open goes through a file input and Save
  through a download — the only way an automated run can pass a file in
  and out; the encode and decode work is the same.

## Results (snapshot, 2026-11-15)

Machine: 4 vCPU (Intel Xeon, 2.10 GHz), 16 GB of memory, Linux 6.18;
Chromium 153.0.8010.12 (headless); Node 22.23.4. "Before" is v0.9.40
(commit 77f79a4), "after" is the same tree with the recalculation change.
Both builds ran the same script on the same generated files, one after the
other, in alternation. The one-million-row workbook ran twice per build and
both values are shown; the smaller ones ran five times and show the median
and the range. ✗ marks a step that failed in every run (see "Known
limits"). The last column is the longest single main-thread task seen in
any run; 0 means no task reached 50 ms.

### 1,000,000 data rows (before: 2 runs, after: 2 runs)

| Step                                             | Scope     |     Before (ms) |      After (ms) | Longest main-thread task, before → after (ms) |
| ------------------------------------------------ | --------- | --------------: | --------------: | --------------------------------------------: |
| open: first rows on screen                       | all rows  | 13,811 / 14,014 |   4,988 / 4,939 |                                13,753 → 4,936 |
| open: accepts a key press                        | on screen |         22 / 16 |         18 / 15 |                                         0 → 0 |
| move: to the last row                            | on screen |         62 / 68 |         64 / 54 |                                       59 → 58 |
| move: to the middle row                          | on screen |        114 / 81 |         58 / 59 |                                      105 → 54 |
| move: back to the first row                      | on screen |         68 / 98 |         71 / 65 |                                        58 → 0 |
| search: one slip number (1 match)                | all rows  |     1,004 / 718 |     1,206 / 890 |                                   881 → 1,083 |
| search: a department name (89872 matches)        | all rows  |   1,102 / 1,188 |   1,112 / 1,085 |                                   1,064 → 989 |
| filter: open the panel (lists the column values) | all rows  |   1,836 / 1,835 |   1,861 / 1,747 |                                         0 → 0 |
| filter: apply department = 福岡営業部            | all rows  | 2,560 / 2,739 ✗ | 2,845 / 2,443 ✗ |                                     427 → 524 |
| filter: clear                                    | all rows  |         51 / 56 |         71 / 45 |                                       56 → 72 |
| summary: first display of all results            | all rows  | 33,337 / 31,630 |   3,838 / 2,749 |                                33,336 → 3,837 |
| summary: department = 大阪営業部                 | all rows  | 30,814 / 28,280 |         79 / 72 |                                   30,810 → 75 |
| summary: start date = 2025-04-01                 | all rows  | 24,317 / 25,155 |         49 / 68 |                                   25,151 → 64 |
| summary: end date = 2025-09-30                   | all rows  | 24,448 / 22,554 |         57 / 42 |                                   24,444 → 53 |
| summary: category = 家電                         | all rows  | 22,131 / 20,198 |         45 / 45 |                                    22,127 → 0 |
| edit: quantity of one row, its own sales updates | on screen |   1,835 / 2,142 |       101 / 102 |                                    2,134 → 96 |
| edit: summary shows the new totals               | all rows  | 19,954 / 19,268 |        80 / 123 |                                   10,809 → 95 |
| undo: the row is back                            | on screen |   1,563 / 2,035 |         32 / 29 |                                     2,029 → 0 |
| undo: summary shows the earlier totals           | all rows  | 23,171 / 21,185 |       112 / 114 |                                   12,917 → 91 |
| redo: the row is edited again                    | on screen |   1,604 / 2,249 |         17 / 20 |                                     2,243 → 0 |
| redo: summary shows the new totals               | all rows  | 19,832 / 22,058 |        76 / 141 |                                  11,612 → 114 |
| save: file handed to the browser                 | all rows  | 16,738 / 15,230 | 14,002 / 13,288 |                               13,015 → 11,966 |
| reopen: saved file, summary results on screen    | all rows  | 34,178 / 34,315 |   9,852 / 9,426 |                                34,257 → 9,781 |
| reopen: the edited row is as saved               | on screen |       170 / 222 |       198 / 174 |                                       78 → 78 |

Startup (page ready, no file): before 291 / 692 ms, after 290 / 286 ms. Peak renderer memory over the run: before 5,159 MiB, after 3,835 MiB. JavaScript heap after save: before 3,168 / 3,566 MiB, after 2,353 / 2,353 MiB.

### 100,000 data rows (before: 5 runs, after: 5 runs)

| Step                                             | Scope     |         Before (ms) |          After (ms) | Longest main-thread task, before → after (ms) |
| ------------------------------------------------ | --------- | ------------------: | ------------------: | --------------------------------------------: |
| open: first rows on screen                       | all rows  | 1,366 (1,290–1,535) |       773 (627–989) |                                   1,497 → 840 |
| open: accepts a key press                        | on screen |          21 (16–22) |          16 (13–21) |                                         0 → 0 |
| move: to the last row                            | on screen |          58 (54–96) |          69 (63–95) |                                       87 → 86 |
| move: to the middle row                          | on screen |          82 (60–97) |         96 (70–111) |                                      89 → 103 |
| move: back to the first row                      | on screen |         99 (69–117) |         83 (74–102) |                                       75 → 64 |
| search: one slip number (1 match)                | all rows  |       193 (190–206) |       228 (194–269) |                                      82 → 145 |
| search: a department name (8948 matches)         | all rows  |       225 (221–284) |       260 (238–354) |                                     161 → 226 |
| filter: open the panel (lists the column values) | all rows  |       210 (192–238) |       228 (223–250) |                                         0 → 0 |
| filter: apply department = 福岡営業部            | all rows  |       302 (252–331) |       291 (273–336) |                                      108 → 75 |
| filter: clear                                    | all rows  |          50 (48–90) |          58 (47–75) |                                       91 → 75 |
| summary: first display of all results            | all rows  | 3,067 (2,587–3,492) |       542 (385–692) |                                   3,492 → 692 |
| summary: department = 大阪営業部                 | all rows  | 2,811 (2,662–3,432) |          36 (32–57) |                                    3,428 → 53 |
| summary: start date = 2025-04-01                 | all rows  | 2,215 (2,055–2,406) |          36 (25–38) |                                     2,403 → 0 |
| summary: end date = 2025-09-30                   | all rows  | 1,954 (1,886–2,029) |          33 (24–36) |                                     2,025 → 0 |
| summary: category = 家電                         | all rows  | 2,049 (1,901–2,483) |          31 (22–32) |                                     2,479 → 0 |
| edit: quantity of one row, its own sales updates | on screen |       187 (175–221) |          89 (67–97) |                                      216 → 89 |
| edit: summary shows the new totals               | all rows  | 2,000 (1,833–2,177) |         97 (58–101) |                                    1,190 → 76 |
| undo: the row is back                            | on screen |       130 (121–176) |          17 (16–22) |                                       169 → 0 |
| undo: summary shows the earlier totals           | all rows  | 2,032 (1,868–2,255) |          65 (56–79) |                                    1,285 → 53 |
| redo: the row is edited again                    | on screen |       122 (113–177) |          22 (14–23) |                                       170 → 0 |
| redo: summary shows the new totals               | all rows  | 2,166 (2,038–2,399) |          64 (53–86) |                                    1,529 → 62 |
| save: file handed to the browser                 | all rows  | 1,299 (1,269–1,313) | 1,425 (1,305–1,658) |                                 1,076 → 1,377 |
| reopen: saved file, summary results on screen    | all rows  | 3,261 (3,012–3,534) | 1,267 (1,217–1,335) |                                 3,496 → 1,297 |
| reopen: the edited row is as saved               | on screen |       196 (178–272) |       200 (182–291) |                                     115 → 103 |

Startup (page ready, no file): before 275 (270–319) ms, after 284 (281–414) ms. Peak renderer memory over the run: before 1,227 MiB, after 821 MiB. JavaScript heap after save: before 439 (430–446) MiB, after 255 (193–264) MiB.

### 10,000 data rows (before: 5 runs, after: 5 runs)

| Step                                             | Scope     |   Before (ms) |    After (ms) | Longest main-thread task, before → after (ms) |
| ------------------------------------------------ | --------- | ------------: | ------------: | --------------------------------------------: |
| open: first rows on screen                       | all rows  | 273 (263–283) | 213 (185–233) |                                     275 → 224 |
| open: accepts a key press                        | on screen |    16 (14–18) |    18 (13–29) |                                         0 → 0 |
| move: to the last row                            | on screen |    75 (62–98) |    72 (55–85) |                                       88 → 78 |
| move: to the middle row                          | on screen |   73 (59–104) |   82 (64–113) |                                      96 → 105 |
| move: back to the first row                      | on screen |   82 (70–117) |   77 (65–101) |                                       73 → 66 |
| search: one slip number (1 match)                | all rows  | 149 (141–154) | 139 (137–146) |                                         0 → 0 |
| search: a department name (942 matches)          | all rows  | 141 (140–151) | 148 (142–153) |                                         0 → 0 |
| filter: open the panel (lists the column values) | all rows  |    21 (20–25) |    30 (25–31) |                                         0 → 0 |
| filter: apply department = 福岡営業部            | all rows  |   77 (61–102) |    68 (62–89) |                                      103 → 90 |
| filter: clear                                    | all rows  |    57 (41–77) |    45 (42–57) |                                       78 → 58 |
| summary: first display of all results            | all rows  | 463 (340–550) | 130 (123–158) |                                     549 → 160 |
| summary: department = 大阪営業部                 | all rows  | 272 (247–309) |    31 (29–41) |                                       306 → 0 |
| summary: start date = 2025-04-01                 | all rows  | 203 (193–239) |    22 (21–29) |                                       235 → 0 |
| summary: end date = 2025-09-30                   | all rows  | 202 (179–233) |    23 (19–31) |                                       229 → 0 |
| summary: category = 家電                         | all rows  | 183 (160–210) |    21 (18–29) |                                       207 → 0 |
| edit: quantity of one row, its own sales updates | on screen |   82 (61–123) |    57 (51–79) |                                      115 → 72 |
| edit: summary shows the new totals               | all rows  | 254 (227–325) |    75 (61–99) |                                      199 → 66 |
| undo: the row is back                            | on screen |    24 (23–28) |    19 (18–22) |                                         0 → 0 |
| undo: summary shows the earlier totals           | all rows  | 238 (220–284) |    74 (61–91) |                                      169 → 61 |
| redo: the row is edited again                    | on screen |    32 (21–40) |    15 (13–23) |                                         0 → 0 |
| redo: summary shows the new totals               | all rows  | 220 (201–354) |   83 (69–103) |                                      233 → 71 |
| save: file handed to the browser                 | all rows  | 223 (191–253) | 221 (218–250) |                                     194 → 184 |
| reopen: saved file, summary results on screen    | all rows  | 535 (490–576) | 340 (277–354) |                                     538 → 325 |
| reopen: the edited row is as saved               | on screen | 207 (159–220) | 213 (203–223) |                                       99 → 96 |

Startup (page ready, no file): before 289 (255–304) ms, after 314 (270–347) ms. Peak renderer memory over the run: before 425 MiB, after 351 MiB. JavaScript heap after save: before 54 (46–56) MiB, after 34 (22–37) MiB.

Build size (the files under the build folder): 2,901,374 bytes before,
2,914,932 bytes after.

What the tables say:

- **Recalculation was the obstacle and is gone.** At one million rows a
  condition change, an edit, an undo or a redo reaches the summary in 42 to
  141 ms instead of 19 to 31 seconds, with no main-thread task over
  114 ms. The edited row itself updates in about 0.1 s instead of about
  2 s.
- **Opening is faster as a side effect** (about 5 s instead of about 14 s
  at one million rows), because the formulas are no longer parsed one by
  one; reopening and showing the summary takes under 10 s instead of 34 s.
- **Search, filter and save are unchanged work.** At one million rows the
  search and filter times are within the run-to-run spread; saving is about
  2 s faster and peaks at 3.8 GB instead of 5.1 GB, because less memory is
  in use when it starts.
- **Smaller workbooks did not get slower where the change applies**, and
  three steps it does not touch came out slower in the middle size: at
  100,000 rows the median of the two searches is 35 ms higher, opening the
  filter panel 18 ms higher, and saving 126 ms higher (about 10 %). The
  code of those steps is the same in both builds, a profile of the save
  shows the extra time spread over the same functions and the garbage
  collector, and saving straight after opening takes the same time in both
  builds (6 saves in each of 3 runs: 991 to 1,216 ms before, 1,003 to
  1,245 ms after). The likely cause is the state the step starts from (the
  "after" build holds a smaller heap: 255 MiB against 439 MiB once the
  save is done), but that is not proven.
- **Saved files are the same.** The JSON document each build saved at the
  end of the run was compared byte for byte at all three sizes: only the
  two timestamps differ.

## What the measurements led to

Before the change, opening, moving, searching and filtering a million rows
already worked. Recalculation did not: showing the summary took about half
a minute, and every change after that — a condition, one quantity, an
undo — froze the application for about 20 seconds, because any mutation
dropped every result, re-walked two million formulas and rescanned a
million rows per summary formula through one value object per cell.

That one obstacle was removed inside the TypeScript engine (the reasons
for not adding a second evaluator are in
[dependency-rules.md](../architecture/dependency-rules.md)):

- filled-down formulas share one parsed formula
  (`src/core/formula/template.ts`, `src/core/workbook/formula-runs.ts`);
- results live in paged arrays (`src/core/workbook/cell-memo.ts`), and
  long single-column ranges are read as typed columns
  (`src/core/workbook/column-store.ts`);
- `COUNTIFS`, `SUMIFS` and friends scan those columns with one cached bit
  mask per column and criterion (`src/core/formula/columnar.ts`), and the
  cell-by-cell scan stays as the reference and as the path for every other
  shape of argument;
- a cell change drops only the results that can read that cell
  (`src/core/workbook/recalc-dependents.ts`); see "Workbook-wide
  recalculation" in [invariants.md](../architecture/invariants.md).

No file format, WASM code or limit changed.

## Known limits

- **A filter counts data rows, not its header row.** A range may cover at
  most 1,000,000 data rows (`MAX_FILTER_ROWS` in
  `src/core/workbook/filter.ts`), so a whole million-row sheet with a header
  row can be filtered. Before this change the header row counted too, and
  the last row stayed outside the filter. A `.rsf` file saved with a filter
  over a whole million-row sheet opens without that filter in versions
  before this change, because they cannot read such a range.
- **A workbook holding a dynamic array, or one where a circular reference
  has been met, recomputes everything on each change**, as every workbook
  did before. Formulas that only _could_ return an array (`IFERROR`,
  `INDEX`, `XLOOKUP`) do not have this effect unless one actually does.
- **The first display of the summary still blocks once** (about 3 to 4 s
  at a million rows): two million detail formulas are evaluated the first
  time something reads their columns.
- **Open and save are the next obstacles.** Both hold the whole JSON
  document as text and as objects at once: opening takes about 5 s, and
  saving takes 13 to 14 s, blocks the page for about 12 s of that, and
  peaks near 3.8 GB of memory.
- Structural edits (inserting or deleting rows or columns) and any change
  to worksheets or settings still drop every result.
