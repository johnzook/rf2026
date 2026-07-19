'use strict';
// TESTPLAN group J (persistence, staleness, fail-soft networking, deploy watcher).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer, openPage, closeBrowser, denverMs, DEFAULT_NOW,
  cacheBlob, rowInfo, INDEX_HTML, INDEX_PATH,
} = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = DEFAULT_NOW; // Sat Jul 18, 12:00 MDT
const simpleFeed = () => F.feed([
  F.entry({ pinny: 720, rider: F.FOLLOWED.zook, division: 'DivP', details: [
    F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
]);
const simpleScoring = () => F.scoring({
  divisions: [F.division({ id: 50, name: 'DivP' })],
  rows: [F.scoringRow({ pinny: 720, divisionId: 50, dressageScore: '31.0', dressagePlace: '4', finalPlace: '4' })],
});

test('J40: good fetches cache both payloads with a timestamp; cache renders before network answers', async () => {
  // (a) Normal load writes both caches, stamped with (pinned) Date.now().
  let s = await openPage({ server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON });
  let cached;
  try {
    cached = await s.page.evaluate(() => ({
      event: JSON.parse(localStorage.getItem('rf2026:event')),
      scoring: JSON.parse(localStorage.getItem('rf2026:scoring')),
    }));
  } finally { await s.context.close(); }
  assert.equal(cached.event.at, NOON);
  assert.equal(cached.scoring.at, NOON);
  assert.equal(cached.event.value.EntryList[0].PinnyNumber, 720);
  assert.equal(cached.scoring.value.ScoringList[0].Pinny, 720);

  // (b) With the network stalled (requests hang forever), a warm cache
  // still renders rows + results immediately.
  s = await openPage({
    server, now: NOON, network: 'stall',
    localStorage: {
      'rf2026:event': cacheBlob(NOON - 60_000, simpleFeed()),
      'rf2026:scoring': cacheBlob(NOON - 60_000, simpleScoring()),
    },
  });
  try {
    await s.page.waitForSelector('#list .row');
    const row = await rowInfo(s.page, 720);
    assert.ok(row, 'row rendered from cache while fetch is still pending');
    assert.ok(row.pop.includes('31.0 (4th)'), 'results hydrated from cached scoring');
  } finally { await s.context.close(); }
});

test('R3: unchanged payloads skip the cache rewrite; changed payloads write again with a fresh stamp', async () => {
  const s = await openPage({ server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON });
  try {
    // Spy on every localStorage write from here on (the initial load's two
    // cache writes have already happened).
    await s.page.evaluate(() => {
      window.__writes = [];
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return orig.call(this, k, v); };
    });

    // Two full poll rounds with byte-identical payloads: zero writes, but
    // lastUpdatedMs (freshness display) still advances per fetch.
    await s.page.evaluate(async ms => {
      window.__setNow(ms);
      await fetchEventFeed(); await fetchScoring();
      await fetchEventFeed(); await fetchScoring();
    }, NOON + 60_000);
    const afterSame = await s.page.evaluate(() => ({
      writes: window.__writes.slice(),
      lastUpdatedMs,
      cachedAt: JSON.parse(localStorage.getItem('rf2026:event')).at,
    }));
    assert.deepEqual(afterSame.writes, [], 'no writes for unchanged payloads');
    assert.equal(afterSame.lastUpdatedMs, NOON + 60_000, 'freshness still updates every fetch');
    assert.equal(afterSame.cachedAt, NOON, 'cache stamp untouched while content is unchanged');

    // A changed event payload writes exactly once, refreshing the stamp.
    const changed = simpleFeed();
    changed.EntryList[0].RidingDetails[0].RideTimes = F.rideTimeStr(2026, 7, 18, 15, 0);
    await s.context.route('**/api/sc/event/1187', r => r.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(changed),
    }));
    await s.page.evaluate(async ms => { window.__setNow(ms); await fetchEventFeed(); }, NOON + 120_000);
    const afterChange = await s.page.evaluate(() => ({
      writes: window.__writes.slice(),
      cached: JSON.parse(localStorage.getItem('rf2026:event')),
    }));
    assert.deepEqual(afterChange.writes, ['rf2026:event'], 'changed payload written once');
    assert.equal(afterChange.cached.at, NOON + 120_000, 'stamp refreshed on content change');
    assert.ok(afterChange.cached.value.EntryList[0].RidingDetails[0].RideTimes.includes('3:00:00 PM'),
      'cache holds the new payload');

    // The identical payload again: still no further writes.
    await s.page.evaluate(() => fetchEventFeed());
    assert.deepEqual(await s.page.evaluate(() => window.__writes), ['rf2026:event']);
  } finally { await s.context.close(); }
});

