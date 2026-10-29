'use strict';
// TESTPLAN S102–S108 and S113–S115: the optional scores snapshot for snapshot events — a
// pasted evententries "Live Scores" board, encrypted under the same link
// token into snapshots/ee-<key>-scores.json, parsed into the scoringLive
// shape and joined through buildResultsIndex. Fixtures are small synthetic
// boards (invented names) built with the CLI's own encryptSnapshot() and
// served per test by the local server; the committed files are never read.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, rowInfo } = require('./helpers');
const { encryptSnapshot, decryptSnapshot } = require('../tools/snapshot-encrypt');
const fetchTool = require('../tools/snapshot-fetch');
const fs = require('fs');
const os = require('os');
const path = require('path');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });
beforeEach(() => { server.clearFiles(); });

const KEY = 'ScoresKey01';
const EVENT = `ee:${KEY}`;
const TOKEN = 'TESTTOKEN12345678';
const SCHED_FILE = `/snapshots/ee-${KEY}.json`;
const SCORES_FILE = `/snapshots/ee-${KEY}-scores.json`;
const START = '2026-10-28'; // Wednesday; the show runs Thu–Sun
// Pinned "now": Thu Oct 29 2026, 08:00 America/Los_Angeles (PDT = UTC-7).
const NOW = Date.UTC(2026, 9, 29, 15, 0, 0);

