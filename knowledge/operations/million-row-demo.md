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
(commit 77f79a4). At one million rows, "after" is the final tree (commit
567aef9). The two builds ran the same script on the same generated file, one
after the other, three rounds each, in one batch. The 100,000- and
10,000-row tables are from the recalculation commit (b65925a), five rounds
each. The final commit changes only the filter row limit, which those sizes
never reach, but those two tables were not measured again on the final tree.
Each table shows the median of its runs and, in brackets, the lowest and the
highest. ✗ marks a step that failed in at least one run. The last column is
the longest single main-thread task seen in any run; 0 means no task reached
50 ms.

### 1,000,000 data rows (before: 3 runs, after: 3 runs)

| Step                                             | Scope     |            Before (ms) |             After (ms) | Longest main-thread task, before → after (ms) |
| ------------------------------------------------ | --------- | ---------------------: | ---------------------: | --------------------------------------------: |
| open: first rows on screen                       | all rows  | 13,063 (11,037–13,509) |    5,659 (5,031–5,973) |                                13,459 → 5,923 |
| open: accepts a key press                        | on screen |             17 (16–20) |             15 (13–22) |                                         0 → 0 |
| move: to the last row                            | on screen |             79 (60–90) |            63 (52–100) |                                       83 → 90 |
| move: to the middle row                          | on screen |             74 (64–75) |            70 (65–105) |                                       69 → 96 |
| move: back to the first row                      | on screen |           131 (69–132) |             85 (74–93) |                                       92 → 56 |
| search: one slip number (1 match)                | all rows  |          797 (680–937) |          694 (660–810) |                                     813 → 687 |
| search: a department name (89872 matches)        | all rows  |        996 (987–1,326) |    1,104 (1,079–1,104) |                                   1,201 → 981 |
| filter: open the panel (lists the column values) | all rows  |    2,138 (1,869–2,363) |    1,743 (1,710–1,922) |                                       116 → 0 |
| filter: apply department = 福岡営業部            | all rows  |  2,550 (2,505–2,664) ✗ |    2,561 (2,465–2,981) |                                     489 → 532 |
| filter: clear                                    | all rows  |             54 (49–73) |             55 (54–74) |                                       74 → 73 |
| summary: first display of all results            | all rows  | 28,265 (28,180–29,787) |    2,961 (2,939–3,043) |                                29,787 → 3,042 |
| summary: department = 大阪営業部                 | all rows  | 27,038 (24,232–27,403) |             73 (72–83) |                                   27,400 → 79 |
| summary: start date = 2025-04-01                 | all rows  | 23,614 (23,304–26,444) |             49 (45–50) |                                    26,439 → 0 |
| summary: end date = 2025-09-30                   | all rows  | 20,397 (20,317–23,649) |             42 (40–55) |                                   23,643 → 50 |
| summary: category = 家電                         | all rows  | 21,181 (21,001–21,962) |             40 (40–42) |                                    21,958 → 0 |
| edit: quantity of one row, its own sales updates | on screen |    1,864 (1,811–1,928) |             78 (74–78) |                                    1,922 → 72 |
| edit: summary shows the new totals               | all rows  | 19,380 (19,186–21,075) |            93 (90–139) |                                  10,885 → 108 |
| undo: the row is back                            | on screen |    1,751 (1,667–1,759) |             35 (26–37) |                                     1,754 → 0 |
| undo: summary shows the earlier totals           | all rows  | 19,283 (18,604–20,194) |           110 (79–116) |                                   11,011 → 88 |
| redo: the row is edited again                    | on screen |    1,962 (1,813–1,988) |             22 (16–24) |                                     1,981 → 0 |
| redo: summary shows the new totals               | all rows  | 19,351 (18,948–21,762) |           114 (79–118) |                                   11,005 → 93 |
| save: file handed to the browser                 | all rows  | 17,507 (15,987–17,742) | 13,592 (13,213–15,502) |                               15,464 → 13,216 |
| reopen: saved file, summary results on screen    | all rows  | 31,616 (31,377–34,094) |   9,535 (8,618–10,727) |                               34,034 → 10,661 |
| reopen: the edited row is as saved               | on screen |          199 (187–265) |          219 (204–267) |                                     111 → 103 |

Startup (page ready, no file): before 297 (277–311) ms, after 258 (252–347) ms. Peak renderer memory over the run: before 4,767 MiB, after 3,924 MiB. JavaScript heap after save: before 3,177 (3,177–3,566) MiB, after 2,056 (2,056–2,056) MiB.

### Save and open across batches (1,000,000 rows)

The same build's save and open times moved from one batch to the next, so a
result is read only against the other builds of its own batch. Two runs are
shown as they were; three runs as the median and the range.

| Batch | Build   | Runs | Save (ms)              | Open (ms)              | Summary, first display (ms) | Failed steps |
| ----- | ------- | ---: | ---------------------- | ---------------------- | --------------------------- | ------------ |
| 1     | v0.9.40 |    2 | 16,738 / 15,230        | 13,811 / 14,014        | 33,337 / 31,630             | filter       |
| 1     | b65925a |    2 | 14,002 / 13,288        | 4,988 / 4,939          | 3,838 / 2,749               | filter       |
| 2     | 567aef9 |    2 | 23,745 / 16,917        | 5,733 / 5,447          | 2,886 / 3,138               | none         |
| 3     | b65925a |    2 | 18,727 / 15,753        | 5,487 / 5,529          | 3,544 / 2,802               | filter       |
| 3     | 567aef9 |    2 | 18,541 / 17,947        | 5,860 / 5,604          | 3,343 / 3,003               | none         |
| 4     | v0.9.40 |    3 | 17,507 (15,987–17,742) | 13,063 (11,037–13,509) | 28,265 (28,180–29,787)      | filter       |
| 4     | 567aef9 |    3 | 13,592 (13,213–15,502) | 5,659 (5,031–5,973)    | 2,961 (2,939–3,043)         | none         |

