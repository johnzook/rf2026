'use strict';
// TESTPLAN group E (SJ slot estimates).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOW = denverMs(2026, 7, 18, 12, 0);
const SJ_1400 = F.rideTimeStr(2026, 7, 18, 14, 0); // shared block-start string

// A block division: two accepted entries with the identical SJ time string.
function blockFeed() {
  return F.feed([
    F.entry({ pinny: 630, rider: F.FOLLOWED.zook, division: 'Block Div', divisionShort: 'BD',
      details: [F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: SJ_1400 })] }),
    F.entry({ pinny: 631, rider: 'Other, One', division: 'Block Div', divisionShort: 'BD',
      details: [F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: SJ_1400 })] }),
    // Solo division: one entry only -> not a block.
    F.entry({ pinny: 632, rider: F.FOLLOWED.aulita, division: 'Solo Div', divisionShort: 'SD',
      details: [F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 15, 0) })] }),
    // Distinct individual times -> not a block.
    F.entry({ pinny: 633, rider: 'Other, Two', division: 'Var Div', divisionShort: 'VD',
      details: [F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 16, 0) })] }),
    F.entry({ pinny: 634, rider: 'Other, Three', division: 'Var Div', divisionShort: 'VD',
      details: [F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR1', time: F.rideTimeStr(2026, 7, 18, 16, 4) })] }),
  ]);
}

function blockScoring() {
  return F.scoring({
    divisions: [F.division({ id: 10, name: 'Block Div' }), F.division({ id: 11, name: 'Solo Div' })],
    rows: [
      F.scoringRow({ pinny: 630, divisionId: 10, dressagePlace: '3', finalPlace: '3' }),
      F.scoringRow({ pinny: 631, divisionId: 10, dressagePlace: '1', finalPlace: '1' }),
      F.scoringRow({ pinny: 635, divisionId: 10, finalPlace: '2' }),
      F.scoringRow({ pinny: 636, divisionId: 10, finalPlace: '4' }),
      F.scoringRow({ pinny: 637, divisionId: 10, finalPlace: '5' }),
      F.scoringRow({ pinny: 638, divisionId: 10, finalPlace: 'E' }),  // out: not counted
      F.scoringRow({ pinny: 632, divisionId: 11, finalPlace: '1' }),
    ],
  });
}

test('E19: block detection needs >1 entry with identical SJ time strings', async () => {
  const s = await openPage({ server, feed: blockFeed(), scoring: blockScoring(), now: NOW });
  try {
    assert.deepEqual(await s.page.evaluate(() => [...sjBlockDivs]), ['Block Div']);
  } finally { await s.context.close(); }
});

test('E20: autoEstimate = block start + 2 min per lower-placed active combo; ties equal', async () => {
  const s = await openPage({ server, feed: blockFeed(), scoring: blockScoring(), now: NOW });
  try {
    const r = await s.page.evaluate(() => {
      const base = new Date(2026, 6, 18, 14, 0);
      const mk = pinny => ({ phase: 'Show Jumping', division: 'Block Div', pinny });
      const probe = p => { const e = autoEstimate(mk(p), base); return e && { when: fmtClock(e.when), note: e.note }; };
      const out = { p630: probe(630), p631: probe(631), p637: probe(637) };
      // Tie in placing: two combos both placed 3 -> identical estimates.
      scoringByDiv['Block Div'].find(x => x.Pinny === 635).FinalPlace = '3';
      out.tieA = probe(630);
      out.tieB = probe(635);
      return out;
    });
    // Actives: places 1,2,3,4,5 (E excluded). Place 3 -> 2 ahead -> 14:04, 3rd of 5.
    assert.deepEqual(r.p630, { when: '2:04 PM', note: '3rd of 5 to jump, by standing' });
    // Leader jumps last: 4 ahead -> 14:08, 5th of 5.
    assert.deepEqual(r.p631, { when: '2:08 PM', note: '5th of 5 to jump, by standing' });
    // Last place jumps first: 0 ahead -> block start, 1st of 5.
    assert.deepEqual(r.p637, { when: '2:00 PM', note: '1st of 5 to jump, by standing' });
    // Tied places produce equal estimates (both still count 2 combos below).
    assert.deepEqual(r.tieA, r.tieB);
    assert.deepEqual(r.tieA, { when: '2:04 PM', note: '3rd of 5 to jump, by standing' });
  } finally { await s.context.close(); }
});

test('E21: no auto estimate for out combos, missing scoring rows, non-SJ, non-block divisions', async () => {
  const s = await openPage({ server, feed: blockFeed(), scoring: blockScoring(), now: NOW });
  try {
    const r = await s.page.evaluate(() => {
      const base = new Date(2026, 6, 18, 14, 0);
      return {
        outCombo: autoEstimate({ phase: 'Show Jumping', division: 'Block Div', pinny: 638 }, base),
        noRow: autoEstimate({ phase: 'Show Jumping', division: 'Block Div', pinny: 999 }, base),
        nonSJ: autoEstimate({ phase: 'Dressage', division: 'Block Div', pinny: 630 }, base),
        nonBlock: autoEstimate({ phase: 'Show Jumping', division: 'Solo Div', pinny: 632 }, base),
      };
    });
    assert.deepEqual(r, { outCombo: null, noRow: null, nonSJ: null, nonBlock: null });
  } finally { await s.context.close(); }
});

test('E18+E20: manual date-matched ESTIMATES beat the auto estimate in rendering', async () => {
  const s = await openPage({ server, feed: blockFeed(), scoring: blockScoring(), now: NOW });
  try {
    // Auto first: place 3 of 5 -> 14:04.
    let row = await rowInfo(s.page, 630);
    assert.equal(row.est, 'est. slot ~2:04 PM · 3rd of 5 to jump, by standing');
    assert.ok(row.pop.includes('~2:04 PM (3rd of 5 to jump, by standing)'), 'estimate also in popover');

    // Manual entry (date-matched) takes precedence.
    await s.page.evaluate(() => {
      EST_IDX['630|Show Jumping'] = { when: new Date(2026, 6, 18, 14, 10), note: 'manual sheet note' };
      rides = extractRides(lastFeed);
      render();
    });
    row = await rowInfo(s.page, 630);
    assert.equal(row.est, 'est. slot ~2:10 PM · manual sheet note');

    // A manual entry for the WRONG day is ignored; auto wins again.
    await s.page.evaluate(() => {
      EST_IDX['630|Show Jumping'] = { when: new Date(2026, 6, 17, 14, 10), note: 'stale note' };
      rides = extractRides(lastFeed);
      render();
    });
    row = await rowInfo(s.page, 630);
    assert.equal(row.est, 'est. slot ~2:04 PM · 3rd of 5 to jump, by standing');
  } finally { await s.context.close(); }
});

test('E22: estimates are hidden on past/done rows', async () => {
  const s = await openPage({ server, feed: blockFeed(), scoring: blockScoring(), now: NOW });
  try {
    assert.ok((await rowInfo(s.page, 630)).est, 'estimate visible while upcoming');
    // Past the estimate (14:04) + 10 min grace.
    await s.page.evaluate(ms => { window.__setNow(ms); render(); }, denverMs(2026, 7, 18, 14, 20));
    const row = await rowInfo(s.page, 630);
    assert.ok(row.classes.includes('past'), 'row is done');
    assert.equal(row.est, null, 'no est line once past');
  } finally { await s.context.close(); }
});
