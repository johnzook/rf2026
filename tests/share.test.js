'use strict';
// TESTPLAN P77–P81: building share links and receiving ?riders= lists.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);
const rideAt = (pinny, rider, h, min) =>
  F.entry({ pinny, rider, details: [
    F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, h, min) })] });
const shareFeed = () => F.feed([
  rideAt(730, F.FOLLOWED.zook, 13, 0),
  rideAt(731, F.FOLLOWED.aulita, 13, 30),
  rideAt(732, F.FOLLOWED.crocker, 14, 0),
]);

const sharedUrl = names =>
  `${server.url}?event=1187&riders=${encodeURIComponent(names.join('|'))}`;

const storedRiders = page => page.evaluate(() => getStoredList(RIDERS_KEY));

test('P77: buildShareUrl encodes the followed names — commas and spaces survive a round-trip', async () => {
  const names = ['Zook, Penelope', 'Aulita, Brittany'];
  const s = await openPage({ server, feed: shareFeed(), now: NOON, riders: names });
  try {
    const r = await s.page.evaluate(() => ({
      url: buildShareUrl(),
      origin: location.origin,
      pathname: location.pathname,
    }));
    assert.equal(r.url,
      `${r.origin}${r.pathname}?event=1187&riders=${encodeURIComponent(names.join('|'))}`);
    assert.ok(r.url.includes('%2C'), 'commas percent-encoded');
    assert.ok(r.url.includes('%20'), 'spaces percent-encoded');
    assert.ok(!/[ ,|]/.test(r.url.split('riders=')[1]), 'no raw separators in the param');
    // Round-trip exactly as the receiving side decodes it.
    const back = decodeURIComponent(new URL(r.url).searchParams.get('riders')).split('|');
    // (searchParams already decodes once; decodeURIComponent of the decoded
    // string is a no-op for these names)
    assert.deepEqual(back, names, 'names survive the round-trip verbatim');
  } finally { await s.context.close(); }
});

test('P78: share row hidden with no riders; visible with riders — sms href, copy-with-confirmation, native share only when available', async () => {
  const s = await openPage({ server, feed: shareFeed(), now: NOON, riders: null });
  try {
    // Empty list: sheet opens via the empty-state prompt, share row hidden.
    await s.page.click('#add-riders-btn');
    assert.equal(await s.page.$eval('#share-row', el => el.hidden), true, 'nothing to share');

    // Add one rider: the share row appears with working fallbacks.
    await s.page.fill('#rider-search', 'zook');
    await s.page.click('#rider-results button.rbtn.add[data-n="Zook, Penelope"]');
    const r = await s.page.evaluate(() => ({
      rowHidden: document.getElementById('share-row').hidden,
      nativeHidden: document.getElementById('share-native').hidden,
      sms: document.getElementById('share-sms').getAttribute('href'),
      copiedHidden: document.getElementById('share-copied').hidden,
    }));
    assert.equal(r.rowHidden, false);
    assert.equal(r.nativeHidden, true, 'no navigator.share in headless chromium');
    assert.equal(r.sms, 'sms:?&body=' + encodeURIComponent(
      `${server.url}?event=1187&riders=${encodeURIComponent('Zook, Penelope')}`));
    assert.equal(r.copiedHidden, true);

    // Copy link writes the URL to the clipboard and flashes "copied".
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await s.page.click('#share-copy');
    await s.page.waitForSelector('#share-copied', { state: 'visible' });
    assert.equal(await s.page.evaluate(() => navigator.clipboard.readText()),
      `${server.url}?event=1187&riders=${encodeURIComponent('Zook, Penelope')}`);

    // With navigator.share present, the native button shows and is used.
    const native = await s.page.evaluate(() => {
      window.__shared = null;
      Object.defineProperty(navigator, 'share', {
        value: d => { window.__shared = d; return Promise.resolve(); }, configurable: true,
      });
      renderRiderSheet();
      const hidden = document.getElementById('share-native').hidden;
      document.getElementById('share-native').click();
      return { hidden, shared: window.__shared };
    });
    assert.equal(native.hidden, false, 'native share button shown when supported');
    assert.equal(native.shared.title, 'Test Event — riders');
    assert.ok(native.shared.url.includes('riders='), 'share sheet gets the link');
  } finally { await s.context.close(); }
});

