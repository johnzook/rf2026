# Handoff — knowledge for generalizing this into an any-event tool

Written after The Event at Rebecca Farm 2026 (ShowConnectId 1187), where
this page ran live all weekend. Everything below was learned by probing
the real feeds and operating the page during competition; little of it is
documented anywhere else. Companion docs: `InitialPrompt.md` (original
brief + first API findings), `TESTPLAN.md` (65-item behavior spec),
`REVIEW.md` (resolved-issues changelog), `tests/` (84 Playwright tests,
`cd tests && npm install && npm test`).

## API knowledge beyond InitialPrompt.md

All verified live against ShowConnect during the event:

- **`/api/sc/event/{id}/scoringLive`** (~30 KB) works and is essential:
  `EventDetails`, `DivisionsList`, `ScoringList`. `scoringPhaseLive` was
  observed EMPTY all weekend — do not build against it.
- **Results join**: `ScoringList[].Pinny` was unique event-wide (561/561)
  and `DivisionsList[].DivisionName` matches the entry feed's `Division`
  strings verbatim. Join on pinny + division name. NEVER join on rider
  name — entry feed uses "Last, First", scoring uses "First Last (USA)".
  Entry feed contains `PinnyNumber: null` (unassigned/scratched) — a
  pinny-only join conflates those.
- **SJ times are division-block placeholders**: every entry in a division
  shares one identical `RideTimes` string for Show Jumping (the block
  start). Detect by grouping; don't assume per-rider SJ times. Dressage
  and XC are individually timed.
- **Order of go in SJ = reverse of current standing.** Enables automatic
  slot estimates: block start + pace × (# still-competing combos placed
  below). Observed pace at this event: ~2 min/rider (measured live:
  9 riders in 25 min ≈ 2.8 incl. holds; clean stretch exactly 2.0).
  Official order-of-go sheets (PDFs from the show office) list E/R/RF
  riders in-order but they don't start — skip them when counting.
- **Out-of-competition codes** appear in `FinalPlace` (and phase score
  fields): E/IE/TE = eliminated, R/MR = retired, RF = rider fall,
  W/IW = withdrawn. Numeric = still competing.
- **Per-phase "place" fields are the cumulative standing AFTER that
  phase, with ties sharing a number**; `FinalPlace` applies the tiebreak
  (XC time nearest optimum). Hence "SJ T4th but 5th overall" is
  consistent data, not an error.
- **`DivisionsList[].PhaseOrder`** (e.g. "d-xc-sj") tells you a
  division's final phase — used to decide when a division is complete
  ("finished Nth overall" vs "currently Nth overall").
- **A phase score posting is the authoritative "this ride happened"
  signal** — better than any clock/grace heuristic.
- Feed data quirks seen in production: trailing spaces in horse names,
  `Venues[0].venue: null` on Phases A/B/C, `Status: "Scratched"` entries
  retaining stale data, duplicated rows in official PDFs (Sat XC sheet
  printed the last two pairs twice with shifted times).

## Operating model that worked

- Weather-day reality: delays are NOT uniform. This event had per-ring
  flat delays (SJ +90, FEI dressage +60, HT dressage +90) AND a full XC
  re-order where one rider moved 4+ hours. Hence the three-layer time
  model: `DELAYS` (venue+date-scoped) → `OVERRIDES` (per pinny+phase
  exact revised times, from official sheets) → `ESTIMATES` (individual
  slot within an SJ block; manual beats automatic). Keep all three in a
  generic tool.
- Edits flowed through a maintainer (commit → auto-deploy → pages
  self-reload within ~90 s). The deploy watcher (self-fetch + byte
  compare) made "no separate signal file" workable. Reloads restore
  day/scroll via sessionStorage.
- Ring-side estimate anchoring: one live observation ("rider #337 started
  2:15") re-anchors a block's estimates better than any prior. A generic
  tool could make this a first-class input.

## Event-specific things to genericize

- `EVENT_ID` (1187), `EVENT_TZ` ("America/Denver"), page title/header,
  `FOLLOWING`, `DELAY_DATE`/`DELAYS` venue keys, `OVERRIDES`,
  `ESTIMATES`, `EXTRAS` — all hardcoded for this event (config at top of
  `index.html`).
- localStorage/sessionStorage keys are prefixed `rf2026:` — must become
  per-event (cache from another event must never hydrate).
- Venue codes (R1..R5, SJR1/3/4, XC, "Phase A") vary by event; the code
  treats them as opaque strings already.
- `PHASE_SHORT`/phase-field maps cover Dressage/XC/SJ; Phases A/B/C
  (roads & tracks/steeplechase) have no scoring fields and no venue —
  handled as display-only rows.
- The 2-min SJ pace and 10-min grace window are constants
  (`SJ_PACE_MIN`, `PAST_GRACE_MIN`) — reasonable defaults, could be
  config.

## Deferred features (discussed, deliberately not built)

1. **.ics calendar export** — the only push-notification substitute
   available to a static page. Highest-value deferred item.
2. **Per-rider share links** (`?rider=` filter) — so each family shares a
   URL scoped to their rider.
3. **Override-vs-feed drift detection** — flag when the feed's time
   disagrees with a configured override (stale override, or a further
   revision). Declined for this event; likely worth it for a generic
   tool where overrides are routine.
4. **Auto day-flip at midnight** (REVIEW #12b) — current behavior (flip)
   was judged correct; revisit only if users complain.
5. Rejected outright, reasons still valid: push notifications (backend),
   auto-parsing order-of-go PDFs (irregular layouts; human-in-the-loop
   was more reliable), `scoringPhaseLive` live tracking (never saw data).

## Development workflow proven here

- Single self-contained `index.html`, classic script — this made the
  entire app testable via Playwright `page.evaluate` with zero
  testability hooks. Preserve that property.
- `TESTPLAN.md` is the spec: every behavior numbered; tests reference
  item numbers. Change behavior → update the item + test together.
- Tests pin time via a `Date` shim and disable `setInterval`
  (`tests/helpers.js`) — all 84 tests are deterministic and will stay
  green after the event's dates pass.
- The event feed is unofficial and could change shape without notice:
  fetch/parse stays isolated (`extractRides`, `buildResultsIndex`,
  `parseRideTime`), and degenerate-input behavior is pinned by
  `tests/robustness.test.js` / `edge-cases.test.js`.
