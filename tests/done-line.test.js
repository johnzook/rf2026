'use strict';
// TESTPLAN group H (done-line on completed rides).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, rowInfo } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);
const rd = (phase, venue, m, d, h, min) =>
  F.ridingDetail({ phase, venue, time: F.rideTimeStr(2026, m, d, h, min) });

// One combo per scenario, all in division 'DD' (id 30). Now = Sat 12:00.
function doneFeed() {
  return F.feed([
    // H31a: XC done at 8:00, rides SJ at 15:00, placed.
    F.entry({ pinny: 660, rider: F.FOLLOWED.zook, division: 'DD',
      details: [rd('Cross Country', 'XC', 7, 18, 8, 0), rd('Show Jumping', 'SJR1', 7, 18, 15, 0)] }),
    // H31b: SJ done at 9:00, nothing later, placed -> finished.
    F.entry({ pinny: 661, rider: F.FOLLOWED.aulita, division: 'DD',
      details: [rd('Show Jumping', 'SJR1', 7, 18, 9, 0)] }),
    // H32a: dressage done, no scoring row, XC later.
    F.entry({ pinny: 662, rider: F.FOLLOWED.crocker, division: 'DD',
      details: [rd('Dressage', 'R4', 7, 18, 8, 30), rd('Cross Country', 'XC', 7, 18, 16, 0)] }),
    // H32b: dressage done, no scoring row, nothing later.
    F.entry({ pinny: 663, rider: F.FOLLOWED.grandia, division: 'DD',
      details: [rd('Dressage', 'R4', 7, 18, 8, 35)] }),
    // H32c: XC done, phase place posted but FinalPlace missing, nothing later.
    F.entry({ pinny: 664, rider: F.FOLLOWED.mcmahan, division: 'DD',
      details: [rd('Cross Country', 'XC', 7, 18, 8, 5)] }),
    // H33a: eliminated ON this ride, no places at all.
    F.entry({ pinny: 665, rider: F.FOLLOWED.corkery, division: 'DD',
      details: [rd('Cross Country', 'XC', 7, 18, 8, 10)] }),
    // H33b: dressage place posted, withdrawn afterwards.
    F.entry({ pinny: 666, rider: F.FOLLOWED.yakovac, division: 'DD',
      details: [rd('Dressage', 'R4', 7, 18, 8, 40)] }),
    // H34: dressage 8:00 and XC 10:00 both already run; SJ tomorrow 15:00.
    F.entry({ pinny: 667, rider: F.FOLLOWED.braitling, division: 'DD',
      details: [rd('Dressage', 'R4', 7, 18, 8, 0), rd('Cross Country', 'XC', 7, 18, 10, 0),
                rd('Show Jumping', 'SJR1', 7, 19, 15, 0)] }),
    // H31c: SJ done, division EE fully complete -> finished.
    F.entry({ pinny: 668, rider: F.FOLLOWED.zook, division: 'EE',
      details: [rd('Show Jumping', 'SJR1', 7, 18, 9, 30)] }),
  ]);
}

function doneScoring() {
  return F.scoring({
    divisions: [F.division({ id: 30, name: 'DD' }), F.division({ id: 31, name: 'EE' })],
    rows: [
      // Division EE: every still-competing combo has its final phase (SJ)
      // posted, so EE is complete; the retired row's missing SJ is ignored.
      F.scoringRow({ pinny: 668, divisionId: 31, sjScore: '30.0', sjPlace: '2', finalPoints: '30.0', finalPlace: '2' }),
      F.scoringRow({ pinny: 669, divisionId: 31, sjScore: '28.0', sjPlace: '1', finalPoints: '28.0', finalPlace: '1' }),
      F.scoringRow({ pinny: 670, divisionId: 31, finalPlace: 'R' }),
      F.scoringRow({ pinny: 660, divisionId: 30, xcScore: '33.8', xcPlace: '3', finalPoints: '33.8', finalPlace: '2' }),
      F.scoringRow({ pinny: 661, divisionId: 30, sjScore: '28.0', sjPlace: '1', finalPoints: '28.0', finalPlace: '1' }),
      // 662, 663: no scoring rows at all.
      F.scoringRow({ pinny: 664, divisionId: 30, xcScore: '40.0', xcPlace: '3', finalPlace: '--' }),
      F.scoringRow({ pinny: 665, divisionId: 30, finalPlace: 'E' }),
      F.scoringRow({ pinny: 666, divisionId: 30, dressageScore: '35.2', dressagePlace: '14', finalPlace: 'W' }),
      F.scoringRow({ pinny: 667, divisionId: 30, dressagePlace: '5', xcPlace: '4', finalPlace: '4' }),
    ],
  });
}

test('H31: done rides show ✓ phase place + currently/finished overall + next ride', async () => {
  const s = await openPage({ server, feed: doneFeed(), scoring: doneScoring(), now: NOON });
  try {
    const stillRiding = await rowInfo(s.page, 660);
    assert.equal(stillRiding.countdown, '✓ XC T3rd · currently 2nd overall · next: SJ 3:00 PM',
      'shared phase place gets a T prefix');
    // 661 is done riding but a competitor in DD still jumps at 3:00 PM, so
    // the division isn't final — "currently", never "finished", until the
    // last rider of the division's final phase has a posted score.
    const doneButDivisionLive = await rowInfo(s.page, 661);
    assert.equal(doneButDivisionLive.countdown, '✓ SJ 1st · currently 1st overall');
    // 668's division EE has all active final-phase scores posted -> finished.
    const finished = await rowInfo(s.page, 668);
    assert.equal(finished.countdown, '✓ SJ 2nd · finished 2nd overall');
  } finally { await s.context.close(); }
});

