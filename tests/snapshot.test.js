'use strict';
// TESTPLAN S94–S101: snapshot events — a hosted, encrypted evententries
// "Order of Go" (?event=ee:<key>&k=<token>) parsed into the ShowConnect
// feed shape. The encrypted fixture is built here from a small synthetic
// order of go (invented names) with the same code path the CLI uses, and
// served per test by the local server — the committed snapshot is never
// read, and no ShowConnect request may be made for these events.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer, openPage, openPicker, closeBrowser, rowInfo, chipLabels,
} = require('./helpers');
const { encryptSnapshot } = require('../tools/snapshot-encrypt');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });
beforeEach(() => { server.clearFiles(); });

const KEY = 'TestKey01';
const EVENT = `ee:${KEY}`;
const TOKEN = 'TESTTOKEN12345678';
const FILE = `/snapshots/ee-${KEY}.json`;
const START = '2026-10-28'; // a Wednesday; the show runs Thu–Sun
// Pinned "now": Thu Oct 29 2026, 08:00 America/Los_Angeles (PDT = UTC-7).
const NOW = Date.UTC(2026, 9, 29, 15, 0, 0);

// Synthetic order of go, one table cell per line as the show center copies.
// Exercises: a ring shared by consecutive sections (Ring A), a Break, a
// pinny-less Test Ride, a 12:00 PM and a 12:00 AM time, three phases with
// their own rings, and a Sunday ride.
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
09:12 AM Thu
Break
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
11:40 AM Thu
Test Ride
Test Horse 2 Star
CCI2-L
301
12:00 AM Fri
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
SJ - Main
Show Jumping Novice
Judge(s):
101
01:30 PM Sun
Ada Tester
Horse One
ON
`;

async function publish({ text = OOG, token = TOKEN, name = 'Snapshot Test Event', state = 'California', start = START } = {}) {
  const r = await encryptSnapshot({ key: KEY, token, name, start, state, text, captured: 'Thu Oct 29, 9:00 AM PDT' });
  server.setFile(FILE, JSON.stringify(r.payload));
  return r.payload;
}

// Open the snapshot event. `riders` seeds sc:ee:<key>:riders (default two
// followed riders); `k` controls the token in the URL.
async function openSnap(opts = {}) {
  const { riders = ['Ada Tester', 'Cal Fixture'], k = TOKEN, query = '', waitLoaded = true, ...rest } = opts;
  const url = `${server.url}?event=${EVENT}${k ? `&k=${k}` : ''}${query}`;
  return openPage({ server, eventId: EVENT, riders, now: NOW, url, waitLoaded, ...rest });
}

const parseIn = (page, text, start = START) =>
  page.evaluate(([t, s]) => {
    const f = parseOrderOfGo(t, s);
    return {
      stats: f.stats,
      entries: f.EntryList.map(e => ({
        pinny: e.PinnyNumber, rider: e.RiderName, horse: e.HorseName, division: e.Division,
        status: e.Status,
        rides: e.RidingDetails.map(rd => ({
          phase: rd.Phase, venue: rd.Venues[0].venue, time: rd.RideTimes,
          parsed: parseRideTime(rd.RideTimes) && parseRideTime(rd.RideTimes).toString(),
        })),
      })),
    };
  }, [text, start]);

// ---- S94: event id scheme ----

test('S94: ee:<key> ids load the event view; malformed keys fall to the picker; parseManualEvent accepts ids and evententries links', async () => {
  await publish();
  const s = await openSnap();
  try {
    assert.equal(await s.page.$eval('#picker', el => el.hidden), true);
    assert.equal(await s.page.$eval('header', el => el.hidden), false);
    assert.equal(await s.page.evaluate(() => eventId), EVENT);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }

  for (const bad of ['?event=ee:', '?event=ee:bad%20key', `?event=ee:${'x'.repeat(41)}`, '?event=ee:a.b']) {
    const b = await openPicker({ server, path: bad, now: NOW });
    try {
      assert.equal(await b.page.$eval('#picker', el => el.hidden), false, `${bad} shows the picker`);
      assert.equal(b.page.__pageError, undefined);
      if (bad === '?event=ee:') {
        const r = await b.page.evaluate(() => ({
          plain: parseManualEvent('ee:ZAsNB86e3r89ldK9'),
          link: parseManualEvent('https://evententries.com/#ShowCenterZAsNB86e3r89ldK9'),
          num: parseManualEvent('1187'),
          sc: parseManualEvent('https://showconnect.org/x?ShowConnectId=1190'),
          junk: parseManualEvent('ee:'),
          junk2: parseManualEvent('https://evententries.com/#LiveScores'),
        }));
        assert.deepEqual(r, {
          plain: 'ee:ZAsNB86e3r89ldK9', link: 'ee:ZAsNB86e3r89ldK9', num: 1187, sc: 1190,
          junk: null, junk2: null,
        });
      }
    } finally { await b.context.close(); }
  }
});

test('S94: sc:last-event is written as "ee:<key>" after a good load and a bare URL resumes it with the stored token', async () => {
  await publish();
  const s = await openSnap();
  try {
    assert.equal(await s.page.evaluate(() => localStorage.getItem('sc:last-event')), EVENT);
  } finally { await s.context.close(); }

  const r = await openPage({
    server, eventId: EVENT, now: NOW, url: server.url, riders: ['Ada Tester'],
    localStorage: { 'sc:last-event': EVENT, [`sc:${EVENT}:k`]: TOKEN },
  });
  try {
    assert.equal(await r.page.evaluate(() => location.search), `?event=${EVENT}&k=${TOKEN}`);
    assert.equal((await rowInfo(r.page, 101)) !== null, true, 'rows rendered from the resumed event');
  } finally { await r.context.close(); }
});

// ---- S95: token handling ----

test('S95: &k= is stored per event, the URL canonicalizes to ?event=ee:<key>&k=<token>, a bare ?event reuses the stored token, and share links carry it', async () => {
  await publish();
  const s = await openSnap({ riders: ['Ada Tester'] });
  try {
    const r = await s.page.evaluate(() => ({
      search: location.search,
      stored: localStorage.getItem(`sc:${eventId}:k`),
      share: buildShareUrl(),
      origin: location.origin + location.pathname,
    }));
    assert.equal(r.search, `?event=${EVENT}&k=${TOKEN}`);
    assert.equal(r.stored, TOKEN);
    assert.equal(r.share, `${r.origin}?event=${EVENT}&k=${TOKEN}&riders=${encodeURIComponent('Ada Tester')}`);

    // Bare ?event=ee:<key> in the same browser: the stored token applies.
    await s.page.goto(`${server.url}?event=${EVENT}`);
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    assert.equal(await s.page.evaluate(() => location.search), `?event=${EVENT}&k=${TOKEN}`);
    assert.equal(await s.page.$eval('#fetch-err', el => el.textContent), '');
  } finally { await s.context.close(); }
});

test('S95: a received ?riders= link with the token adopts the riders onto an empty list and cleans the URL', async () => {
  await publish();
  const s = await openSnap({ riders: null, query: `&riders=${encodeURIComponent('Ada Tester|Cal Fixture')}` });
  try {
    const r = await s.page.evaluate(() => ({
      stored: getStoredList(RIDERS_KEY),
      search: location.search,
      banner: document.getElementById('share-banner').hidden,
    }));
    assert.deepEqual(r.stored, ['Ada Tester', 'Cal Fixture']);
    assert.equal(r.search, `?event=${EVENT}&k=${TOKEN}`);
    assert.equal(r.banner, true, 'silent adoption onto an empty list');
    assert.ok(await rowInfo(s.page, 101), 'adopted rider renders');
  } finally { await s.context.close(); }
});

// ---- S96/S97: parseOrderOfGo ----

test('S96: order-of-go grammar — ring inheritance, Break ignored, Test Ride skipped, header words filtered, per-combo phases', async () => {
  await publish();
  const s = await openSnap();
  try {
    const r = await parseIn(s.page, OOG);
    assert.deepEqual(r.stats, { rides: 7, breaks: 1, skipped: 1, sections: 5 });
    assert.deepEqual(r.entries.map(e => e.pinny), [101, 102, 201, 301]);
    const byPinny = Object.fromEntries(r.entries.map(e => [e.pinny, e]));
    assert.equal(byPinny[101].rider, 'Ada Tester');
    assert.equal(byPinny[101].status, 'Accepted');
    assert.deepEqual(byPinny[101].rides.map(x => [x.phase, x.venue]),
      [['Dressage', 'Ring A'], ['Cross Country', 'XC'], ['Show Jumping', 'SJ - Main']]);
    // Second dressage section names no ring: it inherits Ring A.
    assert.deepEqual(byPinny[201].rides.map(x => [x.phase, x.venue]), [['Dressage', 'Ring A']]);
    assert.deepEqual(byPinny[301].rides.map(x => [x.phase, x.venue]), [['Dressage', 'Ring B']]);
    assert.equal(byPinny[301].division, 'CCI2-L');
    // No entry was ever created for the header words or the test ride.
    assert.ok(!r.entries.some(e => /pinney|rider|test ride/i.test(e.rider)));
  } finally { await s.context.close(); }
});

test('S96: tab-separated rows parse identically; a duplicate combo+phase keeps the later row; empty or garbage text yields an empty EntryList', async () => {
  await publish();
  const s = await openSnap();
  try {
    const tabbed = [
      'Pinney\tGoTime\tRider\tHorse\tDivision',
      'Ring A', '2026 USEA Novice Dressage Test B', 'Judge(s): X',
      '101\t09:00 AM Thu\tAda Tester\tHorse One\tON',
      '101\t09:30 AM Thu\tAda Tester\tHorse One\tON', // re-published later row wins
    ].join('\n');
    const r = await parseIn(s.page, tabbed);
    assert.equal(r.stats.rides, 2);
    assert.equal(r.entries.length, 1);
    assert.deepEqual(r.entries[0].rides.map(x => x.time), ['Thu, Oct 29, 2026, 9:30:00 AM']);

    const empties = await s.page.evaluate(() => [
      parseOrderOfGo('', '2026-10-28').EntryList.length,
      parseOrderOfGo(null, '2026-10-28').EntryList.length,
      parseOrderOfGo('just some words\n42\nmore words', '2026-10-28').EntryList.length,
      parseOrderOfGo('101\n09:00 AM Thu\nAda Tester\nHorse One\nON', 'not-a-date').EntryList.length, // no start date → skipped
      parseOrderOfGo('101\n09:00 AM Thu\nAda Tester\nHorse One\nON', 'not-a-date').stats.skipped,
    ]);
    assert.deepEqual(empties, [0, 0, 0, 0, 1]);
  } finally { await s.context.close(); }
});

test('S97: weekdays resolve from the start date (wrapping past it), 12 AM/PM parse, RideTimes round-trip through parseRideTime, phases from section titles', async () => {
  await publish();
  const s = await openSnap();
  try {
    const r = await parseIn(s.page, OOG);
    const byPinny = Object.fromEntries(r.entries.map(e => [e.pinny, e]));
    assert.equal(byPinny[201].rides[0].time, 'Thu, Oct 29, 2026, 12:00:00 PM');
    assert.equal(byPinny[301].rides[0].time, 'Fri, Oct 30, 2026, 12:00:00 AM');
    assert.equal(byPinny[101].rides[2].time, 'Sun, Nov 1, 2026, 1:30:00 PM');
    // Every synthesized string is accepted by the shared parser, at the
    // right wall-clock hour (12 PM → 12, 12 AM → 0).
    assert.ok(r.entries.every(e => e.rides.every(x => x.parsed)));
    assert.match(byPinny[201].rides[0].parsed, /12:00:00/);
    assert.match(byPinny[301].rides[0].parsed, /00:00:00/);

    // Start on a Friday: a "Thu" ride lands the following Thursday.
    const wrap = await parseIn(s.page, 'R\nCross Country Novice\nJudge(s):\n5\n08:00 AM Thu\nA B\nH\nON\n6\n08:10 AM Fri\nC D\nH2\nON', '2026-10-30');
    assert.deepEqual(wrap.entries.map(e => e.rides[0].time),
      ['Thu, Nov 5, 2026, 8:00:00 AM', 'Fri, Oct 30, 2026, 8:10:00 AM']);

    assert.deepEqual(await s.page.evaluate(() => [
      oogPhase('2026 USEF Preliminary Dressage Test B'),
      oogPhase('2026 FEI Eventing CCI4 Test A'),
      oogPhase('2026 USEA Novice Classic Three-Day Test'),
      oogPhase('Cross Country FEI'),
      oogPhase('Show Jumping Modified'),
      oogPhase('Stadium Novice'),
      oogPhase(''),
    ]), ['Dressage', 'Dressage', 'Dressage', 'Cross Country', 'Show Jumping', 'Show Jumping', 'Dressage']);
  } finally { await s.context.close(); }
});

// ---- S98: happy path ----

test('S98: the hosted snapshot decrypts and renders — rows, chips, name/title, timezone from the state, footer provenance, no results, no ShowConnect traffic', async () => {
  await publish();
  const log = [];
  const s = await openSnap({ requestLog: log, timezoneId: 'Asia/Tokyo' });
  try {
    const r = await s.page.evaluate(() => ({
      name: document.getElementById('event-name').textContent,
      title: document.title,
      tz: eventTz,
      footer: document.querySelector('footer').textContent,
      err: document.getElementById('fetch-err').textContent,
      status: document.getElementById('status').textContent,
      rides: rides.map(x => `${x.dayKey} ${x.phase} ${x.venue} #${x.pinny} ${x.rider}`),
      results: Object.keys(resultsIdx).length,
      scoringUrl: SCORING_URL, eventUrl: EVENT_URL,
    }));
    assert.equal(r.name, 'Snapshot Test Event');
    assert.equal(r.title, 'Snapshot Test Event — Ride Times');
    assert.equal(r.tz, 'America/Los_Angeles');
    assert.match(r.footer, /\(PDT\)/);
    assert.match(r.footer, /evententries order of go captured Thu Oct 29, 9:00 AM PDT — no live results/);
    assert.equal(r.err, '');
    assert.match(r.status, /^Updated 8:00 AM/);
    assert.deepEqual(r.rides, [
      '2026-10-29 Dressage Ring A #101 Ada Tester',
      '2026-10-31 Cross Country XC #101 Ada Tester',
      '2026-11-01 Show Jumping SJ - Main #101 Ada Tester',
      '2026-10-29 Dressage Ring A #201 Cal Fixture',
    ]);
    assert.equal(r.results, 0);
    assert.equal(r.scoringUrl, null);
    assert.equal(r.eventUrl, null);
    assert.deepEqual(await chipLabels(s.page), ['Today*', 'Sat, Oct 31', 'Sun, Nov 1']);
    const row = await rowInfo(s.page, 101);
    assert.equal(row.adj, '9:00 AM');
    assert.match(row.pop, /Not posted yet/);
    assert.ok(!log.some(u => u.includes('showconnect')), `no ShowConnect requests: ${log.join(', ')}`);
    assert.ok(log.some(u => u.endsWith(FILE)), 'the snapshot file was fetched');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

