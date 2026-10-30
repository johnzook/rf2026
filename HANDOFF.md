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

## evententries.com findings (Oct 2026, Galway Downs)

Probed for "could the site work with evententries?" (the other major US
entry/scoring platform — Galway Downs, Kentucky Horse Park, VHC, Waredaca
and many others enter through it). Verified live:

- **Stack:** evententries.com and its per-show "Show Center" sites are
  GWT (Google Web Toolkit) apps, Java servlet backend, classes under one
  `com.kyler.*` namespace. All data moves over **GWT-RPC**: pipe-delimited
  requests (`7|0|4|<module base>|<serialization policy hash>|<service>|
  <method>|…`) needing an `X-GWT-Permutation` header, and `//OK[…]`
  reversed-token responses over a string table. Both hashes change on
  every recompile. There is no JSON API, documented or otherwise.
- **The Show Center on evententries.com is just an iframe** of a per-show
  host: `<id>-<show>.heofeed.com:444`, `….heoshowcenter.com:444` or
  `….heoshows.com/heoshowcntr` (three generations of the same "HEO Show
  Center" app — HEO = their desktop "Horse Event Organizer" program, a
  Firebird database that secretaries schedule and score in). Methods seen:
  `LoadShowProfile`, `LoadRideTimes`, `LoadOrderOfGo` on
  `…/heoshowcenter/info`; `LoadShowCenterList`, `LoadScoringShows`,
  `LoadScoringBoard` on `evententries.com/evententries/sf`. Live scores
  live on evententries.com itself (`#LiveScores`), per-division boards
  with pinny, judge marks, XC jump/time, SJ, to-date and final places;
  a `RefreshSignals` counter is polled for change notification.
- **No CORS** on either host: replayed requests with a foreign `Origin`
  return data but no `Access-Control-Allow-Origin`, and the preflight is
  empty. A static page cannot call them; a server-side proxy would be
  required (breaking the no-backend property).
- **Terms of Use** (evententries.com → Terms of Service) prohibit
  "systematic retrieval of data … to create or compile … a collection,
  compilation, database" without written permission (info@evententries.com)
  and redistribution, but allow printing/downloading **one copy** for
  personal use. It is a very small operation (Laurel, MS; the show
  secretary's P.O. box), so permission requests are a phone call, not an
  API program.
- **Order of Go layout** (what the snapshot parser consumes): per ring
  heading (`Eucalptus`, `Grand Prix`, `Sycamore`, `XC`, `SJ - Grand Prix`),
  a section title (`2026 USEA Novice Dressage Test B`, `Cross Country
  Novice`, `Show Jumping FEI`), a `Judge(s): …` line, then rows of
  `Pinney / GoTime ("10:00 AM Thu") / Rider ("First Last") / Horse /
  Division (short code only)`. `Break` rows and pinny-less `Test Ride`
  rows interleave. Rings repeat only when they change. **SJ sections carry
  only Breaks until XC is done** (order is reverse of standing, published
  later) — re-publish the snapshot then. Ride Times tab is the same data
  per rider ("Last, First"); Live Scores name riders "First Last (USA)".
  Pinny is unique show-wide, so a pinny+division join works as on
  ShowConnect — which is how the scores snapshot (below) is joined.
- **Live Scores board layout** (`evententries.com/#LiveScores<boardkey>`,
  one page for the whole show; per-level pages exist with their own
  keys). Copying the entire page gives: site chrome, then per division a
  header line with the division name, its code in parentheses and the
  event name run together (`Novice Rider (NR)The Eventing Championships
  at Galway Downs(Oct. 2026)`; some names carry two paren groups —
  `Modified/Training - Championship (OT CHAMPS) (M/T-CH)The …` — and the
  code is the group that runs straight into the event name), then a
  judge line (`Judge: Wendy Wergeles` or `Jdg @ M: Debbie Adams, Jdg @ C:
  Peter Gray, Jdg @ E: Bea di Grazia`), then the column names one per
  line (`#`, `Rider`, `Horse`, 0–3 × `Jdg @ X`, `Dress`, `Score`, `To
  Date`, `Place`, `XC`, `Jump`, `XC`, `Elapsed`, `XC`, `Time`, `To Date`,
  `Score`, `To Date`, `Place`, `Stad`, `Jump`, `Time`, `Pen`, `Final`,
  `Score`, `Final`, `Place`), then rows: pinny (may carry a trailing tab),
  `First Last (USA)` (country optional), horse, and ONLY the cells that
  have posted — blanks are dropped from the copy (3-judge dressage reads
  `70.00 68.13 67.71 31.4 1`, single-judge `18.3 1`, nothing yet = no
  cells). `Test Ride` / `Test Horse 2 Star` lines appear without a pinny;
  a horse can be named `PJ`. Scores are cumulative ("To Date Score" after
  XC, "Final Score" after stadium), same semantics as ShowConnect.
  **The same board as a browser's `innerText`** (what
  `tools/snapshot-fetch.js` saves) differs in three ways from a macOS
  copy: the division line and the event name are separate lines
  (`CCI Four Star - L (CCI4-L)` / `The Eventing Championships at Galway
  Downs(Oct. 2026)` / `Jdg @ M: …`), cells are padded with blank and
  tab-only lines, and a tied place renders as `4-T`. The parser accepts
  both forms (same 251 rows / 30 divisions on Galway) and normalizes
  `4-T` → `4`, leaving tie display to the page's equal-places rule.
