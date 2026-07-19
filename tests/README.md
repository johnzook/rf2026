# Test suite for index.html

Automated Playwright suite covering every numbered behavior in
[`../TESTPLAN.md`](../TESTPLAN.md) (items A1–N54).

## Running

```sh
cd tests
npm install       # installs playwright-core only
npm test          # node --test --test-concurrency=1 (all *.test.js)
```

Single file: `node --test parsing.test.js`.

Requirements: Node ≥ 20 (built-in test runner) and a chromium binary at
`/opt/pw-browsers/chromium` (the suite uses `playwright-core` with an
explicit `executablePath` — never run `playwright install`).

## How it works

- `helpers.js` starts a local http server that serves the repo's
  `index.html` (with mutable bytes, for the deploy-watcher test), launches
  one shared chromium per test file, and opens each test's page in a fresh
  context with both ShowConnect API routes (`**/api/sc/event/1187` and
  `.../scoringLive`) stubbed by per-test fixtures. No live network is used.
- Time is pinned by replacing `Date` via `addInitScript` so that zero-arg
  `new Date()` / `Date.now()` return a fixed instant (component/epoch
  constructors pass through). That pins both `eventLocalNow()` (which reads
  `new Date()` through `Intl` in America/Denver) and the staleness/cache
  math, without touching `index.html`. Tests advance time with
  `window.__setNow(ms)` + `render()`. `setInterval` is stubbed to a no-op so
  the 20 s/30 s/60 s polls never fire mid-test; tests call `fetchEventFeed()`,
  `fetchScoring()`, `checkForNewDeploy()` and `render()` explicitly.
- Because `index.html` is a classic script, all of its functions and
  top-level `let`/`const` state (`rides`, `resultsIdx`, `DELAYS`,
  `OVERRIDE_IDX`, `EST_IDX`, `EXTRAS`, …) are reachable and mutable from
  `page.evaluate`, which the unit-style tests use directly.
- `fixtures/builders.js` constructs minimal synthetic feed/scoring payloads
  (same field shapes as the real API: `EntryList[].RidingDetails[].Venues[]`,
  `DivisionsList`/`ScoringList`). All fixture dates are fixed in July 2026;
  nothing depends on the real clock. Fixture pinnies stay clear of the
  page's baked `OVERRIDES`/`ESTIMATES` pinnies (245/192/270/343/441/472/501)
  except where a test injects its own entries.

## TESTPLAN item → test file mapping

| Items | File |
|---|---|
| A1–A8, N54 | `parsing.test.js` |
| B9–B10 | `days.test.js` |
| C11–C14, D15–D17 | `delays-overrides.test.js` |
| E18–E22 | `estimates.test.js` |
| F23–F27 | `lifecycle.test.js` |
| G28–G30 | `out-status.test.js` |
| H31–H36 | `done-line.test.js` |
| I37–I39 | `popover.test.js` |
| J40–J44 | `persistence.test.js` |
| K45–K48 | `my-riders.test.js` |
| L49, N52–N53 | `misc.test.js` |
| M50–M51 | `scroll.test.js` |

All 54 items are covered; none skipped. Each test name starts with the
item number(s) it covers (some tests cover two adjacent items, some items
get several assertions across tests).

Notes on specific items:

- **A7** runs the page under `timezoneId` UTC / Asia/Tokyo / America/New_York
  contexts and asserts `eventLocalNow()` still yields Mountain wall-clock
  components. (All other tests default to a UTC context, so Mountain-time
  independence is exercised suite-wide.)
- **J44** serves mutated page bytes from the test server and calls
  `checkForNewDeploy()` manually, asserting reload/no-reload via a page
  marker; the `file://` no-op branch is loaded straight from disk.
- **F26** verifies the CSS precedence half (next-up beats soon) via computed
  border colors, since both classes legitimately co-exist in the DOM.
- **K45**'s "byte-identical" assertion compares `#list` innerHTML before and
  after a localStorage round-trip against the baked list.

No bugs in `index.html` were found by the suite; no changes to
`index.html` were needed for testability.
