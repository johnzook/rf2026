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
