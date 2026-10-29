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

## Hosted schedule snapshots (evententries events)

Shows that run on evententries.com instead of ShowConnect have no public
feed (their show centers are GWT-RPC apps with no CORS, and their Terms of
Use forbid systematic retrieval — see `HANDOFF.md`). For those, the page
supports a **snapshot event**: a maintainer copies the show center's
"Order of Go" text once and commits it, encrypted, as
`snapshots/ee-<key>.json`. The repo holds ciphertext only; the key travels
in the link, so the schedule is reachable by the people it's sent to
without being republished to the world.

- **Link format:** `?event=ee:<key>&k=<token>` — `<key>` is the show-center
  id from the evententries link (`…/#ShowCenter<key>`), `<token>` the
  decryption token. The token is remembered per device, so a bare
  `?event=ee:<key>` and the last-event resume keep working, and share
  links from the rider sheet carry it.
- **Publish:** open the show center's Order of Go tab, select all, copy,
  save the text to a file *outside the repo* (one cell per line, or
  tab-separated — both parse), then:

  ```sh
  node tools/snapshot-encrypt.js --key ZAsNB86e3r89ldK9 \
    --name "The Eventing Championships at Galway Downs (Oct 2026)" \
    --start 2026-10-28 --state California --in ~/galway-order-of-go.txt
  ```

  `--start` is the first day the show can run (weekday names in the text
  resolve from it); `--state` sets the event timezone. The script prints
  the token and the link; commit the JSON and send the link.
- **Re-publish** (SJ order appears after cross-country; a ring gets
  re-ordered): re-run with the same `--token` so links already sent stay
  valid, commit, and open pages pick the new file up within a minute.
- **What you get:** the timeline, day chips, countdowns, rider picking,
  sharing, the round view's running order, and the delay/override layers.
  `EVENT_CONFIGS` entries for these events use the quoted key, e.g.
  `"ee:ZAsNB86e3r89ldK9": { … }`, with ring names exactly as printed in
  the order of go.
- **Results (optional):** nothing is live, but you can paste the show's
  evententries "Live Scores" page (select the whole page, copy, save as
  text — the chrome and ads are skipped) and publish it under the same
  token whenever you want fresher results:

  ```sh
  node tools/snapshot-encrypt.js --scores --key ZAsNB86e3r89ldK9 \
    --token <the schedule's token> --in ~/galway-scores.txt
  ```

  That writes `snapshots/ee-<key>-scores.json`; commit it and open pages
  pick it up within a minute. Ride popovers then show per-phase and
  overall results, and the round view shows places and progress. Re-paste
  by hand as often as you like; delete the file to go back to "Not posted
  yet". The footer says when each snapshot was captured.
- **Links to the live source:** `--scores-url <url>` (the show's Live
  Scores page) and `--links <file.json>` (`{"<division code>": "<url>"}`
  for the per-level pages) on the schedule publish add a "live scores ↗"
  link to each ride's details and the round view — a plain outbound link
  to evententries' own page, per division where you gave one, else the
  show-wide page.
- **Be a good citizen:** every copy here is a person copying a page their
  terms let them download once. Keep it that way — no scripts on a timer,
  no scrapers, however slow: their Terms of Use forbid systematic
  retrieval, and the page itself never contacts their servers.
- `node tools/snapshot-encrypt.js --decrypt --key <key> --token <token>`
  (add `--scores` for the results file) prints a snapshot's metadata to
  check what's published.

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
  own score is up. Riders yet to go show the score they carry into the
  phase in gray (scoring is cumulative, so that's where a clean ride puts
  them), and a "placing" toggle re-sorts the round into the live
  provisional leaderboard.
- Times are event-local; countdowns are computed against event-local
  "now", so they're right even for family in other timezones.

## Hosting

Serve `index.html` from GitHub Pages or Vercel; the API allows any origin.
Opening the file directly (`file://`) also works.
