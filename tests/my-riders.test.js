'use strict';
// TESTPLAN group K (per-browser follow list).
// There is no baked list anymore: the follow list IS the per-event stored
// list sc:1187:riders (openPage seeds the nine fixture names by default).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);
const rideAt = (pinny, rider, h, min, status = 'Accepted') =>
  F.entry({ pinny, rider, status, details: [
    F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, h, min) })] });

function pickerFeed() {
  const entries = [
    rideAt(730, F.FOLLOWED.zook, 13, 0),
    rideAt(731, F.FOLLOWED.aulita, 13, 30),
    rideAt(732, 'Extra, Rider', 14, 0),
    rideAt(733, 'Scratched, Sam', 14, 30, 'Scratched'), // searchable, shown as scratched
    F.entry({ pinny: 734, rider: 'Novice, Nancy', division: 'Open Novice B', divisionShort: 'ONB',
      details: [F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 16, 0) })] }),
  ];
  // 25 accepted riders matching "matchrider" — search must cap at 20.
  for (let i = 1; i <= 25; i++) {
    entries.push(rideAt(740 + i, `Matchrider, R${String(i).padStart(2, '0')}`, 15, i));
  }
  return F.feed(entries);
}

const stored = page => page.evaluate(() => getStoredList(RIDERS_KEY));

test('K45: effectiveFollowing = the stored per-event list; clearing storage yields the empty-state prompt', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    // The seeded list is the whole effective list — no baked segment.
    const before = await s.page.evaluate(() => ({
      eff: effectiveFollowing(),
      key: RIDERS_KEY,
      status: document.getElementById('status').textContent,
    }));
    assert.deepEqual(before.eff, F.FOLLOWING_NAMES);
    assert.equal(before.key, 'sc:1187:riders');
    // pickerFeed matches 2 of the 9 seeded names (R4 wording).
    assert.ok(before.status.endsWith('· 2 of 9 riders found'), before.status);

    // Editing the stored list changes the effective list directly.
    const edited = await s.page.evaluate(() => {
      setStoredList(RIDERS_KEY, ['Extra, Rider', 'Zook, Penelope']);
      return effectiveFollowing();
    });
    assert.deepEqual(edited, ['Extra, Rider', 'Zook, Penelope']);

    // Wiping storage leaves nobody followed: the empty-state prompt renders
    // (there is no baked list to fall back to) with adapted status copy.
    const after = await s.page.evaluate(() => {
      localStorage.clear();
      rides = extractRides(lastFeed);
      render();
      return {
        eff: effectiveFollowing(),
        empty: document.querySelector('#list .empty').textContent.replace(/\s+/g, ' ').trim(),
        hasBtn: !!document.getElementById('add-riders-btn'),
        status: document.getElementById('status').textContent,
        chips: document.querySelectorAll('#days .day-chip').length,
      };
    });
    assert.deepEqual(after.eff, []);
    assert.ok(after.empty.startsWith('No riders followed yet.'), after.empty);
    assert.equal(after.hasBtn, true, 'prompt offers the add-riders button');
    assert.ok(after.status.endsWith('· no riders followed yet'), after.status);
    assert.equal(after.chips, 0, 'no day chips in the empty state');

    // The prompt button opens the rider sheet.
    await s.page.click('#add-riders-btn');
    assert.equal(await s.page.$eval('#rider-sheet', el => el.hidden), false);
  } finally { await s.context.close(); }
});

test('K46: sheet lists stored riders with Remove; removing deletes from the store, drops the row, and persists across reload', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    await s.page.click('#edit-riders');
    assert.equal(await s.page.$eval('#rider-sheet', el => el.hidden), false);
    const listed = await s.page.$$eval('#my-riders-list .rrow', els => els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.equal(listed.length, 9, 'all stored riders listed');
    assert.equal(await s.page.$$eval('#my-riders-list button.rm', els => els.length), 9, 'Remove on every rider');

    // Removing deletes from the stored list — nothing is merely "hidden".
    await s.page.click('#my-riders-list button.rm[data-n="Zook, Penelope"]');
    const afterRm = await stored(s.page);
    assert.ok(!afterRm.includes('Zook, Penelope'), 'removed from the store');
    assert.equal(afterRm.length, 8);
    assert.equal(await rowInfo(s.page, 730), null, 'timeline drops the removed rider');
    assert.ok(await rowInfo(s.page, 731), 'others stay');

    // Adding then removing a rider round-trips the store.
    await s.page.fill('#rider-search', 'extra');
    await s.page.click('#rider-results button.rbtn.add[data-n="Extra, Rider"]');
    assert.ok((await stored(s.page)).includes('Extra, Rider'));
    assert.ok(await rowInfo(s.page, 732), 'added rider shows in timeline');
    await s.page.click('#my-riders-list button.rm[data-n="Extra, Rider"]');
    assert.ok(!(await stored(s.page)).includes('Extra, Rider'));
    assert.equal(await rowInfo(s.page, 732), null);

    // The removal survives a reload — it was a real delete, not a hide.
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    assert.equal(await rowInfo(s.page, 730), null, 'removed rider still gone after reload');
    assert.equal((await stored(s.page)).length, 8);
  } finally { await s.context.close(); }
});

