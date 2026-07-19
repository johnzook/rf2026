'use strict';
// Tests for compare.html — the 2025-vs-2026 statistics page.
//
// Same approach as the index.html suite: compare.html is a classic script, so
// its stats engine (pnum, levelOf, classifyRow, aggregate, …) is reachable
// from page.evaluate. Both years' API routes are stubbed with small synthetic
// fixtures; no live network. Scoring-code semantics in the fixtures mirror
// the real feeds: a code appears in the column of the phase it happened in
// and cascades into every later phase column and the Final columns.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getBrowser, closeBrowser } = require('./helpers');

const COMPARE_HTML = fs.readFileSync(path.join(__dirname, '..', 'compare.html'), 'utf8');

// ---- fixtures -------------------------------------------------------------

// A scoring row where every cell defaults to '--' (unposted).
function row(over = {}) {
  return Object.assign({
    DivisionId: 1, Pinny: 1, RiderName: 'Test Rider (USA)', HorseName: 'Horse',
    DressageScore: '--', DressagePlace: '--',
    ThreeDayPhaseATimePenalty: '--', ThreeDayPhaseBTimePenalty: '--',
    ThreeDayPhaseBJumpPenalty: '--', ThreeDayPhaseCTimePenalty: '--',
    XCElapsedTime: '--', XCTimePenalty: '--', XCJumpPenalty: '--', XCScore: '--', XCPlace: '--',
    SJElapsedTime: '--', SJTimePenalty: '--', SJJumpPenalty: '--', SJScore: '--', SJPlace: '--',
    FinalPoints: '--', FinalPlace: '--',
  }, over);
}

// A finisher: dressage 30.0, XC clear inside the time, SJ clear.
function finisher(over = {}) {
  return row(Object.assign({
    DressageScore: '30.0', DressagePlace: '1',
    XCTimePenalty: '0.00', XCJumpPenalty: '0', XCScore: '30.0', XCPlace: '1',
    SJTimePenalty: '0', SJJumpPenalty: '0', SJScore: '30.0', SJPlace: '1',
    FinalPoints: '30.0', FinalPlace: '1',
  }, over));
}

function division(id, name, over = {}) {
  return Object.assign({ DivisionId: id, DivisionName: name, DivisionStatus: 'FINAL', PhaseOrder: 'd-xc-sj' }, over);
}

const EMPTY_SCORING = { DivisionsList: [], ScoringList: [] };
const EMPTY_FEED = { EntryList: [] };

// ---- harness --------------------------------------------------------------

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(COMPARE_HTML);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

// Open compare.html with each year's two routes stubbed. Routes must be
// registered most-specific first: '**/api/sc/event/NNNN' would otherwise
// also swallow the '/scoringLive' request.
async function openCompare(server, { scoring25 = EMPTY_SCORING, feed25 = EMPTY_FEED, scoring26 = EMPTY_SCORING, feed26 = EMPTY_FEED } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const serve = body => route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/sc/event/1150/scoringLive', serve(scoring25));
  await context.route('**/api/sc/event/1150', serve(feed25));
  await context.route('**/api/sc/event/1187/scoringLive', serve(scoring26));
  await context.route('**/api/sc/event/1187', serve(feed26));
  const page = await context.newPage();
  page.on('pageerror', e => { page.__pageError = e; });
  await page.goto(server.url);
  await page.waitForFunction(() => document.getElementById('loading') === null);
  return { context, page };
}

let server;
test.before(async () => { server = await startServer(); });
test.after(async () => { await closeBrowser(); await server.close(); });

// ---- unit: parsing & grouping --------------------------------------------

test('pnum: numbers parse, placeholders and codes are null, annotations keep the number', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const out = await page.evaluate(() => [
    pnum('30.6'), pnum('3.20'), pnum('--'), pnum(''), pnum(null),
    pnum('W'), pnum('IW'), pnum('RF'), pnum('E'), pnum('MR'),
    pnum('68.2 DR-XC'), pnum(0), pnum('0'),
  ]);
  assert.deepStrictEqual(out, [30.6, 3.2, null, null, null, null, null, null, null, null, 68.2, 0, 0]);
});