// Order of go: ON has D Thu / XC Sat and no SJ yet (SJ posts after XC);
// BN has D only; CCI2-L has D Thu, SJ Fri, XC Sat (a d-sj-xc division).
// 103's horse is named "PJ" — a code-shaped horse name.
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
103
09:12 AM Thu
Eve Code
PJ
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
Judge(s): A (C), B (E)
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
103
10:08 AM Sat
Eve Code
PJ
ON
Cross Country FEI
Judge(s):
301
11:00 AM Sat
Dee Mock
Horse Four
CCI2-L
`;

const COLS_0 = ['#\tRider', 'Horse\t', 'Dress', 'Score', 'To Date', 'Place', 'XC', 'Jump', 'XC', 'Elapsed',
  'XC', 'Time', 'To Date', 'Score', 'To Date', 'Place', 'Stad', 'Jump', 'Time', 'Pen', 'Final', 'Score',
  'Final', 'Place'];
const COLS_2 = ['#\tRider', 'Horse\t', 'Jdg @ C', 'Jdg @ E', ...COLS_0.slice(2)];

// The board as the Live Scores page copies: page chrome first, then per
// division a header (name + "(code)" + event name run together — the BN
// one has two paren groups), a judge line, the column tokens one per
// line, and rows of pinny (trailing tab) / rider / horse / posted cells.
// After Bea's row: a place cell "2" followed by ad copy whose first line
// could pass for a rider; after Eve's row a place "3" immediately before
// the next header. CCI2-L ends with a pinny-less Test Ride.
const BOARD = [
  'EventEntries.com', 'Home', 'Live Scores', 'Results are not final and subject to change.',
  'Open Novice (ON)Snapshot Test Event(Oct. 2026)', 'Judge: Someone', ...COLS_0,
  '101\t', 'Ada Tester (USA)', 'Horse One', '18.8', '1',
  '102\t', 'Bea Sample (USA)', 'Horse Two', '22.5', '2',
  'Discover more', 'Equestrian apparel store',
  '103\t', 'Eve Code', 'PJ', '30.0', '3',
  'Beginner Novice (BN CHAMPS) (BN)Snapshot Test Event(Oct. 2026)', 'Judge: Someone', ...COLS_0,
  '201\t', 'Cal Fixture (USA)', 'Horse Three',
  'CCI Two Star - L (CCI2-L)Snapshot Test Event(Oct. 2026)', 'Jdg @ C: A, Jdg @ E: B', ...COLS_2,
  '301\t', 'Dee Mock (USA)', 'Horse Four', '70.00', '68.13', '31.4', '1',
  'Test Ride', 'Test Horse 2 Star',
].join('\n');

async function publishSchedule({ scoresUrl = 'https://example.com/all', links = { ON: 'https://example.com/on', 'CCI2-L': 'javascript:alert(1)' } } = {}) {
  const r = await encryptSnapshot({
    key: KEY, token: TOKEN, name: 'Snapshot Test Event', start: START, state: 'California',
    text: OOG, captured: 'Thu Oct 29, 9:00 AM PDT', scoresUrl, links,
  });
  server.setFile(SCHED_FILE, JSON.stringify(r.payload));
}
async function publishScores({ text = BOARD, token = TOKEN } = {}) {
  const r = await encryptSnapshot({ key: KEY, token, kind: 'scores', text, captured: 'Thu Oct 29, 5:30 PM PDT' });
  server.setFile(SCORES_FILE, JSON.stringify(r.payload));
}

async function openSnap(opts = {}) {
  const { riders = ['Ada Tester', 'Cal Fixture', 'Dee Mock'], scores = true, ...rest } = opts;
  const url = `${server.url}?event=${EVENT}&k=${TOKEN}`;
  const s = await openPage({ server, eventId: EVENT, riders, now: NOW, url, ...rest });
  if (scores) await s.page.waitForFunction(() => Object.keys(resultsIdx).length > 0);
  return s;
}

const parseBoard = (page, text, withFeed = true) =>
  page.evaluate(([t, f]) => {
    const sb = parseScoreboard(t, f ? lastFeed : null);
    return {
      stats: sb.stats,
      divisions: sb.DivisionsList,
      rows: sb.ScoringList.map(s => ({
        pinny: s.Pinny, div: s.DivisionId, rider: s.RiderName, horse: s.HorseName,
        d: [s.DressageScore, s.DressagePlace], xc: [s.XCScore, s.XCPlace], sj: [s.SJScore, s.SJPlace],
        fin: [s.FinalPoints, s.FinalPlace],
      })),
    };
  }, [text, withFeed]);

// ---- S102: parseScoreboard grammar ----

test('S102: division headers (incl. two paren groups) are found by their judge line; column tokens are not headers; rows are recognized via the feed', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const r = await parseBoard(s.page, BOARD);
    assert.deepEqual(r.divisions.map(d => [d.DivisionId, d.DivisionName, d.PhaseOrder]),
      [['ON', 'ON', 'd-xc-sj'], ['BN', 'BN', 'd-xc-sj'], ['CCI2-L', 'CCI2-L', 'd-sj-xc']]);
    assert.deepEqual(r.rows.map(x => [x.pinny, x.div, x.rider, x.horse]), [
      [101, 'ON', 'Ada Tester (USA)', 'Horse One'],
      [102, 'ON', 'Bea Sample (USA)', 'Horse Two'],
      [103, 'ON', 'Eve Code', 'PJ'],               // code-shaped horse name, admitted by the feed
      [201, 'BN', 'Cal Fixture (USA)', 'Horse Three'],
      [301, 'CCI2-L', 'Dee Mock (USA)', 'Horse Four'],
    ]);
    // The place cell before the BN header stayed a cell; the ad copy after
    // Bea's place and the Test Ride lines were skipped and sampled.
    assert.equal(r.rows[2].d[1], '3');
    assert.equal(r.rows[1].d[1], '2');
    assert.equal(r.stats.rows, 5);
    assert.equal(r.stats.divisions, 3);
    assert.deepEqual(r.stats.skippedSamples, ['Discover more', 'Equestrian apparel store', 'Test Ride', 'Test Horse 2 Star']);
    assert.equal(r.stats.skipped, 4);
    // No bogus division from "Jdg @ C" (followed by "Jdg @ E") or "Horse".
    assert.ok(!r.divisions.some(d => /Jdg|Horse/.test(d.DivisionId)));
  } finally { await s.context.close(); }
});

test('S102: without a feed the shape heuristic decides — a code-shaped horse is missed and ad copy after a number can pass; the feed rejects an integer that is not a pinny in that division', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const noFeed = await parseBoard(s.page, BOARD, false);
    assert.deepEqual(noFeed.rows.map(x => x.pinny), [101, 102, 2, 201, 301],
      'no feed: "PJ" row lost (horse looks like a code); place "2" + ad copy read as a row');
    // With the feed, an integer+text that is a pinny in ANOTHER division is
    // rejected too: pinny 201 (BN) placed inside the ON board.
    const crossed = BOARD.replace('102\t\nBea Sample (USA)', '201\t\nBea Sample (USA)');
    const r = await parseBoard(s.page, crossed);
    assert.deepEqual(r.rows.filter(x => x.div === 'ON').map(x => x.pinny), [101, 103]);
    assert.ok(r.stats.skippedSamples.includes('Bea Sample (USA)'));
  } finally { await s.context.close(); }
});

test('S102: tab-separated rows parse identically to one cell per line; empty or garbage text yields empty lists without throwing', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const tabbed = [
      'Open Novice (ON)Snapshot Test Event(Oct. 2026)', 'Judge: Someone', COLS_0.join('\t'),
      '101\tAda Tester (USA)\tHorse One\t18.8\t1',
      '102\tBea Sample (USA)\tHorse Two\t22.5\t2',
    ].join('\n');
    const perLine = tabbed.split('\t').join('\n');
    const a = await parseBoard(s.page, tabbed);
    const b = await parseBoard(s.page, perLine);
    assert.deepEqual(a.rows, b.rows);
    assert.equal(a.rows.length, 2);
    assert.deepEqual(a.rows[0].d, ['18.8', '1']);

    const empties = await s.page.evaluate(() => [
      parseScoreboard('', lastFeed), parseScoreboard(null, null),
      parseScoreboard('Home\n42\nsome words\nmore words', lastFeed),
      parseScoreboard('Open Novice (ON)X\nJudge: Y', lastFeed),
    ].map(sb => [sb.DivisionsList.length, sb.ScoringList.length]));
    assert.deepEqual(empties, [[0, 0], [0, 0], [0, 0], [1, 0]]);
  } finally { await s.context.close(); }
});

// ---- S103: scoreboardCells ----

test('S103: judge-count-aware dressage mapping, XC block via the Elapsed anchor, SJ block, fall-through, and out codes', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const r = await s.page.evaluate(() => {
      const pick = o => [o.DressageScore, o.DressagePlace, o.XCScore, o.XCPlace, o.SJScore, o.SJPlace, o.FinalPoints, o.FinalPlace];
      return {
        j3: pick(scoreboardCells(['70.00', '68.13', '67.71', '31.4', '1'], 3)),
        j1: pick(scoreboardCells(['65.0', '35.0', '2'], 1)),
        j0: pick(scoreboardCells(['18.3', '1'], 0)),
        none: pick(scoreboardCells([], 0)),
        dOnly3: pick(scoreboardCells(['70.00', '68.13', '67.71'], 3)), // marks posted, total not yet
        xcJump: pick(scoreboardCells(['31.4', '1', '0', '6:12', '4.8', '36.2', '2'], 0)),
        xcNoJump: pick(scoreboardCells(['31.4', '1', '6:12', '4.8', '36.2', '2'], 0)),
        xcPositional: pick(scoreboardCells(['31.4', '1', '0', '0', '0', '31.4', '1'], 0)),
        xcJudges: pick(scoreboardCells(['70.00', '68.13', '31.4', '1', '0', '6:12', '0', '31.4', '1'], 2)),
        sj: pick(scoreboardCells(['31.4', '1', '0', '6:12', '4.8', '36.2', '2', '4', '0', '40.2', '3'], 0)),
        sjShort: pick(scoreboardCells(['31.4', '1', '0', '6:12', '4.8', '36.2', '2', '36.2', '1'], 0)),
        eDressage: pick(scoreboardCells(['E'], 0)),
        eXC: pick(scoreboardCells(['31.4', '1', 'E'], 0)),
        rfXC: pick(scoreboardCells(['31.4', '1', '20', 'RF'], 0)),
        eSJ: pick(scoreboardCells(['31.4', '1', '0', '6:12', '0', '31.4', '1', 'RF'], 0)),
      };
    });
    assert.deepEqual(r.j3, ['31.4', '1', '--', '--', '--', '--', '31.4', '1']);
    assert.deepEqual(r.j1, ['35.0', '2', '--', '--', '--', '--', '35.0', '2']);
    assert.deepEqual(r.j0, ['18.3', '1', '--', '--', '--', '--', '18.3', '1']);
    assert.deepEqual(r.none, ['--', '--', '--', '--', '--', '--', '--', '--']);
    assert.deepEqual(r.dOnly3, ['--', '--', '--', '--', '--', '--', '--', '--']);
    assert.deepEqual(r.xcJump, ['31.4', '1', '36.2', '2', '--', '--', '36.2', '2']);
    assert.deepEqual(r.xcNoJump, ['31.4', '1', '36.2', '2', '--', '--', '36.2', '2']);
    assert.deepEqual(r.xcPositional, ['31.4', '1', '31.4', '1', '--', '--', '31.4', '1']);
    assert.deepEqual(r.xcJudges, ['31.4', '1', '31.4', '1', '--', '--', '31.4', '1']);
    assert.deepEqual(r.sj, ['31.4', '1', '36.2', '2', '40.2', '3', '40.2', '3']);
    assert.deepEqual(r.sjShort, ['31.4', '1', '36.2', '2', '36.2', '1', '36.2', '1']);
    assert.deepEqual(r.eDressage, ['--', 'E', '--', '--', '--', '--', '--', 'E']);
    assert.deepEqual(r.eXC, ['31.4', '1', '--', 'E', '--', '--', '31.4', 'E']);
    assert.deepEqual(r.rfXC, ['31.4', '1', '--', 'RF', '--', '--', '31.4', 'RF']);
    assert.deepEqual(r.eSJ, ['31.4', '1', '31.4', '1', '--', 'RF', '31.4', 'RF']);
  } finally { await s.context.close(); }
});

// ---- S104: phaseOrderFromFeed ----

test('S104: phase order per division from the feed — unscheduled phases appended in the usual order, a d-sj-xc feed preserved, unknown divisions default', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const r = await s.page.evaluate(() => {
      const rd = (phase, t) => ({ Phase: phase, Venues: [{ venue: 'R' }], RideTimes: t });
      const feed = { EntryList: [
        { PinnyNumber: 1, Division: 'A', RidingDetails: [rd('Dressage', 'Thu, Oct 29, 2026, 9:00:00 AM'), rd('Cross Country', 'Sat, Oct 31, 2026, 9:00:00 AM')] },
        { PinnyNumber: 2, Division: 'B', RidingDetails: [rd('Cross Country', 'Sat, Oct 31, 2026, 9:00:00 AM'), rd('Show Jumping', 'Fri, Oct 30, 2026, 9:00:00 AM'), rd('Dressage', 'Thu, Oct 29, 2026, 9:00:00 AM')] },
        { PinnyNumber: 3, Division: 'C', RidingDetails: [rd('Show Jumping', 'Fri, Oct 30, 2026, 9:00:00 AM')] },
        { PinnyNumber: 4, Division: 'D', RidingDetails: [rd('Dressage', '')] }, // unscheduled → no entry
        null,
      ] };
      const o = phaseOrderFromFeed(feed);
      // A board for a division the feed doesn't know: with the feed the
      // header is not a header at all (code unknown → ignored); with no
      // feed it is, and its phase order defaults.
      const withFeed = parseScoreboard('Div E (E)X\nJudge: Y\n#\n4\nA B\nH', feed);
      const noFeed = parseScoreboard('Div E (E)X\nJudge: Y\n#\n4\nA B\nH', null);
      return { o, withFeed: withFeed.DivisionsList.map(d => d.PhaseOrder), noFeed: noFeed.DivisionsList.map(d => d.PhaseOrder), empty: phaseOrderFromFeed(null) };
    });
    assert.deepEqual(r.o, { A: 'd-xc-sj', B: 'd-sj-xc', C: 'sj-d-xc' });
    assert.deepEqual(r.withFeed, []);
    assert.deepEqual(r.noFeed, ['d-xc-sj']);
    assert.deepEqual(r.empty, {});
    // And the live page's own divMeta came from the real snapshot feed.
    assert.deepEqual(await s.page.evaluate(() => [divMeta.ON.phaseOrder, divMeta['CCI2-L'].phaseOrder]), ['d-xc-sj', 'd-sj-xc']);
  } finally { await s.context.close(); }
});

// ---- S105: happy path end to end ----

test('S105: schedule + scores served — popover results, round-sheet places and progress, footer provenance, live-scores link precedence', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const row = await rowInfo(s.page, 101);
    assert.match(row.pop, /Dressage18\.8 \(1st\)/);
    assert.match(row.pop, /Cross Country—/);
    assert.match(row.pop, /Overall18\.8 \(1st\)/);
    const footer = await s.page.$eval('footer', el => el.textContent);
    assert.match(footer, /order of go captured Thu Oct 29, 9:00 AM PDT; results captured Thu Oct 29, 5:30 PM PDT — nothing here is live/);
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent), '');

    // Round sheet: ON dressage, all three scored, places shown.
    await s.page.evaluate(() => openRoundSheet('ON', 'Dressage'));
    const round = await s.page.evaluate(() => ({
      sub: document.getElementById('round-sub').innerText.replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('#round-list .qrow')].map(e => e.innerText.replace(/\s+/g, ' ').trim()),
      link: (document.querySelector('#round-sub a.live-link') || {}).href || null,
    }));
    assert.equal(round.sub, 'Dressage · all 3 scores posted live scores ↗');
    assert.deepEqual(round.rows, [
      '9:00 AM Ada Tester Horse One · #101 18.8 (1st)',
      '9:06 AM Bea Sample Horse Two · #102 22.5 (2nd)',
      '9:12 AM Eve Code PJ · #103 30.0 (3rd)',
    ]);
    assert.equal(round.link, 'https://example.com/on', 'per-division link wins');

    // BN (Cal Fixture): no scores yet, show-wide link.
    await s.page.evaluate(() => { closeRoundSheet(); openRoundSheet('BN', 'Dressage'); });
    const bn = await s.page.evaluate(() => ({
      sub: document.getElementById('round-sub').innerText.replace(/\s+/g, ' ').trim(),
      link: (document.querySelector('#round-sub a.live-link') || {}).href || null,
    }));
    assert.equal(bn.sub, 'Dressage · 0 of 1 scores posted live scores ↗');
    assert.equal(bn.link, 'https://example.com/all', 'falls back to scoresUrl');
    // CCI2-L: its per-division value is not http(s) → no link at all.
    await s.page.evaluate(() => { closeRoundSheet(); openRoundSheet('CCI2-L', 'Dressage'); });
    assert.equal(await s.page.evaluate(() => document.querySelector('#round-sub a.live-link')), null);
    assert.deepEqual(await s.page.evaluate(() => [liveScoresUrl('ON'), liveScoresUrl('BN'), liveScoresUrl('CCI2-L')]),
      ['https://example.com/on', 'https://example.com/all', '']);
    // Popover links follow the same rule (Cal's BN row → show-wide).
    const cal = await rowInfo(s.page, 201);
    assert.match(cal.pop, /live scores ↗/);
    assert.equal(await s.page.$eval('[data-key*="201|"] a.live-link', a => a.getAttribute('href')), 'https://example.com/all');
    assert.equal(await s.page.$eval('[data-key*="201|"] a.live-link', a => a.getAttribute('rel')), 'noopener');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('S105: with no links at all (schedule published without scoresUrl) nothing renders a live-scores link', async () => {
  await publishSchedule({ scoresUrl: '', links: null }); await publishScores();
  const s = await openSnap();
  try {
    const row = await rowInfo(s.page, 101);
    assert.ok(!/live scores/.test(row.pop));
    await s.page.evaluate(() => openRoundSheet('ON', 'Dressage'));
    assert.equal(await s.page.evaluate(() => document.querySelector('#round-sub a.live-link')), null);
    assert.equal(await s.page.evaluate(() => liveScoresUrl('ON')), '');
  } finally { await s.context.close(); }
});

// ---- S106: cache ----

test('S106: the parsed board is cached at sc:ee:<key>:scoring with its capture marker and hydrates a reload that cannot reach the files', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const cached = await s.page.evaluate(() => JSON.parse(localStorage.getItem(`sc:${eventId}:scoring`)));
    assert.equal(cached.value.ScoringList.length, 5);
    assert.deepEqual(cached.value.snapshot, { capturedAt: 'Thu Oct 29, 5:30 PM PDT' });

    await s.context.route('**/snapshots/**', route => route.abort('failed'));
    await s.page.reload();
    await s.page.waitForFunction(() => document.getElementById('fetch-err').textContent !== '');
    const r = await s.page.evaluate(() => ({
      footer: document.querySelector('footer').textContent,
      results: Object.keys(resultsIdx).length,
      meta: scoresMeta,
    }));
    assert.match(r.footer, /results captured Thu Oct 29, 5:30 PM PDT/);
    assert.equal(r.results, 5);
    assert.deepEqual(r.meta, { capturedAt: 'Thu Oct 29, 5:30 PM PDT' });
    assert.match((await rowInfo(s.page, 101)).pop, /Dressage18\.8 \(1st\)/);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

// ---- S107: scores file absent or unreadable ----

test('S107: a missing scores file leaves results "Not posted yet" and the footer "not loaded"; a scores file under another token is ignored silently', async () => {
  await publishSchedule();
  const s = await openSnap({ scores: false });
  try {
    await s.page.waitForLoadState('networkidle');
    const r = await s.page.evaluate(() => ({
      results: Object.keys(resultsIdx).length, footer: document.querySelector('footer').textContent,
      err: document.getElementById('fetch-err').textContent, meta: scoresMeta,
      cached: localStorage.getItem(`sc:${eventId}:scoring`),
    }));
    assert.equal(r.results, 0);
    assert.match(r.footer, /results not loaded — nothing here is live/);
    assert.equal(r.err, '');
    assert.equal(r.meta, null);
    assert.equal(r.cached, null);
    assert.match((await rowInfo(s.page, 101)).pop, /Not posted yet/);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }

  await publishScores({ token: 'OTHERTOKEN000000' });
  const w = await openSnap({ scores: false });
  try {
    await w.page.waitForLoadState('networkidle');
    const r = await w.page.evaluate(() => ({
      results: Object.keys(resultsIdx).length, footer: document.querySelector('footer').textContent,
      err: document.getElementById('fetch-err').textContent,
    }));
    assert.equal(r.results, 0);
    assert.match(r.footer, /results not loaded/);
    assert.equal(r.err, '');
    assert.equal(w.page.__pageError, undefined);
  } finally { await w.context.close(); }
});

// ---- S108: the tool ----

test('S108: encryptSnapshot kind "scores" requires a token and round-trips; --links JSON lands in the schedule plaintext', async () => {
  await assert.rejects(encryptSnapshot({ key: KEY, kind: 'scores', text: 'x' }), /needs the schedule's --token/);
  const sc = await encryptSnapshot({ key: KEY, token: TOKEN, kind: 'scores', text: BOARD, captured: 'now-ish' });
  assert.equal(sc.token, TOKEN);
  const back = await decryptSnapshot(sc.payload, TOKEN);
  assert.deepEqual(back, { kind: 'scores', capturedAt: 'now-ish', text: BOARD });
  await assert.rejects(decryptSnapshot(sc.payload, 'WRONGTOKEN0000'));

  const sched = await encryptSnapshot({
    key: KEY, token: TOKEN, name: 'N', start: START, state: 'California', text: OOG, captured: 'c',
    scoresUrl: 'https://example.com/all', links: { ON: 'https://example.com/on' },
  });
  const plain = await decryptSnapshot(sched.payload, TOKEN);
  assert.equal(plain.kind, 'schedule');
  assert.equal(plain.scoresUrl, 'https://example.com/all');
  assert.deepEqual(plain.links, { ON: 'https://example.com/on' });
  // No links given → an empty object, never null.
  const bare = await decryptSnapshot((await encryptSnapshot({ key: KEY, token: TOKEN, start: START, text: '' })).payload, TOKEN);
  assert.deepEqual(bare.links, {});
  assert.equal(bare.scoresUrl, '');
});

// ---- S113: the browser-rendered (innerText) board form ----
// A headless browser's innerText puts the event name on its own line
// under the division line, pads cells with tab-only lines, and renders a
// tied place as "4-T". The line before a header (the "Results are not
// final" banner, a zero-score row's horse) and the event-name line must
// never be read as the header.

const EVENT_NAME = 'Snapshot Test Event(Oct. 2026)';
// Same board as BOARD, in the innerText shape: division line, event-name
// line, blank/tab-only padding between cells; Bea tied 2nd ("2-T"),
// Cal's row has no cells and sits right before the next header.
const SPLIT_BOARD = [
  'EventEntries.com', 'Home', 'Live Scores', 'ShowsResults are not final and subject to change.', '', '',
  'Open Novice (ON)', EVENT_NAME, '', '\t', 'Judge: Someone', '', ...COLS_0.flatMap(c => [c, '\t']),
  '101\t', 'Ada Tester (USA)', 'Horse One', '\t', '18.8', '\t', '1', '\t',
  '102\t', 'Bea Sample (USA)', 'Horse Two', '22.5', '2-T', '\t',
  '103\t', 'Eve Code', 'PJ', '\t', '22.5', '2-T',
  'Beginner Novice (BN CHAMPS) (BN)', EVENT_NAME, 'Judge: Someone', ...COLS_0,
  '201\t', 'Cal Fixture (USA)', 'Horse Three', '\t',
  'CCI Two Star - L (CCI2-L)', EVENT_NAME, 'Jdg @ C: A, Jdg @ E: B', ...COLS_2,
  '301\t', 'Dee Mock (USA)', 'Horse Four', '70.00', '68.13', '31.4', '1',
  'Test Ride', 'Test Horse 2 Star', '\t', '73.86',
].join('\n');

test('S113: the innerText board form (split header, tab-only lines, tied places) parses to the same rows as the glued form; banner, horse-before-header and event-name lines are never headers', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const glued = await parseBoard(s.page, BOARD);
    const split = await parseBoard(s.page, SPLIT_BOARD);
    assert.deepEqual(split.divisions, glued.divisions);
    assert.deepEqual(split.rows.map(x => [x.pinny, x.div, x.rider, x.horse]),
      glued.rows.map(x => [x.pinny, x.div, x.rider, x.horse]));
    assert.equal(split.stats.rows, 5);
    assert.equal(split.stats.divisions, 3);
    // No division named after the banner, the event name, or Cal's horse.
    assert.ok(!split.divisions.some(d => /Results|Snapshot Test|Horse Three|Oct\. 2026/.test(d.DivisionId)),
      JSON.stringify(split.divisions));
    // Tied places normalized: "2-T" → "2" for both Bea and Eve, and the
    // page's tie detection (equal places) picks that up downstream.
    assert.deepEqual(split.rows[1].d, ['22.5', '2']);
    assert.deepEqual(split.rows[2].d, ['22.5', '2']);
    assert.deepEqual(split.rows[1].fin, ['22.5', '2']);
    // Only the Test Ride lines and the test horse's own orphan score cell are skipped.
    assert.deepEqual(split.stats.skippedSamples, ['Test Ride', 'Test Horse 2 Star', '73.86']);

    // Without a feed the same holds: the header needs a code-shaped paren
    // group, which the banner ("no parens"), the event-name line ("Oct. 2026"
    // has a space) and a horse line lack.
    const noFeed = await parseBoard(s.page, SPLIT_BOARD, false);
    assert.deepEqual(noFeed.divisions.map(d => d.DivisionId), ['ON', 'BN', 'CCI2-L']);
    assert.ok(noFeed.rows.some(x => x.pinny === 201 && x.div === 'BN'));
  } finally { await s.context.close(); }
});

test('S113: a tied place followed by more cells keeps its XC block; "4T" is accepted too; a tie in the final pair reads as a plain place', async () => {
  await publishSchedule(); await publishScores();
  const s = await openSnap();
  try {
    const r = await s.page.evaluate(() => [
      scoreboardCells(['18.8', '4-T', '0', '6:12', '0.4', '19.2', '3-T'], 0),
      scoreboardCells(['18.8', '4T'], 0),
      scoreboardCells(['70.00', '68.13', '31.4', '2-T', '0', '6:12', '0', '31.4', '1', '0', '0', '31.4', '1-T'], 2),
    ]);
    assert.deepEqual([r[0].DressageScore, r[0].DressagePlace, r[0].XCScore, r[0].XCPlace, r[0].FinalPlace],
      ['18.8', '4', '19.2', '3', '3']);
    assert.deepEqual([r[1].DressagePlace, r[1].FinalPlace], ['4', '4']);
    assert.deepEqual([r[2].DressagePlace, r[2].XCPlace, r[2].SJPlace, r[2].FinalPlace], ['2', '1', '1', '1']);
    // The tie suffix is a cell, not an out code: FinalPlace stays numeric.
    assert.ok(r.every(x => /^\d+$/.test(x.FinalPlace)));
  } finally { await s.context.close(); }
});

test('S113: a tied place rendered as "2-T" is shown as a tie in the popover and round sheet via equal places', async () => {
  await publishSchedule(); await publishScores({ text: SPLIT_BOARD });
  const s = await openSnap({ riders: ['Ada Tester', 'Bea Sample'] });
  try {
    const info = await rowInfo(s.page, 102);
    assert.match(info.pop, /Dressage\s*22\.5 \(T2nd\)/);
    await s.page.evaluate(() => openRoundSheet('ON', 'Dressage'));
    const rows = await s.page.$$eval('#round-list .qrow', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    assert.equal(rows.length, 3);
    assert.ok(rows.filter(t => /T2nd/.test(t)).length === 2, rows.join(' | '));
  } finally { await s.context.close(); }
});

// ---- S114: the fetch tool's pure helpers (no browser, no network) ----

test('S114: fromLine drops page chrome above the table and falls back to the whole text; parseArgs reads flags and values', () => {
  const { fromLine, parseArgs } = fetchTool;
  assert.equal(fromLine('Home\nShow Center\n  Pinney\tGoTime\nRing 1\n', /^Pinney\b/i), 'Pinney\tGoTime\nRing 1\n');
  assert.equal(fromLine('a\r\nb\r\nDate\r\nThu, 10/29\r\n', /^Date\b/i), 'Date\nThu, 10/29\n');
  assert.equal(fromLine('no match here\nat all', /^Pinney\b/i), 'no match here\nat all\n');
  assert.equal(fromLine('ShowsResults are not final and subject to change.\nx', /Results are not final/i),
    'ShowsResults are not final and subject to change.\nx\n');
  assert.deepEqual(parseArgs(['--key', 'K', '--publish', '--out', '~/g', '--push', 'stray', '--force']),
    { key: 'K', publish: true, out: '~/g', push: true, force: true });
});

test('S114: the spacing guard refuses a re-fetch within 10 minutes of the newest output file unless forced, and allows a first run', () => {
  const { spacingGuard, MIN_SPACING_MS } = fetchTool;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapfetch-'));
  const a = path.join(dir, 'a.txt'), b = path.join(dir, 'b.txt'), missing = path.join(dir, 'nope.txt');
  assert.doesNotThrow(() => spacingGuard([missing], false), 'nothing written yet');
  fs.writeFileSync(a, 'x');
  assert.throws(() => spacingGuard([a, missing], false), /last fetch was 0 min ago; wait 10 min/);
  assert.doesNotThrow(() => spacingGuard([a, missing], true), '--force');
  // An old file no longer blocks; the newest file decides.
  const old = (Date.now() - MIN_SPACING_MS - 60_000) / 1000;
  fs.utimesSync(a, old, old);
  assert.doesNotThrow(() => spacingGuard([a], false));
  fs.writeFileSync(b, 'y');
  assert.throws(() => spacingGuard([a, b], false));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('S115: requiring the fetch tool as a module never launches the CLI (no browser, no argv parsing side effects)', () => {
  assert.equal(typeof fetchTool.fromLine, 'function');
  assert.equal(typeof fetchTool.spacingGuard, 'function');
  assert.equal(fetchTool.MIN_SPACING_MS, 10 * 60_000);
});
