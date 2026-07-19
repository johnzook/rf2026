'use strict';
// TESTPLAN group B (day chips & default day).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, chipLabels } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const rideOn = (pinny, rider, m, d, h, min, phase = 'Dressage', venue = 'R4') =>
  F.entry({ pinny, rider, details: [F.ridingDetail({ phase, venue, time: F.rideTimeStr(2026, m, d, h, min) })] });

test('B9: one chip per day with followed rides, in order, "Today" labeled', async () => {
  const fx = F.feed([
    rideOn(611, F.FOLLOWED.zook, 7, 18, 9, 0),
    rideOn(612, F.FOLLOWED.aulita, 7, 16, 15, 0),
    rideOn(613, F.FOLLOWED.crocker, 7, 17, 10, 0, 'Cross Country', 'XC'),
    rideOn(614, 'Unfollowed, Person', 7, 20, 10, 0), // must NOT create a chip
  ]);
  const s = await openPage({ server, feed: fx, now: denverMs(2026, 7, 17, 12, 0) });
  try {
    assert.deepEqual(await chipLabels(s.page), ['Thu, Jul 16', 'Today*', 'Sat, Jul 18']);
  } finally { await s.context.close(); }
});

test('B10: default day = today > next day with rides > last day; selection sticks', async () => {
  // (a) today has rides -> today is active (covered in B9 too).
  // (b) today empty -> next day with rides.
  const fxFuture = F.feed([
    rideOn(615, F.FOLLOWED.zook, 7, 16, 9, 0),
    rideOn(616, F.FOLLOWED.aulita, 7, 19, 9, 0),
  ]);
  let s = await openPage({ server, feed: fxFuture, now: denverMs(2026, 7, 17, 12, 0) });
  try {
    assert.deepEqual(await chipLabels(s.page), ['Thu, Jul 16', 'Sun, Jul 19*'], 'skips past day, picks next');

    // Selection sticks across re-renders (poll ticks call render()).
    await s.page.click('#days .day-chip'); // pick Jul 16
    assert.deepEqual(await chipLabels(s.page), ['Thu, Jul 16*', 'Sun, Jul 19']);
    await s.page.evaluate(() => render());
    assert.deepEqual(await chipLabels(s.page), ['Thu, Jul 16*', 'Sun, Jul 19'], 'chip choice survives re-render');
  } finally { await s.context.close(); }

  // (c) all days in the past -> last day.
  const fxPast = F.feed([
    rideOn(617, F.FOLLOWED.zook, 7, 15, 9, 0),
    rideOn(618, F.FOLLOWED.aulita, 7, 16, 9, 0),
  ]);
  s = await openPage({ server, feed: fxPast, now: denverMs(2026, 7, 18, 12, 0) });
  try {
    assert.deepEqual(await chipLabels(s.page), ['Wed, Jul 15', 'Thu, Jul 16*'], 'falls back to last day');
  } finally { await s.context.close(); }
});
