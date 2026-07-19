'use strict';
// Regression tests for bugs found during the adversarial bug-hunt pass.
// Each test is named BUG-<slug> and reproduces the original defect: it fails
// against the pre-fix index.html and passes against the fixed one.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, cacheBlob } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);

// The done-line countdown is built with innerHTML; the "next: <phase> ..."
// text includes the feed's phase name verbatim. Unknown phase names (anything
// outside the PHASE_SHORT map) must arrive escaped, per TESTPLAN N53.
test('BUG-phase-escape: feed phase names are escaped in the "next:" done line', async () => {
  const evilPhase = 'Phase <img src=x onerror="window.__xss=1">';
  const feed = F.feed([
    F.entry({ pinny: 860, rider: F.FOLLOWED.zook, division: 'DivP', details: [
      // Past ride -> done line; future ride in the evil phase -> "next: <evil>".
      F.ridingDetail({ phase: evilPhase, venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 9, 0) }),
      F.ridingDetail({ phase: evilPhase, venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 15, 0) }),
    ] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    const r = await s.page.evaluate(() => ({
      xss: window.__xss,
      imgs: document.querySelectorAll('#list img').length,
      doneLine: document.querySelector('#list .countdown.done').textContent.replace(/\s+/g, ' ').trim(),
    }));
    assert.equal(r.xss, undefined, 'onerror never fired');
    assert.equal(r.imgs, 0, 'no element injected via the phase name');
    assert.equal(r.doneLine,
      '✓ scores pending · next: Phase <img src=x onerror="window.__xss=1"> 3:00 PM',
      'phase name shown literally in the done line');
  } finally { await s.context.close(); }
});

// The row omits the pinny when PinnyNumber is null (TESTPLAN N52); the
// popover subtitle used to render a dangling "· #" instead.
test('BUG-null-pinny-popover: popover subtitle omits the pinny when PinnyNumber is null', async () => {
  const feed = F.feed([
    F.entry({ pinny: null, rider: F.FOLLOWED.zook, horse: 'NoNumber', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
    F.entry({ pinny: 861, rider: F.FOLLOWED.aulita, horse: 'HasNumber', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    const subs = await s.page.$$eval('#list .row .pop .pop-sub', els => els.map(e => e.textContent));
    assert.deepEqual(subs, ['NoNumber', 'HasNumber · #861'],
      'no dangling "· #" for the unnumbered entry; numbered entry unchanged');
  } finally { await s.context.close(); }
});

// nextRideInfo matched combos by pinny with `!==`, so two different combos
// that both had PinnyNumber null compared equal — a done line could point at
// another rider's ride. Null-pinny combos must fall back to rider+horse.
test('BUG-null-pinny-next: two unnumbered combos are never conflated by nextRideInfo', async () => {
  const feed = F.feed([
    // Zook/H1: dressage done this morning, own XC at 15:00.
    F.entry({ pinny: null, rider: F.FOLLOWED.zook, horse: 'H1', division: 'DivA', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 9, 0) }),
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 15, 0) }),
    ] }),
    // Aulita/H2, also unnumbered, rides EARLIER (14:00) — the buggy version
    // picked this as Zook's "next" ride.
    F.entry({ pinny: null, rider: F.FOLLOWED.aulita, horse: 'H2', division: 'DivB', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 14, 0) }),
    ] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    const doneLine = await s.page.$eval('#list .countdown.done',
      e => e.textContent.replace(/\s+/g, ' ').trim());
    assert.equal(doneLine, '✓ scores pending · next: XC 3:00 PM',
      'points at Zook\'s own 15:00 ride, not Aulita\'s 14:00');
  } finally { await s.context.close(); }
});

// getStoredList caught JSON.parse errors but returned any valid-JSON value
// as-is; a non-array (e.g. written by another tool on the same origin) made
// effectiveFollowing() throw inside the fetch handler — zero rows plus a
// misleading "can't reach ShowConnect" note, forever.
test('BUG-myriders-non-array: non-array JSON in the follow-list keys degrades to the baked list', async () => {
  const feed = F.feed([
    F.entry({ pinny: 862, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON, localStorage: {
    'rf2026:myRiders': '{"oops":1}',
    'rf2026:hiddenRiders': '"a string"',
  } });
  try {
    const r = await s.page.evaluate(() => ({
      rows: document.querySelectorAll('#list .row').length,
      err: document.getElementById('fetch-err').textContent,
      status: document.getElementById('status').textContent,
      mine: getMyRiders(),
      hidden: getHiddenRiders(),
    }));
    assert.equal(r.rows, 1, 'the followed ride renders');
    assert.equal(r.err, '', 'no phantom network-error note');
    assert.ok(r.status.includes('9 riders followed'), r.status);
    assert.deepEqual(r.mine, []);
    assert.deepEqual(r.hidden, []);
    assert.equal(s.page.__pageError, undefined);

    // The sheet (another getStoredList consumer) opens and works too.
    await s.page.click('#edit-riders');
    const listed = await s.page.$$eval('#my-riders-list .rrow', els => els.length);
    assert.equal(listed, 9, 'sheet lists the baked follow list');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

// Cache hydration ran unguarded at top level: a cached payload of the wrong
// shape (older app version, corrupted storage) threw before the fetch calls
// and event listeners were installed, leaving the page dead on "Loading…"
// even with a healthy network.
test('BUG-cache-hydrate-crash: a malformed cached payload never bricks the page', async () => {
  const feed = F.feed([
    F.entry({ pinny: 863, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON, localStorage: {
    // Valid JSON, wrong shape: EntryList is not iterable.
    'rf2026:event': cacheBlob(NOON - 60_000, { EntryList: 5 }),
    'rf2026:scoring': cacheBlob(NOON - 60_000, { DivisionsList: 7, ScoringList: 7 }),
  } });
  try {
    assert.equal(s.page.__pageError, undefined, 'no uncaught top-level error');
    const r = await s.page.evaluate(() => ({
      rows: document.querySelectorAll('#list .row').length,
      status: document.getElementById('status').textContent,
    }));
    assert.equal(r.rows, 1, 'network data replaced the bad cache');
    assert.ok(r.status.startsWith('Updated'), r.status);
  } finally { await s.context.close(); }
});