Batch 1's second v0.9.40 run was repeated hours after its pair, following an
interruption, so batch 1 is listed for completeness and is not a like-for-like
pair. In batch 3 the two builds saved at the same speed within the spread of
their runs. In batch 4, which has the v0.9.40 and final builds in the same
order three times, the final build saved in 13.2 to 15.5 seconds and v0.9.40 in
16.0 to 17.7 seconds. The final build itself saved in 16.9 to 23.7 seconds in
batch 2 and 17.9 to 18.5 seconds in batch 3, so most of the spread between
batches is the state of the machine, not the code. Saving remains the largest
cost in every batch.

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

{"distBytes": {"baseline": 2901374, "after": 2914984}}

Build size (the files under the build folder): 2,901,374 bytes before,
2,914,984 bytes after (commit 567aef9; 2,914,932 for b65925a).

What the tables say:

- **Recalculation was the obstacle and is gone.** At one million rows a
  condition change reaches the summary in 40 to 73 ms (median), and an edit,
  an undo or a redo reaches it in 93 to 114 ms. Before, the same steps took 19
  to 27 seconds. The edited row itself updates in 78 ms instead of 1.9 seconds.
- **Opening and reopening are faster as a side effect.** Opening takes 5.7
  seconds instead of 13.1, because the formulas are no longer parsed one by
  one. Reopening the saved file and showing its summary takes 9.5 seconds
  instead of 31.6.
- **The filter now covers the whole sheet.** Before this change, a filter at
  one million rows stopped one row short, because the header row counted
  against the limit. The final build passes that step in every run, with a
  median of 2.6 seconds.
- **Search and filter work did not change.** The department search has a
  median of 1,104 ms against 996 ms; the two ranges overlap. The slip-number
  search and the filter panel also overlap their ranges.
- **Saving is faster in the same batch, and it is still the largest cost.**
  The median save is 13.6 seconds against 17.5 seconds, and the renderer peaks at 3,924 MiB instead of 4,767 MiB. One task still holds the main thread for 11 to
  13 seconds in every run.
- **Memory during the work is lower.** During the four condition changes the
  renderer peaks at a median of 2,104 MiB instead of 3,568 MiB.
- **Smaller workbooks did not get faster where the change does not apply, and
  three steps came out slower at 100,000 rows.** In the recalculation commit,
  the two searches' medians are 35 ms higher, the filter panel 18 ms higher and
  the save 126 ms higher (about 10 %). The code of those steps is the same in
  both builds, and saving straight after opening takes the same time in both
  (6 saves in each of 3 runs: 991 to 1,216 ms before, 1,003 to 1,245 ms after).
  The likely cause is the state the step starts from, but that is not proven.
- **Saved files are the same.** The JSON document each build saved matches,
  once the timestamps are masked, at all three sizes: v0.9.40 and the
  recalculation commit at 10,000 and 100,000 rows, and at one million rows
  v0.9.40 and the final build, and the recalculation commit and the final build.

## What the measurements led to

Before the change, opening, moving, searching and opening the filter panel
already worked at a million rows. Recalculation did not: showing the summary
took about half a minute, and every change after that — a condition, one
quantity, an undo — froze the application for about 20 seconds, because any
mutation dropped every result, re-walked two million formulas and rescanned a
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

The file layout, the WASM code and every other limit did not change. One
rule changed in a separate commit: a filter's header row no longer counts
against the row limit (see Known limits).

## Known limits

- **A filter may cover one million data rows plus its header row.**
  `MAX_FILTER_ROWS` (1,000,000, in `src/core/workbook/filter.ts`) counts data
  rows only. Before this change the header row counted too, so a whole
  million-row sheet with a header could not be filtered to its last row. A
  `.rsf` file saved with a filter over a whole million-row sheet opens without
  that filter in versions before this change, because they refuse the range.
  The JSON document version stays at 1. Earlier versions drop such a filter with
  a warning and open the rest of the file; the rule is in
  [compatibility.md](../formats/rsf/compatibility.md). In the Filter panel,
  turning the header row off for a range of 1,000,001 rows is refused with the
  invalid-filter message, because every row would then be a data row.
- **A workbook holding a dynamic array, or one where a circular reference has
  been met, recomputes everything on each change**, as every workbook did
  before. Formulas that only _could_ return an array (`IFERROR`, `INDEX`,
  `XLOOKUP`) do not have this effect unless one actually does.
- **The first display of the summary still blocks once** (about 3 seconds at
  one million rows): two million detail formulas are evaluated the first time
  something reads their columns.
- **Open and save are the next obstacles.** Both hold the whole JSON document
  (about 147 MB) as text and as objects at once. Opening takes about 5.7
  seconds. Saving took 13.6 seconds in the batch that compared it with
  v0.9.40, and 13 to 24 seconds across batches; it holds the main thread for
  11 to 13 seconds in one task and peaks near 3,924 MiB.
- Structural edits (inserting or deleting rows or columns) and any change to
  worksheets or settings still drop every result.
