'use strict';
// TESTPLAN group G (out-of-competition status).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);

test('G28: FinalPlace code mapping (E/IE/TE/R/MR/RF/W/IW), numeric and blank are not out', async () => {
  const s = await openPage({ server, feed: F.feed([]), waitLoaded: false });
  try {
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const r = await s.page.evaluate(() => {
      const codes = ['E', 'IE', 'TE', 'R', 'MR', 'RF', 'W', 'IW', ' E ', '5', '', '--', 'XYZ'];
      const out = {};
      for (const c of codes) {
        resultsIdx = { '700|Div': { FinalPlace: c } };
        out[JSON.stringify(c)] = outStatus({ pinny: 700, division: 'Div' });
      }
      resultsIdx = {};
      out.missingRow = outStatus({ pinny: 701, division: 'Div' });
      return out;
    });
    assert.equal(r['"E"'], 'eliminated');
    assert.equal(r['"IE"'], 'eliminated');
    assert.equal(r['"TE"'], 'eliminated');
    assert.equal(r['"R"'], 'retired');
    assert.equal(r['"MR"'], 'retired');
    assert.equal(r['"RF"'], 'rider fall');
    assert.equal(r['"W"'], 'withdrawn');
    assert.equal(r['"IW"'], 'withdrawn');
    assert.equal(r['" E "'], 'eliminated', 'whitespace trimmed');
    assert.equal(r['"5"'], null, 'numeric place is not out');
    assert.equal(r['""'], null);
    assert.equal(r['"--"'], null);
    assert.equal(r['"XYZ"'], null);
    assert.equal(r.missingRow, null);
  } finally { await s.context.close(); }
});

test('G29: upcoming rides of an out combo: faded, status word, no next-up/soon, future days too', async () => {
  const feed = F.feed([
    // Out combo: SJ in 10 min today + XC tomorrow, same division.
    F.entry({ pinny: 650, rider: F.FOLLOWED.zook, division: 'DivA', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 12, 10) }),
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 19, 10, 0) }),
    ] }),
    // Healthy combo later today (also inside the 30 min soon window).
    F.entry({ pinny: 651, rider: F.FOLLOWED.aulita, division: 'DivA', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 12, 25) }),
    ] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 20, name: 'DivA' })],
    rows: [
      F.scoringRow({ pinny: 650, divisionId: 20, finalPlace: 'E' }),
      F.scoringRow({ pinny: 651, divisionId: 20, finalPlace: '1' }),
    ],
  });
  const s = await openPage({ server, feed, scoring, now: NOON });
  try {
    const outRow = await rowInfo(s.page, 650);
    assert.ok(outRow.classes.includes('out'));
    assert.equal(outRow.countdown, 'eliminated', 'status word replaces countdown');
    assert.ok(!outRow.classes.includes('soon'), 'within 30 min but never soon');
    assert.equal(outRow.nextTag, null, 'out rows are skipped for next-up');
    assert.equal(outRow.opacity, '0.75', 'faded');

    const okRow = await rowInfo(s.page, 651);
    assert.equal(okRow.nextTag, 'Next up', 'next-up moved past the out row');
    assert.ok(okRow.classes.includes('soon'));

    // Tap restores full opacity (pins the row).
    await s.page.click('#list .row', { position: { x: 10, y: 10 } });
    const pinned = await rowInfo(s.page, 650);
    assert.ok(pinned.classes.includes('pinned'));
    assert.equal(pinned.opacity, '1');

    // Future-day view still shows the status.
    await s.page.click('#days .day-chip:last-child');
    const future = await rowInfo(s.page, 650);
    assert.ok(future.classes.includes('out'));
    assert.equal(future.countdown, 'eliminated');
  } finally { await s.context.close(); }
});

test('G30: extras never get out status', async () => {
  const feed = F.feed([
    F.entry({ pinny: 652, rider: F.FOLLOWED.zook, division: 'DivA', details: [
      F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 14, 0) }),
    ] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 20, name: 'DivA' })],
    rows: [F.scoringRow({ pinny: 652, divisionId: 20, finalPlace: 'E' })],
  });
  const s = await openPage({ server, feed, scoring, now: NOON });
  try {
    await s.page.evaluate(() => {
      EXTRAS.length = 0;
      EXTRAS.push({ date: '2026-07-18', time: '12:30 PM', title: 'Course walk', detail: 'Ring 4' });
      render();
    });
    const r = await s.page.evaluate(() => {
      const el = document.querySelector('#list .row.extra');
      const cd = el.querySelector('.countdown');
      return { classes: [...el.classList], countdown: cd ? cd.textContent : null };
    });
    assert.ok(!r.classes.includes('out'));
    assert.equal(r.countdown, 'in 30 min', 'normal countdown, no status word');
  } finally { await s.context.close(); }
});
