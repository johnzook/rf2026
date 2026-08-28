'use strict';
// TESTPLAN group R (round view: division phase progress).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON_SAT = denverMs(2026, 7, 18, 12, 0);

// Timed-phase fixture (Dressage, Sat Jul 18): one followed combo among
// strangers, two posted scores (tied 1st), one withdrawn, one with no
// scoring row at all.
function dressageFeed() {
  return F.feed([
    F.entry({ pinny: 801, rider: F.FOLLOWED.zook, horse: 'Eddy', division: 'Div R', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) }),
      F.ridingDetail({ phase: 'Phase A', venue: 'Phase A', time: F.rideTimeStr(2026, 7, 18, 9, 0) })] }),
    F.entry({ pinny: 802, rider: 'Alpha, Ann', horse: 'H802', division: 'Div R', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 12, 0) })] }),
    F.entry({ pinny: 803, rider: 'Beta, Bob', horse: 'H803', division: 'Div R', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 12, 10) })] }),
    F.entry({ pinny: 804, rider: 'Gamma, Cat', horse: 'H804', division: 'Div R', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 12, 20) })] }),
    F.entry({ pinny: 805, rider: 'Delta, Dee', horse: 'H805', division: 'Div R', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 12, 30) })] }),
    F.entry({ pinny: 806, rider: 'Zeta, Zed', horse: 'H806', division: 'Div R', status: 'Scratched', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 12, 40) })] }),
    F.entry({ pinny: 807, rider: 'Eta, Eve', horse: 'H807', division: 'Other Div', details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R5', time: F.rideTimeStr(2026, 7, 18, 12, 50) })] }),
  ]);
}
function dressageScoring() {
  return F.scoring({
    divisions: [F.division({ id: 60, name: 'Div R' })],
    rows: [
      F.scoringRow({ pinny: 802, divisionId: 60, dressageScore: '30.0', dressagePlace: '1', finalPlace: '1' }),
      F.scoringRow({ pinny: 803, divisionId: 60, dressageScore: '30.0', dressagePlace: '1', finalPlace: '1' }),
      F.scoringRow({ pinny: 804, divisionId: 60, finalPlace: 'W' }),
      // 801 and 805 pending ('--'); no row at all for anyone else.
    ],
  });
}

const ROW_SEL = key => `#list .row[data-key="${key}"]`;
const qrows = page => page.$$eval('#round-list .qrow', els => els.map(e => ({
  classes: [...e.classList],
  time: e.querySelector('.qtime').textContent,
  rider: e.querySelector('.qrider').textContent,
  res: e.querySelector('.qres').textContent.replace(/\s+/g, ' ').trim(),
})));

