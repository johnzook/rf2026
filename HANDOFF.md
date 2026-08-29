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

[Update, July 2026: this checklist is now done — the app is multi-event.
Kept as written for the record; see "Post-genericization" below for what
was built.]

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

Owner's dispositions recorded post-event (July 2026):

1. **.ics calendar export** — recorded as an idea; future potential only,
   not planned. The only push-notification substitute available to a
   static page.
2. **Per-rider share links** (`?rider=` filter) — subsumed by the generic
   version: solving "not hard-coded" there should cover per-viewer rider
   scoping; don't build separately. [Built July 2026, exactly this way:
   generic `?event=<id>&riders=…` share links — see below.]
3. **Override-vs-feed drift detection** — owner expects this to be the
   HARDEST part of a generic tool: schedule revisions are super rare but
   high-impact when they happen (this event re-ordered an entire XC day
   and moved one rider 4+ hours). Design attention should go here —
   detecting when the feed catches up to or further revises a manual
   override, and reconciling the three time layers.
4. **Auto day-flip at midnight** (REVIEW #12b) — agreed correct as-is;
   any change is future work if ever done.
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

## Post-genericization (July 2026)

The single-event page above was genericized into a multi-event app
shortly after Rebecca Farm 2026 (same repo, still one self-contained
`index.html`, classic script, no backend). Test counts elsewhere in this
doc describe the pre-genericization suite.

**Genericize checklist: done.** All items in "Event-specific things to
genericize" landed:

- Event id is chosen at runtime: `?event=<ShowConnectId>`; bare URL
  resumes `sc:last-event`, else shows an event picker (`?choose` forces
  it), which also accepts a typed id or pasted showconnect.org URL.
  Header/title come from `EventDetails.EventName`.
- Timezone is derived at runtime (see below); footer shows the zone's
  short name.
- Storage prefixes are per-event: `sc:<id>:riders` / `sc:<id>:event` /
  `sc:<id>:scoring` (plus global `sc:last-event`, `sc:calendar`,
  `sc:reloadState` — the reload state carries an eventId and only
  restores for a matching event). Other events' feed caches are evicted
  after a successful fetch; every event's `:riders` is kept. Legacy
  `rf2026:myRiders` migrates once to `sc:1187:riders`; other `rf2026:*`
  keys are deleted.
- `FOLLOWING` and the hidden/restore mechanism are gone: riders are
  chosen entirely in-app and stored per event.
- Share links exist: `?event=<id>&riders=<encoded "Last, First" names
  joined with "|">`, sent via navigator.share / `sms:` / copy. Receiving
  onto an empty list adopts silently; otherwise an Add/Replace/Ignore
  banner. The URL is canonicalized to `?event=<id>` via replaceState.
  This is deferred feature #2, now built.

**Calendar endpoint (newly verified live, July 2026).**
`GET /api/sc/event` (no id) — what showconnect.org/calendar itself uses —
returns a JSON array of ~105 events (~11 KB): `ShowConnectId`,
`EventName`, `EventDate` (display string), `EventStartDate`/`EventEndDate`
(ISO), `EventLocation`, `EventAddress`, `PublishEntryList`/
`PublishSchedule`/`PublishScoring`, and `CalendarPosition`: **1 =
happening now, 2 = upcoming (sorted ascending), 3 = past (most recent
first)**. It is flaky: observed one 90 s+ hang followed by a 0.9 s
success. Hence the picker uses the same 10 s fetch abort, caches the list
in `sc:calendar` with a 6 h TTL (stale cache renders immediately while
revalidating), and tolerates total failure — manual id entry always
works.

**No timezone anywhere in the API** — neither feed nor calendar carries
one. Chosen heuristic: scan the comma-separated segments of
`EventAddress`/`EventLocation` last-to-first for a US state name and map
it to that state's primary IANA zone (`STATE_TZ`; split-zone states get
the majority zone), falling back to the device zone. Wrong only for
venues in a state's minority zone — accepted as strictly better than a
fixed zone.

**Maintainer layer unchanged in kind, rescoped.** Delays / overrides /
estimates / extras remain a maintainer-only constant block edited via
commit→deploy, now `EVENT_CONFIGS = { [ShowConnectId]: { delayDate,
delays, overrides, estimates, extras } }`, applied only when the viewed
event matches its key (other entries inert; 1187 kept as the worked
example). Override-vs-feed drift detection — deferred feature #3, still
expected to be the hardest part — remains unbuilt.

