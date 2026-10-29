# Rider Tracker — Tracked Behaviors & Test Plan

Every behavior, gotcha, and fix tracked during development of `index.html`.
Each numbered item should be covered by a unit test (calling the page's
top-level functions directly in a browser context) or a functional test
(rendering the page against fixture feeds with a pinned clock).

## Testability notes

- `index.html` is a single classic-script page: all functions and state
  (`parseRideTime`, `extractRides`, `render`, `rides`, `resultsIdx`,
  `DELAYS`, `OVERRIDE_IDX`, `EST_IDX`, `EXTRAS`, `deriveTz`,
  `sanitizeCalendar`, `buildShareUrl`, etc.) are reachable from
  `page.evaluate` in Playwright (chromium at `/opt/pw-browsers/chromium`,
  via `playwright-core`; do NOT run `playwright install`). The maintainer
  config lives in `EVENT_CONFIGS[<id>]` but is resolved at boot into the
  same mutable `DELAYS`/`DELAY_DATE`/`EXTRAS`/`OVERRIDE_IDX`/`EST_IDX`
  bindings tests mutate via `page.evaluate`.
- Stub all three API endpoints with `page.route` fixtures:
  `**/api/sc/event/<id>`, `**/api/sc/event/<id>/scoringLive`, and the bare
  calendar endpoint `**/api/sc/event` (end-anchored — it never swallows the
  per-event routes). Tests must never touch the real network.
- Tests open the app in event mode via `?event=1187` and seed the nine
  fixture rider names into `sc:1187:riders` (there is no baked follow list
  anymore); picker tests open the bare URL or `?choose` instead.
- Pin time by overriding `eventLocalNow` (and `Date.now` where staleness
  logic is tested) via `page.evaluate` / `addInitScript`, then calling
  `render()`. Fixture data uses fixed July 2026 dates, so tests must never
  depend on the real clock. Fixture feeds carry a Montana
  `EventDetails.EventAddress`, so the derived `eventTz` is America/Denver —
  the zone every fixture wall-clock time assumes.
- Prefer small synthetic fixtures crafted per scenario over the full
  captured payloads, so each state (upcoming/underway/done/out) is stable.

## A. Feed parsing

1. `parseRideTime` parses `"Fri, Jul 17, 2026, 12:30:00 PM"` (format
   `%a, %b %d, %Y, %I:%M:%S %p`) including 12 AM/PM edge cases; returns
   `null` for empty or malformed strings.
2. `Venues[].date`/`time` are a publish timestamp and must never be used
   as the ride time (an entry whose Venues date differs from the RideTimes
   date must be bucketed under the RideTimes date).
3. Entries with empty `RideTimes` for a phase are skipped (not scheduled).
4. Rider filtering matches `RiderName` verbatim ("Last, First"); no
   normalization, no cross-feed name joining.
5. Entries with `Status !== "Accepted"` (e.g. Scratched) are skipped even
   if they carry ride times.
6. Flattening: one row per entry × scheduled phase, carrying rideTime,
   phase, venue, rider, horse, pinny, division, divisionShort.
7. `eventLocalNow` returns the event-local wall clock (the zone derived
   from the feed per item 75 — America/Denver for the fixture feeds)
   regardless of the host timezone (test with TZ=UTC and TZ=Asia/Tokyo
   contexts).
8. Day keys are zero-padded ISO (`2026-07-05` sorts before `2026-07-17`
   with plain string sort).

## B. Day chips & default day

9. One chip per day having followed rides OR an `EXTRAS` item (union of
   ride days and parsed extras dates), in date order; "Today" label for
   the current event-local date. A day whose only content is an extras
   item still gets a chip and renders the extras — never the "no rides"
   empty-state message.
10. Default day = today if it has rides; else the next day with rides;
    else the last day. User's chip selection sticks across re-renders.

## C. Delays

11. `DELAYS[venue]` minutes apply only to rides whose day equals
    `DELAY_DATE`; other days' rides at the same venue are unshifted.
12. Delayed rows show adjusted time large + original struck through;
    un-delayed rows show no strikethrough.
13. Delay changes re-sort the list by adjusted time.
14. Delay banner lists only non-zero venues and only when viewing
    `DELAY_DATE`; hidden otherwise.

## D. Overrides (revised times)

15. An `OVERRIDES` entry (pinny+phase) replaces the feed time entirely;
    venue delay is NOT stacked on top.
