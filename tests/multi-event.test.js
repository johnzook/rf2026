'use strict';
// TESTPLAN P72–P76: per-event storage isolation & eviction, legacy
// migration, event identity (name/title/footer), timezone derivation, and
// the empty follow state.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer, openPage, closeBrowser, denverMs, DEFAULT_NOW, cacheBlob, rowInfo,
} = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);
const rideAt = (pinny, rider, d, h, min) =>
  F.entry({ pinny, rider, details: [
    F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, d, h, min) })] });
const twoDayFeed = () => F.feed([
  rideAt(730, F.FOLLOWED.zook, 17, 9, 0),
  rideAt(731, F.FOLLOWED.zook, 18, 13, 0),
]);

test('P72: riders stored for one event never leak into another; edits write the other event\'s own key', async () => {
  // Event 1211 opened in a browser that has a 1187 follow list stored.
  const s = await openPage({
    server, eventId: 1211, riders: null, now: NOON,
    feed: twoDayFeed(), // contains Zook — but the 1211 list is empty
    localStorage: { 'sc:1187:riders': JSON.stringify(F.FOLLOWING_NAMES) },
  });
  try {
    const r = await s.page.evaluate(() => ({
      key: RIDERS_KEY,
      eff: effectiveFollowing(),
      hasPrompt: !!document.getElementById('add-riders-btn'),
      last: localStorage.getItem('sc:last-event'),
    }));
    assert.equal(r.key, 'sc:1211:riders');
    assert.deepEqual(r.eff, [], '1187 riders do not leak into 1211');
    assert.equal(r.hasPrompt, true, 'empty state despite the feed containing those riders');
    assert.equal(r.last, '1211', 'sc:last-event tracks the viewed event');

    // Adding a rider here writes 1211's key and leaves 1187's untouched.
    await s.page.click('#add-riders-btn');
    await s.page.fill('#rider-search', 'zook');
    await s.page.click('#rider-results button.rbtn.add[data-n="Zook, Penelope"]');
    const after = await s.page.evaluate(() => ({
      mine: JSON.parse(localStorage.getItem('sc:1211:riders')),
      other: JSON.parse(localStorage.getItem('sc:1187:riders')),
    }));
    assert.deepEqual(after.mine, ['Zook, Penelope']);
    assert.deepEqual(after.other, F.FOLLOWING_NAMES, '1187 list untouched');
  } finally { await s.context.close(); }
});

test('P72: sc:reloadState is only restored for the matching event id', async () => {
  const s = await openPage({ server, feed: twoDayFeed(), now: NOON });
  try {
    // Wrong event id, fresh stamp: discarded (and consumed).
    await s.page.evaluate(() => sessionStorage.setItem('sc:reloadState',
      JSON.stringify({ at: Date.now(), eventId: 1211, selectedDay: '2026-07-17', scrollY: 100 })));
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const wrong = await s.page.evaluate(() => ({
      day: selectedDay,
      chip: document.querySelector('#days .day-chip.active').textContent,
      keyLeft: sessionStorage.getItem('sc:reloadState'),
    }));
    assert.equal(wrong.day, null, 'another event\'s state not restored');
    assert.equal(wrong.chip, 'Today');
    assert.equal(wrong.keyLeft, null, 'key consumed either way');

    // Matching event id: restored as before.
    await s.page.evaluate(() => sessionStorage.setItem('sc:reloadState',
      JSON.stringify({ at: Date.now(), eventId: 1187, selectedDay: '2026-07-17', scrollY: 0 })));
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    assert.equal(await s.page.evaluate(() => selectedDay), '2026-07-17', 'own state restored');
  } finally { await s.context.close(); }
});

test('P72: other events\' feed caches are evicted after a successful fetch; every :riders list is kept', async () => {
  const s = await openPage({
    server, feed: twoDayFeed(), now: NOON,
    localStorage: {
      'sc:999:event': cacheBlob(NOON - 60_000, { EntryList: [] }),
      'sc:999:scoring': cacheBlob(NOON - 60_000, { ScoringList: [] }),
      'sc:999:riders': JSON.stringify(['Keep, Me']),
    },
  });
  try {
    const r = await s.page.evaluate(() => ({
      otherEvent: localStorage.getItem('sc:999:event'),
      otherScoring: localStorage.getItem('sc:999:scoring'),
      otherRiders: JSON.parse(localStorage.getItem('sc:999:riders')),
      ownEvent: !!localStorage.getItem('sc:1187:event'),
      ownScoring: !!localStorage.getItem('sc:1187:scoring'),
    }));
    assert.equal(r.otherEvent, null, 'stale foreign feed cache evicted');
    assert.equal(r.otherScoring, null, 'stale foreign scoring cache evicted');
    assert.deepEqual(r.otherRiders, ['Keep, Me'], ':riders is precious — never evicted');
    assert.equal(r.ownEvent, true, 'own cache written');
    assert.equal(r.ownScoring, true);
  } finally { await s.context.close(); }
});

