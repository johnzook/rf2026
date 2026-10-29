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
- **Publish / refresh (one command):** `tools/snapshot-fetch.js` does the
  copy-paste for you — it opens the show center's "Order of Go" and
  "General Schedule" tabs and the show's Live Scores page in a headless
  browser, exactly as a visitor's browser would, saves their text, and
  can encrypt and commit in the same run. One-time setup on the laptop:

  ```sh
  cd tools && npm install && npx playwright install chromium
  ```

  Then, from the repo root, whenever you want a fresh copy:

  ```sh
  node tools/snapshot-fetch.js --key ZAsNB86e3r89ldK9 \
    --scores-url "https://evententries.com/#LiveScoresg4ODAsyNRb0uodpdkV2Lvg==" \
    --out ~/galway --publish --push --token <the link token> \
    --name "The Eventing Championships at Galway Downs (Oct 2026)" \
    --start 2026-10-28 --state California
  ```

  It writes `galway-order-of-go.txt`, `galway-general.txt` and
  `galway-scores.txt` to `~/galway` (outside the repo — keep them there),
  runs `snapshot-encrypt.js` for both files, and `--push` commits and
  pushes `snapshots/`. Open pages pick the new files up within a minute.
  `--start` is the first day the show can run (weekday names in the text
  resolve from it); `--state` sets the event timezone. Drop `--push` to
  review before committing, `--only scores` to refresh results alone,
  `--center <url>` if the show-center iframe can't be read. The tool
  refuses to run again within 10 minutes of the last fetch (`--force`
  overrides) — a nudge, not a license.
- **Posture:** the fetch tool loads the same pages a visitor loads, once,
  when a person runs it. Never put it on a timer, in CI, or in a loop:
  evententries' Terms of Use forbid systematic retrieval, and a human
  pressing the button now and then is the one-copy use they allow.
- **Manual fallback (first publish, or no browser handy):** open the show
  center's Order of Go tab, select all, copy, save the text to a file
  *outside the repo* (one cell per line, or tab-separated — both parse),
  then:

  ```sh
  node tools/snapshot-encrypt.js --key ZAsNB86e3r89ldK9 \
    --name "The Eventing Championships at Galway Downs (Oct 2026)" \
    --start 2026-10-28 --state California --in ~/galway-order-of-go.txt
  ```

  The script prints the token and the link; commit the JSON and send the
  link. The first publish of an event goes this way (or with the fetch
  tool minus `--token`: it prints the new token).
- **Show jumping before its order posts:** evententries publishes the SJ
  order of go only after cross-country, so until then the rows above have
  no SJ times. Copy the show center's "General Schedule" tab the same way
  (it lists, per division and phase, the ring and the time block) and
  add `--schedule ~/galway-general-schedule.txt` to the publish command.
  Every phase a rider has no row for is filled with the division's block
  start, shown in the ride's details as the whole window ("10:26 AM–10:52
  AM (division block) · SJ - Clock Tower"). That is the same
  shared-block-start shape ShowConnect uses for SJ, so the round view
  runs the division in reverse of standing and, once results are pasted
  (below), estimates each rider's slot within the block. When the real
  SJ order appears, re-paste the order of go: rows with real times
  replace the block automatically.
- **Re-publish** (SJ order appears after cross-country; a ring gets
  re-ordered): re-run with the same `--token` so links already sent stay
  valid, commit, and open pages pick the new file up within a minute.
- **What you get:** the timeline, day chips, countdowns, rider picking,
  sharing, the round view's running order, and the delay/override layers.
  `EVENT_CONFIGS` entries for these events use the quoted key, e.g.
  `"ee:ZAsNB86e3r89ldK9": { … }`, with ring names exactly as printed in
  the order of go.
- **Results (optional):** nothing is live, but the fetch tool's
  `--scores-url` (or a hand paste of the show's evententries "Live
  Scores" page — select the whole page, copy, save as text; the chrome,
  ads and the browser's own line breaks are all handled) publishes the
  board under the same token whenever you want fresher results. By hand:

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
  terms let them download once — by hand or by running the fetch tool
  themselves. Keep it that way — no scripts on a timer, no CI job, no
  scrapers, however slow: their Terms of Use forbid systematic
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