test('86: popover round link on scored phases only; opens/closes the round sheet', async () => {
  const s = await openPage({ server, feed: dressageFeed(), scoring: dressageScoring(), now: NOON_SAT });
  try {
    // Dressage row popover carries the link; Phase A (no scoring fields) doesn't.
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    assert.equal(await s.page.$eval('.row.pinned .round-link', el => el.textContent),
      'view Dressage round →');
    await s.page.$eval('.row.pinned .round-link', el => el.click());
    assert.equal(await s.page.$eval('#round-sheet', el => el.hidden), false, 'sheet opens');
    assert.equal(await s.page.textContent('#round-title'), 'Div R');

    // ✕ closes. (Clicks inside the sheet also unpin the popover behind it —
    // the document-level dismiss — so each reopen re-pins the row first.)
    await s.page.click('#round-close');
    assert.equal(await s.page.$eval('#round-sheet', el => el.hidden), true);

    // Backdrop tap closes (top of the overlay is outside the card).
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());
    await s.page.click('#round-sheet', { position: { x: 10, y: 10 } });
    assert.equal(await s.page.$eval('#round-sheet', el => el.hidden), true, 'backdrop closes');

    // Escape closes too.
    await s.page.mouse.move(0, 0);
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());
    await s.page.keyboard.press('Escape');
    assert.equal(await s.page.$eval('#round-sheet', el => el.hidden), true, 'Escape closes');

    // Phase A popover: no link at all.
    await s.page.mouse.move(0, 0);
    await s.page.click(ROW_SEL('801|Phase A|2026-07-18'), { position: { x: 10, y: 10 } });
    assert.equal(await s.page.$('.row.pinned .round-link'), null, 'no link for Phase A');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('87: timed-phase round — time order, scores/ties, out in place, mine highlight, progress line', async () => {
  const s = await openPage({ server, feed: dressageFeed(), scoring: dressageScoring(), now: NOON_SAT });
  try {
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());

    // Withdrawn 804 doesn't count toward the denominator; "through" is the
    // latest posted slot.
    assert.equal(await s.page.textContent('#round-sub'),
      'Dressage · 2 of 4 scores posted · through 12:10 PM');

    const rows = await qrows(s.page);
    // Scratched 806 and other-division 807 never appear; order is ride time.
    assert.deepEqual(rows.map(r => r.rider),
      ['Alpha, Ann', 'Beta, Bob', 'Gamma, Cat', 'Delta, Dee', 'Zook, Penelope']);
    assert.deepEqual(rows.map(r => r.time),
      ['12:00 PM', '12:10 PM', '12:20 PM', '12:30 PM', '1:00 PM']);
    assert.equal(rows[0].res, '30.0 (T1st)', 'tied place carries the T marker');
    assert.equal(rows[1].res, '30.0 (T1st)');
    assert.equal(rows[2].res, 'withdrawn');
    assert.ok(rows[2].classes.includes('out'), 'out combo dimmed in place');
    assert.equal(rows[3].res, '—', 'pending — no score yet');
    assert.equal(rows[4].res, '—', 'no scoring row at all — pending');
    assert.ok(rows[4].classes.includes('mine'), 'followed rider highlighted');
    assert.ok(!rows[0].classes.includes('mine'));

    // An override moves a combo's slot in the round too (same time rules
    // as the timeline rows).
    await s.page.evaluate(() => {
      OVERRIDE_IDX['805|Dressage'] = new Date(2026, 6, 18, 13, 10);
      render();
    });
    const moved = await qrows(s.page);
    assert.deepEqual(moved.map(r => r.rider).slice(-2), ['Zook, Penelope', 'Delta, Dee']);
    assert.equal(moved[moved.length - 1].time, '1:10 PM');
  } finally { await s.context.close(); }
});