test('levelOf: divisions group into canonical levels; Non-Compete excluded', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const out = await page.evaluate(() => [
    levelOf('CCI4*-Long'), levelOf('CCI4*-Short'), levelOf('CCI2*-Long'),
    levelOf('Open Intermediate'), levelOf('Open Preliminary B'), levelOf('Open Modified'),
    levelOf('Training Three-Day'), levelOf('Sr. Open Training C'), levelOf('Jr. Open Training'),
    levelOf('Novice Three-Day A'), levelOf('Sr. Open Novice E'),
    levelOf('Jr. Open Beginner Novice A'), levelOf('Sr. Open Beginner Novice D'),
    levelOf('Non-Compete'), levelOf(''), levelOf(null),
  ]);
  assert.deepStrictEqual(out, [
    'CCI4*-L', 'CCI4*-S', 'CCI2*-L',
    'Intermediate', 'Preliminary', 'Modified',
    'Training', 'Training', 'Training',
    'Novice', 'Novice',
    'Beginner Novice', 'Beginner Novice',
    null, null, null,
  ]);
});

// ---- unit: incident attribution ------------------------------------------

test('classifyRow: cascaded code is attributed to the first phase showing it', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  // Retired on XC: R cascades into SJ and Final columns.
  const out = await page.evaluate(fx => classifyRow(fx, 'd-xc-sj'), row({
    DressageScore: '32.0', DressagePlace: '5',
    XCTimePenalty: 'R', XCJumpPenalty: '20', XCScore: 'R', XCPlace: 'R',
    SJScore: 'R', SJPlace: 'R', FinalPoints: 'R', FinalPlace: 'R',
  }));
  assert.strictEqual(out.incident.phase, 'xc');
  assert.strictEqual(out.incident.group, 'ret');
  assert.ok(out.started);
  assert.ok(out.xcStarted);
  assert.ok(!out.xcCompleted);
  assert.strictEqual(out.refusals, 1); // penalties accrued before retiring still count
});

test('classifyRow: jog withdrawal (IW before SJ) counts XC as completed', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const out = await page.evaluate(fx => classifyRow(fx, 'd-xc-sj'), row({
    DressageScore: '34.3', DressagePlace: '3',
    XCTimePenalty: '2.0', XCJumpPenalty: '0', XCScore: '36.3', XCPlace: '4',
    SJScore: 'IW', SJPlace: 'IW', FinalPoints: 'IW', FinalPlace: 'IW',
  }));
  assert.strictEqual(out.incident.phase, 'sj');
  assert.strictEqual(out.incident.group, 'wd');
  assert.ok(out.xcStarted && out.xcCompleted);
  assert.ok(!out.finished);
});

test('classifyRow: withdrawal with no dressage score never started', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  // Real shape from the feeds: DR '--', W first appears in the XC column.
  const out = await page.evaluate(fx => classifyRow(fx, 'd-xc-sj'), row({
    XCScore: 'W', XCPlace: 'W', SJScore: '--', FinalPoints: 'W', FinalPlace: 'W',
  }));
  assert.ok(out.neverStarted);
  assert.ok(!out.started);
  assert.ok(!out.xcStarted);
});

test('classifyRow: all-empty row with a Final-only code is a no-show, all-numeric row is a finisher', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const noshow = await page.evaluate(fx => classifyRow(fx, 'd-xc-sj'), row({ FinalPoints: 'W', FinalPlace: 'W' }));
  assert.ok(noshow.neverStarted);
  const fin = await page.evaluate(fx => classifyRow(fx, 'd-xc-sj'), finisher());
  assert.strictEqual(fin.incident, null);
  assert.ok(fin.finished && fin.finishedOnDressage);
  assert.strictEqual(fin.refusals, 0);
});

