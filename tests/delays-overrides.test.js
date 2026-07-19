'use strict';
// TESTPLAN groups C (delays) and D (overrides). The baked config has
// DELAY_DATE = 2026-07-17 with SJR4 +90 / R1 +60 / R2 +90 / R3 +90.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo, chipLabels } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON_FRI = denverMs(2026, 7, 17, 12, 0); // DELAY_DATE
const ride = (pinny, rider, opts) => F.entry({ pinny, rider, details: [F.ridingDetail(opts)] });

// Baked EXTRAS has a Jul 17 course walk; clear it so delay-day lists hold
// only fixture rows.
const clearExtras = page => page.evaluate(() => { EXTRAS.length = 0; render(); });

test('C11: adjustedTime applies DELAYS[venue] only on DELAY_DATE', async () => {
  const s = await openPage({ server, feed: F.feed([]), now: NOON_FRI, waitLoaded: false });
  try {
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const r = await s.page.evaluate(() => {
      const mk = (dayKey, venue) => {
        const [y, m, d] = dayKey.split('-').map(Number);
        return { when: new Date(y, m - 1, d, 9, 0), override: null, dayKey, venue };
      };
      const probe = x => { const a = adjustedTime(x); return [fmtClock(a.adj), a.delayMin, a.revised]; };
      return {
        delayDay: probe(mk('2026-07-17', 'SJR4')),
        otherDay: probe(mk('2026-07-18', 'SJR4')),
        zeroVenue: probe(mk('2026-07-17', 'XC')),
        unknownVenue: probe(mk('2026-07-17', 'NoSuchRing')),
      };
    });
    assert.deepEqual(r.delayDay, ['10:30 AM', 90, false], '+90 min on the delay date');
    assert.deepEqual(r.otherDay, ['9:00 AM', 0, false], 'same venue, other day: unshifted');
    assert.deepEqual(r.zeroVenue, ['9:00 AM', 0, false]);
    assert.deepEqual(r.unknownVenue, ['9:00 AM', 0, false]);
  } finally { await s.context.close(); }
});

test('C12+C13: delayed rows show struck original and the list re-sorts by adjusted time', async () => {
  const fx = F.feed([
    // Feed order: delayed ride first. Sched 2:00 PM + 90 -> 3:30 PM.
    ride(620, F.FOLLOWED.zook, { phase: 'Show Jumping', venue: 'SJR4', time: F.rideTimeStr(2026, 7, 17, 14, 0) }),
    // Undelayed 2:10 PM must sort BEFORE the delayed 2:00 PM ride.
    ride(621, F.FOLLOWED.aulita, { phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 14, 10) }),
  ]);
  const s = await openPage({ server, feed: fx, now: NOON_FRI });
  try {
    await clearExtras(s.page);
    const delayed = await rowInfo(s.page, 620);
    const plain = await rowInfo(s.page, 621);
    assert.equal(delayed.adj, '3:30 PM');
    assert.equal(delayed.orig, '2:00 PM', 'original time struck through');
    assert.equal(plain.adj, '2:10 PM');
    assert.equal(plain.orig, null, 'no strikethrough without a delay');
    assert.ok(plain.index < delayed.index, 'C13: sorted by adjusted, not scheduled, time');
  } finally { await s.context.close(); }
});

test('C14: delay banner lists non-zero venues, only when viewing DELAY_DATE', async () => {
  const fx = F.feed([
    ride(622, F.FOLLOWED.zook, { phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 14, 0) }),
    ride(623, F.FOLLOWED.aulita, { phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 18, 9, 0) }),
  ]);
  const s = await openPage({ server, feed: fx, now: NOON_FRI });
  try {
    const banner = await s.page.evaluate(() => {
      const b = document.getElementById('delay-banner');
      return { hidden: b.hidden, text: b.textContent };
    });
    assert.equal(banner.hidden, false, 'visible on the delay date');
    assert.match(banner.text, /^Delays: /);
    assert.ok(banner.text.includes('SJR4 +90 min'), banner.text);
    assert.ok(banner.text.includes('R1 +60 min'), banner.text);
    assert.ok(!banner.text.includes('XC'), 'zero-delay venues omitted');

    // Viewing another day hides it.
    await s.page.click('#days .day-chip:last-child');
    assert.equal(await s.page.$eval('#delay-banner', b => b.hidden), true, 'hidden on other days');

    // All delays zero -> hidden even on the delay date.
    await s.page.click('#days .day-chip:first-child');
    assert.equal(await s.page.$eval('#delay-banner', b => b.hidden), false);
    await s.page.evaluate(() => { for (const k of Object.keys(DELAYS)) DELAYS[k] = 0; render(); });
    assert.equal(await s.page.$eval('#delay-banner', b => b.hidden), true, 'hidden with no active delays');
  } finally { await s.context.close(); }
});

