# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/sandyx99/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/sandyx99/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0. It reads broken CSV files exactly the way csv-reader does — same columns, rows and errors on every case, including stray CRs, unterminated quotes, quote junk, short and long rows — but about 3x faster, by scanning each field in bulk (one regex search plus one slice) instead of one character at a time.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads every case from `/input/cases.json`, answers each one alone with `run()` from `solve.js`, and writes `/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`.

## Method

`run(input)` replicates csv-reader 1.0.0's broken-row policy exactly, then speeds it up:

- An unquoted field is found by scanning for its next delimiter (comma, LF, CR) with one regex exec and slicing the whole run at once. A stray CR is the only thing that splits a field, and it is rare, so the field stays one slice in the common case and is only joined from segments when a stray CR actually appears.
- A quoted field is found the same way, scanning for its next special character (quote, CR, LF), so a plain quoted field costs one regex exec plus one slice. Doubled quotes collapse to one quote, and CRLF or a lone CR inside quotes becomes one LF.
- Line numbers are tracked only at the delimiters and line breaks the scan already lands on, never by walking the text character by character.

Verified on the practice set: all 6 cases match the reference answers exactly, plus 138 hand-picked edge cases and 600 randomised differential tests against csv-reader 1.0.0, all identical. On the practice set (6 cases, ~10.5 MB) the median CPU time is ~0.27–0.34 s against the house baseline's ~0.86–0.99 s — about a 3x speedup — while producing byte-identical answers.

Referral code: `hfckkrqy`
