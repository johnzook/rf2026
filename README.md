# Rebecca Farm Rider Tracker

A single static page (`index.html`) that shows when and where each followed
rider rides, in time order, with per-venue delay offsets. It fetches the
ShowConnect feed client-side and refreshes every 20 seconds — no backend, no
build step. See `InitialPrompt.md` for the full background and API notes.

## Editing between deploys

The entire edit surface is two objects near the top of `index.html`:

- **`FOLLOWING`** — riders to follow, in the feed's exact `"Last, First"`
  format (verbatim, including capitalization).
- **`DELAYS`** + **`DELAY_DATE`** — per-venue delay in minutes, applied only
  to rides on that date. Set both on a weather day and commit to `main`;
  open pages poll their own URL and auto-reload within a minute of deploy,
  so no one has to manually refresh.

## Features

- Day chips for every day a followed rider has a ride; defaults to today
  (or the next day with rides).
- Rows sorted by delay-adjusted time; original time struck through when a
  delay applies; active delays summarized in a banner.
- "Next up" highlight plus per-ride countdowns; past rides dim.
- Hover (desktop) or tap (phone) a ride for details: division, pinny, and
  live results — per-phase scores/places and overall place from the
  `scoringLive` feed as they post. Results are joined on pinny + division
  (never on rider name — the two feeds format names differently).
- Times are event-local (Mountain); countdowns are computed against
  event-local "now", so they're right even for family in other timezones.

## Year-over-year comparison (`compare.html`)

A second standalone page comparing the 2026 event with 2025 (ShowConnect
events 1187 and 1150). It fetches both years' entry and `scoringLive` feeds
on load and computes like-for-like quality metrics — rates over the right
denominators rather than raw fault counts:

- The field: entries, pre-event scratches, withdrew-without-starting.
- Where each entry's weekend ended (withdrew / retired / rider fall /
  eliminated), attributed to the first phase whose scoring column carries a
  status code (codes cascade into later columns, so first occurrence = the
  phase it happened in).
- Cross country: completion %, % of recorded rounds with a refusal/run-out
  (jump penalties in 20s; +11/+15 frangible or flag penalties counted
  separately), refusals per 100 rounds, clear and double-clear %, time
  penalties.
- Show jumping clear %, average dressage, completion %, finished-on-
  dressage-score % — overall and per level via chips (all Sr./Jr. sections
  of a level combined).

It shares no code with `index.html` and is safe to deploy alongside it; the
methodology is documented in the page footer.

## Hosting

Serve `index.html` from GitHub Pages or Vercel; the API allows any origin.
Opening the file directly (`file://`) also works. `compare.html` is served
the same way (e.g. `/compare.html` on the same host).