test('88: SJ block round — reverse-of-standing order, ~slot estimates, outs last, no "through"', async () => {
  const block = F.rideTimeStr(2026, 7, 18, 14, 0);
  const feed = F.feed([901, 902, 903, 904, 905].map((pinny, i) =>
    F.entry({ pinny, rider: pinny === 901 ? F.FOLLOWED.zook : `Rider, R${pinny}`,
      horse: `H${pinny}`, division: 'Div S', details: [
        F.ridingDetail({ phase: 'Show Jumping', venue: 'SJR3', time: block })] })));
  const scoring = F.scoring({
    divisions: [F.division({ id: 61, name: 'Div S' })],
    rows: [
      F.scoringRow({ pinny: 901, divisionId: 61, finalPlace: '3' }),
      F.scoringRow({ pinny: 902, divisionId: 61, finalPlace: '1' }),
      F.scoringRow({ pinny: 903, divisionId: 61, sjScore: '32.5', sjPlace: '1', finalPlace: '2' }),
      F.scoringRow({ pinny: 904, divisionId: 61, finalPlace: '4' }),
      F.scoringRow({ pinny: 905, divisionId: 61, finalPlace: 'E' }),
    ],
  });
  const s = await openPage({ server, feed, scoring, now: NOON_SAT });
  try {
    await s.page.click(ROW_SEL('901|Show Jumping|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());

    assert.equal(await s.page.textContent('#round-sub'), 'SJ · 1 of 4 scores posted',
      'no "through" clause for a block phase');
    const rows = await qrows(s.page);
    // Reverse of current standing (4th jumps first), eliminated 905 last.
    assert.deepEqual(rows.map(r => r.rider),
      ['Rider, R904', 'Zook, Penelope', 'Rider, R903', 'Rider, R902', 'Rider, R905']);
    // Slot estimates from the block start for still-to-jump combos (ahead
    // counts every active combo placed below, matching autoEstimate);
    // posted 903 and eliminated 905 show no time.
    assert.deepEqual(rows.map(r => r.time),
      ['~2:00 PM', '~2:02 PM', '', '~2:06 PM', '']);
    assert.equal(rows[2].res, '32.5 (1st)');
    assert.equal(rows[4].res, 'eliminated');
    assert.ok(rows[4].classes.includes('out'));
    assert.ok(rows[1].classes.includes('mine'));
  } finally { await s.context.close(); }
});

test('90: sort toggle — placing re-sorts to current standing; choice survives re-renders and reopen', async () => {
  const s = await openPage({ server, feed: dressageFeed(), scoring: dressageScoring(), now: NOON_SAT });
  try {
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());

    const activeSort = () => s.page.$eval('#round-sort .active', el => el.dataset.sort);
    assert.equal(await activeSort(), 'order', 'running order is the default');

    // Placing: placed combos ascending (802/803 tied 1st, running-order
    // tiebreak), then not-yet-placed in running order, out 804 last. Rows
    // keep their own slot times.
    await s.page.click('#round-sort [data-sort="place"]');
    assert.equal(await activeSort(), 'place');
    let rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => r.rider),
      ['Alpha, Ann', 'Beta, Bob', 'Delta, Dee', 'Zook, Penelope', 'Gamma, Cat']);
    assert.equal(rows[2].time, '12:30 PM');

    // A live scoring update re-renders in the chosen sort: Penelope posts
    // 2nd, moving between the tied leaders and Delta.
    await s.page.evaluate(() => {
      const sc = JSON.parse(localStorage.getItem('sc:1187:scoring')).value;
      sc.ScoringList.push({ CRID: 3, DivisionId: 60, Pinny: 801,
        DressageScore: '30.5', DressagePlace: '2', FinalPlace: '2' });
      resultsIdx = buildResultsIndex(sc);
      render();
    });
    rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => r.rider),
      ['Alpha, Ann', 'Beta, Bob', 'Zook, Penelope', 'Delta, Dee', 'Gamma, Cat']);

    // Close and reopen: the preference sticks for the page's lifetime.
    await s.page.click('#round-close');
    await s.page.mouse.move(0, 0); // clear any hover popover before re-clicking
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());
    assert.equal(await activeSort(), 'place', 'sort choice survives reopen');

    // And back to running order.
    await s.page.click('#round-sort [data-sort="order"]');
    rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => r.rider),
      ['Alpha, Ann', 'Beta, Bob', 'Gamma, Cat', 'Delta, Dee', 'Zook, Penelope']);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('89: an open round sheet updates live as scoring polls land', async () => {
  const s = await openPage({ server, feed: dressageFeed(), scoring: dressageScoring(), now: NOON_SAT });
  try {
    await s.page.click(ROW_SEL('801|Dressage|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());
    assert.equal(await s.page.textContent('#round-sub'),
      'Dressage · 2 of 4 scores posted · through 12:10 PM');

    // A scoring poll posts the remaining scores (Penelope's among them):
    // the open sheet re-renders through the normal render() path, and the
    // fully posted phase drops the "through" clause for "all N".
    await s.page.evaluate(() => {
      const sc = JSON.parse(localStorage.getItem('sc:1187:scoring')).value;
      sc.ScoringList.push(
        { CRID: 1, DivisionId: 60, Pinny: 801, DressageScore: '31.0', DressagePlace: '3', FinalPlace: '3' },
        { CRID: 2, DivisionId: 60, Pinny: 805, DressageScore: '41.0', DressagePlace: '4', FinalPlace: '4' });
      resultsIdx = buildResultsIndex(sc);
      render();
    });
    assert.equal(await s.page.textContent('#round-sub'), 'Dressage · all 4 scores posted');
    const rows = await qrows(s.page);
    assert.equal(rows[4].res, '31.0 (3rd)', "Penelope's score appeared in place");
    assert.equal(await s.page.$eval('#round-sheet', el => el.hidden), false, 'sheet stayed open');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});
