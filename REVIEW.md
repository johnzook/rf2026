# UX / design review — potential rough edges

Findings from a bug-hunt and review pass (July 2026). Each was a product
call for the owner; items marked FIXED have since been approved and
implemented (see the `Resolved:` note and the referenced `R*:` tests).
Genuine defects found in the original pass were fixed directly and are
covered by `BUG-*` tests in `tests/robustness.test.js`.

## 1. ~~Deploy auto-reload throws away UI state~~ FIXED

Resolved: `checkForNewDeploy` stashes `{at, selectedDay, scrollY}` in
sessionStorage (`rf2026:reloadState`) immediately before `location.reload()`.
On startup a fresh (<2 min) key restores the selected day before the first
render, restores scroll at the first render of rows, and suppresses the
one-time scroll-to-now landing; the key is consumed either way, and normal
loads are unchanged. Pinned popovers are deliberately not restored across a
reload (the deployed data may have changed). Covered by test `R1:`
(TESTPLAN 50/60).

### Original note

**Today:** `checkForNewDeploy` calls `location.reload()` within a minute of
any byte change to the page — while someone may be mid-scroll, on a
non-default day chip, with a popover pinned, or typing in the my-riders
search sheet. Reload resets all of it (selected day and scroll position are
in-memory only).

**Why it's poor:** a delay-table edit pushed from home yanks the phone user
back to the top of "today" and closes whatever they were reading, with no
warning. On a weather day (exactly when deploys happen) this hits everyone
at once.

**Direction:** persist `selectedDay` + scroll offset in `sessionStorage`
and restore after reload; or defer the reload until the tab is hidden /
idle; or swap in the new data without a full reload.

## 2. ~~Pinned popover closes on every poll (up to every 20 s)~~ FIXED

Resolved: ride rows now carry a stable `data-key` (pinny|phase|dayKey);
`render()` captures the pinned row's key before rebuilding `#list` and
re-applies `.pinned` to the matching row afterwards. A row that no longer
exists (rider removed, day switched) drops the pin silently; tap-to-toggle
and pin-moving semantics are unchanged, and extras (no key) still can't
pin. Covered by test `R2:` (TESTPLAN 39/61).

### Original note

**Today:** `render()` rebuilds `#list` via `innerHTML`, so a pinned
popover's `.pinned` class is dropped on each event poll (20 s), scoring
poll (60 s), and countdown tick (30 s). TESTPLAN 39 specifies pin/unpin
behavior but not survival across re-render, so this is technically
in-spec.

**Why it's poor:** reading results in a popover for more than a few
seconds means it vanishes underneath you.

**Direction:** remember the pinned row's identity (pinny+phase) across
renders and re-apply the class; or skip re-render when nothing changed
(feed bytes are usually identical between polls).

## 3. ~~A ~1 MB localStorage write on every poll~~ FIXED

Resolved: `cachePut` serializes once and skips the write when the payload
matches the last-written string (kept in a module variable, no storage
re-read); the blob's `at` stamp moves only when content changes, while
`lastUpdatedMs` — which drives the staleness display — still updates on
every successful fetch. Covered by test `R3:` (TESTPLAN 40/55).

### Original note

**Today:** every successful event fetch (20 s cadence) re-serializes and
rewrites the full ~1 MB feed to `rf2026:event`, and scoring (~360 KB)
every 60 s, even when the payload is unchanged.

**Why it's poor:** synchronous main-thread JSON.stringify + storage I/O
every 20 s on mid-range phones; needless battery/flash churn all day; and
it flirts with the ~5 MB origin quota (a quota failure is caught but then
the offline cache silently stops updating).

**Direction:** write only when the serialized payload differs from what's
stored (a cheap length+hash check), or throttle cache writes to every few
minutes — cache freshness of minutes is fine for its offline purpose.

## 4. ~~"N riders followed" counts names, not riders found~~ FIXED

Resolved: `extractRides` now tracks which followed names matched at least
one accepted entry; the status line reads `M of N riders found` when
fewer matched than are configured (plain `N riders followed` otherwise),
and the my-riders sheet appends a muted `· no entries found` to unmatched
rows once a feed has loaded. Covered by test `R4:` (TESTPLAN 42/48/56).

### Original note

**Today:** the status line counts `effectiveFollowing()` — configured
names, including typos and personal adds that match nothing in the feed
(covered by test `K-edge`). A misspelled `FOLLOWING` entry silently shows
no rides while the count still includes it.

