# Test suite for index.html

Automated Playwright suite covering every numbered behavior in
[`../TESTPLAN.md`](../TESTPLAN.md) (items A1–O65 plus the multi-event
section P66–P82).

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
  `index.html` (with mutable bytes, for the deploy-watcher test) and
  launches one shared chromium per test file.
- `openPage()` opens each test's page in a fresh context **in event mode**:
  it navigates to `/?event=1187` by default, seeds the nine fixture rider
  names into `sc:1187:riders` (the page has no baked follow list anymore —
  this keeps the existing count assertions and FOLLOWED-based fixtures
  working), and stubs all three ShowConnect API routes per test:
  `**/api/sc/event/<id>`, `**/api/sc/event/<id>/scoringLive`, and the bare
  calendar endpoint `**/api/sc/event` (end-anchored, so it never swallows
  the per-event routes). A catch-all route aborts anything else off-origin,
  so no request can ever escape to the real network. The `riders` option
  overrides the seeded list (`null` = seed nothing → the empty follow
  state); the `eventId` option retargets the URL, the API stubs, and the
  riders seed (used by the multi-event tests). Storage seeds are applied
  once per context (marker-guarded), so reloads observe the page's own
  mutations rather than a re-applied seed.
- `openPicker()` opens the event-picker view instead (bare URL by default,
  or `path: '?choose'` etc.), stubs the same routes (the `calendar` option
  sets the bare-endpoint payload) and waits for the picker DOM rather than
  `lastUpdatedMs`.
- Time is pinned by replacing `Date` via `addInitScript` so that zero-arg
  `new Date()` / `Date.now()` return a fixed instant (component/epoch
  constructors pass through). That pins both `eventLocalNow()` (which reads
  `new Date()` through `Intl` in the derived event zone) and the
  staleness/cache math, without touching `index.html`. Tests advance time
  with `window.__setNow(ms)` + `render()`. `setInterval` is stubbed to a
  no-op so the 20 s/30 s/60 s polls never fire mid-test; tests call
  `fetchEventFeed()`, `fetchScoring()`, `checkForNewDeploy()` and
  `render()` explicitly.
- Because `index.html` is a classic script, all of its functions and
  top-level `let`/`const` state (`rides`, `resultsIdx`, `DELAYS`,
  `OVERRIDE_IDX`, `EST_IDX`, `EXTRAS`, `eventTz`, `calendarEvents`, …) are
  reachable and mutable from `page.evaluate`, which the unit-style tests
  use directly. The maintainer config now lives in `EVENT_CONFIGS[<id>]`,
  but it is resolved at boot into those same mutable bindings, so tests
  mutate `DELAYS`/`EXTRAS`/`OVERRIDE_IDX`/`EST_IDX` exactly as before.
- `fixtures/builders.js` constructs minimal synthetic feed/scoring payloads
  (same field shapes as the real API: `EntryList[].RidingDetails[].Venues[]`,
  `DivisionsList`/`ScoringList`). Feed fixtures carry a Montana
  `EventDetails.EventAddress`, so the page derives
  `eventTz = America/Denver` — the zone every fixture wall-clock time
  assumes. `fixtures/calendar.json` is a trimmed real calendar payload
  (8 events incl. 1187) served on the bare endpoint; `builders.calendar()`
  returns a mutable copy. All fixture dates are fixed in July 2026;
  nothing depends on the real clock. Fixture pinnies stay clear of the
  1187 config's `overrides`/`estimates` pinnies (245/192/270/343/441/472/501)
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
| P66–P71 (URL routing, picker, calendar cache) | `event-picker.test.js` |
| P72–P76, P82 (per-event storage, migration, identity, tz, empty state, unknown ids) | `multi-event.test.js` |
| P77–P81 (share links, `?riders=` receiving) | `share.test.js` |
| Bug regressions (`BUG-*`) | `robustness.test.js` |
| Edge-case hardening (`A/C/E/F/I/J/K-edge`) | `edge-cases.test.js` |
| O55–O58 (REVIEW fixes wave 1, `R3/R4/R6/R9/R10/R11`) | `persistence` (R3), `my-riders` (R4), `lifecycle` (R6), `days` (R9), `scroll` (R10), `robustness` (R11) |
| O59–O65 (REVIEW fixes wave 2, `R7/R1/R2/R8/R12a/R12c/R11b`) | `persistence` (R7, R1), `popover` (R2), `done-line` (R8), `lifecycle` (R12a), `scroll` (R12c), `robustness` (R11b) |

