# Test suite for index.html

Automated Playwright suite covering every numbered behavior in
[`../TESTPLAN.md`](../TESTPLAN.md) (items A1–O58).

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
| Bug regressions (`BUG-*`) | `robustness.test.js` |
| Edge-case hardening (`A/C/E/F/I/J/K-edge`) | `edge-cases.test.js` |
| O55–O58 (REVIEW fixes, `R3/R4/R6/R9/R10/R11`) | `persistence` (R3), `my-riders` (R4), `lifecycle` (R6), `days` (R9), `scroll` (R10), `robustness` (R11) |

All numbered items (A1–O58) are covered; none skipped. Each test name starts with the
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

No changes to `index.html` were needed for testability. A later bug-hunt
pass found five defects, each fixed in `index.html` and pinned by a
`BUG-*` test in `robustness.test.js`:

- **BUG-phase-escape** — the done line's `next: <phase>` was interpolated
  into `innerHTML` unescaped (the one feed string that bypassed `esc()`).
- **BUG-null-pinny-popover** — the popover subtitle rendered a dangling
  `· #` when `PinnyNumber` was null (rows already guarded it).
- **BUG-null-pinny-next** — `nextRideInfo` matched combos by
  `pinny !==`, so two null-pinny combos compared equal and one combo's
  done line could point at another's ride; now falls back to rider+horse.
- **BUG-myriders-non-array** — `getStoredList` returned any valid-JSON
  value; a non-array in `rf2026:myRiders`/`hiddenRiders` crashed
  `effectiveFollowing()` and left the page empty behind a phantom
  "can't reach ShowConnect" note. Now guarded with `Array.isArray`.
- **BUG-cache-hydrate-crash** — cache hydration ran unguarded at top
  level; a wrong-shape cached payload threw before the fetches and event
  listeners were installed, bricking the page. Now wrapped in try/catch.

`edge-cases.test.js` adds hardening beyond the numbered items: degenerate
feed shapes (missing `RidingDetails`, empty/null `Venues`, empty
`EntryList`, scoring rows for unknown divisions), a ride exactly at "now",
all-past and all-out days, identical-time sort stability, a zero-delay
`DELAYS` map on `DELAY_DATE`, an auto estimate crossing midnight,
quota-exceeded localStorage writes, and follow-list names absent from the
feed. Product-level concerns found in the same pass live in
[`../REVIEW.md`](../REVIEW.md), deliberately not "fixed" in code.