test('classifyRow: refusal arithmetic separates 20s from frangible remainders', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const cases = await page.evaluate(fx => fx.map(jp => {
    const c = classifyRow({
      DivisionId: 1, DressageScore: '30.0', DressagePlace: '1',
      XCTimePenalty: '0.4', XCJumpPenalty: String(jp), XCScore: '99.9', XCPlace: '9',
      SJScore: '--', SJPlace: '--', FinalPoints: '--', FinalPlace: '--',
    }, 'd-xc-sj');
    return { jp, refusals: c.refusals, frangible: c.frangible };
  }), [0, 20, 40, 60, 11, 31, 51, 15]);
  assert.deepStrictEqual(cases, [
    { jp: 0, refusals: 0, frangible: false },
    { jp: 20, refusals: 1, frangible: false },
    { jp: 40, refusals: 2, frangible: false },
    { jp: 60, refusals: 3, frangible: false },
    { jp: 11, refusals: 0, frangible: true },   // frangible pin only — NOT a refusal
    { jp: 31, refusals: 1, frangible: true },   // one stop + a pin
    { jp: 51, refusals: 2, frangible: true },
    { jp: 15, refusals: 0, frangible: true },   // missed flag
  ]);
});

test('classifyRow: three-day phase order attributes endurance-phase codes', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const out = await page.evaluate(fx => classifyRow(fx, 'd-e-xc-sj'), row({
    DressageScore: '31.7', DressagePlace: '2',
    ThreeDayPhaseBTimePenalty: 'RF',
    XCScore: 'RF', XCPlace: 'RF', SJScore: 'RF', SJPlace: 'RF',
    FinalPoints: 'RF', FinalPlace: 'RF',
  }));
  assert.strictEqual(out.incident.phase, 'endurance');
  assert.strictEqual(out.incident.group, 'fall');
  assert.ok(!out.xcStarted); // fell on steeplechase, never started XC proper
});

// ---- unit: aggregation ----------------------------------------------------