## Round view (Aug 2026, event 1190 — Equestrians' Institute HT)

Built live during the event, one feature per real spectator question:
"how far along is the round while my rider's score isn't up?" → the
round sheet; "who's leading?" → the placing toggle; "where does a clean
ride land?" → carried scores. TESTPLAN group R (items 86–91) is the
spec; `tests/round-view.test.js` covers it.

### New API knowledge (verified against the live feeds)

- **Phase score fields are CUMULATIVE running totals, not per-phase
  penalties.** Verified live: a clean XC leaves the number unchanged
  (#162: Dressage 34.1 → XCScore 34.1). Per-phase place fields rank
  exactly those totals, which is why "sort by score" and "sort by place"
  agree on a finished phase.
- **`FinalPoints` mid-event is the total through the combo's completed
  phases** — numeric as soon as dressage posts, `--` before it. So for a
  combo yet to run a phase, `FinalPoints` IS the score it carries in,
  and (scores being cumulative) exactly where a clean ride ends up. That
  one field powers the gray carried scores without walking `PhaseOrder`.
- **`FinalPlace` ranks `FinalPoints` across the whole division live**, so
  mid-phase a rider can be XCPlace 1st (of the finishers so far) while
  FinalPlace 9th (most of the field still carries better dressage).
- **Do not assume 1187's SJ block times.** 1190 published individual
  per-rider SJ times (~2-min spacing). The verify-don't-assume
  `sjBlockDivs` detection (group by division, require >1 identical
  times) earned its keep: block divisions get reverse-of-standing order
  + slot estimates, individually timed ones just sort by time.
- **`PhaseOrder` varies per division within one event** (1190 ran both
  `d-xc-sj` and `d-sj-xc` divisions the same weekend). Deriving carried
  score from `FinalPoints` rather than "the previous phase's field"
  sidesteps this entirely.
- Scores post in batches and can post out of running order, so the
  progress line's "through <time>" is a high-water mark, not a cursor.

### Design philosophy (worth keeping for future features)

- **Scope views to one division + one phase, entered from where the user
  already is.** The round link lives in the ride popover, so the phase
  is always the one being looked at — no phase chooser, no global
  "browse rounds" surface, and the timeline remains the only navigation.
- **One list, several questions.** Running order + posted scores +
  places answers "how far along", "how did each ride go", and roughly
  "who's leading" in a single view; the placing toggle exists only for
  when the leaderboard is the primary question. Resist splitting into
  more views/tabs.
- **Provisional data is visually second-class and never outranks
  official data.** Carried scores render gray with no place; on a score
  tie the posted result sorts above the carried one (carried is a best
  case — XC time penalties are common). Same principle as est. slots.
- **Denominators count still-competing combos only** ("N of M posted"
  excludes E/W/R…). Accepted quirk: a finished earlier-phase round of a
  division with later withdrawals reads "all 15 scores posted" though 17
  rode — mid-weekend the count's job is "is this round still going".
- **Reuse the page's existing models instead of re-deriving**
  (`adjustedTime` for delays/overrides, `autoEstimate` for SJ slots,
  `resCell`/`tiedAt` for score cells, `OUT_WORDS`, the bottom-sheet
  pattern) so the round view can never disagree with the timeline rows.
- **Live by default, no new polling.** Every `render()` path re-renders
  an open sheet (`renderRoundSheet` is a no-op while closed), so the
  existing 60 s scoring poll drives it.
- **Fetch the real feeds before building.** Both the carried-score
  semantics and the individual-SJ-times surprise were confirmed against
  live payloads first; the synthetic test fixtures were then shaped to
  match what was observed, not what was assumed.

### Known trade-offs (deliberate, revisit only if they chafe)

1. SJ block "running order" drifts once SJ scores post — order is
   reverse of CURRENT standing and a clean round moves a rider up the
   list; the true historical go order isn't recoverable from the feed.
   Placing is the stable view late in a round.
2. A phase split across two days would list correctly but show bare
   clock times with no day labels.
3. Sort preference (`roundSort`) is page-lifetime only, deliberately not
   persisted; a reload returns to running order.
