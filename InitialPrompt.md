# ShowConnect Rider Tracker — Build Handoff Brief

## Goal

A single static web page that shows, for a small hardcoded set of followed riders, when and where they ride today, ordered by time, with per-venue weather delays baked into the page. One stable URL to share with family and use myself. No backend, no login, no shared store. Delays are edited in the source and redeployed.

## Data source

ShowConnect exposes an open, unauthenticated JSON API. No key. `access-control-allow-origin: *`, so a browser page on any origin can call it directly, including local `file://` and any dev server. This was verified live.

Primary endpoint (the only one this app needs):

```
GET https://scripts.showconnect.org/api/sc/event/1187
```

`1187` is the ShowConnectId for this event (The Event at Rebecca Farm, Kalispell MT). To reuse the app for a different event, swap that id.

Response is JSON with top-level keys: `EventDetails`, `DivisionList`, `EntryStatusList`, `EntryList`.

Other endpoints exist (`/scoringLive`, `/scoringPhaseLive`) for results and placings. This app does not need them. Avoid joining to them (see name-format note below).

### No filtering, full payload

The API takes no filter params. Adding `?division=`, `?rider=`, `?date=` returns a byte-identical response. All filtering happens client-side. The live site itself does a full fetch and filters in the browser, and this app should do the same.

- Uncompressed payload: ~1.08 MB.
- Over the wire: server sends brotli, so ~60 KB per fetch.
- Response header: `cache-control: public, max-age=15`.

Poll every 15 to 30 seconds. Bandwidth and phone parse cost are negligible.

## Data model used by this app

Each element of `EntryList` is one horse+rider entry. Relevant fields:

- `RiderName` (string, format "Last, First", e.g. `"Cummings, Anna"`)
- `HorseName` (string)
- `PinnyNumber` (number, identifies the horse+rider combo)
- `Division`, `DivisionShortName`
- `Status` (e.g. `"Accepted"`)
- `RidingDetails` (array, one item per phase)

Each `RidingDetails` item:

```json
{
  "Phase": "Cross Country",
  "Venues": [
    { "venue": "XC", "ordinal": "", "date": "2026-07-17", "time": "17:31:11.239" }
  ],
  "RideTimes": "Fri, Jul 17, 2026, 12:30:00 PM"
}
```

Phases seen: `Dressage`, `Phase A`, `Phase B`, `Phase C`, `Cross Country`, `Show Jumping`.

The venue code (`Venues[0].venue`) is the ring/arena and is the key the delays are applied against. Venue codes seen across the event: `XC`, `SJR1`, `SJR3`, `SJR4`, `R1`, `R2`, `R3`, `R4`, `R5`, `Phase A`. Which ones are active varies by day.

## Critical gotchas

These were found by inspection of the live feed. A naive build will get them wrong.

1. **Ignore `Venues[].date` and `Venues[].time`.** They are a publish/modified timestamp (identical `17:31:11.239` across every phase of an entry), not the ride date or time. The real scheduled date and time are inside the `RideTimes` string. Parsing the `Venues` date will make it look like every phase happens today.

2. **Parse date and time from `RideTimes`.** Format is `"%a, %b %d, %Y, %I:%M:%S %p"`, e.g. `"Fri, Jul 17, 2026, 12:30:00 PM"`. Verified: 1741 RideTimes strings across the event, zero parse failures with this format.

3. **`RideTimes` has no timezone.** It is event-local (Mountain time, Kalispell). For anyone physically at the event on a phone set to local time, comparisons and countdowns are correct against the device clock. If a viewer is in another timezone, a "minutes until ride" countdown should be computed against event-local now, not raw device now. For the primary use case (people at the venue), device clock is fine.

4. **Empty `RideTimes` means not yet scheduled for that phase.** Skip those rows.

5. **Rider name format is "Last, First" in this feed.** The scoring feed uses "First Last (USA)". Do not string-join across feeds. Build the follow list against the exact `RiderName` values from this feed, matched verbatim including spelling and capitalization.

6. **One rider can have multiple entries (multiple horses).** Following a person can surface several rides. That is expected and desired. If a specific horse is ever needed, key on `PinnyNumber` or `EntryListId`.

## Delay model

In eventing, delays are per ring, not per rider. A ring falls behind and everyone after it shifts by roughly the same amount. So delays are a small map of venue code to minutes behind, applied as an offset added to each ride's scheduled `RideTimes` for that venue.

Delays are hardcoded in the page and updated by editing the source and redeploying. Churn is low (typically a delay gets set in the morning and adjusted a few times at most). Keeping them in the HTML is the accepted tradeoff for zero infrastructure.

## Application behavior

1. On load, and every 15 to 30 seconds, fetch the event endpoint.
2. Flatten `EntryList[].RidingDetails[]` into rows of: rideTime (parsed from `RideTimes`), phase, venue, rider, horse, pinny, division.
3. Keep only rows whose rider is in the follow list and whose parsed date is today.
4. Apply the delay offset for each row's venue to get an adjusted time.
5. Sort by adjusted time ascending.
6. Render as a timeline. Group or highlight "next up." Show for each row: adjusted time (and ideally the original scheduled time struck through or noted when a delay applies), phase, venue, rider, horse.
7. Optional nicety: a "minutes until" countdown per row, and a subtle highlight for rides in the next N minutes.

## Configuration surface

Keep the two things I edit as two obvious objects near the top of the file. These are the entire edit surface between deploys.

```js
// Riders to follow. Must match the feed's "Last, First" format verbatim.
const FOLLOWING = [
  "Cummings, Anna",
  "Armstrong, Andy",
  // ...about 10, plus my own rider
];

// Per-venue delay in minutes. Edit on a weather day, then redeploy.
const DELAYS = {
  XC: 0,
  SJR4: 0,
  SJR3: 0,
  SJR1: 0,
  R1: 0,
  R2: 0,
  R3: 0,
  R4: 0,
  R5: 0,
  "Phase A": 0,
};
```

## Build and hosting

- One self-contained `index.html` with inline CSS and JS. No framework, no build step. It fetches the API client-side.
- Source lives in a GitHub repo (this is what makes phone edits and Claude Code access clean).
- Host with GitHub Pages (fewest moving parts, everything in one service) or Vercel connected to the repo (cleaner URL, faster propagation; I already have a Vercel account, use a separate project from my existing app).
- Day-to-day workflow: edit the `DELAYS` object, commit, redeploy is automatic, family's page reflects it on the next poll.

## Event constants for this instance

- ShowConnectId: `1187`
- Event: The Event at Rebecca Farm, Kalispell, Montana
- Endpoint: `https://scripts.showconnect.org/api/sc/event/1187`
- Note: the API is undocumented and unofficial. It could change without notice. Keep the fetch and parse isolated so a shape change is easy to fix.