// ---- S99: cache ----

test('S99: the parsed feed is cached at sc:ee:<key>:event and hydrates a reload that cannot reach the file', async () => {
  await publish();
  const s = await openSnap();
  try {
    const cached = await s.page.evaluate(() => JSON.parse(localStorage.getItem(`sc:${eventId}:event`)));
    assert.equal(typeof cached.at, 'number');
    assert.equal(cached.value.EntryList.length, 4);
    assert.equal(cached.value.snapshot.name, 'Snapshot Test Event');
    assert.equal(cached.value.snapshot.startDate, START);

    await s.context.route('**/snapshots/**', route => route.abort('failed'));
    await s.page.reload();
    await s.page.waitForFunction(() => document.getElementById('fetch-err').textContent !== '');
    const r = await s.page.evaluate(() => ({
      err: document.getElementById('fetch-err').textContent,
      name: document.getElementById('event-name').textContent,
      footer: document.querySelector('footer').textContent,
      n: rides.length,
    }));
    assert.equal(r.err, '· can\'t load the schedule, retrying');
    assert.equal(r.name, 'Snapshot Test Event');
    assert.match(r.footer, /no live results/);
    assert.equal(r.n, 4);
    assert.ok(await rowInfo(s.page, 101), 'rows rendered from cache');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

// ---- S100: error paths ----

test('S100: no token, wrong token and a missing file each explain themselves and leave the page usable', async () => {
  const cases = [
    { name: 'no token', publish: true, k: '', msg: '· this schedule needs the key from the link you were sent' },
    { name: 'wrong token', publish: true, k: 'WRONGTOKEN0000', msg: '· the key in this link doesn\'t open this schedule' },
    { name: 'missing file', publish: false, k: TOKEN, msg: '· schedule not published yet — check the link or switch event' },
  ];
  for (const c of cases) {
    server.clearFiles();
    if (c.publish) await publish();
    const s = await openSnap({ k: c.k, waitLoaded: false, riders: null });
    try {
      await s.page.waitForFunction(() => document.getElementById('fetch-err').textContent !== '');
      const r = await s.page.evaluate(() => ({
        err: document.getElementById('fetch-err').textContent,
        prompt: document.getElementById('list').textContent.replace(/\s+/g, ' ').trim(),
        last: localStorage.getItem('sc:last-event'),
        token: localStorage.getItem(`sc:${eventId}:k`),
      }));
      assert.equal(r.err, c.msg, c.name);
      assert.match(r.prompt, /No riders followed yet/, `${c.name}: page still usable`);
      assert.equal(r.last, null, `${c.name}: a failed load never becomes the resume target`);
      if (c.name === 'no token') assert.equal(r.token, null);
      // The add-riders prompt still opens the sheet.
      await s.page.click('#add-riders-btn');
      assert.equal(await s.page.$eval('#rider-sheet', el => el.hidden), false);
      assert.equal(s.page.__pageError, undefined, c.name);
    } finally { await s.context.close(); }
  }
});

// ---- S101: storage isolation ----

test('S101: pastFollowedNames reads ee:<key> follow lists; evictOtherEventCaches drops other events\' caches but keeps every :riders list and this event\'s cache', async () => {
  await publish();
  const s = await openSnap({
    riders: null,
    localStorage: {
      'sc:ee:other:riders': JSON.stringify(['Ada Tester']),
      'sc:1187:riders': JSON.stringify(['Bea Sample']),
      'sc:ee:other:event': JSON.stringify({ at: 1, value: { EntryList: [] } }),
      'sc:ee:other:scoring': JSON.stringify({ at: 1, value: {} }),
      'sc:1187:event': JSON.stringify({ at: 1, value: { EntryList: [] } }),
      'sc:ee:other:k': 'SOMETOKEN1234',
    },
  });
  try {
    await s.page.click('#add-riders-btn');
    const r = await s.page.evaluate(() => ({
      past: [...pastFollowedNames()].sort(),
      sheet: document.getElementById('rider-results').textContent.replace(/\s+/g, ' ').trim(),
      keys: Object.keys(localStorage).filter(k => k.startsWith('sc:')).sort(),
    }));
    assert.deepEqual(r.past, ['Ada Tester', 'Bea Sample']);
    assert.match(r.sheet, /FOLLOWED AT OTHER EVENTS.*Ada Tester.*Bea Sample/);
    assert.deepEqual(r.keys, [
      'sc:1187:riders', 'sc:ee:TestKey01:event', 'sc:ee:TestKey01:k', 'sc:ee:other:k',
      'sc:ee:other:riders', 'sc:last-event',
    ]);
  } finally { await s.context.close(); }
});