test('J41: fully offline with warm cache: rows + results render, retry note shows', async () => {
  const s = await openPage({
    server, now: NOON, network: 'abort',
    localStorage: {
      'rf2026:event': cacheBlob(NOON - 30 * 60_000, simpleFeed()),
      'rf2026:scoring': cacheBlob(NOON - 30 * 60_000, simpleScoring()),
    },
  });
  try {
    await s.page.waitForFunction(() =>
      document.getElementById('fetch-err').textContent !== '');
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent),
      '· can\'t reach ShowConnect, retrying');
    const row = await rowInfo(s.page, 720);
    assert.ok(row, 'cached rows still shown');
    assert.ok(row.pop.includes('31.0 (4th)'));
    assert.equal(await s.page.$eval('#status', el => el.textContent),
      'Showing data from 11:30 AM (30 min old)');
  } finally { await s.context.close(); }
});

test('J42: status line — fresh vs minutes-old vs hours-old data', async () => {
  const s = await openPage({ server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON });
  try {
    const status = () => s.page.$eval('#status', el => el.textContent);
    // simpleFeed contains only one of the nine followed names (R4).
    assert.equal(await status(), 'Updated 12:00 PM · 1 of 9 riders found');
    await s.page.evaluate(() => { lastUpdatedMs = Date.now() - 5 * 60_000; render(); });
    assert.equal(await status(), 'Showing data from 11:55 AM (5 min old)');
    await s.page.evaluate(() => { lastUpdatedMs = Date.now() - 180 * 60_000; render(); });
    assert.equal(await status(), 'Showing data from 9:00 AM (3 h old)');
  } finally { await s.context.close(); }
});

test('J43: fetch failures never clear rendered data; scoring failures are silent', async () => {
  const s = await openPage({ server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON });
  try {
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent), '');

    // Scoring starts failing: silent, resultsIdx intact.
    await s.context.route('**/api/sc/event/1187/scoringLive', r => r.abort('failed'));
    await s.page.evaluate(() => fetchScoring());
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent), '', 'scoring failure is silent');
    assert.ok((await rowInfo(s.page, 720)).pop.includes('31.0 (4th)'), 'old results kept');

    // Event feed starts failing: error note appears, rows stay.
    await s.context.route('**/api/sc/event/1187', r => r.abort('failed'));
    await s.page.evaluate(() => fetchEventFeed());
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent),
      '· can\'t reach ShowConnect, retrying');
    assert.ok(await rowInfo(s.page, 720), 'rows survive the failure');
    assert.equal(await s.page.evaluate(() => rides.length), 1);

    // Recovery clears the note.
    await s.context.route('**/api/sc/event/1187', r =>
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(simpleFeed()) }));
    await s.page.evaluate(() => fetchEventFeed());
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent), '');
  } finally { await s.context.close(); }
});

test('R7: fetch timeout + in-flight guard — hung requests never pile up, the flag always resets, retry note shows', async () => {
  const s = await openPage({ server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON });
  try {
    // From here on the event endpoint hangs: request accepted, never answered
    // (the saturated-LTE failure mode). Spy on every real fetch() call.
    await s.context.route('**/api/sc/event/1187', () => { /* never fulfill */ });
    await s.page.evaluate(() => {
      window.__fetches = 0;
      const orig = window.fetch;
      window.fetch = (...a) => { window.__fetches++; return orig(...a); };
    });

    // Three poll ticks while the first request hangs: exactly one real fetch.
    const piled = await s.page.evaluate(() => {
      window.__first = fetchEventFeed(); // settles only via the 10 s abort
      fetchEventFeed();
      fetchEventFeed();
      return window.__fetches;
    });
    assert.equal(piled, 1, 'in-flight guard prevents pile-up');

    // AbortSignal.timeout(10_000) fires on real timers: the promise settles
    // (no unhandled rejection) and the SAME retry note appears.
    await s.page.evaluate(() => window.__first);
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent),
      '· can\'t reach ShowConnect, retrying', 'timeout surfaces the retry note');
    assert.ok(await rowInfo(s.page, 720), 'stale rows retained through the timeout');

    // The finally block reset the flag: the NEXT poll really fetches again
    // and recovers once the endpoint answers.
    await s.context.route('**/api/sc/event/1187', r => r.fulfill({
      contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(simpleFeed()),
    }));
    await s.page.evaluate(() => fetchEventFeed());
    assert.equal(await s.page.evaluate(() => window.__fetches), 2,
      'aborted fetch did not wedge polling — next poll fetched again');
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent), '', 'recovery clears the note');

    // fetchScoring and checkForNewDeploy carry the same guard: two calls
    // each against hanging endpoints -> one request each.
    await s.context.route('**/api/sc/event/1187/scoringLive', () => { /* hang */ });
    await s.context.route(s.page.url(), () => { /* hang */ });
    const delta = await s.page.evaluate(() => {
      const before = window.__fetches;
      fetchScoring(); fetchScoring();
      checkForNewDeploy(); checkForNewDeploy();
      return window.__fetches - before;
    });
    assert.equal(delta, 2, 'one in-flight request per endpoint');
    assert.equal(s.page.__pageError, undefined, 'no unhandled rejection anywhere');
  } finally { await s.context.close(); }
});