test('P73: legacy rf2026:myRiders migrates into sc:1187:riders (1187 only, strings only, existing store wins); legacy caches deleted', async () => {
  // (a) 1187 with no stored list: legacy adds become the follow list; the
  // legacy feed caches are freed.
  let s = await openPage({
    server, feed: twoDayFeed(), now: NOON, riders: null,
    localStorage: {
      'rf2026:myRiders': JSON.stringify(['Zook, Penelope', 42, null, 'Added, Ada']),
      'rf2026:event': '{"stale":1}',
      'rf2026:scoring': '{"stale":2}',
    },
  });
  try {
    const r = await s.page.evaluate(() => ({
      migrated: JSON.parse(localStorage.getItem('sc:1187:riders')),
      legacyEvent: localStorage.getItem('rf2026:event'),
      legacyScoring: localStorage.getItem('rf2026:scoring'),
    }));
    assert.deepEqual(r.migrated, ['Zook, Penelope', 'Added, Ada'], 'non-strings filtered out');
    assert.equal(r.legacyEvent, null, 'rf2026:event freed at boot');
    assert.equal(r.legacyScoring, null, 'rf2026:scoring freed at boot');
    assert.ok(await rowInfo(s.page, 731), 'migrated rider renders');
  } finally { await s.context.close(); }

  // (b) An existing sc:1187:riders list wins over the legacy key.
  s = await openPage({
    server, feed: twoDayFeed(), now: NOON, riders: ['Mine, Only'],
    localStorage: { 'rf2026:myRiders': JSON.stringify(['Zook, Penelope']) },
  });
  try {
    assert.deepEqual(await s.page.evaluate(() => getStoredList(RIDERS_KEY)), ['Mine, Only']);
  } finally { await s.context.close(); }

  // (c) Another event never imports the 1187-era legacy list.
  s = await openPage({
    server, eventId: 1211, feed: twoDayFeed(), now: NOON, riders: null,
    localStorage: { 'rf2026:myRiders': JSON.stringify(['Zook, Penelope']) },
  });
  try {
    const r = await s.page.evaluate(() => ({
      own: localStorage.getItem('sc:1211:riders'),
      eff: effectiveFollowing(),
    }));
    assert.equal(r.own, null, 'no migration for other events');
    assert.deepEqual(r.eff, []);
  } finally { await s.context.close(); }
});

test('P74: event name + title come from EventDetails.EventName; footer shows the derived zone', async () => {
  const s = await openPage({ server, feed: twoDayFeed(), now: NOON });
  try {
    const r = await s.page.evaluate(() => ({
      h1: document.getElementById('event-name').textContent,
      title: document.title,
      footer: document.querySelector('footer').textContent,
    }));
    assert.equal(r.h1, 'Test Event');
    assert.equal(r.title, 'Test Event — Ride Times');
    // Fixture address ends in Montana -> America/Denver -> MDT in July.
    assert.equal(r.footer, 'Times are event-local (MDT). Tap a ride for details.');
  } finally { await s.context.close(); }
});