test('H32: scores pending / event complete wording', async () => {
  const s = await openPage({ server, feed: doneFeed(), scoring: doneScoring(), now: NOON });
  try {
    assert.equal((await rowInfo(s.page, 662)).countdown, '✓ scores pending · next: XC 4:00 PM');
    assert.equal((await rowInfo(s.page, 663)).countdown, '✓ scores pending · event complete');
    assert.equal((await rowInfo(s.page, 664)).countdown, '✓ XC T3rd · event complete',
      'phase place without overall still gets event complete');
  } finally { await s.context.close(); }
});

test('H33: out on this ride -> bare status; out later with places -> ✓ place · status', async () => {
  const s = await openPage({ server, feed: doneFeed(), scoring: doneScoring(), now: NOON });
  try {
    assert.equal((await rowInfo(s.page, 665)).countdown, 'eliminated', 'no checkmark without a result');
    assert.equal((await rowInfo(s.page, 666)).countdown, '✓ Dressage 14th · withdrawn');
  } finally { await s.context.close(); }
});

test('H34: next: points at the combo\'s next ride from NOW, override-aware, weekday off-today', async () => {
  const s = await openPage({ server, feed: doneFeed(), scoring: doneScoring(), now: NOON });
  try {
    // Dressage row (8:00) must skip the already-run XC (10:00) and point at
    // tomorrow's SJ, with a weekday label.
    const dressage = await rowInfo(s.page, 667);
    assert.equal(dressage.countdown, '✓ Dressage 5th · currently 4th overall · next: SJ Sun 3:00 PM');
    // XC row says the same next.
    const xcRows = await s.page.evaluate(() => {
      const rows = [...document.querySelectorAll('#list .row')];
      const el = rows.filter(r => { const b = r.querySelector('.horse b'); return b && b.textContent === '#667'; });
      return el.map(r => r.querySelector('.countdown').textContent);
    });
    assert.ok(xcRows[1].endsWith('next: SJ Sun 3:00 PM'), xcRows[1]);

    // An override on the next ride moves the advertised time.
    await s.page.evaluate(() => {
      OVERRIDE_IDX['667|Show Jumping'] = new Date(2026, 6, 19, 16, 0);
      rides = extractRides(lastFeed);
      render();
    });
    assert.ok((await rowInfo(s.page, 667)).countdown.endsWith('next: SJ Sun 4:00 PM'));

    // Unit check of nextRideInfo directly: nothing later -> null.
    const none = await s.page.evaluate(() => nextRideInfo({ pinny: 661 }, eventLocalNow()));
    assert.equal(none, null);
  } finally { await s.context.close(); }
});

test('H35: donePlaces maps DressagePlace/XCPlace/SJPlace + FinalPlace with ordinals', async () => {
  const s = await openPage({ server, feed: F.feed([]), waitLoaded: false });
  try {
    await s.page.waitForFunction(() => lastUpdatedMs !== null);
    const r = await s.page.evaluate(() => {
      resultsIdx = { '670|D': { DressagePlace: '11', XCPlace: '2', SJPlace: '3', FinalPlace: '4' } };
      const mk = phase => ({ pinny: 670, division: 'D', phase });
      return {
        dressage: donePlaces(mk('Dressage'), false),
        xc: donePlaces(mk('Cross Country'), false),
        sjFinal: donePlaces(mk('Show Jumping'), true),
        missing: donePlaces({ pinny: 999, division: 'D', phase: 'Dressage' }, false),
      };
    });
    assert.deepEqual(r.dressage, { phase: 'Dressage 11th', overall: 'currently 4th overall' });
    assert.deepEqual(r.xc, { phase: 'XC 2nd', overall: 'currently 4th overall' });
    assert.deepEqual(r.sjFinal, { phase: 'SJ 3rd', overall: 'finished 4th overall' });
    assert.deepEqual(r.missing, { phase: null, overall: null });
  } finally { await s.context.close(); }
});

test('H36: previous-day rows keep full brightness with gray done styling; today\'s dim + pin restores', async () => {
  const feed = F.feed([
    F.entry({ pinny: 668, rider: F.FOLLOWED.zook, division: 'DD',
      details: [rd('Dressage', 'R4', 7, 17, 9, 0), rd('Cross Country', 'XC', 7, 18, 8, 0)] }),
  ]);
  const s = await openPage({ server, feed, scoring: doneScoring(), now: NOON });
  try {
    // Today's done row (XC 8:00): dimmed via .past; pin restores opacity.
    let today = await rowInfo(s.page, 668);
    assert.ok(today.classes.includes('past'));
    assert.ok(today.countdownClasses.includes('done'));
    assert.equal(today.opacity, '0.55');
    await s.page.click('#list .row', { position: { x: 10, y: 10 } });
    today = await rowInfo(s.page, 668);
    assert.ok(today.classes.includes('pinned'));
    assert.equal(today.opacity, '1', 'tap restores full opacity (popover readable)');

    // Yesterday's row: countdown styled done but NO .past dim class.
    await s.page.click('#days .day-chip:first-child');
    const yesterday = await rowInfo(s.page, 668);
    assert.ok(!yesterday.classes.includes('past'), 'previous-day rows are not dimmed');
    assert.ok(yesterday.countdownClasses.includes('done'), 'gray done-line styling');
    assert.equal(yesterday.opacity, '1');
    assert.match(yesterday.countdown, /^✓ /);
  } finally { await s.context.close(); }
});
