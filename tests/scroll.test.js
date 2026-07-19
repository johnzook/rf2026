'use strict';
// TESTPLAN group M (scroll behavior: initial centering + floating now button).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);

// A long day: 36 rides 7:00–18:40, so the list is much taller than the
// 800px viewport, plus one ride tomorrow for a second chip.
function longFeed() {
  const names = Object.values(F.FOLLOWED);
  const entries = [];
  for (let i = 0; i < 36; i++) {
    const h = 7 + Math.floor(i / 3), min = (i % 3) * 20;
    entries.push(F.entry({ pinny: 800 + i, rider: names[i % names.length], details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, h, min) })] }));
  }
  entries.push(F.entry({ pinny: 899, rider: names[0], details: [
    F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 19, 9, 0) })] }));
  return F.feed(entries);
}

const nowLineTop = page => page.evaluate(() => {
  const el = document.querySelector('.now-line');
  return el ? el.getBoundingClientRect().top : null;
});

test('M50: first render centers the now-line once; later renders and day switches never move scroll', async () => {
  const s = await openPage({ server, feed: longFeed(), now: NOON });
  try {
    const vh = 800;
    const top = await nowLineTop(s.page);
    assert.ok(await s.page.evaluate(() => window.scrollY) > 0, 'page scrolled down on load');
    assert.ok(Math.abs(top - vh / 2) < 120, `now-line near viewport center (top=${top})`);

    // A re-render (poll tick) must not move the screen.
    await s.page.evaluate(() => window.scrollTo(0, 0));
    await s.page.evaluate(() => render());
    assert.equal(await s.page.evaluate(() => window.scrollY), 0, 're-render keeps scroll');

    // Day switch + back: still no re-centering.
    await s.page.click('#days .day-chip:last-child');
    assert.equal(await s.page.evaluate(() => window.scrollY), 0);
    await s.page.click('#days .day-chip:first-child');
    assert.equal(await s.page.evaluate(() => window.scrollY), 0, 'initial centering happens only once');
  } finally { await s.context.close(); }
});

test('R10: active day chip is auto-scrolled into view in the chip row; page scroll never moves', async () => {
  // Ten days of rides (Jul 10–19) on a narrow phone: the chip row overflows
  // and "Today" (Jul 18, 9th chip) starts far off-screen to the right.
  const names = Object.values(F.FOLLOWED);
  const entries = [];
  for (let d = 10; d <= 19; d++) {
    entries.push(F.entry({ pinny: 900 + d, rider: names[d % names.length], details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, d, 9, 0) })] }));
  }
  // Extra rides on Jul 18 and Jul 10 so the page itself stays scrollable on
  // both viewed days (a shrinking document would clamp window.scrollY).
  for (let i = 0; i < 20; i++) {
    for (const [d, base] of [[18, 940], [10, 970]]) {
      entries.push(F.entry({ pinny: base + i, rider: names[i % names.length], details: [
        F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, d, 10 + Math.floor(i / 4), (i % 4) * 15) })] }));
    }
  }
  const s = await openPage({
    server, feed: F.feed(entries), now: NOON,
    viewport: { width: 320, height: 600 },
  });
  try {
    const probe = () => s.page.evaluate(() => {
      const row = document.getElementById('days');
      const chip = row.querySelector('.day-chip.active');
      const rowR = row.getBoundingClientRect(), chipR = chip.getBoundingClientRect();
      return {
        overflow: row.scrollWidth > row.clientWidth,
        scrollLeft: row.scrollLeft,
        chipVisible: chipR.left >= rowR.left - 1 && chipR.right <= rowR.right + 1,
        label: chip.textContent,
        scrollY: window.scrollY,
      };
    });

    // On load the chip row scrolled right so the active "Today" is visible.
    let r = await probe();
    assert.equal(r.overflow, true, 'chip row overflows at 320px');
    assert.equal(r.label, 'Today');
    assert.ok(r.scrollLeft > 0, 'chip row scrolled right toward Today');
    assert.equal(r.chipVisible, true, 'active chip fully inside the row');

    // A re-render keeps the active chip visible without touching page scroll.
    const pageY = await s.page.evaluate(() => { window.scrollTo(0, 150); return window.scrollY; });
    assert.ok(pageY > 0, 'page is scrollable');
    await s.page.evaluate(() => render());
    r = await probe();
    assert.equal(r.scrollY, pageY, 're-render never moves the page scroll');
    assert.equal(r.chipVisible, true);

    // Selecting the leftmost (off-screen) day scrolls the row back left.
    await s.page.evaluate(() => { selectedDay = '2026-07-10'; render(); });
    r = await probe();
    assert.equal(r.label, 'Fri, Jul 10');
    assert.equal(r.chipVisible, true, 'row scrolled back for a left-edge chip');
    assert.equal(r.scrollLeft, 0);
    assert.equal(r.scrollY, pageY, 'chip-row scrolling leaves the page scroll alone');
  } finally { await s.context.close(); }
});

test('M51: now button appears with direction when the marker is off-screen; click brings it back', async () => {
  const s = await openPage({ server, feed: longFeed(), now: NOON });
  try {
    const btn = () => s.page.$eval('#now-btn', el => ({ hidden: el.hidden, text: el.textContent }));
    // After the initial centering the marker is on-screen: button hidden.
    assert.equal((await btn()).hidden, true);

    // Scroll far down: marker is above -> "↑ now".
    await s.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await s.page.waitForFunction(() => !document.getElementById('now-btn').hidden);
    assert.equal((await btn()).text, '↑ now');

    // Scroll to top: marker below -> "↓ now".
    await s.page.evaluate(() => window.scrollTo(0, 0));
    await s.page.waitForFunction(() =>
      !document.getElementById('now-btn').hidden &&
      document.getElementById('now-btn').textContent.includes('↓'));
    assert.equal((await btn()).text, '↓ now');

    // Click: smooth-scrolls the marker to ~25% down the viewport.
    await s.page.click('#now-btn');
    await s.page.waitForFunction(() => {
      const el = document.querySelector('.now-line');
      return el && Math.abs(el.getBoundingClientRect().top - window.innerHeight * 0.25) < 60;
    });

    // Viewing another day: no marker, button hidden.
    await s.page.click('#days .day-chip:last-child');
    assert.equal(await s.page.$('.now-line'), null);
    assert.equal((await btn()).hidden, true);
  } finally { await s.context.close(); }
});
