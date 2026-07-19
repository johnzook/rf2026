'use strict';
// TESTPLAN group K (per-browser follow list).
// The baked FOLLOWING list has 9 riders; edits live in localStorage under
// rf2026:myRiders (personal adds) and rf2026:hiddenRiders (hidden baked).

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
    rideAt(733, 'Scratched, Sam', 14, 30, 'Scratched'), // must never appear in search
  ];
  // 25 accepted riders matching "matchrider" — search must cap at 20.
  for (let i = 1; i <= 25; i++) {
    entries.push(rideAt(740 + i, `Matchrider, R${String(i).padStart(2, '0')}`, 15, i));
  }
  return F.feed(entries);
}

const storage = page => page.evaluate(() => ({
  mine: getMyRiders(), hidden: getHiddenRiders(),
}));

test('K45: effectiveFollowing = (FOLLOWING − hidden) ∪ adds; empty storage renders exactly as baked', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    // Empty storage == baked list, byte-identical rendering.
    const before = await s.page.evaluate(() => ({
      eff: effectiveFollowing(),
      baked: FOLLOWING.slice(),
      html: document.getElementById('list').innerHTML,
      status: document.getElementById('status').textContent,
    }));
    assert.deepEqual(before.eff, before.baked);
    assert.ok(before.status.endsWith('· 9 riders followed'), before.status);

    // Unit: hidden removed from the baked segment, adds appended.
    const combo = await s.page.evaluate(() => {
      localStorage.setItem('rf2026:hiddenRiders', JSON.stringify(['Zook, Penelope']));
      localStorage.setItem('rf2026:myRiders', JSON.stringify(['Extra, Rider']));
      return effectiveFollowing();
    });
    assert.ok(!combo.includes('Zook, Penelope'));
    assert.equal(combo[combo.length - 1], 'Extra, Rider');
    assert.equal(combo.length, 9); // 9 - 1 + 1

    // Round-trip add+remove returns to the byte-identical baked rendering.
    const after = await s.page.evaluate(() => {
      localStorage.clear();
      rides = extractRides(lastFeed);
      render();
      return {
        html: document.getElementById('list').innerHTML,
        status: document.getElementById('status').textContent,
      };
    });
    assert.equal(after.html, before.html, 'rendering identical to baked');
    assert.equal(after.status, before.status);
  } finally { await s.context.close(); }
});

test('K46: sheet lists effective riders; Remove hides baked riders but deletes personal adds', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    await s.page.click('#edit-riders');
    assert.equal(await s.page.$eval('#rider-sheet', el => el.hidden), false);
    const listed = await s.page.$$eval('#my-riders-list .rrow', els => els.map(e => e.textContent.replace('Remove', '').trim()));
    assert.equal(listed.length, 9, 'all baked riders listed');
    assert.equal(await s.page.$$eval('#my-riders-list button.rm', els => els.length), 9, 'Remove on every rider');

    // Removing a baked rider stores a hide (not a delete from mine).
    await s.page.click('#my-riders-list button.rm[data-n="Zook, Penelope"]');
    assert.deepEqual(await storage(s.page), { mine: [], hidden: ['Zook, Penelope'] });
    assert.equal(await rowInfo(s.page, 730), null, 'timeline drops the hidden rider');
    assert.ok(await rowInfo(s.page, 731), 'others stay');

    // Personal add, then removing it deletes from mine (hidden untouched).
    await s.page.fill('#rider-search', 'extra');
    await s.page.click('#rider-results button.rbtn.add[data-n="Extra, Rider"]');
    assert.deepEqual(await storage(s.page), { mine: ['Extra, Rider'], hidden: ['Zook, Penelope'] });
    assert.ok(await rowInfo(s.page, 732), 'personal add shows in timeline');
    await s.page.click('#my-riders-list button.rm[data-n="Extra, Rider"]');
    assert.deepEqual(await storage(s.page), { mine: [], hidden: ['Zook, Penelope'] });
    assert.equal(await rowInfo(s.page, 732), null);
  } finally { await s.context.close(); }
});

