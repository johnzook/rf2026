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
    assert.equal(await status(), 'Updated 12:00 PM · 9 riders followed');
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