test('R1: deploy reload restores day + scroll and suppresses the landing; stale state falls back to a normal load', async () => {
  // Tall today list (so the now-landing visibly scrolls) plus a Friday list
  // tall enough to scroll to 250px.
  const names = Object.values(F.FOLLOWED);
  const entries = [];
  for (let i = 0; i < 30; i++) {
    entries.push(F.entry({ pinny: 730 + i, rider: names[i % names.length], details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 8 + Math.floor(i / 3), (i % 3) * 20) })] }));
  }
  for (let i = 0; i < 20; i++) {
    entries.push(F.entry({ pinny: 770 + i, rider: names[i % names.length], details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R1', time: F.rideTimeStr(2026, 7, 17, 9 + Math.floor(i / 3), (i % 3) * 20) })] }));
  }
  const s = await openPage({ server, feed: F.feed(entries), now: NOON });
  try {
    // Normal load (no reload-state key): today's now-landing still happens.
    assert.ok(await s.page.evaluate(() => window.scrollY) > 0, 'normal load lands on now');

    // User picks Friday and scrolls; then a deploy lands and the page
    // reloads itself, stashing day + scroll in sessionStorage.
    await s.page.click('#days .day-chip:first-child');
    await s.page.evaluate(() => window.scrollTo(0, 250));
    server.setPage(INDEX_HTML.replace('</body>', '<!-- deploy-r1 --></body>'));
    await Promise.all([
      s.page.waitForNavigation({ waitUntil: 'load' }),
      s.page.evaluate(() => checkForNewDeploy()).catch(() => { /* context destroyed by reload */ }),
    ]);
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const r = await s.page.evaluate(() => ({
      day: selectedDay,
      chip: document.querySelector('#days .day-chip.active').textContent,
      scrollY: window.scrollY,
      keyLeft: sessionStorage.getItem('rf2026:reloadState'),
      landingDone: initialScrollDone,
    }));
    assert.equal(r.day, '2026-07-17', 'selected day restored across the reload');
    assert.equal(r.chip, 'Fri, Jul 17');
    assert.equal(r.scrollY, 250, 'scroll offset restored, not re-centered on now');
    assert.equal(r.keyLeft, null, 'reload-state key consumed');
    assert.equal(r.landingDone, true, 'one-time now-landing suppressed');

    // A stale key (>2 min old) is discarded: the load behaves normally
    // (auto day = today, now-landing fires) and the key is still cleared.
    await s.page.evaluate(() => sessionStorage.setItem('rf2026:reloadState',
      JSON.stringify({ at: Date.now() - 3 * 60_000, selectedDay: '2026-07-17', scrollY: 250 })));
    await s.page.reload({ waitUntil: 'load' });
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const r2 = await s.page.evaluate(() => ({
      day: selectedDay,
      chip: document.querySelector('#days .day-chip.active').textContent,
      keyLeft: sessionStorage.getItem('rf2026:reloadState'),
    }));
    assert.equal(r2.day, null, 'stale day not restored');
    assert.equal(r2.chip, 'Today');
    assert.equal(r2.keyLeft, null, 'stale key still cleared');
  } finally { server.reset(); await s.context.close(); }
});

test('J44: deploy watcher — same bytes: no reload; changed bytes: reload; file:// is a no-op', async () => {
  const s = await openPage({ server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON });
  try {
    await s.page.evaluate(() => { window.__alive = 1; });

    // Identical self-fetch: baseline was set on load; nothing happens.
    await s.page.evaluate(() => checkForNewDeploy());
    assert.equal(await s.page.evaluate(() => window.__alive), 1, 'no reload on identical bytes');

    // Changed bytes: the page reloads itself.
    server.setPage(INDEX_HTML.replace('</body>', '<!-- deploy-v2 --></body>'));
    await Promise.all([
      s.page.waitForNavigation({ waitUntil: 'load' }),
      s.page.evaluate(() => checkForNewDeploy()).catch(() => { /* context destroyed by reload */ }),
    ]);
    assert.equal(await s.page.evaluate(() => window.__alive), undefined, 'page reloaded');
    assert.ok((await s.page.content()).includes('deploy-v2'), 'new deploy is live');
  } finally {
    server.reset();
    await s.context.close();
  }

  // file:// no-op: guard returns before fetching; baseline never set.
  const f = await openPage({
    server, feed: simpleFeed(), scoring: simpleScoring(), now: NOON,
    url: 'file://' + INDEX_PATH, waitLoaded: false,
  });
  try {
    await f.page.waitForFunction(() => typeof checkForNewDeploy === 'function');
    const r = await f.page.evaluate(async () => {
      window.__alive = 1;
      await checkForNewDeploy();
      return { alive: window.__alive, baseline: deployBaseline, protocol: location.protocol };
    });
    assert.deepEqual(r, { alive: 1, baseline: null, protocol: 'file:' });
  } finally { await f.context.close(); }
});