test('K47: browse + filter — full alphabetical list when empty, filter by name/horse/division, all statuses; Add appends without duplicating', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    await s.page.click('#edit-riders');

    // Empty box = browse: every entered rider, alphabetical, letter-grouped.
    const browse = await s.page.evaluate(() => ({
      rows: [...document.querySelectorAll('#rider-results .rrow span')].map(e => e.textContent),
      letters: [...document.querySelectorAll('#rider-results .rletter')].map(e => e.textContent),
    }));
    assert.equal(browse.rows.length, 30, 'all riders listed with no filter');
    const names = browse.rows.map(t => t.split(' · ')[0]);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'alphabetical');
    assert.ok(browse.letters.includes('Z') && browse.letters.includes('M'), 'letter group headers');
    assert.ok(browse.rows.some(t => t.includes('Novice, Nancy') && t.includes('(ONB)')),
      'division shown per horse');

    // A single character already filters (the box narrows the browse list).
    await s.page.fill('#rider-search', 'z');
    let rows = await s.page.$$eval('#rider-results .rrow', els => els.map(e => e.textContent));
    assert.equal(rows.length, 1, 'one char filters');
    assert.ok(rows[0].includes('Zook, Penelope'));

    await s.page.fill('#rider-search', 'ZOOK');
    rows = await s.page.$$eval('#rider-results .rrow', els => els.map(e => e.textContent));
    assert.equal(rows.length, 1, 'case-insensitive substring match');
    assert.ok(await s.page.$('#rider-results button.rm'), 'followed rider offers Remove');

    // Division filters browse a level; horse names match too.
    await s.page.fill('#rider-search', 'open novice');
    rows = await s.page.$$eval('#rider-results .rrow', els => els.map(e => e.textContent));
    assert.deepEqual(rows.map(t => t.split(' · ')[0]), ['Novice, Nancy'], 'full division name filters');
    await s.page.fill('#rider-search', 'onb');
    rows = await s.page.$$eval('#rider-results .rrow', els => els.map(e => e.textContent));
    assert.deepEqual(rows.map(t => t.split(' · ')[0]), ['Novice, Nancy'], 'short division filters');

    await s.page.fill('#rider-search', 'extra');
    assert.ok(await s.page.$('#rider-results button.rbtn.add'), 'unfollowed rider offers Add');

    // Scratched riders ARE searchable (the entry could come back to life),
    // dimmed, annotated per horse, and still addable.
    await s.page.fill('#rider-search', 'scratched');
    const scr = await s.page.$eval('#rider-results .rrow', el => ({
      text: el.textContent, dimmed: el.classList.contains('out'),
      hasAdd: !!el.querySelector('button.rbtn.add'),
    }));
    assert.ok(scr.text.includes('Scratched, Sam'));
    assert.ok(scr.text.includes('Test Horse (TD, scratched)'), 'horse annotated with division + status');
    assert.equal(scr.dimmed, true, 'no accepted entries → dimmed');
    assert.equal(scr.hasAdd, true, 'still addable');

    // Once followed, the my-riders list says "scratched" — not the
    // misleading "no entries found" (that stays for true ghosts).
    await s.page.click('#rider-results button.rbtn.add[data-n="Scratched, Sam"]');
    await s.page.evaluate(() => {
      setStoredList(RIDERS_KEY, [...getStoredList(RIDERS_KEY), 'Ghost, Nobody']);
      rides = extractRides(lastFeed);
      renderRiderSheet();
    });
    const listRows = await s.page.$$eval('#my-riders-list .rrow', els =>
      els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.ok(listRows.includes('Scratched, Sam · scratched'), listRows.join(' | '));
    assert.ok(listRows.includes('Ghost, Nobody · no entries found'));
    await s.page.evaluate(() => {
      setStoredList(RIDERS_KEY, getStoredList(RIDERS_KEY)
        .filter(n => n !== 'Scratched, Sam' && n !== 'Ghost, Nobody'));
      rides = extractRides(lastFeed);
      renderRiderSheet();
    });

    await s.page.fill('#rider-search', 'matchrider');
    rows = await s.page.$$eval('#rider-results .rrow', els => els.length);
    assert.equal(rows, 25, 'no cap — the filtered list shows every match');

    // Add appends exactly once; a repeated Add cannot duplicate the name
    // (the sheet re-render flips the button to Remove, and the handler's
    // guard skips names already present).
    await s.page.fill('#rider-search', 'extra');
    await s.page.click('#rider-results button.rbtn.add[data-n="Extra, Rider"]');
    // Exercise the page's own guard: inject a stale Add button (as a
    // double-tap race would leave behind) and click through the real
    // delegated handler.
    const after = await s.page.evaluate(() => {
      const stale = document.createElement('button');
      stale.className = 'rbtn add';
      stale.dataset.n = 'Extra, Rider';
      document.getElementById('rider-results').appendChild(stale);
      stale.click();
      return getStoredList(RIDERS_KEY);
    });
    assert.equal(after.filter(n => n === 'Extra, Rider').length, 1, 'no duplicate');
    assert.equal(after[after.length - 1], 'Extra, Rider', 'appended at the end');
    assert.ok(await s.page.$('#rider-results button.rm[data-n="Extra, Rider"]'),
      'button flipped to Remove after the add');
  } finally { await s.context.close(); }
});

