'use strict';
// TESTPLAN S109–S112: the pasted "General Schedule" tab embedded in a
// schedule snapshot — per division and phase, the ring and the time block.
// It fills phases the order of go has no rider rows for yet (show jumping,
// published after XC) with the division's block start, which is exactly
// the shared-block-start shape ShowConnect publishes for SJ, so the page's
// SJ-block machinery (reverse-of-standing round order, slot estimates)
// applies unchanged. Fixtures are small synthetic pastes (invented names).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, rowInfo, chipLabels } = require('./helpers');
const { encryptSnapshot, decryptSnapshot } = require('../tools/snapshot-encrypt');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });
beforeEach(() => { server.clearFiles(); });

const KEY = 'GenSchedKey1';
const EVENT = `ee:${KEY}`;
const TOKEN = 'TESTTOKEN12345678';
const SCHED_FILE = `/snapshots/ee-${KEY}.json`;
const SCORES_FILE = `/snapshots/ee-${KEY}-scores.json`;
const START = '2026-10-28'; // Wednesday; the show runs Thu–Sun
// Pinned "now": Thu Oct 29 2026, 08:00 America/Los_Angeles (PDT = UTC-7).
const NOW = Date.UTC(2026, 9, 29, 15, 0, 0);

// Order of go: ON has D Thu / XC Sat and no SJ rows yet; BN has D only;
// CCI2-L has D Thu, individually timed SJ Fri, XC Sat.
const OOG = `
Pinney
GoTime
Rider
Horse
Division
Ring A
2026 USEA Novice Dressage Test B
Judge(s): Someone (C)
101
09:00 AM Thu
Ada Tester
Horse One
ON
102
09:06 AM Thu
Bea Sample
Horse Two
ON
2026 USEA Beginner Novice Dressage Test B
Judge(s): Someone (C)
201
12:00 PM Thu
Cal Fixture
Horse Three
BN
Ring B
2026 FEI Eventing CCI2 Test A
Judge(s): Alpha Judge (C), Beta Judge (E)
301
10:00 AM Thu
Dee Mock
Horse Four
CCI2-L
SJ - Main
Show Jumping FEI
Judge(s):
301
09:00 AM Fri
Dee Mock
Horse Four
CCI2-L
XC
Cross Country Novice
Judge(s):
101
10:00 AM Sat
Ada Tester
Horse One
ON
102
10:04 AM Sat
Bea Sample
Horse Two
ON
Cross Country FEI
Judge(s):
301
11:00 AM Sat
Dee Mock
Horse Four
CCI2-L
`;

// The General Schedule tab as copied: column header tokens, date lines,
// bare ring lines, "HH:MM-HH:MM / division / classification" blocks, and
// judge-name lines after dressage blocks (bare text, like rings).
const GENERAL = `
Date
Ring
Time
Division
Classification
Judge(s)
Thu, 10/29
Ring A
09:00-09:12
ON
Dressage
Someone
12:00-12:10
BN
Dressage
Someone
Ring B
10:00-10:30
CCI2-L
Dressage
Alpha Judge
Beta Judge
Fri, 10/30
SJ - Main
09:00-09:30
CCI2-L
Stadium
Sat, 10/31
XC
10:00-10:12
ON
Cross Country
11:00-11:10
CCI2-L
Cross Country
Sun, 11/01
SJ - Main
10:26-10:52
ON
Stadium
01:30-01:40
BN
Stadium
`;

const COLS_0 = ['#\tRider', 'Horse\t', 'Dress', 'Score', 'To Date', 'Place', 'XC', 'Jump', 'XC', 'Elapsed',
  'XC', 'Time', 'To Date', 'Score', 'To Date', 'Place', 'Stad', 'Jump', 'Time', 'Pen', 'Final', 'Score',
  'Final', 'Place'];
// ON dressage posted: Ada 1st, Bea 2nd → SJ runs Bea then Ada.
const BOARD = [
  'Open Novice (ON)Snapshot Test Event(Oct. 2026)', 'Judge: Someone', ...COLS_0,
  '101\t', 'Ada Tester (USA)', 'Horse One', '18.8', '1',
  '102\t', 'Bea Sample (USA)', 'Horse Two', '22.5', '2',
].join('\n');

