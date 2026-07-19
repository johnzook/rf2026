'use strict';
// TESTPLAN group I (results join + detail popover).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON_FRI = denverMs(2026, 7, 17, 12, 0); // delay date, for the delayed time-row variant

test('I37: results join strictly on pinny + division name, never rider name', async () => {
  const s = await openPage({ server, feed: F.feed([]), waitLoaded: false });
  try {
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const r = await s.page.evaluate(() => {
      const idx = buildResultsIndex({
        DivisionsList: [
          { DivisionId: 1, DivisionName: 'Div One' },
          { DivisionId: 2, DivisionName: 'Div Two' },
        ],
        ScoringList: [
          // Same pinny in two divisions: both survive under distinct keys.
          { DivisionId: 1, Pinny: 700, RiderName: 'Formatted Differently (USA)', FinalPlace: '1' },
          { DivisionId: 2, Pinny: 700, FinalPlace: '2' },
          { DivisionId: 1, Pinny: 701, FinalPlace: '3' },
          { DivisionId: 99, Pinny: 702, FinalPlace: '4' }, // unknown division id -> "" name
        ],
      });
      return {
        keys: Object.keys(idx).sort(),
        p700div1: idx['700|Div One'].FinalPlace,
        p700div2: idx['700|Div Two'].FinalPlace,
        byDiv: Object.fromEntries(Object.entries(scoringByDiv).map(([k, v]) => [k, v.length])),
      };
    });
    assert.deepEqual(r.keys, ['700|Div One', '700|Div Two', '701|Div One', '702|']);
    assert.equal(r.p700div1, '1');
    assert.equal(r.p700div2, '2');
    assert.deepEqual(r.byDiv, { 'Div One': 2, 'Div Two': 1, '': 1 });
  } finally { await s.context.close(); }
});

test('I37+I38: popover shows joined results despite different rider-name formats; -- renders as em-dash', async () => {
  const feed = F.feed([
    F.entry({ pinny: 703, rider: F.FOLLOWED.zook, horse: 'Eddy', division: 'JO Beginner Novice C',
      details: [F.ridingDetail({ phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 15, 10) })] }),
    F.entry({ pinny: 704, rider: F.FOLLOWED.aulita, division: 'JO Beginner Novice C',
      details: [F.ridingDetail({ phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 15, 20) })] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 40, name: 'JO Beginner Novice C' })],
    rows: [
      // Scoring feed formats the name "First Last" — the join must not care.
      F.scoringRow({ pinny: 703, divisionId: 40, rider: 'Penelope Zook',
        dressageScore: '30.6', dressagePlace: '2', finalPoints: '30.6', finalPlace: '2' }),
      // 704 has no scoring row.
    ],
  });
  const s = await openPage({ server, feed, scoring, now: NOON_FRI });
  try {
    const withRes = await rowInfo(s.page, 703);
    assert.ok(withRes.pop.includes('Zook, Penelope'), 'popover header');
    assert.ok(withRes.pop.includes('Eddy · #703'));
    assert.ok(withRes.pop.includes('JO Beginner Novice C'));
    assert.ok(withRes.pop.includes('30.6 (2nd)'), 'dressage score + place');
    assert.ok(withRes.pop.includes('Cross Country—') || withRes.pop.includes('Cross Country —') ||
      /Cross Country\s*—/.test(withRes.pop), 'unposted phases render em-dash');
    const noRes = await rowInfo(s.page, 704);
    assert.ok(noRes.pop.includes('Not posted yet'), 'missing scoring row');
  } finally { await s.context.close(); }
});

test('I38: time row variants — plain, delayed (+N min venue), revised', async () => {
  const feed = F.feed([
    F.entry({ pinny: 705, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 15, 10) })] }),
    F.entry({ pinny: 706, rider: F.FOLLOWED.aulita, details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR4', time: F.rideTimeStr(2026, 7, 17, 15, 0) })] }),
    F.entry({ pinny: 707, rider: F.FOLLOWED.crocker, details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 17, 15, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON_FRI });
  try {
    await s.page.evaluate(() => {
      OVERRIDE_IDX['707|Show Jumping'] = new Date(2026, 6, 17, 17, 0);
      rides = extractRides(lastFeed);
      render();
    });
    const plain = await rowInfo(s.page, 705);
    assert.ok(plain.pop.includes('Dressage3:10 PM · R5'), plain.pop);
    assert.ok(!plain.pop.includes('sched'), 'no annotation without delay');

    const delayed = await rowInfo(s.page, 706); // SJR4 +90 on Jul 17
    assert.ok(delayed.pop.includes('4:30 PM (sched 3:00 PM, +90 min SJR4) · SJR4'), delayed.pop);

    const revised = await rowInfo(s.page, 707);
    assert.ok(revised.pop.includes('5:00 PM (revised; sched 3:00 PM) · SJR1'), revised.pop);
  } finally { await s.context.close(); }
});

test('I39: tap pins exactly one popover; re-tap unpins; clicks inside the popover keep the pin', async () => {
  const feed = F.feed([
    F.entry({ pinny: 708, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
    F.entry({ pinny: 709, rider: F.FOLLOWED.aulita, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
    F.entry({ pinny: 710, rider: F.FOLLOWED.crocker, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 15, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: denverMs(2026, 7, 18, 12, 0) });
  try {
    const pinned = () => s.page.$$eval('#list .row.pinned .horse b', els => els.map(e => e.textContent));
    const rowSel = p => `#list .row:has(.horse b:text-is("#${p}"))`;

    // Pin the middle row (its popover drops over the row below, not above).
    await s.page.click(rowSel(709), { position: { x: 10, y: 10 } });
    assert.deepEqual(await pinned(), ['#709']);
    assert.ok(await s.page.$eval(`${rowSel(709)} .pop`, el => getComputedStyle(el).display === 'block'),
      'pinned popover is visible');

    // Click INSIDE the open popover: pin stays.
    await s.page.click(`${rowSel(709)} .pop h3`);
    assert.deepEqual(await pinned(), ['#709']);

    // Tap another row above: pin moves (exactly one pinned).
    await s.page.click(rowSel(708), { position: { x: 10, y: 10 } });
    assert.deepEqual(await pinned(), ['#708']);

    // Tap the pinned row again: unpins.
    await s.page.click(rowSel(708), { position: { x: 10, y: 10 } });
    assert.deepEqual(await pinned(), []);
  } finally { await s.context.close(); }
});