- **General Schedule tab layout** (the third paste, optional): column
  header tokens (`Date`, `Ring`, `Time`, `Division`, `Classification`,
  `Judge(s)`), then per day a date line (`Thu, 10/29`), bare ring lines
  (`Grand Prix`, `Sycamore`, `Eucalptus`, `XC`, `SJ - Grand Prix`, `SJ -
  Clock Tower`) and per block `HH:MM-HH:MM` / division code /
  classification (`Dressage`, `Cross Country`, `Stadium`) followed by 0–3
  judge-name lines. **Times carry no AM/PM**: the parser reads hours 1–6
  as PM, 7–11 as AM, 12 as noon (show days start ~7 AM; `11:20-02:04`
  spans noon). **Judge lines and ring lines are both bare text** and
  indistinguishable by shape; the judge names learned from the order of
  go's `Judge(s):` lines decide (judge → skip, anything else → ring),
  with a known-venue / `SJ`/`XC`-prefix fallback when there are no judge
  hints. Each block fills phases a combo has no order-of-go row for —
  show jumping, until its order posts — with the division's block start
  and end. That makes evententries SJ behave exactly like ShowConnect's
  SJ block model (one shared time per division → `sjBlockDivs` →
  reverse-of-standing round order + `autoEstimate` slots from pasted
  placings), with no new code downstream of `extractRides` beyond the
  block window in the popover. Verified on Galway: 90 blocks, every combo
  3 phases, 28 SJ block divisions, the individually timed CCI2-L left
  alone.
  **Parser rules that made it reliable:** with the order-of-go feed loaded,
  a row starts only at an integer that is a known pinny in THAT board's
  division — place cells (1–30 overlap FEI pinnies), ad copy after a
  number and other divisions' pinnies all fail that test, and a
  code-shaped horse name passes. And a division header is only a line
  whose paren code the feed knows (shape-checked without a feed), with
  the judge line directly after it or one line later: that is what keeps
  the line before a header (the "Results are not final" banner, a
  zero-score row's horse) and the event-name line (`(Oct. 2026)`) from
  being taken as the header — one wrong header cascades, because every
  row under it then fails the pinny-in-this-division test.
  **XC block verified (Fri Oct 30):** the first real post-XC row was
  `65.93 67.04 33.5 7 20.0 07:54 34.4 87.9 1` with two judges — judge
  marks, dressage score and place, XC jump, elapsed, time penalties, to
  date score, to date place — exactly the inferred layout; the `m:ss`
  elapsed-cell anchor holds. **Known unknown that remains:** the stadium
  block (`Stad Jump`, `Time Pen`, `Final Score/Place`) is still inferred
  from the column names; the parser takes the last two cells as the final
  pair. Verify against a paste after SJ.
  **"To Date Place" ranks finishers of that phase only** — the same row
  showed `1` because that combo was the first home from XC, while it sat
  last in the division on cumulative points. scoringLive's `FinalPlace`,
  by contrast, ranks `FinalPoints` across the whole division live (the
  Aug 2026 finding above), and "currently Nth overall", the tie marker
  (equal places) and the round view's placing sort all assume that. So
  `rankScoreboard` computes the overall itself: ascending `FinalPoints`
  per division, equal points sharing a number, out codes and unscored
  rows left alone; the per-phase place fields stay the board's. Before
  this, the first XC finisher read "currently 1st overall" and "T1st"
  (tied with a dressage-only 1st via the fall-through) — a real spectator
  caught it within the hour.

**Design chosen:** the one-copy snapshot (section S of TESTPLAN,
`tools/snapshot-encrypt.js`): a human copies the order of go once, the
repo hosts it AES-GCM encrypted under a random link token, the page
decrypts and parses it into the ShowConnect feed shape. No automated
retrieval from their servers, no proxy, no plaintext in the public repo,
and everything downstream of `extractRides` reused unchanged. Results
come the same way: an optional pasted Live Scores board, encrypted under
the same token (`--scores`), parsed into the scoringLive shape and joined
on pinny + division code; plus outbound "live scores ↗" links to their
own per-level pages. `tools/snapshot-fetch.js` does the copy step with
a headless browser when a person runs it (the same page loads a visitor
makes, once; a 10-minute spacing guard; never a timer or CI — their
terms). Trade-offs accepted: nothing live (a human triggers every
refresh), and
`"First Last"` rider names (so names followed on ShowConnect events don't
cross-match in the "followed at other events" header).
