'use strict';
// Edge-case hardening beyond the numbered TESTPLAN items: degenerate feed
// shapes seen in the real payloads (null venues, missing arrays), time and
// lifecycle boundaries, and storage-failure behavior. Names are prefixed
// with the TESTPLAN group they extend.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);

test('A-edge: degenerate entry shapes — missing RidingDetails, empty/null Venues — render without crashing', async () => {
  const noDetails = F.entry({ pinny: 870, rider: F.FOLLOWED.zook });
  delete noDetails.RidingDetails; // field absent entirely
  const nullVenue = F.entry({ pinny: 871, rider: F.FOLLOWED.aulita, details: [
    F.ridingDetail({ phase: 'Dressage', venue: null, time: F.rideTimeStr(2026, 7, 18, 13, 0) })] });
  const emptyVenues = F.entry({ pinny: 872, rider: F.FOLLOWED.crocker, details: [
    F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] });
  emptyVenues.RidingDetails[0].Venues = [];
  const s = await openPage({ server, feed: F.feed([noDetails, nullVenue, emptyVenues]), now: NOON });
  try {
    assert.equal(s.page.__pageError, undefined);
    const r = await s.page.evaluate(() => ({
      rows: document.querySelectorAll('#list .row').length,
      venues: rides.map(x => x.venue),
    }));
    assert.equal(r.rows, 2, 'detail-less entry contributes nothing; the others render');
    assert.deepEqual(r.venues, ['', ''], 'null venue and empty Venues both normalize to ""');
  } finally { await s.context.close(); }
});

test('A-edge: null venue on DELAY_DATE gets no delay (no DELAYS key matches "")', async () => {
  const e = F.entry({ pinny: 873, rider: F.FOLLOWED.zook, details: [
    F.ridingDetail({ phase: 'Dressage', venue: null, time: F.rideTimeStr(2026, 7, 17, 13, 0) })] });
  const s = await openPage({ server, feed: F.feed([e]), now: NOON });
  try {
    await s.page.click('#days .day-chip'); // view the DELAY_DATE day (Jul 17)
    const row = await rowInfo(s.page, 873);
    assert.equal(row.adj, '1:00 PM', 'unshifted');
    assert.equal(row.orig, null, 'no strikethrough');
  } finally { await s.context.close(); }
});

test('A-edge: empty EntryList and empty ScoringList render the empty state, no crash', async () => {
  const s = await openPage({ server, feed: { EntryList: [] }, scoring: {}, now: NOON });
  try {
    assert.equal(s.page.__pageError, undefined);
    // The baked EXTRAS item still earns its chip (R9); with extras cleared
    // too, the true empty state shows with no chips at all.
    await s.page.evaluate(() => { EXTRAS.length = 0; render(); });
    const empty = await s.page.$eval('#list .empty', e => e.textContent);
    assert.equal(empty, 'No scheduled rides yet for the followed riders.');
    assert.equal(await s.page.$$eval('#days .day-chip', els => els.length), 0, 'no day chips');
  } finally { await s.context.close(); }
});

test('I-edge: scoring rows for divisions absent from the entry feed are ignored harmlessly', async () => {
  const feed = F.feed([
    F.entry({ pinny: 874, rider: F.FOLLOWED.zook, division: 'Known Div', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
  ]);
  const scoring = F.scoring({
    // DivisionsList lacks the id used by the rows below -> name maps to "".
    divisions: [],
    rows: [
      F.scoringRow({ pinny: 874, divisionId: 99, finalPlace: '1' }), // unknown division
      F.scoringRow({ pinny: 999, divisionId: 98, finalPlace: '2' }), // unknown pinny too
    ],
  });
  const s = await openPage({ server, feed, scoring, now: NOON });
  try {
    assert.equal(s.page.__pageError, undefined);
    const row = await rowInfo(s.page, 874);
    assert.ok(row.pop.includes('Not posted yet'),
      'no join across the unknown division: ' + row.pop);
    assert.equal(row.countdown, 'in 1 h 0 min', 'not treated as out');
  } finally { await s.context.close(); }
});

test('F-edge: a ride exactly at now is "underway", tagged "Now", and sits below the now-line', async () => {
  const feed = F.feed([
    F.entry({ pinny: 875, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 12, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    const row = await rowInfo(s.page, 875);
    assert.equal(row.countdown, 'underway');
    assert.equal(row.nextTag, 'Now');
    const order = await s.page.$$eval('#list > div', els =>
      els.map(e => e.classList.contains('now-line') ? 'now' : 'row'));
    assert.deepEqual(order, ['now', 'row'], 'now-line directly above the at-now ride');
  } finally { await s.context.close(); }
});

test('F-edge: all rides past — no next-up, now-line at the end; all combos out — no next-up either', async () => {
  const allPast = F.feed([
    F.entry({ pinny: 876, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 8, 0) })] }),
    F.entry({ pinny: 877, rider: F.FOLLOWED.aulita, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 9, 0) })] }),
  ]);
  let s = await openPage({ server, feed: allPast, now: NOON });
  try {
    const r = await s.page.evaluate(() => ({
      tags: document.querySelectorAll('#list .next-tag').length,
      last: [...document.querySelectorAll('#list > div')].pop().className,
    }));
    assert.equal(r.tags, 0, 'nothing is next up');
    assert.equal(r.last, 'now-line', 'now marker after every past ride');
  } finally { await s.context.close(); }

  const allOut = F.feed([
    F.entry({ pinny: 878, rider: F.FOLLOWED.zook, division: 'DivA', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
    F.entry({ pinny: 879, rider: F.FOLLOWED.aulita, division: 'DivA', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 15, 0) })] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 30, name: 'DivA' })],
    rows: [
      F.scoringRow({ pinny: 878, divisionId: 30, finalPlace: 'W' }),
      F.scoringRow({ pinny: 879, divisionId: 30, finalPlace: 'E' }),
    ],
  });
  s = await openPage({ server, feed: allOut, scoring, now: NOON });
  try {
    const r = await s.page.evaluate(() => ({
      tags: document.querySelectorAll('#list .next-tag').length,
      countdowns: [...document.querySelectorAll('#list .countdown')].map(e => e.textContent),
    }));
    assert.equal(r.tags, 0, 'out rows never become next-up');
    assert.deepEqual(r.countdowns, ['withdrawn', 'eliminated']);
  } finally { await s.context.close(); }
});