16. An override can move a ride to a different day (row appears under the
    override's day chip).
17. Overridden rows show "revised" treatment: struck-through original,
    popover text `(revised; sched X)`. If override equals the feed time,
    no strikethrough (revised flag false).

## E. Slot estimates

18. Manual `ESTIMATES` entries (pinny+phase, date-matched) take precedence
    over automatic estimates; rendered as `est. slot ~X · <note>`.
19. Auto estimate applies only to Show Jumping rides in divisions whose SJ
    time is a shared block placeholder (>1 entry, identical time strings).
20. Auto estimate = adjusted block start + 2 min × (count of
    still-competing combos placed numerically below this one); note reads
    `Nth of M to jump, by standing`; ties in placing produce equal
    estimates.
21. Combos with non-numeric FinalPlace get no auto estimate; rides with
    no scoring row get none; non-SJ phases get none.
22. Estimates are hidden on past/done rows.

## F. Row lifecycle (today)

23. `activeUntil` = (estimate time if present, else adjusted time) +
    10 min grace; row is `past` only after that — OR as soon as the ride's
    phase score is posted numerically in the scoring feed, provided the
    listed time has passed (a posted score never marks a future ride done;
    out codes E/R/W... in the score field don't count as posted).
    Midnight nuance: a row whose `activeUntil` extends past event-local
    midnight is NOT flipped to a previous-day row at 12:00 AM — the
    day-boundary check only wins once `activeUntil` has expired; ordinary
    previous-day rows (grace long expired) are unaffected. (Test `R12a:`.)
24. Countdown text: `in N min` (<60), `in H h M min` (>=60), `underway`
    when listed time has passed but not activeUntil.
25. "Next up" tag on the first non-past, non-out row; label reads
    "Next up" before the listed time and "Now" once underway.
26. `soon` highlight only before the start: `0 < minsUntil <= 30`. An
    underway row (minsUntil <= 0) never carries the orange soon
    treatment; never on out rows, never visually on next-up (CSS gives
    next-up precedence when both classes apply).
27. The now-line marker sits between the last row with adjusted time <
    now and the first >= now (position by time, not by past/active
    state); shown only when viewing today; label `now · H:MM AM/PM`.

## G. Out-of-competition status

28. `FinalPlace` codes map: E/IE/TE→eliminated, R/MR→retired,
    RF→rider fall, W/IW→withdrawn; numeric places → not out.
29. Upcoming rides of an out combo: faded (opacity .75), status word in
    place of countdown, excluded from next-up and soon; shown on future
    days too; tap/hover restores full opacity.
30. Extras never get out status.

## H. Done-line (completed rides)

31. With places: `✓ {Dressage|XC|SJ} Nth · currently Nth overall ·
    next: ...` while the combo rides again; `✓ ... · finished Nth
    overall` (no suffix) only once the combo is done riding AND its
    division's final phase is complete (every still-competing combo has a
    posted score in the division's last phase per `PhaseOrder`; out combos
    ignored) — placings can change while later riders are on course, so a
    done-riding combo in a live division stays "currently".
32. No places posted and not out: `✓ scores pending · <next|event
    complete>`; `event complete` also appended when finished but overall
    place missing.
33. Out on this ride with no places: bare status word (no ✓). Out later
    with places on this ride: `✓ Dressage 14th · withdrawn`.
34. `next:` points at the combo's next ride from NOW (not from the row's
    slot — skips intermediate phases that already ran); uses each
    candidate's effective time per `adjustedTime` (override wins, else
    venue delay when the ride's day is `DELAY_DATE`) for BOTH the
    still-in-the-future filter and the displayed time — so a delay-pushed
    ride is never skipped as already past, and the advertised time always
    matches that ride's own row; weekday label included only when the next
    ride is not today; phase abbreviated XC/SJ. (Test `R8:`.)
35. Phase place field per phase: DressagePlace / XCPlace / SJPlace;
    overall from FinalPlace; ordinals correct (1st/2nd/3rd/4th, 11th-13th).
    A place shared by 2+ combos in the division gets a "T" prefix (T4th)
    in the done line and in the popover result cells; unique places get
    no prefix.
36. Previous-day rows: full brightness (no `.past` dim class) but gray
    done-line styling; today's done rows dim to 0.55 and tap/hover
    restores opacity (popover readable).

## I. Results popover

37. Results join strictly on pinny + division name (scoring
    DivisionsList id→name mapping equals entry-feed Division strings);
    never on rider name.
38. Popover shows division, pinny, time row (plain / delayed / revised
    variants), estimate row when present, and Dressage/XC/SJ/Overall
    results; `--` or empty feed values render as em-dash; missing scoring
    row → "Not posted yet".
39. Tap pins exactly one popover (tapping another row moves the pin;
    tapping the pinned row unpins); clicks inside the popover don't
    unpin. Tapping anywhere OUTSIDE a row (page background, header,
    chips) dismisses the pin, as does Escape — applies to timeline and
    roster (item 85) popovers alike. A pinned popover survives re-render: ride rows carry a stable
    `data-key` (pinny|phase|dayKey), the pinned row's key is captured
    before `#list` is rebuilt and the pin re-applied to the matching row
    afterwards; if the row no longer exists (rider removed, day switched)
    the pin is dropped silently. Extras carry no key and can't pin.
    (Test `R2:`.)

## J. Persistence & network

