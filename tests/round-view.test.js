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
      // 805 pending: a row exists but everything (FinalPoints included) is
      // '--' — the first-phase no-carried-score case. 801 has no row at all.
      F.scoringRow({ pinny: 805, divisionId: 60 }),
    ],
  });
}

const ROW_SEL = key => `#list .row[data-key="${key}"]`;
const qrows = page => page.$$eval('#round-list .qrow', els => els.map(e => {
  const rank = e.querySelector('.qtime .qrank');
  const sub = e.querySelector('.qtime .qsub');
  return {
    classes: [...e.classList],
    time: rank ? (sub ? sub.textContent : '') : e.querySelector('.qtime').textContent,
    rank: rank ? rank.textContent : null,
    rankProv: rank ? rank.classList.contains('prov') : null,
    rider: e.querySelector('.qrider').textContent,
    res: e.querySelector('.qres').textContent.replace(/\s+/g, ' ').trim(),
    carried: !!e.querySelector('.qres .carried'),
  };
}));

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
    assert.ok(!rows[3].carried, 'first phase: FinalPoints "--" means no carried score');
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

test('91: carried scores — pending rows show FinalPoints in gray; placing merges by cumulative score', async () => {
  // Mid-XC: 812 has run (cumulative 34.1, XC 1st of the finishers so far);
  // 813 and 811 carry their dressage totals in; 814 has no scoring row;
  // 815 was eliminated on course.
  const feed = F.feed([
    F.entry({ pinny: 812, rider: 'Alpha, Ann', horse: 'H812', division: 'Div X', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 0) })] }),
    F.entry({ pinny: 811, rider: F.FOLLOWED.zook, horse: 'Eddy', division: 'Div X', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 10) })] }),
    F.entry({ pinny: 813, rider: 'Beta, Bob', horse: 'H813', division: 'Div X', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 20) })] }),
    F.entry({ pinny: 814, rider: 'Cara, Kit', horse: 'H814', division: 'Div X', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 30) })] }),
    F.entry({ pinny: 815, rider: 'Dena, Max', horse: 'H815', division: 'Div X', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 40) })] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 62, name: 'Div X' })],
    rows: [
      F.scoringRow({ pinny: 812, divisionId: 62, dressageScore: '34.1', dressagePlace: '2',
        xcScore: '34.1', xcPlace: '1', finalPoints: '34.1', finalPlace: '3' }),
      F.scoringRow({ pinny: 813, divisionId: 62, dressageScore: '34.1', dressagePlace: '2',
        finalPoints: '34.1', finalPlace: '4' }),
      F.scoringRow({ pinny: 811, divisionId: 62, dressageScore: '35.6', dressagePlace: '4',
        finalPoints: '35.6', finalPlace: '5' }),
      F.scoringRow({ pinny: 815, divisionId: 62, dressageScore: '30.0', dressagePlace: '1',
        finalPlace: 'E' }),
    ],
  });
  const s = await openPage({ server, feed, scoring, now: NOON_SAT });
  try {
    await s.page.click(ROW_SEL('811|Cross Country|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());
    assert.equal(await s.page.textContent('#round-sub'),
      'XC · 1 of 4 scores posted · through 9:00 AM');

    let rows = await qrows(s.page);
    // Item 93: running order shows the SAME merged standing as the placing
    // view, not the feed's phase place — Ann's XCPlace is "1" (1st of the
    // one finisher) but Bob carries an identical 34.1 into the phase, so
    // both read T1st. Carried rows carry a gray provisional place too.
    assert.deepEqual(rows.map(r => [r.rider, r.res, r.carried]), [
      ['Alpha, Ann', '34.1 (T1st)', false],  // posted — accent place
      ['Zook, Penelope', '35.6 (3rd)', true],// carried score and place in gray
      ['Beta, Bob', '34.1 (T1st)', true],
      ['Cara, Kit', '—', false],             // no scoring row — nothing to carry or rank
      ['Dena, Max', 'eliminated', false],    // out shows the status word, never a carried score
    ], 'running order with gray carried scores and merged provisional places');
    assert.deepEqual(await s.page.$$eval('#round-list .qres .place',
      els => els.map(e => e.classList.contains('prov'))), [false, true, true],
      'provisional place gray on carried rows, accent on the posted one');

    // Placing merges by cumulative score — pending combos slot where a
    // clean ride would land them; posted 812 outranks 813's identical
    // carried 34.1; no-score 814 follows in running order, out 815 last.
    await s.page.click('#round-sort [data-sort="place"]');
    rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => r.rider),
      ['Alpha, Ann', 'Beta, Bob', 'Zook, Penelope', 'Cara, Kit', 'Dena, Max']);
    // Item 92: every scored row shows a provisional rank (merged scores,
    // ties share a T rank, gray while carried); no-score and out rows get
    // none, and the score cell drops its "(place)" parens in this view —
    // 812's among-finishers "(1st)" would contradict its merged T1st/9th
    // style position.
    assert.deepEqual(rows.map(r => [r.rank, r.rankProv]), [
      ['T1st', false], ['T1st', true], ['3rd', true], [null, null], [null, null]]);
    assert.equal(rows[0].res, '34.1', 'posted score stands alone in placing view');
    // Both views agree on every place: the running-order parens above and
    // the rank column here are the one merged standing.
    assert.deepEqual(rows.map(r => r.rank), ['T1st', 'T1st', '3rd', null, null]);
    assert.deepEqual(rows.map(r => r.time),
      ['9:00 AM', '9:20 AM', '9:10 AM', '9:30 AM', '9:40 AM'],
      'ride times demoted to the sub-line but still shown');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('93: running order shows the merged provisional place, not the feed\'s finishers-only one', async () => {
  // Mid-XC, the first combo through the finish has the WORST cumulative
  // score in the division: XCPlace is "1" (it leads the one finisher) but
  // three combos carry better dressage totals into the phase, so its real
  // provisional standing is 4th. The feed place is what running order used
  // to print — "58.0 (1st)" to a rider sitting last.
  const feed = F.feed([
    F.entry({ pinny: 821, rider: 'Alpha, Ann', horse: 'H821', division: 'Div P', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 0) })] }),
    F.entry({ pinny: 822, rider: F.FOLLOWED.zook, horse: 'Eddy', division: 'Div P', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 10) })] }),
    F.entry({ pinny: 823, rider: 'Beta, Bob', horse: 'H823', division: 'Div P', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 20) })] }),
    F.entry({ pinny: 824, rider: 'Cara, Kit', horse: 'H824', division: 'Div P', details: [
      F.ridingDetail({ phase: 'Cross Country', venue: 'XC', time: F.rideTimeStr(2026, 7, 18, 9, 30) })] }),
  ]);
  const scoring = F.scoring({
    divisions: [F.division({ id: 63, name: 'Div P' })],
    rows: [
      F.scoringRow({ pinny: 821, divisionId: 63, dressageScore: '38.0', dressagePlace: '4',
        xcScore: '58.0', xcPlace: '1', finalPoints: '58.0', finalPlace: '4' }),
      F.scoringRow({ pinny: 822, divisionId: 63, dressageScore: '30.0', dressagePlace: '1',
        finalPoints: '30.0', finalPlace: '1' }),
      F.scoringRow({ pinny: 823, divisionId: 63, dressageScore: '32.0', dressagePlace: '2',
        finalPoints: '32.0', finalPlace: '2' }),
      F.scoringRow({ pinny: 824, divisionId: 63, dressageScore: '34.0', dressagePlace: '3',
        finalPoints: '34.0', finalPlace: '3' }),
    ],
  });
  const s = await openPage({ server, feed, scoring, now: NOON_SAT });
  try {
    await s.page.click(ROW_SEL('822|Cross Country|2026-07-18'), { position: { x: 10, y: 10 } });
    await s.page.$eval('.row.pinned .round-link', el => el.click());

    let rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => [r.rider, r.res]), [
      ['Alpha, Ann', '58.0 (4th)'],      // NOT the feed's XCPlace "1"
      ['Zook, Penelope', '30.0 (1st)'],  // carried — where a clean ride leaves her
      ['Beta, Bob', '32.0 (2nd)'],
      ['Cara, Kit', '34.0 (3rd)'],
    ], 'running order ranks over the merged scores, everyone assumed clear');

    // The placing view reorders the rows but reports the same four places.
    await s.page.click('#round-sort [data-sort="place"]');
    rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => [r.rider, r.rank]), [
      ['Zook, Penelope', '1st'], ['Beta, Bob', '2nd'],
      ['Cara, Kit', '3rd'], ['Alpha, Ann', '4th']]);
    assert.deepEqual(rows.map(r => r.res), ['30.0', '32.0', '34.0', '58.0'],
      'placing view keeps the score alone — the rank column carries the place');

    // Once the round finishes, the merged rank IS the feed's phase place:
    // the posted cumulative scores are exactly what those places rank.
    await s.page.click('#round-sort [data-sort="order"]');
    await s.page.evaluate(() => {
      const sc = JSON.parse(localStorage.getItem('sc:1187:scoring')).value;
      for (const r of sc.ScoringList) {
        if (r.Pinny === 821) continue;
        r.XCScore = r.DressageScore; // clean rides: cumulative unchanged
        r.XCPlace = String({ 822: 1, 823: 2, 824: 3 }[r.Pinny]);
      }
      resultsIdx = buildResultsIndex(sc);
      render();
    });
    rows = await qrows(s.page);
    assert.deepEqual(rows.map(r => r.res),
      ['58.0 (4th)', '30.0 (1st)', '32.0 (2nd)', '34.0 (3rd)']);
    assert.equal(await s.page.$$eval('#round-list .qres .carried', els => els.length), 0,
      'nothing carried once every score is posted');
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
