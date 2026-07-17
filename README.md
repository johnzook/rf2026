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

## Hosting

Serve `index.html` from GitHub Pages or Vercel; the API allows any origin.
Opening the file directly (`file://`) also works.
