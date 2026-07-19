'use strict';
// TESTPLAN groups L (extras) and N52/N53 (pinny display, HTML escaping).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);

test('L49: extras render inline on their day, dashed, popover-less, with countdown/next-up; nothing once past', async () => {
  const feed = F.feed([
    F.entry({ pinny: 750, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 11, 0) })] }),
    F.entry({ pinny: 751, rider: F.FOLLOWED.aulita, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
    F.entry({ pinny: 752, rider: F.FOLLOWED.crocker, details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 19, 10, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    await s.page.evaluate(() => {
      EXTRAS.length = 0;
      EXTRAS.push({ date: '2026-07-18', time: '12:30 PM', title: 'BN course walk', detail: 'Ring 4, meet at gate' });
      EXTRAS.push({ date: '2026-07-19', time: '8:00 AM', title: 'Sunday walk', detail: 'XC start box' });
      render();
    });
    const extra = await s.page.evaluate(() => {
      const rows = [...document.querySelectorAll('#list .row')];
      const el = document.querySelector('#list .row.extra');
      const cd = el.querySelector('.countdown');
      return {
        index: rows.indexOf(el), count: rows.filter(r => r.classList.contains('extra')).length,
        title: el.querySelector('.rider').textContent,
        detail: el.querySelector('.horse').textContent,
        time: el.querySelector('.adj').textContent,
        borderStyle: getComputedStyle(el).borderTopStyle,
        hasPop: !!el.querySelector('.pop'),
        hasPinny: el.textContent.includes('#'),
        countdown: cd && cd.textContent,
        nextTag: el.querySelector('.next-tag') && el.querySelector('.next-tag').textContent,
      };
    });
    assert.equal(extra.count, 1, 'only this day\'s extra shows');
    assert.equal(extra.title, 'BN course walk');
    assert.equal(extra.detail, 'Ring 4, meet at gate');
    assert.equal(extra.time, '12:30 PM');
    assert.equal(extra.index, 1, 'sorted between the 11:00 and 13:00 rides');
    assert.equal(extra.borderStyle, 'dashed');
    assert.equal(extra.hasPop, false, 'no popover');
    assert.equal(extra.hasPinny, false, 'no pinny');
    assert.equal(extra.countdown, 'in 30 min');
    assert.equal(extra.nextTag, 'Next up', 'extras participate in next-up');

    // Once past (12:30 + 10 min grace), the extra shows no countdown line.
    await s.page.evaluate(ms => { window.__setNow(ms); render(); }, denverMs(2026, 7, 18, 12, 41));
    const past = await s.page.evaluate(() => {
      const el = document.querySelector('#list .row.extra');
      return { past: el.classList.contains('past'), hasCountdown: !!el.querySelector('.countdown') };
    });
    assert.equal(past.past, true);
    assert.equal(past.hasCountdown, false, 'nothing shown once past');

    // The other extra lives only under its own day chip.
    await s.page.click('#days .day-chip:last-child');
    const sunday = await s.page.$eval('#list .row.extra .rider', el => el.textContent);
    assert.equal(sunday, 'Sunday walk');
  } finally { await s.context.close(); }
});

test('N52: pinny renders bold after the horse; omitted when null', async () => {
  const feed = F.feed([
    F.entry({ pinny: 753, rider: F.FOLLOWED.zook, horse: 'Eddy', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
    F.entry({ pinny: null, rider: F.FOLLOWED.aulita, horse: 'NoNumber', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    const r = await s.page.evaluate(() => {
      const horses = [...document.querySelectorAll('#list .row .horse')];
      const withPinny = horses.find(h => h.textContent.includes('Eddy'));
      const withoutPinny = horses.find(h => h.textContent.includes('NoNumber'));
      return {
        boldPinny: withPinny.querySelector('b') && withPinny.querySelector('b').textContent,
        text: withPinny.textContent,
        nullText: withoutPinny.textContent,
        nullHasBold: !!withoutPinny.querySelector('b'),
      };
    });
    assert.equal(r.boldPinny, '#753', 'pinny in a <b>');
    assert.equal(r.text, 'Eddy · #753');
    assert.equal(r.nullText, 'NoNumber', 'no separator/# when pinny is null');
    assert.equal(r.nullHasBold, false);
  } finally { await s.context.close(); }
});

test('N53: feed strings are HTML-escaped everywhere — no element injection', async () => {
  const evilRider = '<img src=x onerror="window.__xss=1">, Evil';
  const evilHorse = 'A & "B" <b>bold</b> \'C\'';
  const feed = F.feed([
    F.entry({ pinny: 754, rider: evilRider, horse: evilHorse,
      division: 'Div <script>bad</script>', divisionShort: '<i>DS</i>',
      details: [F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
  ]);
  const s = await openPage({
    server, feed, now: NOON,
    // Follow the malicious rider through the personal list.
    localStorage: { 'rf2026:myRiders': JSON.stringify([evilRider]) },
  });
  try {
    const r = await s.page.evaluate(evil => ({
      xss: window.__xss,
      imgCount: document.querySelectorAll('img').length,
      scriptInList: !!document.querySelector('#list script, #list i'),
      riderText: document.querySelector('#list .row .rider').textContent,
      horseText: document.querySelector('#list .row .horse').textContent,
      horseHTML: document.querySelector('#list .row .horse').innerHTML,
      popHeader: document.querySelector('#list .row .pop h3').textContent,
    }), evilRider);
    assert.equal(r.xss, undefined, 'onerror never fired');
    assert.equal(r.imgCount, 0, 'no <img> element injected');
    assert.equal(r.scriptInList, false, 'no <script>/<i> injected from division strings');
    assert.equal(r.riderText, evilRider, 'name shown literally');
    assert.ok(r.horseText.startsWith('A & "B" <b>bold</b>'), r.horseText);
    assert.ok(r.horseHTML.includes('&lt;b&gt;bold&lt;/b&gt;'), 'markup arrived escaped');
    assert.equal(r.popHeader, evilRider, 'popover header escaped too');

    // The rider sheet (list + search results) is safe as well.
    await s.page.click('#edit-riders');
    await s.page.fill('#rider-search', 'evil');
    const sheet = await s.page.evaluate(() => ({
      imgCount: document.querySelectorAll('img').length,
      xss: window.__xss,
      resultText: document.querySelector('#rider-results .rrow span').textContent,
    }));
    assert.equal(sheet.imgCount, 0);
    assert.equal(sheet.xss, undefined);
    assert.ok(sheet.resultText.includes('<img src=x onerror="window.__xss=1">, Evil'));
  } finally { await s.context.close(); }
});