test('aggregate: entries land in the right level buckets with scratches from the entry feed', async t => {
  const { context, page } = await openCompare(server);
  t.after(() => context.close());
  const scoring = {
    DivisionsList: [
      division(1, 'Sr. Open Novice A'),
      division(2, 'Jr. Open Novice B'),
      division(3, 'Non-Compete', { DivisionStatus: null }),
    ],
    ScoringList: [
      finisher({ DivisionId: 1, Pinny: 1 }),
      // eliminated on XC after two stops
      row({ DivisionId: 1, Pinny: 2, DressageScore: '35.0', DressagePlace: '2',
        XCTimePenalty: 'E', XCJumpPenalty: '40', XCScore: 'E', XCPlace: 'E',
        SJScore: 'E', SJPlace: 'E', FinalPoints: 'E', FinalPlace: 'E' }),
      // withdrew before SJ, one stop on XC
      row({ DivisionId: 2, Pinny: 3, DressageScore: '28.0', DressagePlace: '1',
        XCTimePenalty: '1.2', XCJumpPenalty: '20', XCScore: '49.2', XCPlace: '3',
        SJScore: 'W', SJPlace: 'W', FinalPoints: 'W', FinalPlace: 'W' }),
      // non-compete rides are excluded entirely
      finisher({ DivisionId: 3, Pinny: 4 }),
    ],
  };
  const feed = { EntryList: [
    { Division: 'Sr. Open Novice A', Status: 'Scratched' },
    { Division: 'Sr. Open Novice A', Status: 'Accepted' },
    { Division: 'Open Preliminary A', Status: 'Scratched' },
  ] };
  const out = await page.evaluate(fx => {
    const { byLevel, overall } = aggregate(fx.scoring, fx.feed);
    const pick = s => s && {
      scratched: s.scratched, entries: s.entries, started: s.started,
      xcStarters: s.xcStarters, xcCompleted: s.xcCompleted, xcRecorded: s.xcRecorded,
      xcRefused: s.xcRefused, xcRefusalCount: s.xcRefusalCount,
      xcClearJump: s.xcClearJump, xcDoubleClear: s.xcDoubleClear,
      finished: s.finished, finishedOnDressage: s.finishedOnDressage, inc: s.inc,
    };
    return {
      levels: [...byLevel.keys()].sort(),
      novice: pick(byLevel.get('Novice')),
      prelim: pick(byLevel.get('Preliminary')),
      overall: pick(overall),
    };
  }, { scoring, feed });

  // Preliminary exists only via its scratch; Non-Compete never appears.
  assert.deepStrictEqual(out.levels, ['Novice', 'Preliminary']);
  assert.strictEqual(out.prelim.scratched, 1);
  assert.strictEqual(out.prelim.entries, 0);

  const n = out.novice;
  assert.strictEqual(n.scratched, 1);
  assert.strictEqual(n.entries, 3);
  assert.strictEqual(n.started, 3);
  assert.strictEqual(n.xcStarters, 3);        // finisher + eliminated + W-before-SJ
  assert.strictEqual(n.xcCompleted, 2);       // eliminated horse didn't complete
  assert.strictEqual(n.xcRecorded, 3);        // but its 40 jump penalties ARE recorded
  assert.strictEqual(n.xcRefused, 2);
  assert.strictEqual(n.xcRefusalCount, 3);    // 2 stops + 1 stop
  assert.strictEqual(n.xcClearJump, 1);
  assert.strictEqual(n.xcDoubleClear, 1);
  assert.strictEqual(n.finished, 1);
  assert.strictEqual(n.finishedOnDressage, 1);
  assert.deepStrictEqual(n.inc, { xc_elim: 1, sj_wd: 1 });
  assert.strictEqual(out.overall.entries, 3);
  assert.strictEqual(out.overall.scratched, 2);
});

// ---- functional: rendering ------------------------------------------------

test('page renders tiles, sections and level chips from both years', async t => {
  const mk = pinny => ({
    scoring: { DivisionsList: [division(1, 'Sr. Open Training A')], ScoringList: [finisher({ DivisionId: 1, Pinny: pinny })] },
    feed: { EntryList: [{ Division: 'Sr. Open Training A', Status: 'Scratched' }] },
  });
  const y25 = mk(1), y26 = mk(2);
  const { context, page } = await openCompare(server, {
    scoring25: y25.scoring, feed25: y25.feed, scoring26: y26.scoring, feed26: y26.feed,
  });
  t.after(() => context.close());
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 4);
  assert.strictEqual(page.__pageError, undefined, String(page.__pageError));
  const chips = await page.$$eval('.level-chip', els => els.map(e => e.textContent));
  assert.deepStrictEqual(chips, ['All levels', 'Training']);
  const heads = await page.$$eval('main h2', els => els.map(e => e.textContent));
  assert.ok(heads.includes('The field'));
  assert.ok(heads.includes('Cross country, like for like'));
  assert.ok(heads.includes('Levels at a glance'));
  // both finishers, both scratches make it into the tables
  const fieldTable = await page.$eval('main section .card table', el => el.textContent.replace(/\s+/g, ' '));
  assert.ok(fieldTable.includes('Scratched before the event 1 1'), fieldTable);
});