test('D15: an override replaces the feed time; venue delay is not stacked', async () => {
  const fx = F.feed([
    // SJR4 carries +90 on Jul 17; the override must win outright.
    ride(624, F.FOLLOWED.crocker, { phase: 'Show Jumping', venue: 'SJR4', time: F.rideTimeStr(2026, 7, 17, 15, 0) }),
  ]);
  const s = await openPage({ server, feed: fx, now: NOON_FRI });
  try {
    const r = await s.page.evaluate(() => {
      OVERRIDE_IDX['624|Show Jumping'] = new Date(2026, 6, 17, 17, 0);
      rides = extractRides(lastFeed);
      const a = adjustedTime(rides[0]);
      return { adj: fmtClock(a.adj), delayMin: a.delayMin, revised: a.revised };
    });
    assert.deepEqual(r, { adj: '5:00 PM', delayMin: 0, revised: true },
      'override time exactly, not 5:00+90 nor 3:00+90');
  } finally { await s.context.close(); }
});

test('D16: an override can move a ride to another day chip', async () => {
  const fx = F.feed([
    ride(625, F.FOLLOWED.zook, { phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 17, 10, 0) }),
    ride(626, F.FOLLOWED.aulita, { phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 9, 0) }),
  ]);
  const s = await openPage({ server, feed: fx, now: NOON_FRI });
  try {
    await s.page.evaluate(() => {
      OVERRIDE_IDX['625|Cross Country'] = new Date(2026, 6, 18, 10, 0); // moved to Sat
      rides = extractRides(lastFeed);
      EXTRAS.length = 0;
      render();
    });
    assert.deepEqual(await chipLabels(s.page), ['Today*', 'Sat, Jul 18'], 'Sat chip appears');
    assert.equal(await rowInfo(s.page, 625), null, 'moved ride gone from Jul 17');
    assert.ok(await rowInfo(s.page, 626), 'other ride still on Jul 17');
    await s.page.click('#days .day-chip:last-child');
    const moved = await rowInfo(s.page, 625);
    assert.ok(moved, 'ride shows under the override day');
    assert.equal(moved.adj, '10:00 AM');
  } finally { await s.context.close(); }
});

test('D17: revised rows show strikethrough + "(revised; sched X)"; equal override shows neither', async () => {
  const fx = F.feed([
    ride(627, F.FOLLOWED.zook, { phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 17, 15, 0) }),
    ride(628, F.FOLLOWED.aulita, { phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 17, 14, 0) }),
  ]);
  const s = await openPage({ server, feed: fx, now: NOON_FRI });
  try {
    await s.page.evaluate(() => {
      OVERRIDE_IDX['627|Show Jumping'] = new Date(2026, 6, 17, 17, 0);  // real revision
      OVERRIDE_IDX['628|Dressage'] = new Date(2026, 6, 17, 14, 0);      // equals feed time
      rides = extractRides(lastFeed);
      EXTRAS.length = 0;
      render();
    });
    const revised = await rowInfo(s.page, 627);
    assert.equal(revised.adj, '5:00 PM');
    assert.equal(revised.orig, '3:00 PM', 'original struck through');
    assert.ok(revised.pop.includes('(revised; sched 3:00 PM)'), revised.pop);

    const same = await rowInfo(s.page, 628);
    assert.equal(same.adj, '2:00 PM');
    assert.equal(same.orig, null, 'no strikethrough when override equals feed time');
    assert.ok(!same.pop.includes('revised'), same.pop);
  } finally { await s.context.close(); }
});
