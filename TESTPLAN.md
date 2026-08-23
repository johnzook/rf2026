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
    unpin. A pinned popover survives re-render: ride rows carry a stable
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
47. Search (≥2 chars, case-insensitive substring, top 20, built from
    accepted entries only) shows Add for unfollowed, Remove for followed;
    Add appends the name once (already-present names are never
    duplicated).
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
    `M of N riders found` when M < N, plain `N riders followed`
    otherwise; the my-riders sheet appends a muted `· no entries found`
    to unmatched rows, only once a feed has loaded. The pre-schedule
    roster (item 83) uses the same `no entries found` wording for
    followed names with no entries. (Test `R4:`; items 42/48 updated.)

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
    both bounded to 9 digits (item 66), via the Go button or Enter;
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
    exists and shares `{title: "<event> — riders", url}`.
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