test('P74: before the feed answers, the calendar cache supplies the name and tz; with nothing, the neutral defaults hold', async () => {
  // Feed carries no EventDetails; a cached calendar names the event and
  // pins the zone from its location string — even on a Tokyo device.
  const s = await openPage({
    server, feed: { EntryList: [] }, now: NOON, timezoneId: 'Asia/Tokyo',
    localStorage: { 'sc:calendar': cacheBlob(NOON - 60_000, F.calendar()) },
  });
  try {
    const r = await s.page.evaluate(() => ({
      h1: document.getElementById('event-name').textContent,
      title: document.title,
      tz: eventTz,
      footer: document.querySelector('footer').textContent,
    }));
    assert.equal(r.h1, 'The Event at Rebecca Farm', 'calendar-cache name used');
    assert.equal(r.title, 'The Event at Rebecca Farm — Ride Times');
    assert.equal(r.tz, 'America/Denver', 'zone derived from the calendar entry location');
    assert.equal(r.footer, 'Times are event-local (MDT). Tap a ride for details.');
  } finally { await s.context.close(); }

  // No EventDetails, no calendar cache: neutral name, device zone.
  const n = await openPage({ server, feed: { EntryList: [] }, now: NOON, timezoneId: 'Asia/Tokyo' });
  try {
    const r = await n.page.evaluate(() => ({
      h1: document.getElementById('event-name').textContent,
      title: document.title,
      tz: eventTz,
    }));
    assert.equal(r.h1, 'Ride Times', 'neutral default name');
    assert.equal(r.title, 'Ride Times');
    assert.equal(r.tz, 'Asia/Tokyo', 'device zone fallback');
  } finally { await n.context.close(); }
});

test('P75: deriveTz maps trailing US state names to primary IANA zones; unknown yields null (device fallback)', async () => {
  const s = await openPage({ server, feed: twoDayFeed(), now: NOON });
  try {
    const r = await s.page.evaluate(() => ({
      montana: deriveTz('1385 Farm to Market Road, Kalispell, Montana'),
      washington: deriveTz('Legacy Farm & Stable, Loon Lake, Washington'),
      zip: deriveTz('Kalispell, Montana 59901'),
      dc: deriveTz('Somewhere, Washington, D.C.'),
      kentucky: deriveTz('Lexington, Kentucky'),
      texas: deriveTz('Onalaska, Texas'),
      caseless: deriveTz('kalispell, MONTANA'),
      firstHitWins: deriveTz('Nowhere, Atlantis', 'Loon Lake, Washington'),
      unknown: deriveTz('Middle, Nowhere'),
      empty: deriveTz('', '   '),
      nonStrings: deriveTz(null, undefined, 42),
      none: deriveTz(),
    }));
    assert.equal(r.montana, 'America/Denver');
    assert.equal(r.washington, 'America/Los_Angeles');
    assert.equal(r.zip, 'America/Denver', 'trailing zip stripped');
    assert.equal(r.dc, 'America/New_York', 'D.C. punctuation tolerated');
    assert.equal(r.kentucky, 'America/New_York');
    assert.equal(r.texas, 'America/Chicago');
    assert.equal(r.caseless, 'America/Denver');
    assert.equal(r.firstHitWins, 'America/Los_Angeles', 'later candidates scanned');
    assert.equal(r.unknown, null);
    assert.equal(r.empty, null);
    assert.equal(r.nonStrings, null);
    assert.equal(r.none, null);

    // The derived zone drives event-local time: same instant, Denver clock.
    const clock = await s.page.evaluate(() => ({
      tz: eventTz,
      now: (d => [d.getHours(), d.getMinutes()])(eventLocalNow()),
    }));
    assert.equal(clock.tz, 'America/Denver');
    assert.deepEqual(clock.now, [12, 0], 'noon MDT under a UTC browser context');
  } finally { await s.context.close(); }
});

test('P76: with nobody followed, the page prompts to add riders instead of an empty timeline', async () => {
  const s = await openPage({ server, feed: twoDayFeed(), now: NOON, riders: null });
  try {
    const r = await s.page.evaluate(() => ({
      empty: document.querySelector('#list .empty').textContent.replace(/\s+/g, ' ').trim(),
      status: document.getElementById('status').textContent,
      chips: document.querySelectorAll('#days .day-chip').length,
      banner: document.getElementById('delay-banner').hidden,
    }));
    assert.ok(r.empty.startsWith('No riders followed yet.'), r.empty);
    assert.ok(r.status.endsWith('· no riders followed yet'), r.status);
    assert.equal(r.chips, 0);
    assert.equal(r.banner, true);

    // The button opens the sheet; adding a rider swaps the prompt for rows.
    await s.page.click('#add-riders-btn');
    assert.equal(await s.page.$eval('#rider-sheet', el => el.hidden), false);
    await s.page.fill('#rider-search', 'zook');
    await s.page.click('#rider-results button.rbtn.add[data-n="Zook, Penelope"]');
    await s.page.click('#sheet-close');
    assert.ok(await rowInfo(s.page, 731), 'timeline renders after the first add');
    assert.ok((await s.page.$eval('#status', el => el.textContent))
      .endsWith('· 1 riders followed'));
  } finally { await s.context.close(); }
});
