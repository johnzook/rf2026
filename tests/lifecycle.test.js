'use strict';
// TESTPLAN group F (row lifecycle on the current day).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);
const ride = (pinny, rider, h, min, phase = 'Dressage', venue = 'R4') =>
  F.entry({ pinny, rider, details: [F.ridingDetail({ phase, venue, time: F.rideTimeStr(2026, 7, 18, h, min) })] });

// Timeline at 12:00 — 11:30 (past), 11:55 (underway), 12:20 (soon),
// 12:45, 13:00, 14:30 (future).
const dayFeed = () => F.feed([
  ride(640, F.FOLLOWED.zook, 11, 30),
  ride(641, F.FOLLOWED.aulita, 11, 55),
  ride(642, F.FOLLOWED.crocker, 12, 20),
  ride(643, F.FOLLOWED.grandia, 12, 45),
  ride(644, F.FOLLOWED.mcmahan, 13, 0),
  ride(645, F.FOLLOWED.corkery, 14, 30),
]);

test('F23: activeUntil = listed time + 10 min grace; estimates extend it', async () => {
  const s = await openPage({ server, feed: dayFeed(), now: NOON });
  try {
    const past = await rowInfo(s.page, 640);   // 11:30 + 10 < 12:00
    const grace = await rowInfo(s.page, 641);  // 11:55 + 10 > 12:00
    assert.ok(past.classes.includes('past'));
    assert.ok(!grace.classes.includes('past'), 'still active within grace');
    assert.equal(grace.countdown, 'underway');

    // An estimate extends the active window: listed 11:30, est slot 12:30.
    await s.page.evaluate(() => {
      EST_IDX['640|Dressage'] = { when: new Date(2026, 6, 18, 12, 30), note: 'held late' };
      rides = extractRides(lastFeed);
      render();
    });
    const extended = await rowInfo(s.page, 640);
    assert.ok(!extended.classes.includes('past'), 'estimate pushes activeUntil out');
    assert.equal(extended.countdown, 'underway');
    // ...until est + grace passes.
    await s.page.evaluate(ms => { window.__setNow(ms); render(); }, denverMs(2026, 7, 18, 12, 41));
    assert.ok((await rowInfo(s.page, 640)).classes.includes('past'));
  } finally { await s.context.close(); }
});

test('F23b: a posted phase score ends "underway" immediately; never a future ride; out codes excluded', async () => {
  const s = await openPage({ server, feed: dayFeed(), now: NOON });
  try {
    // 641 (11:55) is inside its grace window -> underway...
    assert.equal((await rowInfo(s.page, 641)).countdown, 'underway');
    // ...until its phase score posts, which flips it to done at once.
    await s.page.evaluate(() => {
      resultsIdx['641|Test Division'] = { DressageScore: '31.0', DressagePlace: '2', FinalPlace: '2' };
      scoringByDiv['Test Division'] = [resultsIdx['641|Test Division']];
      render();
    });
    const done = await rowInfo(s.page, 641);
    assert.ok(done.classes.includes('past'), 'posted score ends the grace window');
    assert.ok(done.countdown.startsWith('✓ Dressage 2nd'), done.countdown);

    // A posted score never marks a FUTURE ride done (642 rides at 12:20).
    await s.page.evaluate(() => {
      resultsIdx['642|Test Division'] = { DressageScore: '30.0', DressagePlace: '1', FinalPlace: '1' };
      render();
    });
    assert.equal((await rowInfo(s.page, 642)).countdown, 'in 20 min');

    // An out code in the score field is not a posted result.
    await s.page.evaluate(() => {
      resultsIdx['641|Test Division'].DressageScore = 'E';
      resultsIdx['641|Test Division'].DressagePlace = '';
      resultsIdx['641|Test Division'].FinalPlace = 'E';
      render();
    });
    assert.equal((await rowInfo(s.page, 641)).countdown, 'eliminated');
  } finally { await s.context.close(); }
});