40. Successful event/scoring fetches cache payloads to localStorage
    (`sc:<id>:event`, `sc:<id>:scoring` — keyed per event, so another
    event's cache can never hydrate this one) with a timestamp; on load the
    page hydrates and renders from cache before any network response. A fetch
    whose serialized payload is identical to the last-written one skips
    the localStorage write entirely (the blob and its `at` stamp only
    change when content changes); `lastUpdatedMs` still refreshes on
    every successful event fetch.
41. With all network blocked and a warm cache, reload still renders rows
    and results; error note "can't reach ShowConnect, retrying" appears.
42. Status line: fresh data → plain `Updated H:MM` when every followed
    name matched at least one accepted entry in the feed (the follow
    count lives only in the header `my riders (N)` control, item 84 —
    stating it twice was reported as clutter), or
    `Updated H:MM · M of N riders found` when only M of the N did
    (singular "rider" when N is 1);
    data older than 2 min → `Showing data from H:MM (N min old)` (hours
    form past 60 min). With nobody followed the follow note reads
    `no riders followed yet`. The wording is produced by one shared
    `updateStatusLine()` and set on EVERY render path — timeline, empty
    day, pre-schedule roster, nobody-followed — never left stale by an
    early return (item 84).
43. Fetch failures never clear previously-rendered data (fail-soft);
    scoring failures are silent.
44. Deploy watcher: identical self-fetch → no reload; changed bytes →
    reload; first fetch just sets the baseline; no-op on `file://`.

## K. Per-browser follow list ("my riders")

*(Rewritten for the multi-event refactor: there is no baked `FOLLOWING`
list and no hidden-riders mechanism anymore — the follow list IS the
per-event stored list `sc:<id>:riders`, chosen entirely in-app.)*

45. `effectiveFollowing()` = the stored `sc:<id>:riders` list, period.
    With no stored list (fresh browser, or storage wiped) nobody is
    followed: the empty-state prompt renders (item 76), never a baked
    default.
46. Sheet lists the stored riders with Remove on every rider; Remove
    deletes the name from `sc:<id>:riders` (a real delete — the removal
    survives reload), drops the rider's rows from the timeline, and can be
    undone only by re-adding.
47. Browse + filter: with an empty box the sheet lists EVERY entered
    rider (alphabetical, letter-group headers); typing filters —
    case-insensitive substring, any length, matching rider name, horse
    name, or division (full or short, so "novice"/"ONB" browses a
    level); no result cap. Entries of EVERY status are indexed — a
    scratched rider must stay findable, since scratches can un-scratch.
    Each horse shows its division short name; non-accepted horses are
    annotated in place ("Horse (ONB, scratched)"); a rider with no
    accepted entries at all is dimmed but still addable. Shows Add for
    unfollowed, Remove for followed; Add appends the name once
    (already-present names are never duplicated). With no feed loaded
    the list area reads "Entry list not loaded yet."
48. The stored list persists across reload in the same browser profile; a
    fresh browser context sees the empty state. Follower count in status
    reflects the stored list (worded per item 42's found/followed rule).
    Once a feed has loaded, sheet rows for followed names that matched no
    accepted entry carry a muted `· no entries found` note.

## L. Extras (course walks etc.)

49. `EXTRAS` items render on their date's chip only, sorted into the
    timeline by time, dashed style, no popover, no pinny; countdown and
    next-up participation like rides; nothing shown once past. Per item
    9, an extras item's date always has a chip even with no rides that
    day.

## M. Scroll behavior

50. First render of today's list scrolls the now-line to viewport center,
    exactly once per page load; re-renders and day switches never move
    scroll. The one-shot is consumed by the FIRST render backed by feed
    data whatever it shows (empty day, another day's rows), so the landing
    can never fire hours later and yank the screen; renders before any
    event-feed data (a scoring response arriving first) leave it armed.
    A deploy-triggered reload restores the previous day + scroll instead
    of landing on now (item 60). (Tests `M50`, `R12c:`, `R1:`.)
51. Floating "now" button hidden while the marker is on-screen or when
    viewing another day; appears with ↑/↓ direction when off-screen;
    click scrolls the marker to ~25% down the viewport.

## N. Misc display

52. Pinny shown bold on each row after the horse name; absent when null.
53. All user-visible strings from the feed are HTML-escaped (rider/horse
    names with `<`, `&`, quotes render literally, no element injection).
54. `isoDay`, `fmtClock` (12-hour, 12 AM/PM correctness), `ordinal`
    helpers behave per examples above.

## O. July 2026 UX/robustness fixes (REVIEW items 1–4, 6–12)

55. Redundant cache writes are skipped: `cachePut` serializes the payload
    once, remembers the last-written string per key in a module variable,
    and returns without touching localStorage when it is unchanged. A
    changed payload writes exactly once with a fresh `at` stamp; a write
    blocked by quota is retried on the next poll (the last-written marker
    is only set after a successful write). (Test `R3:`; also folded into
    item 40.)

56. Rider-found feedback: `extractRides` records the set of followed
    names that matched at least one accepted entry. Status shows
    `M of N riders found` when M < N, plain `Updated H:MM` otherwise
    (item 42); the my-riders sheet annotates unmatched rows, only once a
    feed has loaded: a followed rider whose entries all scratched gets
    the muted status word (`· scratched`), a name with no entries at all
    gets `· no entries found`. The pre-schedule roster (item 83) uses the
    same `no entries found` wording for followed names with no entries.
    (Test `R4:`; items 42/48 updated.)

57. Active-chip visibility: after rendering the day chips, if the active
    chip is not fully visible inside the scrollable chip row, the row's
    `scrollLeft` is adjusted (left or right, minimal movement) so it is.
    Chips are never reordered or collapsed, and window/page scroll is
    never touched by this adjustment. (Test `R10:`.)

58. Prototype-safe lookups: `OVERRIDE_IDX`, `EST_IDX`, `sjTimes`,
    `divName`, `divMeta`, `resultsIdx`, and `scoringByDiv` are built with
    `Object.create(null)`, and the `DELAYS[venue]` config read is guarded
    with `Object.hasOwn` plus a `typeof === "number"` check — so a venue
    or division literally named `constructor`/`toString`/`__proto__`
    yields safe defaults (0 delay, normal join) instead of inherited
    functions, and a typo'd non-number delay value shifts nothing.
    (Test `R11:`.)

59. Fetch timeout + in-flight guard: `fetchEventFeed`, `fetchScoring`,
    and `checkForNewDeploy` each pass `AbortSignal.timeout(10_000)` to
    their fetch (feature-detected — browsers without `AbortSignal.timeout`
    simply skip the timeout, no polyfill) and hold a per-function
    in-flight boolean, so a poll tick that fires while the previous
    request is still pending returns immediately instead of stacking
    another request. A timed-out event fetch surfaces the same
    "can't reach ShowConnect, retrying" note as any other failure. The
    flag is reset in a `finally` block, so a rejected/aborted/timed-out
    fetch can never wedge polling — the next poll fetches again.
    (Test `R7:`.)

60. Deploy-reload state handoff: immediately before the auto-reload,
    `checkForNewDeploy` writes `{at, eventId, selectedDay, scrollY}` to
    sessionStorage key `sc:reloadState`. On startup, a key younger
    than 2 minutes whose `eventId` matches the current event restores
    `selectedDay` before the first render, restores the scroll offset at
    the first render of rows, and sets `initialScrollDone = true` (no
    scroll-to-now landing). The key is consumed (removed) whether fresh or
    stale; stale, absent, or other-event state (item 72) behaves like a
    normal load, including today's now-landing. Pinned popovers are NOT
    restored across reload (data may have changed). (Test `R1:`; item 50
    updated.)

61. Pinned-popover survival across re-render, per item 39's data-key
    rule. (Test `R2:`.)

62. Delay-aware done-line "next:", per item 34's `adjustedTime` rule.
    (Test `R8:`.)

63. Grace windows span midnight, per item 23's midnight nuance.
    Deliberately NOT changed: the default (auto) day chip still flips to
    the new day at midnight (REVIEW 12b). (Test `R12a:`.)

64. Stale one-shot landing, per item 50: the first feed-data-backed
    render consumes the scroll-to-now one-shot even when it shows an
    empty day or another day's rows. (Test `R12c:`.)

65. Guarded feed-string map reads: `OUT_WORDS`, `PHASE_SHORT`,
    `PHASE_PLACE_FIELD`, `PHASE_DONE_FIELD`, and `PHASE_SCORE_FIELD`
    stay plain literals but are read via an `Object.hasOwn` helper
    (`mapGet`), so a `FinalPlace` or phase named
    `constructor`/`toString`/`__proto__` misses the map — a FinalPlace of
    "constructor" yields not-out, and the done line never stringifies an
    inherited function. (Test `R11b:`; extends item 58.)

## P. Multi-event, event picker & sharing (July 2026 refactor)

The single-event page became a multi-event app: the event is chosen by URL
(`?event=<ShowConnectId>`) or via an in-page picker fed by the bare
calendar endpoint; the follow list is per-event and shareable via URL.
Group-K items 45–48, items 7/40/42/60 and the testability notes were
updated in place for the same refactor.

66. URL scheme & boot routing: `?event=<id>` loads that event (writing
    `sc:last-event` only once its feed actually loads — item 82); a bare
    URL auto-loads `sc:last-event` when present
    (with `history.replaceState` upgrading the URL to the canonical
    `?event=<id>`), else shows the picker; `?choose` always shows the
    picker, even with a last-event stored; an invalid `?event` value
    (non-numeric, or numeric longer than 9 digits — parseInt would
    round-trip it as exponent notation) falls back to the picker. In picker mode the app chrome
    (header/main/footer) is hidden, the picker shown, and the title reads
    "Choose an event — Ride Times"; in event mode the reverse. The
    header's "switch event" control navigates to `?choose`.
67. Picker sections from the calendar payload, by `CalendarPosition`:
    "Happening now" (1), "Upcoming" (2), "Recent" (3, capped at 15 unless
    searching — the rest reachable via search); empty sections are
    omitted; calendar order is preserved within a section. Each row
    carries the event name, `date · location` meta, and an "entries not
    published yet" note when `PublishEntryList` is false (still
    selectable).
68. Picker filter: case-insensitive substring match against event name OR
    location, across all sections (sections without hits vanish);
    "No events match." when nothing hits; clearing restores the full
    list.
69. Clicking a picker row performs a full navigation to `?event=<id>`
    (clean state, working back button) and lands in the event view.
70. Manual entry accepts a bare numeric ShowConnectId or a pasted
    showconnect.org URL containing `ShowConnectId=NNN` (case-insensitive),
    both bounded to 9 digits (item 66) — and, since Oct 2026, a snapshot
    id `ee:<key>` or an evententries show-center link (item 94) — via
    the Go button or Enter;
    invalid input shows an inline error and
    stays on the picker; a subsequent valid entry navigates.
71. Calendar caching: `sc:calendar` holds `{at, value}` with a 6 h TTL. A
    fresh cache renders without refetching; a stale cache renders
    immediately while revalidating — and while fully offline, with a
    "showing a saved list" note; total failure with no cache shows an
    error note and leaves manual entry usable. Degenerate payloads (null,
    non-array, entries missing/mistyped fields) sanitize to a clean list
    (`sanitizeCalendar`) without throwing, and a degenerate response never
    clobbers a previously-good list or its cache.
72. Per-event storage isolation: the follow list lives at
    `sc:<id>:riders` — riders stored for one event never appear for
    another, and edits write only the current event's key. After a
    successful feed fetch, other events' `sc:<other>:event` /
    `sc:<other>:scoring` caches are evicted (quota hygiene); every event's
    `:riders` list is kept. `sc:reloadState` carries the `eventId` and is
    restored only when it matches the current event (consumed either
    way).
73. Legacy migration at boot: when loading event 1187 with no
    `sc:1187:riders` stored, a legacy `rf2026:myRiders` array seeds it
    (string entries only; an existing store wins; other events never
    import it). Legacy `rf2026:event` / `rf2026:scoring` blobs are
    deleted at boot to free quota.
74. Event identity: `#event-name` and `document.title`
    (`"<name> — Ride Times"`) come from `EventDetails.EventName` once the
    feed loads; before that, the calendar cache's name for the event is
    used; with neither, the neutral "Ride Times" default. The footer
    reads `Times are event-local (<short zone>). Tap a ride for details.`
    with the derived zone's short name (MDT for the Montana fixtures).
75. Timezone derivation: `deriveTz` scans comma-separated segments
    last-to-first across the feed's address/location strings (and the
    calendar entry's location) for a trailing US state name — tolerating
    trailing zips and D.C. punctuation, case-insensitively — and maps it
    to the state's primary IANA zone (Montana→America/Denver,
    Washington→America/Los_Angeles, …); unknown yields null and `eventTz`
    stays the device zone. The derived zone drives `eventLocalNow` and
    all clock displays.
76. Empty follow state: with nobody followed, the main list shows a
    prompt ("No riders followed yet…") with an "Add riders to follow"
    button opening the rider sheet — no day chips, no delay banner — and
    the status line reads `Updated H:MM · no riders followed yet` (the
    shared item-42 wording, so data older than 2 min shows the
    `Showing data from …` form instead); adding the first rider
    immediately (no reload) swaps the prompt for the timeline — or for
    the pre-schedule roster (item 83) when no ride times are posted yet —
    and updates the status line and header count; removing the last rider
    swaps back to the prompt with the adapted status.
77. `buildShareUrl()` =
    `origin + pathname + "?event=<id>&riders=" +
    encodeURIComponent(names.join("|"))` — names with commas/spaces
    survive an encode/decode round-trip verbatim.
78. Share row in the rider sheet: hidden with 0 riders, shown with ≥1.
    Fallbacks always present: an `sms:?&body=<encoded url>` "Text it"
    link and a Copy-link button (clipboard write + transient "copied"
    tag); the native Share button appears only when `navigator.share`
    exists and shares `{title: "<event> — riders", url}`. The header
    also carries a one-tap `#share-page` control on the main page
    (hidden with 0 riders, and in picker mode with the header): native
    share sheet when available, else clipboard copy with a transient
    "copied" tag, else a prompt() — the richer options stay in the
    sheet.
79. Receiving `?riders=` with an empty stored list adopts the shared
    names silently (persisted to `sc:<id>:riders`, rows render); a shared
    list identical (as a set) to the stored one shows no banner. Names
    are taken verbatim — never trimmed (the feed ships strings with stray
    whitespace and follow matching is exact) — with whitespace-only
    entries and duplicates dropped. A riders param WITHOUT an explicit
    `?event` (truncated/hand-edited link) is ignored outright — nothing
    adopts into the last-viewed event. Every path — including a plain
    `?event=` load — ends with `history.replaceState` cleaning the URL to
    `?event=<id>`.
80. Receiving `?riders=` with a differing stored list shows the banner
    "This link shares N rider(s) for this event" (store untouched, URL
    uncleaned while pending): "Add to mine" appends the new names deduped,
    "Replace mine" overwrites, "Ignore" keeps the store; every choice
    hides the banner, cleans the URL, and re-filters the timeline.
81. Shared names not found in the feed behave exactly like any ghost
    follow: counted in "M of N riders found" and flagged
    `· no entries found` in the sheet (items 42/48/56).
82. Unknown event id: the real API answers 200 + a JSON `null` body for
    an id that doesn't exist — that, and an HTTP 404, both show
    "event not found — check the id or switch event" instead of the
    retry note; a plain network failure still shows
    "can't reach ShowConnect, retrying". `sc:last-event` is written only
    after a successful feed load, so a typo'd or dead id never becomes
    the bare-URL resume target. Feed caches for other events are evicted
    BEFORE the current event's cache is written, so a quota-full first
    visit succeeds on its first fetch.

## Q. Pre-event UX (Aug 2026)

Before an event's schedule posts, the real feed has hundreds of entries
whose `RidingDetails[].RideTimes` are all `""` and `PinnyNumber` all null,
so `extractRides()` yields zero rides and there are no day chips. The page
previously looked stuck ("Loading…"/stale status + a bare "No scheduled
rides yet" line); these items make the pre-event state first-class.

83. Pre-schedule roster: when riders are followed, a feed has loaded
    (`lastFeed` set — fetched OR hydrated from cache, e.g. fully offline),
    and `rides.length === 0`, the main list shows, instead of the bare
    "No scheduled rides yet…" line:
    - a muted lead-in (`.pre-note.lead-in`): "Ride times aren't posted
      yet — they'll appear here automatically once ShowConnect publishes
      the schedule.";
    - when `EventDetails.OfficeComment` is a non-empty string, a muted
      `Event notes: <comment>` line (`.pre-note.office-note`), escaped —
      it is untrusted feed prose; absent when empty/missing/non-string;
    - one card (`.row.roster`) per `lastFeed.EntryList` entry whose
      `RiderName` is in the followed list (verbatim match, ANY Status),
      in stored-list order then feed order for a rider's multiple horses:
      rider name, horse, division short name + full name, bold `#pinny`
      only when non-null, and for `Status !== "Accepted"` a lowercased
      `· <status>` annotation with the row dimmed via the existing `.out`
      class;
    - a dimmed `no entries found` row (same wording as the sheet
      annotation, item 56) for each followed name with no entries at all.
    No day chips render (no ride days), roster cards are not interactive
    (no popovers/pins), and all feed strings go through `esc()`. The
    "No rides on this day for the followed riders." message (rides exist,
    selected day empty) and the nobody-followed prompt (item 76) are
    unchanged; with no feed at all the old "No scheduled rides yet for
    the followed riders." line still shows. A later poll that delivers
    ride times replaces the roster with the normal timeline.
84. Status/controls update on EVERY render path (the pre-event "stuck"
    regression): the `dayRides.length === 0` early return previously
    skipped the status-line block, leaving `#status` showing the static
    "Loading…" on a fresh pre-event load or a stale
    "no riders followed yet" right after adding the first rider.
    `updateStatusLine()` (shared item-42 wording) and `updateNowBtn()`
    now run on all branches of `render()`, and the header `#edit-riders`
    control shows the live follow count — `＋ my riders (N)`, plain
    `＋ my riders` at zero (and in picker mode, where the header is
    hidden) — updated in `render()`, which every follow-list mutation
    (sheet add/remove, share adoption, storage edits) already flows
    through.
85. Roster cards tap-to-pin a detail popover (same pattern and pin
    survival as timeline rows — one pinned at a time, re-applied by
    `data-key` across poll re-renders, `roster|<EntryListId>`): division
    full name with its accepted-entry count ("(19 entered)"), a Status
    row for non-accepted entries, ring assignments from any
    `RidingDetails[].Venues[0].venue` already set pre-times ("Dressage
    R4 · XC DXC · SJ SJR3", PHASE_SHORT labels), "Stabling with" from
    `stableWith` when non-empty, pinny when assigned, and a closing
    "Ride times not posted yet" note. Payment/deficiency fields
    (`Balance`, `EntryNote`, `requirementCheck`…) are deliberately never
    shown. Ghost ("no entries found") rows carry no popover and keep the
    default cursor. All feed strings escaped.

## R. Round view (division progress) (Aug 2026)

Watching one rider, the round itself is the missing context: earlier
riders' scores post long before yours does, and "6 of 17 posted, through
10:36" answers both "how far along is the round" and "who's leading" (each
posted row carries its place). Opened per ride — division + phase — from
the popover; the sheet reuses the my-riders bottom-sheet pattern.

86. Ride popovers for scored phases (Dressage/XC/SJ — the
    `PHASE_DONE_FIELD` keys) carry a "view <PHASE_SHORT> round →" link;
    Phases A/B/C rows and roster (item 85) popovers don't. The link opens
    the round sheet (`#round-sheet`) titled with the full division name;
    ✕, backdrop tap, and Escape all close it (Escape also still unpins
    popovers — both happen on one press). Clicking the link doesn't
    unpin the row behind it (it's inside `.pop`); clicks elsewhere inside
    the sheet do, via the existing outside-a-row dismiss — harmless, the
    sheet covers the popover.
87. Timed-phase round (Dressage/XC — and SJ divisions with individual
    times, i.e. not in `sjBlockDivs`): one `.qrow` per Accepted entry of
    the division, sorted by effective ride time — same override/delay
    rules as timeline rows (`OVERRIDE_IDX`, venue delays on
    `DELAY_DATE`), entries without a parseable time last, pinny
    tiebreak. Each row: time, rider, horse, `#pinny` when assigned, and
    the phase score + (place) via `resCell` as posted (tie "T" marker
    from `tiedAt`, em-dash while pending). Out combos (`OUT_WORDS` on
    `FinalPlace`) keep their slot, dimmed (`.out`), with the status word
    as the result cell unless this phase's score posted before it
    happened. Followed riders' rows highlight (`.mine`). Scratched
    entries and other divisions never appear; all feed strings escaped.
    The sub line reads "<PHASE_SHORT> · N of M scores posted" (M counts
    still-competing combos only) plus "· through <time>" — the latest
    posted slot, a high-water mark, since scores can post out of order —
    while partial; "· all M scores posted" when complete.
88. SJ block divisions (shared block-start time, `sjBlockDivs`): rows
    sort in reverse order of current standing (order of go —
    `autoEstimate`'s model), still-to-jump combos showing their "~slot"
    estimate (reusing `autoEstimate`) as the time cell; posted and out
    rows show no time (the shared block start on every row is noise);
    outs sort to the end, dimmed. No "through" clause — block phases
    have no per-rider schedule to measure against.
89. An open round sheet is live: every `render()` path calls
    `renderRoundSheet()` (a no-op while closed), so a scoring poll that
    delivers new scores updates the progress line and result cells in
    place — including the early-return render branches (empty day,
    roster, nobody followed).
90. Sort toggle ("running order" / "placing" pills between the progress
    line and the rows; running order is the default and marked active):
    "placing" re-sorts to the leaderboard (item 91's cumulative-score
    merge — on a finished round that equals ascending place, since the
    places rank exactly those scores); combos with no score at all
    follow in running order, outs last; rows keep their own
    time/estimate cells. Applies to timed and SJ-block rounds alike.
    The choice is a page-lifetime preference: it survives live
    re-renders and close/reopen (any division), but is not persisted to
    storage — a reload is back to running order.
91. Carried scores. Scoring is cumulative: each phase score field is the
    running total after that phase (verified live — a clean XC leaves
    the number unchanged) and `FinalPoints` is the total through a
    combo's completed phases. A round row whose phase score isn't posted
    but whose `FinalPoints` is numeric shows it grayed (`.carried`)
    instead of the pending em-dash — the score carried into the phase,
    i.e. where a clean ride ends up. Before the first phase
    `FinalPoints` is `--` (NaN), so a dressage round keeps the em-dash.
    The "placing" sort merges combos by cumulative score after the
    phase — actual when posted, carried when pending, posted first on a
    tie — so mid-round it reads as the provisional leaderboard with
    pending combos slotted where a clean ride would land them. Out
    combos still show their status word, never a carried score.
92. Placing-view rank column: in the "placing" sort every scored row
    (posted or carried) shows its provisional standing in the left
    column — ranked over the merged cumulative scores, equal scores
    sharing a "T" rank — accent-colored for posted rows, gray (`.prov`)
    for carried ones; the ride time / slot estimate drops to a small
    `.qsub` line beneath. The rank deliberately is NOT the feed's phase
    place: mid-round that counts finishers only, so a posted "1st"
    can rightly sit 9th on the merged board — hence the score cell also
    drops its "(place)" parens in this view (score alone), avoiding two
    contradictory numbers on one row. Rows with no score and out rows
    keep a bare time cell. Running-order view is unchanged.
93. Riders followed at other events float to the top of the rider sheet.
    Names from every other event's `sc:<id>:riders` list (never the
    current event's) that have ≥1 accepted entry in this feed lead the
    browse list under a "FOLLOWED AT OTHER EVENTS" header (alphabetical,
    same row format and Add/Remove as the A–Z list), and are left out of
    the A–Z groups below — no duplicate rows. The filter box narrows both
    parts; the header disappears when no past-followed rider matches.
    Scratched-only riders and names not in this feed stay out of the
    section. Read-only: other events' lists are never modified, and
    nothing is auto-followed.

## S. Snapshot events (evententries order of go) (Oct 2026)

Some shows (e.g. Galway Downs) run entries and live scoring on
evententries.com, whose show centers have no public API, no CORS, and
Terms of Use that forbid systematic retrieval. For those, a maintainer
pastes the show center's "Order of Go" text once and commits it as
`snapshots/ee-<key>.json`, AES-GCM encrypted under a random link token
(`tools/snapshot-encrypt.js`). The page decrypts it in the browser and
parses it into the ShowConnect feed shape, so everything downstream of
`extractRides` is unchanged; there is no scoring feed. Tests build their
own encrypted fixture from a synthetic order of go and serve it from the
local test server (`server.setFile`) — the committed snapshot is never read.

94. Event id scheme: `?event=ee:<key>` (key = 1–40 url-safe chars
    `[A-Za-z0-9_-]`) is an event view with `EVENT_URL`/`SCORING_URL`
    null and `SNAPSHOT_URL = snapshots/ee-<key>.json`; `ee:`, keys with
    spaces/dots, or >40 chars fall to the picker like any invalid id.
    `sc:last-event` is written as `"ee:<key>"` only after a successful
    load, and a bare URL resumes it. `parseManualEvent` accepts `ee:<key>`
    and a pasted `https://evententries.com/#ShowCenter<key>` link.
95. Link token: `&k=<token>` (8–64 url-safe chars) is stored at
    `sc:ee:<key>:k`; the URL canonicalizes to `?event=ee:<key>&k=<token>`
    (the token stays in the address bar so copying it works); a bare
    `?event=ee:<key>` reuses the stored token; `buildShareUrl()` carries
    `&k=<token>` before `&riders=`; a received `?riders=` link with the
    token adopts/merges exactly as P79–P80.
96. `parseOrderOfGo(text, startDate, details)` grammar (one table cell
    per line, or tab-separated rows): a `Judge(s):` line closes a section
    header whose title is the previous line and whose ring is the line
    before that when present — consecutive sections in one ring inherit
    it; column-header words (Pinney/GoTime/Rider/Horse/Division) are
    ignored; `<time> Break` rows are skipped (counted in `stats.breaks`);
    rows without a pinny (`Test Ride`) are skipped (`stats.skipped`);
    one `EntryList` item per pinny with `Status: "Accepted"`,
    `Division = DivisionShortName =` the printed code, and one
    `RidingDetails` row per phase carrying the ring as `Venues[0].venue`;
    the same combo+phase listed twice keeps the later row; empty, null
    or garbage text returns an empty `EntryList` without throwing.
97. Times: `<HH:MM AM|PM> <Mon..Sun>` resolves to the first such weekday
    on/after `startDate` (wrapping past the start weekday), 12:00 AM/PM
    handled, and is emitted as a ShowConnect-format `RideTimes` string
    (`"Thu, Oct 29, 2026, 12:00:00 PM"`) so `parseRideTime` serves both
    sources. Phase from the section title: "Cross Country …" → Cross
    Country, "Show Jumping …"/"Stadium …" → Show Jumping, anything else
    (dressage test names) → Dressage.
98. Happy path: `fetchSnapshot` reads the file with `cache: "no-store"`,
    decrypts with the stored token, parses, and takes the normal feed
    tail (rider index, rides, `lastUpdatedMs`, event name/title from the
    snapshot's `name`, `eventTz` derived from its `state` via
    `deriveTz`, cache write, `sc:last-event`). Footer appends the
    provenance ("Schedule: evententries order of go captured …; results
    not loaded — nothing here is live"). Results stay empty ("Not posted
    yet") until a scores snapshot (S102–S108) loads, no ShowConnect
    request is ever made, and the file is re-read every
    `SNAPSHOT_POLL_MS` (a re-published order of go lands by commit).
99. Cache: the parsed feed (with its `snapshot` meta) is cached at
    `sc:ee:<key>:event` and hydrates a reload that cannot reach the file
    (rows + footer note from cache, "can't load the schedule, retrying"
    in the status line).
100. Error paths in the status line: no token → "needs the key from the
    link you were sent"; wrong token (GCM auth failure) → "the key in this
    link doesn't open this schedule"; 404/non-JSON → "schedule not
    published yet"; no WebCrypto (insecure context) → "open this page over
    https"; other failures → retry note. None writes `sc:last-event`, and
    the page stays usable (add-riders prompt, no page error).
101. Storage isolation: `pastFollowedNames` and `evictOtherEventCaches`
    match both `sc:<digits>:…` and `sc:ee:<key>:…` keys — other events'
    `:event`/`:scoring` blobs are evicted whatever their id shape, every
    `:riders` list and `:k` token is kept.

### Scores snapshot (evententries Live Scores board)

An optional second file, `snapshots/ee-<key>-scores.json`, encrypted under
the same token (`tools/snapshot-encrypt.js --scores --token <token>`),
holds a pasted copy of the show's evententries "Live Scores" page. It is
re-pasted by hand whenever fresher results are wanted — never fetched
from their site by the page or by a script. Tests build synthetic boards
(invented names) and serve both files with `server.setFile`.

102. `parseScoreboard(text, feed)` grammar (one cell per line, or
    tab-separated): page chrome before the first board is ignored. A
    division header is a name-like line carrying a valid division code
    whose judge line with names (`Judge: …` / `Jdg @ M: …, …`) follows
    directly or one line later (item 113); the column tokens that follow
    (`#`, `Rider`, `Horse`, 0–3 × `Jdg @ X`, `Dress`, `Score`, `To
    Date`, `Place`, `XC`, `Jump`, `Elapsed`, `Time`, `Stad`, `Pen`,
    `Final`) never read as headers (no colon). The division code is the
    first `(…)` group that runs straight into the event name ("Open
    Novice (OP)The Eventing…"; "… (OT CHAMPS) (M/T-CH)The …" → `M/T-CH`),
    else the last group; it is valid only if the order-of-go feed knows
    that division (or, with no feed, if it is code-shaped: no spaces,
    ≤14 chars), so a board for an unknown division is ignored when a feed
    is loaded. Rows are pinny / rider ("First Last (USA)",
    country optional) / horse / only the posted cells (blanks are dropped
    from the copy). With a feed, a row starts only at an integer that is
    a pinny in THIS board's division (so a place cell before the next
    header, ad copy after a number, and a pinny from another division are
    not rows, and a horse named like a code — "PJ" — is admitted); without
    a feed the shape heuristic (integer + two name-like lines) decides.
    Pinny-less `Test Ride` rows and unrecognized lines are counted in
    `stats.skipped` with up to 10 `stats.skippedSamples`. Output mirrors
    scoringLive: `DivisionsList[{DivisionId, DivisionName (= the code,
    which is the order-of-go feed's `Division`), PhaseOrder}]` and
    `ScoringList[{Pinny, DivisionId, RiderName, HorseName, …fields}]`;
    empty or garbage text yields empty lists without throwing.
103. `scoreboardCells(cells, judges)`: the first `judges` cells are judge
    marks, then `DressageScore`, `DressagePlace`; the XC block is anchored
    on the `XC Elapsed` cell (`m:ss`) — `XCScore`/`XCPlace` are the two
    cells after `XC Time`, whether or not a leading `XC Jump` cell was
    posted — or, with no elapsed cell but ≥ J+7 cells, positional; the
    stadium block is whatever follows and its last two cells are
    `SJScore`/`SJPlace`. `FinalPoints`/`FinalPlace` fall through SJ → XC →
    dressage. An out code (`E`, `R`, `W`, `RF`, …) anywhere becomes
    `FinalPlace` and the place of the phase it sits in (after the XC
    block → SJ, after dressage → XC, else dressage); cells after it are
    ignored. Missing values are `"--"` (parse to NaN like scoringLive).
    Known unknown: the XC/SJ cell layout is inferred from the column names
    and unverified until those phases post.
104. `phaseOrderFromFeed(feed)`: per division, phases ordered by their
    earliest ride time (`d`/`xc`/`sj`), with phases not yet in the order
    of go appended in the usual order (SJ posts after XC: "d-xc" →
    "d-xc-sj"; a d-sj-xc division stays d-sj-xc) so a division is never
    "complete" before its last phase is scheduled; with no feed, boards
    default to `d-xc-sj` in `DivisionsList` (with a feed, a board for an
    unknown division is not a header at all — item 102).
105. Happy path: `fetchScoresSnapshot` (after the schedule, and on the
    `SNAPSHOT_POLL_MS` cadence) reads the file with `cache: "no-store"`,
    decrypts with the stored token, parses against `lastFeed`, rebuilds
    `resultsIdx`, caches, and re-renders: ride popovers show the per-phase
    and Overall result rows, the round sheet shows places and "all N
    scores posted", and the footer says "results captured <capturedAt>".
    Live-scores link: `liveScoresUrl(division)` is the schedule snapshot's
    `links[code]` if present, else its `scoresUrl`, and only if http(s);
    rendered as `live scores ↗` (new tab, `rel=noopener`) after the
    popover's round button and in the round sheet's progress line; absent
    when neither applies or the value is not http(s).
106. Cache: the parsed board (with `snapshot: {capturedAt}`) is cached at
    `sc:ee:<key>:scoring` and hydrates a reload that cannot reach the
    files (`resultsIdx`, `scoresMeta`, footer).
107. Absent/unreadable: a 404 (not published), a non-JSON body, a file
    under another token or a bad shape are ignored silently — results
    stay "Not posted yet", the footer says "results not loaded", nothing
    is cached, no status-line error, no page error.
108. Tool: `encryptSnapshot({ kind: "scores" })` requires the schedule's
    token and writes `{kind, capturedAt, text}` (`--scores` → `ee-<key>-
    scores.json`, `--decrypt --scores` reads it); a schedule snapshot
    carries `scoresUrl` (`--scores-url`) and `links` (`--links <json>`,
    `{}` when absent).

### General schedule (evententries General Schedule tab)

The schedule snapshot may also carry the show center's "General Schedule"
tab (`--schedule <file>`, plaintext field `schedule`): per division and
phase, the ring and the time block. It fills phases the order of go has
no rider rows for yet — show jumping, published after cross-country —
with the division's block start, which is exactly the shared-block-start
shape ShowConnect publishes for SJ, so `sjBlockDivs`, the
reverse-of-standing round order and `autoEstimate` slot estimates apply
unchanged. Tests use small synthetic pastes (invented names).

109. `parseGeneralSchedule(text, startDate, hints)` grammar (one cell per
    line or tab-separated): column header tokens (`Date`, `Ring`, `Time`,
    `Division`, `Classification`, `Judge(s)`) are ignored; a date line
    (`Thu, 10/29`) sets the day (year from `startDate`, rolling into the
    next year when the month precedes the start month); a block is a
    range line (`09:30-10:22`) followed by the division code and the
    classification (`Dressage` / `Cross Country` / `Stadium` → Show
    Jumping, via `oogPhase`); blocks before any date line are dropped.
    Times carry no AM/PM: `gsHour24` reads hours 1–6 as PM, 7–11 as AM,
    12 as noon (so `11:20-02:04` spans noon); an end before its start is
    clamped to the start. Every other line is bare text — a judge or a
    ring: with `hints.judges` (from the order of go) a judge line is
    skipped and any other bare line sets the ring; without judge hints a
    line is a ring only if it is in `hints.venues` or starts with `SJ` /
    `XC`, else ignored. Rings carry across blocks until the next ring
    line. Empty, null or garbage input yields `[]`, never a throw.
110. `parseOrderOfGo` also returns `judges` (names from every `Judge(s):`
    line, role tags like `(C)` stripped, de-duplicated) and `venues` (the
    ring headings seen). `applyGeneralSchedule(feed, blocks)` appends, to
    every entry of a block's division, a `RidingDetails` row for each
    phase the entry has NO row for — `{Phase, Venues: [{venue: ring}],
    RideTimes: <block start>, BlockEnd: <block end>, Block: true}`, both
    times in the ShowConnect `RideTimes` format so `parseRideTime` reads
    them — and returns the count. Existing rows (individually timed
    phases) are never touched; applying twice adds nothing; no blocks /
    no feed are no-ops.
111. End to end (`fetchSnapshot` applies the schedule when the plaintext
    carries one; an empty `schedule` leaves the feed as the order of go):
    filled rows render on their day (a Sunday chip appears), the popover
    time row reads `10:26 AM–10:52 AM (division block) · <ring>`
    (`extractRides` carries `blockEnd` for `Block` rows; individually
    timed rows show a plain time), a division whose entries now share
    one SJ time lands in `sjBlockDivs` (a single-entry division does not —
    the >1-identical-times rule stands; neither does one with individual
    SJ rows), and once a scores snapshot gives placings the SJ round
    sheet runs in reverse of standing with `~` slot estimates and the
    timeline row shows `est. slot ~H:MM · Nth of M to jump, by standing`.
112. Tool: `encryptSnapshot({ schedule })` stores the General Schedule
    text as `schedule` in the schedule plaintext (`""` when absent; a
    scores snapshot never carries one); `--schedule <file>` on the CLI.

### Fetch tool and the browser-rendered board (`tools/snapshot-fetch.js`)

`tools/snapshot-fetch.js` is the copy-paste step done by a headless
browser, run by hand: it loads the show center's "Order of Go" and
"General Schedule" tabs and the Live Scores page once, saves their
`innerText`, and optionally encrypts (`--publish`) and commits
(`--push`). It is never run on a timer or in CI (Terms of Use); tests
exercise only its pure helpers and never launch a browser or touch the
network.

113. Browser-rendered board form: a page's `innerText` puts the event
    name on its own line under the division line ("CCI Four Star - L
    (CCI4-L)" / "The Eventing Championships at Galway Downs(Oct. 2026)" /
    "Jdg @ M: …"), pads cells with blank or tab-only lines, and renders a
    tied place as "4-T" (or "4T"). `parseScoreboard` accepts the judge
    line directly after the header or one line later, and parses the
    split form to the same `DivisionsList`/`ScoringList` as the glued
    (hand-copied) form. The line BEFORE a header — the "Results are not
    final…" banner, a zero-score row's horse — and the event-name line
    (its paren group "Oct. 2026" is not a known division, nor
    code-shaped) are never taken as the header, with or without a feed.
    Tie cells are cells (`SB_TIE_RE`/`SB_CELL_RE`), normalized to the
    bare place in `scoreboardCells` ("2-T" → "2"; a tie followed by more
    cells keeps its XC block; a tie in the final pair stays numeric, never
    an out code); ties are re-derived downstream from equal places
    (`tiedAt` → "T2nd" in the popover and round sheet). Blank and
    tab-only lines are ignored.
114. Fetch-tool helpers: `fromLine(text, re)` returns the text from the
    first line matching `re` onward (page chrome dropped; CRLF
    normalized; whole text when nothing matches; trailing newline);
    `parseArgs` reads `--flag value` pairs and the bare `--publish` /
    `--push` / `--force` switches; `spacingGuard(files, force)` throws
    when the newest existing output file is younger than 10 minutes
    (`MIN_SPACING_MS`) unless forced, and passes on a first run or when
    every file is older.
115. The tool exports `{ parseArgs, fromLine, spacingGuard,
    MIN_SPACING_MS }` and runs its CLI only under `require.main ===
    module`, so requiring it from the suite has no side effects.