test('K48: a custom stored list persists across reload; a fresh context sees the empty state; count reflects the list', async () => {
  // Seed a custom 3-name list (2 in the feed, 1 ghost) via the riders knob.
  const s = await openPage({
    server, feed: pickerFeed(), now: NOON,
    riders: ['Zook, Penelope', 'Extra, Rider', 'Ghost, Nobody'],
  });
  try {
    assert.ok((await s.page.$eval('#status', el => el.textContent)).endsWith('· 2 of 3 riders found'));

    // Survives reload in the same browser profile.
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    await s.page.waitForLoadState('networkidle');
    assert.ok((await s.page.$eval('#status', el => el.textContent)).endsWith('· 2 of 3 riders found'));

    // In-page edits persist across reload too.
    await s.page.click('#edit-riders');
    await s.page.click('#my-riders-list button.rm[data-n="Ghost, Nobody"]');
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    assert.match(await s.page.$eval('#status', el => el.textContent),
      /^Updated \d{1,2}:\d{2} [AP]M$/, 'all found — no suffix (count is in the header label)');
  } finally { await s.context.close(); }

  // A fresh context has no stored list: empty state, not any default names.
  const fresh = await openPage({ server, feed: pickerFeed(), now: NOON, riders: null });
  try {
    assert.deepEqual(await fresh.page.evaluate(() => effectiveFollowing()), []);
    assert.ok(await fresh.page.$('#add-riders-btn'), 'empty-state prompt shown');
    assert.ok((await fresh.page.$eval('#status', el => el.textContent))
      .endsWith('· no riders followed yet'));
  } finally { await fresh.context.close(); }
});

test('R4: status counts riders actually found; sheet flags names matching nothing in the feed', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    // 2 of the 9 seeded names (zook, aulita) match the feed.
    assert.ok((await s.page.$eval('#status', el => el.textContent))
      .endsWith('· 2 of 9 riders found'));

    // The sheet marks the unmatched names — and only those.
    await s.page.click('#edit-riders');
    const rows = await s.page.$$eval('#my-riders-list .rrow', els =>
      els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.equal(rows.length, 9);
    assert.ok(rows.includes('Zook, Penelope'), 'matched rider unflagged');
    assert.ok(rows.includes('Aulita, Brittany'), 'matched rider unflagged');
    assert.ok(rows.includes('McMahan, Galena · no entries found'), rows.join(' | '));
    assert.equal(rows.filter(r => r.endsWith('· no entries found')).length, 7,
      'all 7 unmatched names flagged');

    // Once every stored name matches, the plain wording returns.
    await s.page.evaluate(() => {
      setStoredList(RIDERS_KEY, ['Aulita, Brittany', 'Zook, Penelope']);
      rides = extractRides(lastFeed);
      render();
      renderRiderSheet();
    });
    assert.match(await s.page.$eval('#status', el => el.textContent),
      /^Updated \d{1,2}:\d{2} [AP]M$/, 'all found — no suffix (count is in the header label)');
    const rows2 = await s.page.$$eval('#my-riders-list .rrow', els =>
      els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.deepEqual(rows2, ['Aulita, Brittany', 'Zook, Penelope'], 'no flags when all found');
  } finally { await s.context.close(); }
});

test('K47: a rider with accepted AND scratched horses shows undimmed, only the scratched horse annotated, and counts as found', async () => {
  const feed = F.feed([
    rideAt(730, F.FOLLOWED.zook, 13, 0),
    F.entry({ pinny: 750, rider: 'Mixed, Molly', horse: 'Keeper', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 15, 0) })] }),
    F.entry({ pinny: 751, rider: 'Mixed, Molly', horse: 'Benched', status: 'Scratched', details: [] }),
  ]);
  const s = await openPage({ server, feed, now: NOON, riders: ['Zook, Penelope', 'Mixed, Molly'] });
  try {
    await s.page.click('#edit-riders');
    await s.page.fill('#rider-search', 'mixed');
    const r = await s.page.$eval('#rider-results .rrow', el => ({
      text: el.textContent.replace(/\s+/g, ' '), dimmed: el.classList.contains('out'),
    }));
    assert.ok(r.text.includes('Keeper (TD), Benched (TD, scratched)'), r.text);
    assert.equal(r.dimmed, false, 'an accepted entry keeps the row full-strength');
    const listRows = await s.page.$$eval('#my-riders-list .rrow', els =>
      els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.ok(listRows.includes('Mixed, Molly'), 'no annotation — she has an accepted ride');
    assert.match(await s.page.$eval('#status', el => el.textContent),
      /^Updated \d{1,2}:\d{2} [AP]M$/, 'accepted entry ⇒ counted as found');
  } finally { await s.context.close(); }
});