test('F24: countdown wording: "in N min", "in H h M min", "underway"', async () => {
  const s = await openPage({ server, feed: dayFeed(), now: NOON });
  try {
    assert.equal((await rowInfo(s.page, 642)).countdown, 'in 20 min');
    assert.equal((await rowInfo(s.page, 643)).countdown, 'in 45 min');
    assert.equal((await rowInfo(s.page, 644)).countdown, 'in 1 h 0 min', 'hour form at exactly 60');
    assert.equal((await rowInfo(s.page, 645)).countdown, 'in 2 h 30 min');
    assert.equal((await rowInfo(s.page, 641)).countdown, 'underway');
  } finally { await s.context.close(); }
});

test('F25: next-up tag on first active row; reads "Now" once underway, "Next up" before', async () => {
  const s = await openPage({ server, feed: dayFeed(), now: NOON });
  try {
    // At 12:00 the first non-past row is 641, already underway.
    assert.equal((await rowInfo(s.page, 641)).nextTag, 'Now');
    assert.equal((await rowInfo(s.page, 642)).nextTag, null, 'only one tag');
    assert.ok((await rowInfo(s.page, 641)).classes.includes('next-up'));

    // Earlier in the day the first row hasn't started: label "Next up".
    await s.page.evaluate(ms => { window.__setNow(ms); render(); }, denverMs(2026, 7, 18, 11, 10));
    assert.equal((await rowInfo(s.page, 640)).nextTag, 'Next up');
  } finally { await s.context.close(); }
});

test('F26: soon highlight within 30 min; next-up styling wins over soon', async () => {
  const s = await openPage({ server, feed: dayFeed(), now: NOON });
  try {
    const soonRow = await rowInfo(s.page, 642);   // in 20 min
    const laterRow = await rowInfo(s.page, 643);  // in 45 min
    const nextRow = await rowInfo(s.page, 641);   // underway + next-up (also within 30)
    assert.ok(soonRow.classes.includes('soon'));
    assert.ok(!laterRow.classes.includes('soon'), 'outside the 30 min window');
    assert.equal(soonRow.borderColor, 'rgb(180, 83, 9)', 'soon border color');
    // CSS precedence: a next-up row keeps the accent border even if soon.
    assert.ok(nextRow.classes.includes('soon'));
    assert.equal(nextRow.borderColor, 'rgb(26, 107, 60)', 'next-up wins over soon');
  } finally { await s.context.close(); }
});

test('F27: now-line placed by adjusted time, today only, labeled with the clock', async () => {
  const s = await openPage({ server, feed: dayFeed(), now: NOON });
  try {
    const probe = () => s.page.evaluate(() => {
      const el = document.querySelector('.now-line');
      if (!el) return null;
      const kids = [...document.getElementById('list').children];
      const pin = n => { const b = n && n.querySelector && n.querySelector('.horse b'); return b ? b.textContent : null; };
      return { index: kids.indexOf(el), label: el.textContent, prev: pin(el.previousElementSibling), next: pin(el.nextElementSibling) };
    });
    let r = await probe();
    // 641 (11:55) is still ACTIVE/underway, but the marker sits by time:
    // after 11:55, before 12:20.
    assert.equal(r.prev, '#641');
    assert.equal(r.next, '#642');
    assert.equal(r.label, 'now · 12:00 PM');

    // Before all rides -> first; after all rides -> last.
    await s.page.evaluate(ms => { window.__setNow(ms); render(); }, denverMs(2026, 7, 18, 6, 0));
    r = await probe();
    assert.equal(r.index, 0);
    await s.page.evaluate(ms => { window.__setNow(ms); render(); }, denverMs(2026, 7, 18, 23, 0));
    r = await probe();
    assert.equal(r.prev, '#645', 'after the last row');

    // Not shown when viewing another day.
    await s.page.evaluate(() => {
      window.__setNow(Date.UTC(2026, 6, 17, 18, 0)); // Fri noon MDT
      selectedDay = '2026-07-18';
      render();
    });
    assert.equal(await probe(), null, 'no now-line off-today');
  } finally { await s.context.close(); }
});