**Why it's poor:** the count is the only feedback that the follow list is
working; it reads "9 riders followed" even when only 7 matched, so a typo
in a deploy goes unnoticed until someone misses a ride.

**Direction:** count distinct followed riders that actually matched
entries (or show "7 of 9 found" when they differ), and/or surface
unmatched names in the my-riders sheet.

## 5. ~~"underway" lingers for the whole grace window after the result posts~~ FIXED

Resolved: a numerically posted phase score now ends the underway state
immediately (once the listed time has passed). Covered by test `F23b`.

### Original note

**Today:** a row stays "underway" until (estimate ?? adjusted time) +
10 min, even if the scoring feed has already posted this phase's score —
the done-line (✓, places, next ride) only appears once the clock runs out.

**Why it's poor:** the most exciting moment — the score just landed — is
exactly when the page still says "underway"; the result is only visible by
opening the popover.

**Direction:** treat a posted phase score (per `PHASE_PLACE_FIELD` /
phase score fields) as completing the ride immediately: done-line as soon
as results exist, grace window only as the fallback when they don't.

## 6. ~~Soon-highlight (orange) stays on rows that are already underway~~ FIXED

Resolved: `soon` is now scoped to `0 < minsUntil <= 30`, so underway rows
never keep the orange treatment (the overlapping-rides case shows a plain
border). Covered by test `R6:` (TESTPLAN 26).

### Original note