All numbered items (A1–P82) are covered; none skipped. Each test name starts with the
item number(s) it covers (some tests cover two adjacent items, some items
get several assertions across tests).

Notes on specific items:

- **A7** runs the page under `timezoneId` UTC / Asia/Tokyo / America/New_York
  contexts and asserts `eventLocalNow()` still yields Mountain wall-clock
  components (the fixture feeds derive America/Denver). (All other tests
  default to a UTC context, so event-zone independence is exercised
  suite-wide; the device-zone *fallback* when nothing derivable exists is
  covered under P74/P75 in `multi-event.test.js`.)
- **J44** serves mutated page bytes from the test server and calls
  `checkForNewDeploy()` manually, asserting reload/no-reload via a page
  marker; the `file://` no-op branch is loaded straight from disk (with
  `?event=1187` on the file URL).
- **F26** verifies the CSS precedence half (next-up beats soon) via computed
  border colors, since both classes legitimately co-exist in the DOM.
- **K45**'s old "byte-identical to the baked list" assertion is gone with the
  baked list itself: clearing storage now yields the add-riders empty state,
  which is what the test asserts instead.
- **P78**'s clipboard assertions run with `clipboard-read`/`clipboard-write`
  granted on the context; `navigator.share` is absent in headless chromium,
  so the native-share branch is exercised by defining a stub `share` and
  re-rendering the sheet.
- **R12c**(a) needs a page variant with no extras; it patches the
  `extras: [...]` block inside `EVENT_CONFIGS[1187]` in the served bytes
  (EXTRAS itself is resolved from the config at boot).

No changes to `index.html` were needed for testability. A later bug-hunt
pass (pre-refactor) found five defects, each fixed in `index.html` and
pinned by a `BUG-*` test in `robustness.test.js`:

- **BUG-phase-escape** — the done line's `next: <phase>` was interpolated
  into `innerHTML` unescaped (the one feed string that bypassed `esc()`).
- **BUG-null-pinny-popover** — the popover subtitle rendered a dangling
  `· #` when `PinnyNumber` was null (rows already guarded it).
- **BUG-null-pinny-next** — `nextRideInfo` matched combos by
  `pinny !==`, so two null-pinny combos compared equal and one combo's
  done line could point at another's ride; now falls back to rider+horse.
- **BUG-myriders-non-array** — `getStoredList` returned any valid-JSON
  value; a non-array in the follow-list key crashed
  `effectiveFollowing()` and left the page empty behind a phantom
  "can't reach ShowConnect" note. Now guarded with `Array.isArray`
  (post-refactor: a corrupt `sc:<id>:riders` degrades to the empty list
  and the add-riders prompt, which is what the test asserts today).
- **BUG-cache-hydrate-crash** — cache hydration ran unguarded at top
  level; a wrong-shape cached payload threw before the fetches and event
  listeners were installed, bricking the page. Now wrapped in try/catch.

`edge-cases.test.js` adds hardening beyond the numbered items: degenerate
feed shapes (missing `RidingDetails`, empty/null `Venues`, empty
`EntryList`, scoring rows for unknown divisions), a ride exactly at "now",
all-past and all-out days, identical-time sort stability, a zero-delay
`DELAYS` map on `DELAY_DATE`, an auto estimate crossing midnight,
quota-exceeded localStorage writes, and follow-list names absent from the
feed. Degenerate *calendar* payloads are covered under P71 in
`event-picker.test.js`. Product-level concerns found in the same pass live
in [`../REVIEW.md`](../REVIEW.md), deliberately not "fixed" in code.