test('K47: search — ≥2 chars, case-insensitive, top 20, accepted only, Add un-hides hidden baked riders', async () => {
  const s = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    await s.page.click('#edit-riders');

    await s.page.fill('#rider-search', 'z');
    assert.equal(await s.page.$eval('#rider-results', el => el.innerHTML), '', 'one char: no results');

    await s.page.fill('#rider-search', 'ZOOK');
    let rows = await s.page.$$eval('#rider-results .rrow', els => els.map(e => e.textContent));
    assert.equal(rows.length, 1, 'case-insensitive substring match');
    assert.ok(rows[0].includes('Zook, Penelope'));
    assert.ok(await s.page.$('#rider-results button.rm'), 'followed rider offers Remove');

    await s.page.fill('#rider-search', 'extra');
    assert.ok(await s.page.$('#rider-results button.rbtn.add'), 'unfollowed rider offers Add');

    await s.page.fill('#rider-search', 'scratched');
    assert.equal(await s.page.$eval('#rider-results', el => el.textContent.trim()), 'No match.',
      'non-accepted entries are not searchable');

    await s.page.fill('#rider-search', 'matchrider');
    rows = await s.page.$$eval('#rider-results .rrow', els => els.length);
    assert.equal(rows, 20, 'capped at top 20 of 25 matches');

    // Hide a baked rider, then re-Add via search: un-hides, no duplicate in mine.
    await s.page.click('#my-riders-list button.rm[data-n="Zook, Penelope"]');
    assert.deepEqual(await storage(s.page), { mine: [], hidden: ['Zook, Penelope'] });
    await s.page.fill('#rider-search', 'zook');
    await s.page.click('#rider-results button.rbtn.add[data-n="Zook, Penelope"]');
    assert.deepEqual(await storage(s.page), { mine: [], hidden: [] }, 'un-hidden, not added to mine');
  } finally { await s.context.close(); }
});

test('K48: Removed-note + restore; persistence across reload; fresh context sees baked list; count reflects edits', async () => {
  // Seed one hide and two adds: 9 - 1 + 2 = 10 followed.
  const s = await openPage({
    server, feed: pickerFeed(), now: NOON,
    localStorage: {
      'rf2026:hiddenRiders': JSON.stringify(['Zook, Penelope']),
      'rf2026:myRiders': JSON.stringify(['Extra, Rider', 'Matchrider, R01']),
    },
  });
  try {
    assert.ok((await s.page.$eval('#status', el => el.textContent)).endsWith('· 10 riders followed'));

    // Survives reload in the same browser profile.
    await s.page.reload();
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    await s.page.waitForLoadState('networkidle');
    assert.ok((await s.page.$eval('#status', el => el.textContent)).endsWith('· 10 riders followed'));

    // Removed-note with restore link.
    await s.page.click('#edit-riders');
    const note = await s.page.$eval('#my-riders-list', el => el.textContent);
    assert.ok(note.includes('Removed: Zook, Penelope'), note);
    await s.page.click('#restore-shared');
    assert.deepEqual(await storage(s.page), { mine: ['Extra, Rider', 'Matchrider, R01'], hidden: [] });
    assert.ok((await s.page.$eval('#status', el => el.textContent)).endsWith('· 11 riders followed'));
  } finally { await s.context.close(); }

  // A fresh context has no local edits: baked list only.
  const fresh = await openPage({ server, feed: pickerFeed(), now: NOON });
  try {
    assert.deepEqual(await fresh.page.evaluate(() => effectiveFollowing()),
      await fresh.page.evaluate(() => FOLLOWING.slice()));
    assert.ok((await fresh.page.$eval('#status', el => el.textContent)).endsWith('· 9 riders followed'));
  } finally { await fresh.context.close(); }
});
