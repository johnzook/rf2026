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

9. One chip per day having followed rides, in date order; "Today" label
   for the current event-local date.
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
    10 min grace; row is `past` only after that.
24. Countdown text: `in N min` (<60), `in H h M min` (>=60), `underway`
    when listed time has passed but not activeUntil.
25. "Next up" tag on the first non-past, non-out row; label reads
    "Next up" before the listed time and "Now" once underway.
26. `soon` highlight within 30 min, never on out rows, never on next-up
    (CSS gives next-up precedence).
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
    slot — skips intermediate phases that already ran); uses
    override-adjusted times; weekday label included only when the next
    ride is not today; phase abbreviated XC/SJ.
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
    unpin.

## J. Persistence & network

40. Successful event/scoring fetches cache payloads to localStorage
    (`rf2026:event`, `rf2026:scoring`) with a timestamp; on load the page
    hydrates and renders from cache before any network response.
41. With all network blocked and a warm cache, reload still renders rows
    and results; error note "can't reach ShowConnect, retrying" appears.
42. Status line: fresh data → `Updated H:MM · N riders followed`; data
    older than 2 min → `Showing data from H:MM (N min old)` (hours form
    past 60 min).
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
    reflects the effective set.

## L. Extras (course walks etc.)

49. `EXTRAS` items render on their date's chip only, sorted into the
    timeline by time, dashed style, no popover, no pinny; countdown and
    next-up participation like rides; nothing shown once past.

## M. Scroll behavior

50. First render of today's list scrolls the now-line to viewport center,
    exactly once per page load; re-renders and day switches never move
    scroll.
51. Floating "now" button hidden while the marker is on-screen or when
    viewing another day; appears with ↑/↓ direction when off-screen;
    click scrolls the marker to ~25% down the viewport.

## N. Misc display

52. Pinny shown bold on each row after the horse name; absent when null.
53. All user-visible strings from the feed are HTML-escaped (rider/horse
    names with `<`, `&`, quotes render literally, no element injection).
54. `isoDay`, `fmtClock` (12-hour, 12 AM/PM correctness), `ordinal`
    helpers behave per examples above.