async function publishSchedule({ schedule = GENERAL } = {}) {
  const r = await encryptSnapshot({
    key: KEY, token: TOKEN, name: 'Snapshot Test Event', start: START, state: 'California',
    text: OOG, captured: 'Thu Oct 29, 9:00 AM PDT', schedule,
  });
  server.setFile(SCHED_FILE, JSON.stringify(r.payload));
}
async function publishScores() {
  const r = await encryptSnapshot({ key: KEY, token: TOKEN, kind: 'scores', text: BOARD, captured: 'Thu Oct 29, 5:30 PM PDT' });
  server.setFile(SCORES_FILE, JSON.stringify(r.payload));
}
async function openSnap(opts = {}) {
  const { riders = ['Ada Tester', 'Cal Fixture', 'Dee Mock'], scores = false, ...rest } = opts;
  const url = `${server.url}?event=${EVENT}&k=${TOKEN}`;
  const s = await openPage({ server, eventId: EVENT, riders, now: NOW, url, ...rest });
  if (scores) await s.page.waitForFunction(() => Object.keys(resultsIdx).length > 0);
  return s;
}

// Blocks as plain strings: "division phase ring M/D HH:MM-HH:MM" (24 h).
const parseBlocks = (page, text, startDate, hints) =>
  page.evaluate(([t, sd, h]) => {
    const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const f = d => `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}`;
    return parseGeneralSchedule(t, sd, h).map(b =>
      `${b.division} ${b.phase} [${b.ring}] ${f(b.start)}-${hm(b.end)} ${b.start.getFullYear()}`);
  }, [text, startDate, hints]);

const HINTS = { judges: ['Someone', 'Alpha Judge', 'Beta Judge'], venues: ['Ring A', 'Ring B', 'XC', 'SJ - Main'] };

// ---- S109: parseGeneralSchedule grammar ----

