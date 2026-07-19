# Rider Tracker — Tracked Behaviors & Test Plan

Every behavior, gotcha, and fix tracked during development of `index.html`.
Each numbered item should be covered by a unit test (calling the page's
top-level functions directly in a browser context) or a functional test
(rendering the page against fixture feeds with a pinned clock).

## Testability notes

- `index.html` is a single classic-script page: all functions and state
  (`parseRideTime`, `extractRides`, `render`, `rides`, `resultsIdx`,
  `DELAYS`, `OVERRIDES`, `ESTIMATES`, etc.) are reachable from
  `page.evaluate` in Playwright (chromium at `/opt/pw-browsers/chromium`,
  via `playwright-core`; do NOT run `playwright install`).
- Stub both API endpoints with `page.route` fixtures:
  `**/api/sc/event/1187` and `**/api/sc/event/1187/scoringLive`.
- Pin time by overriding `eventLocalNow` (and `Date.now` where staleness
  logic is tested) via `page.evaluate` / `addInitScript`, then calling
  `render()`. Fixture data uses fixed July 2026 dates, so tests must never
  depend on the real clock.
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
7. `eventLocalNow` returns Mountain-time wall clock regardless of the
   host timezone (test with TZ=UTC and TZ=Asia/Tokyo contexts).
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
    (`rf2026:event`, `rf2026:scoring`) with a timestamp; on load the page
    hydrates and renders from cache before any network response. A fetch
    whose serialized payload is identical to the last-written one skips
    the localStorage write entirely (the blob and its `at` stamp only
    change when content changes); `lastUpdatedMs` still refreshes on
    every successful event fetch.
41. With all network blocked and a warm cache, reload still renders rows
    and results; error note "can't reach ShowConnect, retrying" appears.
42. Status line: fresh data → `Updated H:MM · N riders followed` when
    every followed name matched at least one accepted entry in the feed,
    or `Updated H:MM · M of N riders found` when only M of the N did;
    data older than 2 min → `Showing data from H:MM (N min old)` (hours
    form past 60 min).
43. Fetch failures never clear previously-rendered data (fail-soft);
    scoring failures are silent.
44. Deploy watcher: identical self-fetch → no reload; changed bytes →
    reload; first fetch just sets the baseline; no-op on `file://`.

## K. Per-browser follow list ("my riders")

45. `effectiveFollowing()` = (FOLLOWING − hidden) ∪ personal adds;
    with empty storage the page behaves exactly as baked (byte-identical
    rendering assertion on rows + status count).
46. Sheet lists the effective follow list with Remove on every rider;
    removing a baked rider stores it in `rf2026:hiddenRiders` (not
    deleting from mine); removing a personal add deletes it from
    `rf2026:myRiders`.
47. Search (≥2 chars, case-insensitive substring, top 20, built from
    accepted entries only) shows Add for unfollowed, Remove for followed;
    Add on a hidden baked rider un-hides instead of duplicating into
    personal adds.
48. "Removed: ... · restore" note appears when hides exist; restore
    clears all hides. Personal state persists across reload; a fresh
    browser context sees only the baked list. Follower count in status
    reflects the effective set (worded per item 42's found/followed
    rule). Once a feed has loaded, sheet rows for followed names that
    matched no accepted entry carry a muted `· no entries found` note.

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
    to unmatched rows, only once a feed has loaded. (Test `R4:`; items
    42/48 updated.)

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
    `checkForNewDeploy` writes `{at, selectedDay, scrollY}` to
    sessionStorage key `rf2026:reloadState`. On startup, a key younger
    than 2 minutes restores `selectedDay` before the first render,
    restores the scroll offset at the first render of rows, and sets
    `initialScrollDone = true` (no scroll-to-now landing). The key is
    consumed (removed) whether fresh or stale; stale or absent state
    behaves like a normal load, including today's now-landing. Pinned
    popovers are NOT restored across reload (data may have changed).
    (Test `R1:`; item 50 updated.)

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
