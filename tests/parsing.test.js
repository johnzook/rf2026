'use strict';
// TESTPLAN group A (feed parsing) + N54 (helpers).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs } = require('./helpers');
const F = require('./fixtures/builders');

let server, session;
before(async () => {
  server = await startServer();
  // One shared page is enough for pure-function unit tests.
  session = await openPage({ server, feed: F.feed([]) , waitLoaded: false });
  await session.page.waitForFunction(() => lastUpdatedMs !== null);
});
after(async () => {
  await session.context.close();
  await server.close();
  await closeBrowser();
});

test('A1: parseRideTime parses the feed format incl. 12 AM/PM edges; null on bad input', async () => {
  const r = await session.page.evaluate(() => {
    const parts = d => d && [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
    return {
      basic: parts(parseRideTime('Fri, Jul 17, 2026, 12:30:00 PM')),
      pm: parts(parseRideTime('Sat, Jul 18, 2026, 4:05:09 PM')),
      am: parts(parseRideTime('Sat, Jul 18, 2026, 8:46:00 AM')),
      noon: parts(parseRideTime('Sun, Jul 19, 2026, 12:00:00 PM')),
      midnight: parts(parseRideTime('Sun, Jul 19, 2026, 12:00:00 AM')),
      empty: parseRideTime(''),
      undef: parseRideTime(undefined),
      noSeconds: parseRideTime('Fri, Jul 17, 2026, 12:30 PM'),
      badMonth: parseRideTime('Fri, Jjj 17, 2026, 12:30:00 PM'),
      garbage: parseRideTime('2026-07-17T12:30:00Z'),
    };
  });
  assert.deepEqual(r.basic, [2026, 6, 17, 12, 30, 0]);
  assert.deepEqual(r.pm, [2026, 6, 18, 16, 5, 9]);
  assert.deepEqual(r.am, [2026, 6, 18, 8, 46, 0]);
  assert.deepEqual(r.noon, [2026, 6, 19, 12, 0, 0], '12 PM is noon');
  assert.deepEqual(r.midnight, [2026, 6, 19, 0, 0, 0], '12 AM is midnight');
  for (const k of ['empty', 'undef', 'noSeconds', 'badMonth', 'garbage']) assert.equal(r[k], null, k);
});

test('A2: Venues[].date/time is a publish timestamp, never the ride time', async () => {
  // RideTimes says Jul 17; Venues[].date says Jul 18. The ride must be
  // bucketed under Jul 17.
  const fx = F.feed([
    F.entry({
      pinny: 601, rider: F.FOLLOWED.zook,
      details: [F.ridingDetail({
        phase: 'Dressage', venue: 'R4',
        time: F.rideTimeStr(2026, 7, 17, 9, 30),
        venueDate: '2026-07-18', venueTime: '11:59:59.000',
      })],
    }),
  ]);
  const r = await session.page.evaluate(fx => {
    const rides = extractRides(fx);
    return rides.map(x => ({ dayKey: x.dayKey, h: x.when.getHours(), m: x.when.getMinutes() }));
  }, fx);
  assert.deepEqual(r, [{ dayKey: '2026-07-17', h: 9, m: 30 }]);
});

test('A3: phases with empty RideTimes are skipped (not yet scheduled)', async () => {
  const fx = F.feed([
    F.entry({
      pinny: 602, rider: F.FOLLOWED.zook,
      details: [
        F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 17, 9, 0) }),
        F.ridingDetail({ phase: 'Phase A', venue: null, time: '' }),
        F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: '' }),
      ],
    }),
  ]);
  const phases = await session.page.evaluate(fx => extractRides(fx).map(r => r.phase), fx);
  assert.deepEqual(phases, ['Dressage']);
});

test('A4: rider filter matches RiderName verbatim, no normalization', async () => {
  const detail = () => [F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 17, 9, 0) })];
  const fx = F.feed([
    F.entry({ pinny: 603, rider: 'Zook, Penelope', details: detail() }),   // exact -> in
    F.entry({ pinny: 604, rider: 'zook, penelope', details: detail() }),   // case -> out
    F.entry({ pinny: 605, rider: 'Penelope Zook', details: detail() }),    // format -> out
    F.entry({ pinny: 606, rider: 'Zook,  Penelope', details: detail() }),  // spacing -> out
  ]);
  const pinnies = await session.page.evaluate(fx => extractRides(fx).map(r => r.pinny), fx);
  assert.deepEqual(pinnies, [603]);
});