test('level chip narrows every table to that level and hides the glance table', async t => {
  const scoring26 = {
    DivisionsList: [division(1, 'Sr. Open Novice A'), division(2, 'Sr. Open Training A')],
    ScoringList: [
      finisher({ DivisionId: 1, Pinny: 1 }),
      finisher({ DivisionId: 2, Pinny: 2 }),
      finisher({ DivisionId: 2, Pinny: 3 }),
    ],
  };
  const { context, page } = await openCompare(server, { scoring26 });
  t.after(() => context.close());
  await page.waitForFunction(() => document.querySelectorAll('.level-chip').length === 3);
  await page.click('.level-chip[data-level="Training"]');
  const heads = await page.$$eval('main h2', els => els.map(e => e.textContent));
  assert.ok(!heads.includes('Levels at a glance'));
  const field = await page.$eval('main section .card table', el => el.textContent.replace(/\s+/g, ' '));
  // 2025 column empty-ish (0), 2026 column shows only Training's 2 entries
  assert.ok(field.includes('Entries on the scoreboard 0 2'), field);
});

test('delta direction: more falls shows as worse, more completions as better', async t => {
  const fall = pinny => row({ DivisionId: 1, Pinny: pinny, DressageScore: '30.0', DressagePlace: '1',
    XCTimePenalty: 'RF', XCJumpPenalty: '--', XCScore: 'RF', XCPlace: 'RF',
    SJScore: 'RF', SJPlace: 'RF', FinalPoints: 'RF', FinalPlace: 'RF' });
  const div = [division(1, 'Sr. Open Novice A')];
  const { context, page } = await openCompare(server, {
    scoring25: { DivisionsList: div, ScoringList: [finisher({ DivisionId: 1, Pinny: 1 }), finisher({ DivisionId: 1, Pinny: 2 })] },
    scoring26: { DivisionsList: div, ScoringList: [finisher({ DivisionId: 1, Pinny: 1 }), fall(2)] },
  });
  t.after(() => context.close());
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 4);
  const deltas = await page.evaluate(() => {
    const find = label => {
      const tr = [...document.querySelectorAll('main tr')].find(r => {
        const m = r.querySelector('td.metric');
        return m && m.textContent.trim().startsWith(label);
      });
      const d = tr && tr.querySelector('.delta');
      return d ? [...d.classList].filter(c => c !== 'delta')[0] : null;
    };
    return {
      falls: find('Rider fall on cross country'),
      completed: find('Completed the course'),
      finished: find('Completed the event'),
    };
  });
  assert.strictEqual(deltas.falls, 'worse');      // 0% -> 50% of starters fell
  assert.strictEqual(deltas.completed, 'worse');  // 100% -> 50% completed
  assert.strictEqual(deltas.finished, 'worse');
});

test('a failed year degrades gracefully: error shown, other year still renders', async t => {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  t.after(() => context.close());
  const serve = body => route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/sc/event/1150/scoringLive', route => route.abort('failed'));
  await context.route('**/api/sc/event/1150', route => route.abort('failed'));
  await context.route('**/api/sc/event/1187/scoringLive', serve({
    DivisionsList: [division(1, 'Sr. Open Novice A')],
    ScoringList: [finisher({ DivisionId: 1, Pinny: 1 })],
  }));
  await context.route('**/api/sc/event/1187', serve(EMPTY_FEED));
  const page = await context.newPage();
  page.on('pageerror', e => { page.__pageError = e; });
  await page.goto(server.url);
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 4);
  assert.strictEqual(page.__pageError, undefined, String(page.__pageError));
  const status = await page.textContent('#status');
  assert.ok(/couldn't load 2025/i.test(status), status);
  const chips = await page.$$eval('.level-chip', els => els.map(e => e.textContent));
  assert.deepStrictEqual(chips, ['All levels', 'Novice']);
});

test('live note appears when a 2026 division is still posting', async t => {
  const active = {
    DivisionsList: [division(1, 'Sr. Open Novice A', { DivisionStatus: 'ACTIVE' })],
    ScoringList: [finisher({ DivisionId: 1, Pinny: 1 })],
  };
  const { context, page } = await openCompare(server, { scoring26: active });
  t.after(() => context.close());
  await page.waitForFunction(() => document.querySelectorAll('.tile').length === 4);
  const note = await page.$eval('.note', el => el.textContent);
  assert.ok(/still posting/.test(note), note);
});