**Today:** `soon` is `minsUntil <= 30`, which includes negative values, so
an underway row keeps the orange "starting soon" treatment until it goes
past (unless it's the next-up row, whose green styling wins).

**Why it's poor:** with two overlapping rides, the second one shows orange
"soon" styling with an "underway" countdown — mixed signals about whether
it has started.

**Direction:** scope `soon` to `0 < minsUntil <= 30`, or give underway
rows their own treatment.

## 7. ~~No fetch timeout — hanging cell networks stall silently~~ FIXED

Resolved: all three fetch sites (`fetchEventFeed`, `fetchScoring`,
`checkForNewDeploy`) pass `AbortSignal.timeout(10_000)` — feature-detected,
so browsers without it just skip the timeout — and each holds a per-function
in-flight boolean so a new poll returns immediately while the previous
request is pending. A timed-out event fetch surfaces the same "can't reach
ShowConnect, retrying" note; the flags reset in `finally`, so an
aborted/rejected fetch can never wedge polling. Covered by test `R7:`
(TESTPLAN 59).

### Original note

**Today:** `fetch(EVENT_URL)` has no timeout/AbortController. On venue
cell networks that accept the connection and then hang (common on
saturated LTE), the promise neither resolves nor rejects: the catch that
shows "can't reach ShowConnect, retrying" never fires, and every 20 s
`setInterval` starts another hanging fetch on top (they pile up
indefinitely — there is no in-flight guard either).

**Why it's poor:** the page looks alive but quietly shows aging data; the
staleness note appears only after 2 min, and the retry note never does.
Piled-up sockets can also starve the browser's connection pool.

**Direction:** `AbortSignal.timeout(10_000)` on all three fetch sites,
plus an in-flight flag so a new poll never overlaps a hung one.

## 8. ~~Done-line "next:" times ignore venue delays~~ FIXED

Resolved: `nextRideInfo` now computes each candidate's effective time via
`adjustedTime(o).adj` (override wins; else venue delay on `DELAY_DATE`) for
both the still-in-the-future filter and the displayed time, so the "next:"
line can never disagree with that ride's own row and a delay-pushed ride is
never skipped as already past. Covered by test `R8:` (TESTPLAN 34/62).

### Original note

**Today:** `nextRideInfo` uses `override || when` — overrides yes, but
`DELAYS` no (TESTPLAN 34 specifies exactly this). On a delay day the done
line can say "next: SJ 12:25 PM" while that same SJ row displays the
delayed 1:55 PM. The `<= now` filter also uses the unadjusted time, so a
ride pushed into the future by a delay is skipped as "already past" and
the line may claim "event complete" prematurely.

**Why it's poor:** two different times for the same ride on one screen,
specifically on the chaotic day when people rely on the page most.

**Direction:** route `nextRideInfo` through `adjustedTime()` (and update
TESTPLAN 34) — kept out of the bug-fix pass because the current behavior
is what the TESTPLAN specifies.

## 9. ~~A day with only an EXTRAS item is unreachable~~ FIXED

Resolved: the day-chip list is now the union of ride days and parsed
`EXTRAS` dates, so an extras-only day gets a chip and renders its extras
(the "no rides" empty state cannot hide them). Covered by test `R9:`
(TESTPLAN 9/49).

### Original note

**Today:** day chips are derived from rides only; an `EXTRAS` entry on a
date with no followed rides gets no chip, so it can never be displayed.

**Why it's poor:** a course-walk reminder added for a rest day silently
never appears, and the config looks correct.

**Direction:** include EXTRAS dates when building the chip list, or log a
console warning for unreachable extras.

## 10. ~~Past-day chips accumulate over the event week~~ FIXED (light variant)

Resolved with the auto-scroll option only: after each render, if the
active chip is not fully visible the chip row's own `scrollLeft` is
adjusted to bring it into view (page scroll is never touched; chips are
not reordered or collapsed, so past chips still accumulate but "Today"
is always on screen). Covered by test `R10:` (TESTPLAN 57).

### Original note

**Today:** every day with followed rides keeps its chip all week; by
Sunday the row starts with Wed/Thu/Fri/Sat before Today, pushing "Today"
and future days toward the overflow scroll on narrow phones.

**Why it's poor:** the most useful chips (today/tomorrow) drift right; the
row starts scrolled to the left.

**Direction:** order past days after future ones, collapse them behind a
"earlier ▸" chip, or auto-scroll the chip row so Today is visible.

## 11. ~~Plain-object lookups keyed by feed strings~~ FIXED

Resolved: the built indexes (`OVERRIDE_IDX`, `EST_IDX`, `sjTimes`,
`divName`, `divMeta`, `resultsIdx`, `scoringByDiv`) are now created with
`Object.create(null)`, and the user-edited `DELAYS` literal is read
through an `Object.hasOwn` + `typeof === "number"` guard — hostile or
typo'd values yield 0 delay / no match. Covered by test `R11:`
(TESTPLAN 58).

### Original note

**Today:** `DELAYS[ride.venue]`, `sjTimes[e.Division]`,
`scoringByDiv[dn]`, `divName[s.DivisionId]` are plain-object lookups keyed
by strings from the feed. A venue or division literally named
`constructor`/`toString` would resolve to an inherited function — yielding
`NaN` times or a TypeError during extraction.

**Why it might matter:** the feed is unofficial and unvalidated; one odd
value garbles the page. Realistically remote (real values are "R1",
"SJR4", division names), which is why it's a review note rather than a
fix.

**Direction:** `Object.create(null)` for the built indexes and an
`Object.hasOwn`/`typeof === "number"` guard on the `DELAYS` lookup.

## 12. ~~Midnight-boundary behaviors~~ FIXED (a + c; b intentionally kept)

Resolved for (a) and (c): a row whose `activeUntil` is still in the future
is no longer flipped to a previous-day row at 12:00 AM — the day-boundary
check only wins once the grace window has expired (test `R12a:`,
TESTPLAN 23/63); and the one-time scroll-to-now landing is consumed by the
first feed-data-backed render whatever it shows, so a page first opened on
a no-rides day (or showing another day) can never be yanked hours later
when today first gains rows (test `R12c:`, TESTPLAN 50/64).
Part (b) — the default (auto) day chip flipping to the new day at midnight
— was reviewed and deliberately KEPT as-is: a user who wants to stay on a
day can tap its chip, which pins it.

### Original note

**Today:** at event-local midnight, (a) a ride still inside its grace
window (e.g. an 11:56 PM SJ block whose estimate crosses 12:00 AM — see
test `E-edge`) flips to a past-day row instantly, because the
previous-day check trumps `activeUntil`; (b) the default day chip flips to
the new day mid-view; (c) if the page was first opened on a day with no
rides, the one-time now-line auto-scroll can fire days later at the moment
"today" first gains rides, moving the screen under the user.

**Why it's poor:** all three are surprising screen changes at 12:00 AM,
though only genuinely late-running events would ever see (a).

**Direction:** let `activeUntil` win over the day-boundary check for rows
whose window spans midnight; keep the user's selected day pinned across
the rollover; clear (or set) `initialScrollDone` once the first today
render has happened at all.