test('A5: non-Accepted entries are skipped even with ride times', async () => {
  const detail = () => [F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 17, 9, 0) })];
  const fx = F.feed([
    F.entry({ pinny: 607, rider: F.FOLLOWED.zook, status: 'Scratched', details: detail() }),
    F.entry({ pinny: 608, rider: F.FOLLOWED.aulita, status: 'Withdrawn', details: detail() }),
    F.entry({ pinny: 609, rider: F.FOLLOWED.crocker, status: 'Accepted', details: detail() }),
  ]);
  const pinnies = await session.page.evaluate(fx => extractRides(fx).map(r => r.pinny), fx);
  assert.deepEqual(pinnies, [609]);
});

test('A6: flattening yields one row per entry x scheduled phase with all fields', async () => {
  const fx = F.feed([
    F.entry({
      pinny: 610, rider: F.FOLLOWED.grandia, horse: 'GHS Test', division: 'Open Novice A', divisionShort: 'ONA',
      details: [
        F.ridingDetail({ phase: 'Dressage', venue: 'R2', time: F.rideTimeStr(2026, 7, 16, 15, 9) }),
        F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 8, 46) }),
        F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 19, 12, 25) }),
      ],
    }),
  ]);
  const rides = await session.page.evaluate(fx => extractRides(fx).map(r => ({
    phase: r.phase, venue: r.venue, rider: r.rider, horse: r.horse,
    pinny: r.pinny, division: r.division, divisionShort: r.divisionShort,
    dayKey: r.dayKey, hm: [r.when.getHours(), r.when.getMinutes()],
  })), fx);
  assert.equal(rides.length, 3);
  assert.deepEqual(rides[0], {
    phase: 'Dressage', venue: 'R2', rider: 'Grandia, Marc', horse: 'GHS Test',
    pinny: 610, division: 'Open Novice A', divisionShort: 'ONA',
    dayKey: '2026-07-16', hm: [15, 9],
  });
  assert.deepEqual(rides.map(r => [r.phase, r.venue, r.dayKey]), [
    ['Dressage', 'R2', '2026-07-16'],
    ['Cross Country', 'XC', '2026-07-18'],
    ['Show Jumping', 'SJR1', '2026-07-19'],
  ]);
});

test('A7: eventLocalNow returns Mountain wall clock regardless of host TZ', async () => {
  // Pinned instant: Sat Jul 18 2026 09:30:00 MDT == 15:30 UTC == Jul 19 00:30 Tokyo.
  const instant = denverMs(2026, 7, 18, 9, 30, 0);
  for (const timezoneId of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
    const s = await openPage({ server, feed: F.feed([]), now: instant, timezoneId, waitLoaded: false });
    try {
      await s.page.waitForFunction(() => lastUpdatedMs !== null);
      const r = await s.page.evaluate(() => {
        const n = eventLocalNow();
        return [n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()];
      });
      assert.deepEqual(r, [2026, 6, 18, 9, 30, 0], `tz=${timezoneId}`);
    } finally {
      await s.context.close();
    }
  }
});

test('A8: day keys are zero-padded ISO and sort correctly as strings', async () => {
  const r = await session.page.evaluate(() => ({
    early: isoDay(new Date(2026, 6, 5)),
    later: isoDay(new Date(2026, 6, 17)),
    jan: isoDay(new Date(2026, 0, 3)),
  }));
  assert.equal(r.early, '2026-07-05');
  assert.equal(r.later, '2026-07-17');
  assert.equal(r.jan, '2026-01-03');
  assert.ok(r.early < r.later, 'plain string sort respects date order');
  assert.deepEqual(['2026-07-17', '2026-07-05'].sort(), ['2026-07-05', '2026-07-17']);
});

test('N54: fmtClock 12-hour behavior and ordinal suffixes', async () => {
  const r = await session.page.evaluate(() => ({
    midnight: fmtClock(new Date(2026, 6, 18, 0, 5)),
    morning: fmtClock(new Date(2026, 6, 18, 8, 46)),
    noon: fmtClock(new Date(2026, 6, 18, 12, 0)),
    afternoon: fmtClock(new Date(2026, 6, 18, 13, 7)),
    night: fmtClock(new Date(2026, 6, 18, 23, 59)),
    ords: [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(n => n + ordinal(n)),
    strOrd: '2' + ordinal('2'),
    nan: ordinal('E'),
  }));
  assert.equal(r.midnight, '12:05 AM');
  assert.equal(r.morning, '8:46 AM');
  assert.equal(r.noon, '12:00 PM');
  assert.equal(r.afternoon, '1:07 PM');
  assert.equal(r.night, '11:59 PM');
  assert.deepEqual(r.ords, ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  assert.equal(r.strOrd, '2nd');
  assert.equal(r.nan, '');
});
