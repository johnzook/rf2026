# Ride Times — ShowConnect rider tracker

A single static page (`index.html`) that shows when and where each followed
rider rides at any ShowConnect event, in time order, with live results and
per-venue delay offsets. It fetches the ShowConnect feeds client-side and
refreshes every 20 seconds — no backend, no build step. See
`InitialPrompt.md` and `HANDOFF.md` for the full background and API notes.

## Picking an event

The URL selects the event: `?event=<ShowConnectId>` is the canonical form.
A bare URL resumes the last event viewed on that device; first-time
visitors (and `?choose`, via the header's "switch event" link) get an event
picker fed by the ShowConnect calendar — happening now / upcoming / recent,
searchable — plus a box for typing a ShowConnectId or pasting a
showconnect.org link. The page title and header take the event's name, and
times display in the event's timezone (derived from its US state; footer
shows the zone).

## Following and sharing riders

There is no configured rider list. Riders are added in-app ("＋ my riders")
and saved on the device, per event. The sheet's "Share this list" row sends
a `?event=<id>&riders=…` link via the system share sheet, an SMS link, or
copy-to-clipboard. Opening a shared link adopts the riders silently if you
follow nobody yet for that event; otherwise a banner offers Add to mine /
Replace mine / Ignore.

## Editing between deploys (maintainers)

The entire edit surface is one object at the top of `index.html`,
`EVENT_CONFIGS`, keyed by ShowConnectId — entries for other events are
inert, and the 1187 (Rebecca Farm 2026) entry is kept as a worked example.
Per event:

- **`delayDate` + `delays`** — per-venue delay in minutes, applied only to
  rides on that date. Set both on a weather day.
- **`overrides`** — exact revised times (pinny + phase + date) when a ring
  is re-ordered rather than uniformly delayed.
- **`estimates`** — manual SJ slot estimates from printed order-of-go
  sheets; these beat the automatic standings-based estimate.
- **`extras`** — one-off schedule items (course walks etc.) shown inline.

Commit to `main`; open pages poll their own URL and auto-reload within a
minute of deploy, so no one has to manually refresh.

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
- "View round" from a ride's details: the whole division for that phase in
  running order (ride times; SJ blocks in reverse order of standing, with
  slot estimates), scores and places checking in live as they post, with a
  progress line ("6 of 17 scores posted · through 10:36 AM") and your
  riders highlighted — so you can watch a round unfold before your rider's
  own score is up.
- Times are event-local; countdowns are computed against event-local
  "now", so they're right even for family in other timezones.

## Hosting

Serve `index.html` from GitHub Pages or Vercel; the API allows any origin.
Opening the file directly (`file://`) also works.