test('S109: date lines, ring inheritance, judge lines skipped via hints, header tokens ignored, "Stadium" → Show Jumping', async () => {
  await publishSchedule();
  const s = await openSnap();
  try {
    const blocks = await parseBlocks(s.page, GENERAL, START, HINTS);
    assert.deepEqual(blocks, [
      'ON Dressage [Ring A] 10/29 09:00-09:12 2026',
      'BN Dressage [Ring A] 10/29 12:00-12:10 2026',
      'CCI2-L Dressage [Ring B] 10/29 10:00-10:30 2026',
      'CCI2-L Show Jumping [SJ - Main] 10/30 09:00-09:30 2026',
      'ON Cross Country [XC] 10/31 10:00-10:12 2026',
      'CCI2-L Cross Country [XC] 10/31 11:00-11:10 2026',
      'ON Show Jumping [SJ - Main] 11/1 10:26-10:52 2026',
      'BN Show Jumping [SJ - Main] 11/1 13:30-13:40 2026',
    ]);
    // Tab-separated rows (desktop copy) parse identically.
    const tabbed = GENERAL.trim().split('\n').map((l, i) => (i % 3 === 0 ? l : '\t' + l)).join('\n');
    assert.deepEqual(await parseBlocks(s.page, tabbed, START, HINTS), blocks);
    // Empty / garbage input → no blocks, no throw.
    assert.deepEqual(await parseBlocks(s.page, '', START, HINTS), []);
    assert.deepEqual(await parseBlocks(s.page, 'lorem\nipsum\n12:00\nON', START, HINTS), []);
    assert.deepEqual(await s.page.evaluate(() => parseGeneralSchedule(null, null, null)), []);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('S109: hour heuristic (1–6 PM, 7–11 AM, 12 noon, a range crossing noon), end<start clamped, year wrap from the start date', async () => {
  await publishSchedule();
  const s = await openSnap();
  try {
    const text = ['Thu, 10/29', 'Ring A', '11:20-02:04', 'A', 'Dressage', '12:05-12:35', 'B', 'Cross Country',
      '07:00-11:59', 'C', 'Dressage', '05:00-04:00', 'D', 'Stadium', '06:30-07:00', 'E', 'Stadium'].join('\n');
    assert.deepEqual(await parseBlocks(s.page, text, START, HINTS), [
      'A Dressage [Ring A] 10/29 11:20-14:04 2026',
      'B Cross Country [Ring A] 10/29 12:05-12:35 2026',
      'C Dressage [Ring A] 10/29 07:00-11:59 2026',
      'D Show Jumping [Ring A] 10/29 17:00-17:00 2026', // end before start → clamped
      'E Show Jumping [Ring A] 10/29 18:30-18:30 2026', // 06:30 reads PM, 07:00 AM → clamped
    ]);
    assert.deepEqual(await s.page.evaluate(() => [1, 6, 7, 11, 12].map(gsHour24)), [13, 18, 7, 11, 12]);
    // A show starting Dec 30 whose Sunday is Jan 2 lands in the next year.
    const wrap = ['Sat, 1/2', 'Ring A', '09:00-09:30', 'A', 'Dressage'].join('\n');
    assert.deepEqual(await parseBlocks(s.page, wrap, '2026-12-30', HINTS), ['A Dressage [Ring A] 1/2 09:00-09:30 2027']);
    // Blocks before any date line are dropped (no date to anchor to).
    assert.deepEqual(await parseBlocks(s.page, ['Ring A', '09:00-09:30', 'A', 'Dressage'].join('\n'), START, HINTS), []);
  } finally { await s.context.close(); }
});

test('S109: without judge hints a bare line is a ring only if it is a known venue or starts with SJ/XC; with judge hints every non-judge line is a ring', async () => {
  await publishSchedule();
  const s = await openSnap();
  try {
    const text = ['Thu, 10/29', 'Ring A', '09:00-09:12', 'ON', 'Dressage', 'Someone', '09:20-09:30', 'BN', 'Dressage',
      'XC', '10:00-10:12', 'ON', 'Cross Country', 'SJ - Far Ring', '11:00-11:10', 'BN', 'Stadium',
      'Mystery Ring', '12:00-12:10', 'CCI2-L', 'Stadium'].join('\n');
    // No hints at all: "Someone" is NOT a ring (unknown bare text), so BN
    // stays in Ring A… but Ring A itself is unknown too, so it stays "".
    assert.deepEqual(await parseBlocks(s.page, text, START, null), [
      'ON Dressage [] 10/29 09:00-09:12 2026',
      'BN Dressage [] 10/29 09:20-09:30 2026',
      'ON Cross Country [XC] 10/29 10:00-10:12 2026',
      'BN Show Jumping [SJ - Far Ring] 10/29 11:00-11:10 2026',
      'CCI2-L Show Jumping [SJ - Far Ring] 10/29 12:00-12:10 2026',
    ]);
    // Venue hints only: Ring A is known, "Someone" is ignored.
    assert.deepEqual((await parseBlocks(s.page, text, START, { venues: ['Ring A'] })).slice(0, 2), [
      'ON Dressage [Ring A] 10/29 09:00-09:12 2026',
      'BN Dressage [Ring A] 10/29 09:20-09:30 2026',
    ]);
    // Judge hints: every non-judge bare line is a ring, "Mystery Ring" included.
    const withJudges = await parseBlocks(s.page, text, START, { judges: ['Someone'] });
    assert.equal(withJudges[1], 'BN Dressage [Ring A] 10/29 09:20-09:30 2026');
    assert.equal(withJudges[4], 'CCI2-L Show Jumping [Mystery Ring] 10/29 12:00-12:10 2026');
  } finally { await s.context.close(); }
});

// ---- S110: parseOrderOfGo hints + applyGeneralSchedule ----

test('S110: parseOrderOfGo returns judge names (role tags stripped) and venues; applyGeneralSchedule fills only missing phases with Block/BlockEnd rows', async () => {
  await publishSchedule();
  const s = await openSnap();
  try {
    const r = await s.page.evaluate(([oog, gen, sd]) => {
      const f = parseOrderOfGo(oog, sd, { EventName: 'x' });
      const blocks = parseGeneralSchedule(gen, sd, { judges: f.judges, venues: f.venues });
      const before = JSON.stringify(f.EntryList);
      const added = applyGeneralSchedule(f, blocks);
      const by = p => f.EntryList.find(e => e.PinnyNumber === p);
      const rows = e => e.RidingDetails.map(rd => `${rd.Phase}|${rd.Venues[0].venue}|${rd.RideTimes}|${rd.BlockEnd || ''}|${rd.Block ? 'B' : ''}`);
      return {
        judges: f.judges, venues: f.venues, added,
        on: rows(by(101)), bn: rows(by(201)), cci: rows(by(301)),
        roundTrip: f.EntryList.every(e => e.RidingDetails.every(rd => parseRideTime(rd.RideTimes) !== null
          && (!rd.BlockEnd || parseRideTime(rd.BlockEnd) !== null))),
        // A second application adds nothing (phases now present).
        again: applyGeneralSchedule(f, blocks),
        // No blocks / no feed are no-ops.
        none: applyGeneralSchedule(f, []) + applyGeneralSchedule(null, blocks) + applyGeneralSchedule({}, null),
        unchangedPrefix: before.length > 0,
      };
    }, [OOG, GENERAL, START]);
    assert.deepEqual(r.judges, ['Someone', 'Alpha Judge', 'Beta Judge']);
    assert.deepEqual(r.venues, ['Ring A', 'Ring B', 'SJ - Main', 'XC']);
    assert.equal(r.added, 3); // ON×2 SJ, BN×1 SJ (BN has no XC block; CCI2-L already has SJ)
    assert.deepEqual(r.on, [
      'Dressage|Ring A|Thu, Oct 29, 2026, 9:00:00 AM||',
      'Cross Country|XC|Sat, Oct 31, 2026, 10:00:00 AM||',
      'Show Jumping|SJ - Main|Sun, Nov 1, 2026, 10:26:00 AM|Sun, Nov 1, 2026, 10:52:00 AM|B',
    ]);
    assert.deepEqual(r.bn, [
      'Dressage|Ring A|Thu, Oct 29, 2026, 12:00:00 PM||',
      'Show Jumping|SJ - Main|Sun, Nov 1, 2026, 1:30:00 PM|Sun, Nov 1, 2026, 1:40:00 PM|B',
    ]);
    // CCI2-L's individually timed SJ row is untouched (no Block, no BlockEnd).
    assert.deepEqual(r.cci, [
      'Dressage|Ring B|Thu, Oct 29, 2026, 10:00:00 AM||',
      'Show Jumping|SJ - Main|Fri, Oct 30, 2026, 9:00:00 AM||',
      'Cross Country|XC|Sat, Oct 31, 2026, 11:00:00 AM||',
    ]);
    assert.equal(r.roundTrip, true);
    assert.equal(r.again, 0);
    assert.equal(r.none, 0);
  } finally { await s.context.close(); }
});

// ---- S111: end to end ----

test('S111: block rows render on their day with the window in the popover; the division becomes an SJ block, an individually timed one does not', async () => {
  await publishSchedule();
  const s = await openSnap();
  try {
    assert.deepEqual(await chipLabels(s.page), ['Today*', 'Fri, Oct 30', 'Sat, Oct 31', 'Sun, Nov 1']);
    const r = await s.page.evaluate(() => {
      selectedDay = '2026-11-01'; render();
      return {
        sjBlock: [...sjBlockDivs].sort(),
        rows: [...document.querySelectorAll('#list .row')].map(e => e.querySelector('.time').textContent.trim() + ' ' + e.querySelector('.rider').textContent),
        sjRides: rides.filter(r => r.phase === 'Show Jumping').map(r => `${r.dayKey} #${r.pinny} ${r.venue} ${r.blockEnd ? 'block' : 'individual'}`).sort(),
      };
    });
    // ON: two entries sharing one SJ time → block. BN has a single entry,
    // and the block rule needs >1 identical times (verify-don't-assume), so
    // it is not flagged; CCI2-L has individual times.
    assert.deepEqual(r.sjBlock, ['ON']);
    assert.deepEqual(r.rows, ['10:26 AM Ada Tester', '1:30 PM Cal Fixture']);
    assert.deepEqual(r.sjRides, [
      '2026-10-30 #301 SJ - Main individual',
      '2026-11-01 #101 SJ - Main block',
      '2026-11-01 #201 SJ - Main block',
    ]);
    const ada = await rowInfo(s.page, 101);
    assert.match(ada.pop, /Show Jumping10:26 AM–10:52 AM \(division block\) · SJ - Main/);
    assert.match(ada.pop, /Results Not posted yet/); // no scores file in this test
    const cal = await rowInfo(s.page, 201);
    assert.match(cal.pop, /Show Jumping1:30 PM–1:40 PM \(division block\) · SJ - Main/);
    // Dee's individually timed SJ row shows a plain time.
    await s.page.evaluate(() => { selectedDay = '2026-10-30'; render(); });
    const dee = await rowInfo(s.page, 301);
    assert.match(dee.pop, /Show Jumping9:00 AM · SJ - Main/);
    assert.doesNotMatch(dee.pop, /division block/);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('S111: with placings from a scores file the SJ round sheet runs in reverse of standing with ~slot estimates, and the timeline row carries the estimate', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap({ scores: true });
  try {
    await s.page.evaluate(() => { selectedDay = '2026-11-01'; render(); openRoundSheet('ON', 'Show Jumping'); });
    const round = await s.page.evaluate(() => ({
      sub: document.getElementById('round-sub').innerText.replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('#round-list .qrow')].map(e => e.innerText.replace(/\s+/g, ' ').trim()),
    }));
    assert.equal(round.sub, 'SJ · 0 of 2 scores posted');
    assert.deepEqual(round.rows, [
      '~10:26 AM Bea Sample Horse Two · #102 22.5',
      '~10:28 AM Ada Tester Horse One · #101 18.8',
    ]);
    const ada = await rowInfo(s.page, 101);
    assert.equal(ada.est, 'est. slot ~10:28 AM · 2nd of 2 to jump, by standing');
    assert.match(ada.pop, /Est\. slot~10:28 AM \(2nd of 2 to jump, by standing\)/);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('S111: a schedule snapshot without a General Schedule leaves the feed as the order of go alone (no SJ rows, no Sunday chip)', async () => {
  await publishSchedule({ schedule: '' });
  const s = await openSnap();
  try {
    assert.deepEqual(await chipLabels(s.page), ['Today*', 'Fri, Oct 30', 'Sat, Oct 31']);
    assert.deepEqual(await s.page.evaluate(() => [...sjBlockDivs]), []);
    assert.equal(await s.page.evaluate(() => rides.filter(r => r.phase === 'Show Jumping').length), 1);
  } finally { await s.context.close(); }
});

// ---- S112: tool ----

test('S112: encryptSnapshot carries the General Schedule text as `schedule` (default "") and it round-trips', async () => {
  const withIt = await encryptSnapshot({ key: KEY, token: TOKEN, name: 'x', start: START, text: OOG, schedule: GENERAL });
  const plain = await decryptSnapshot(withIt.payload, TOKEN);
  assert.equal(plain.schedule, GENERAL);
  assert.equal(plain.text, OOG);
  const without = await encryptSnapshot({ key: KEY, token: TOKEN, name: 'x', start: START, text: OOG });
  assert.equal((await decryptSnapshot(without.payload, TOKEN)).schedule, '');
  // A scores snapshot never carries one.
  const scores = await encryptSnapshot({ key: KEY, token: TOKEN, kind: 'scores', text: BOARD, schedule: GENERAL });
  assert.equal((await decryptSnapshot(scores.payload, TOKEN)).schedule, undefined);
});