test('F-edge: two rides with identical adjusted times keep feed order (stable sort)', async () => {
  const t = F.rideTimeStr(2026, 7, 18, 13, 0);
  const feed = F.feed([
    F.entry({ pinny: 880, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: t })] }),
    F.entry({ pinny: 881, rider: F.FOLLOWED.aulita, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: t })] }),
    F.entry({ pinny: 882, rider: F.FOLLOWED.crocker, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: t })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    const order = await s.page.$$eval('#list .row .horse b', els => els.map(e => e.textContent));
    assert.deepEqual(order, ['#880', '#881', '#882'], 'EntryList order preserved');
    // And re-rendering does not reshuffle them.
    await s.page.evaluate(() => render());
    const order2 = await s.page.$$eval('#list .row .horse b', els => els.map(e => e.textContent));
    assert.deepEqual(order2, order);
  } finally { await s.context.close(); }
});

test('C-edge: DELAY_DATE with an all-zero delay map — banner hidden, times unshifted', async () => {
  const feed = F.feed([
    F.entry({ pinny: 883, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR4', time: F.rideTimeStr(2026, 7, 17, 13, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    await s.page.evaluate(() => {
      for (const k of Object.keys(DELAYS)) DELAYS[k] = 0;
      selectedDay = '2026-07-17'; // the baked DELAY_DATE
      render();
    });
    assert.equal(await s.page.$eval('#delay-banner', e => e.hidden), true, 'no banner for a zero map');
    const row = await rowInfo(s.page, 883);
    assert.equal(row.adj, '1:00 PM');
    assert.equal(row.orig, null);
  } finally { await s.context.close(); }
});

test('E-edge: an auto estimate crossing midnight renders the next-day clock time', async () => {
  const t = F.rideTimeStr(2026, 7, 18, 23, 56); // shared SJ block start 11:56 PM
  const feed = F.feed([
    F.entry({ pinny: 884, rider: F.FOLLOWED.zook, division: 'Late Div', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: t })] }),
    F.entry({ pinny: 885, rider: 'Other, One', division: 'Late Div', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: t })] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 31, name: 'Late Div' })],
    rows: [1, 2, 3, 4, 5].map(p =>
      F.scoringRow({ pinny: 883 + p, divisionId: 31, finalPlace: String(p) })),
  });
  // Pinny 884 is placed 1st -> jumps last: 4 ahead -> 23:56 + 8 min = 12:04 AM.
  const s = await openPage({ server, feed, scoring, now: denverMs(2026, 7, 18, 23, 0) });
  try {
    const row = await rowInfo(s.page, 884);
    assert.equal(row.est, 'est. slot ~12:04 AM · 5th of 5 to jump, by standing');
    assert.ok(!row.classes.includes('past'), 'row still active before midnight');
  } finally { await s.context.close(); }
});

test('J-edge: localStorage writes failing (quota) never break fetching or my-riders edits', async () => {
  const feed = F.feed([
    F.entry({ pinny: 886, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
    F.entry({ pinny: 887, rider: 'Newby, Nora', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    // Simulate a full store: every write throws from here on.
    await s.page.evaluate(async () => {
      Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
      await fetchEventFeed(); // cachePut now throws internally
      await fetchScoring();
    });
    assert.equal(s.page.__pageError, undefined);
    const r = await s.page.evaluate(() => ({
      rows: document.querySelectorAll('#list .row').length,
      err: document.getElementById('fetch-err').textContent,
    }));
    assert.equal(r.rows, 1);
    assert.equal(r.err, '', 'a failed cache write is not a fetch failure');

    // Sheet edits: the Add click's setStoredList throws (silently) — the tap
    // must not crash the page, even though it cannot persist.
    await s.page.click('#edit-riders');
    await s.page.fill('#rider-search', 'newby');
    await s.page.click('#rider-results .rbtn.add');
    assert.equal(s.page.__pageError, undefined, 'no uncaught error from the blocked write');
  } finally { await s.context.close(); }
});

test('K-edge: follow-list names absent from the feed count toward the status but render nothing', async () => {
  const feed = F.feed([
    F.entry({ pinny: 888, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON, localStorage: {
    'rf2026:myRiders': JSON.stringify(['Ghost, Rider']),          // not in the feed
    'rf2026:hiddenRiders': JSON.stringify(['Nobody, Here']),      // not in FOLLOWING
  } });
  try {
    assert.equal(s.page.__pageError, undefined);
    const r = await s.page.evaluate(() => ({
      rows: document.querySelectorAll('#list .row').length,
      status: document.getElementById('status').textContent,
    }));
    assert.equal(r.rows, 1, 'only the real entry renders');
    // 9 baked (none actually hidden — the hide names nobody) + 1 ghost add
    // in the denominator; only zook actually matched the feed (R4).
    assert.ok(r.status.includes('1 of 10 riders found'), r.status);
  } finally { await s.context.close(); }
});
