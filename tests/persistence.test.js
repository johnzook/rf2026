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