test('P79: ?riders= with an empty store adopts silently — list persisted, rows render, URL cleaned', async () => {
  const names = ['Zook, Penelope', 'Aulita, Brittany'];
  const s = await openPage({ server, feed: shareFeed(), now: NOON, riders: null, url: sharedUrl(names) });
  try {
    assert.deepEqual(await storedRiders(s.page), names, 'shared list adopted into the store');
    assert.equal(await s.page.evaluate(() => location.search), '?event=1187', 'riders param dropped');
    assert.equal(await s.page.$eval('#share-banner', el => el.hidden), true, 'no banner on silent adopt');
    assert.ok(await rowInfo(s.page, 730), 'adopted rider renders');
    assert.ok(await rowInfo(s.page, 731));
    assert.equal(await rowInfo(s.page, 732), null, 'unshared rider not followed');

    // Persisted: a reload (URL now clean) keeps the adopted list.
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    assert.deepEqual(await storedRiders(s.page), names);
  } finally { await s.context.close(); }
});

test('P79: a shared list identical to the store shows no banner and just cleans the URL', async () => {
  const names = ['Aulita, Brittany', 'Zook, Penelope'];
  const s = await openPage({
    server, feed: shareFeed(), now: NOON,
    riders: ['Zook, Penelope', 'Aulita, Brittany'], // same set, different order
    url: sharedUrl(names),
  });
  try {
    assert.equal(await s.page.$eval('#share-banner', el => el.hidden), true, 'no banner');
    assert.equal(await s.page.evaluate(() => location.search), '?event=1187', 'URL cleaned');
    assert.deepEqual(await storedRiders(s.page), ['Zook, Penelope', 'Aulita, Brittany'],
      'store untouched');
  } finally { await s.context.close(); }
});

test('P80: differing store shows the banner — Add merges deduped, Replace replaces, Ignore keeps mine; all clean the URL', async () => {
  const mine = ['Zook, Penelope', 'Aulita, Brittany'];
  const theirs = ['Aulita, Brittany', 'Crocker, Shelby'];
  const outcomes = {
    'share-adopt-add': ['Zook, Penelope', 'Aulita, Brittany', 'Crocker, Shelby'],
    'share-adopt-replace': theirs,
    'share-adopt-ignore': mine,
  };
  for (const [btn, want] of Object.entries(outcomes)) {
    const s = await openPage({
      server, feed: shareFeed(), now: NOON, riders: mine, url: sharedUrl(theirs),
    });
    try {
      const before = await s.page.evaluate(() => ({
        hidden: document.getElementById('share-banner').hidden,
        text: document.getElementById('share-banner-text').textContent,
        search: location.search,
      }));
      assert.equal(before.hidden, false, 'banner shown for a differing list');
      assert.equal(before.text, 'This link shares 2 riders for this event.');
      assert.ok(before.search.includes('riders='), 'URL not cleaned until the user decides');
      assert.deepEqual(await storedRiders(s.page), mine, 'store untouched while pending');

      await s.page.click('#' + btn);
      assert.deepEqual(await storedRiders(s.page), want, `${btn} outcome`);
      assert.equal(await s.page.evaluate(() => location.search), '?event=1187', 'URL cleaned');
      assert.equal(await s.page.$eval('#share-banner', el => el.hidden), true, 'banner dismissed');
      // The timeline re-filters to the chosen list.
      const zookRow = await rowInfo(s.page, 730);
      const crockerRow = await rowInfo(s.page, 732);
      assert.equal(!!zookRow, want.includes('Zook, Penelope'), 'Zook row matches outcome');
      assert.equal(!!crockerRow, want.includes('Crocker, Shelby'), 'Crocker row matches outcome');
    } finally { await s.context.close(); }
  }

  // Singular wording for a one-rider link.
  const one = await openPage({
    server, feed: shareFeed(), now: NOON, riders: mine, url: sharedUrl(['Crocker, Shelby']),
  });
  try {
    assert.equal(await one.page.$eval('#share-banner-text', el => el.textContent),
      'This link shares 1 rider for this event.');
  } finally { await one.context.close(); }
});

test('P81: shared names not in the feed behave like ghost follows — counted in the status, flagged in the sheet', async () => {
  const names = ['Zook, Penelope', 'Ghost, Rider'];
  const s = await openPage({ server, feed: shareFeed(), now: NOON, riders: null, url: sharedUrl(names) });
  try {
    assert.ok((await s.page.$eval('#status', el => el.textContent))
      .endsWith('· 1 of 2 riders found'));
    await s.page.click('#edit-riders');
    const rows = await s.page.$$eval('#my-riders-list .rrow', els =>
      els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.deepEqual(rows, ['Zook, Penelope', 'Ghost, Rider · no entries found']);
  } finally { await s.context.close(); }
});
