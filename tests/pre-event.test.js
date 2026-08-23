'use strict';
// TESTPLAN group Q (pre-event UX): the pre-schedule roster (item 83) and
// status/controls updating on every render path (item 84). Pre-event feeds
// mirror the real shape verified against event 1190: entries present, every
// RidingDetails[].RideTimes "" and every PinnyNumber null. Event id 1190 is
// used so no EVENT_CONFIGS block (extras/delays) interferes.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openPage, closeBrowser, denverMs, cacheBlob } = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const NOON = denverMs(2026, 7, 18, 12, 0);
const PRE_EVENT_ID = 1190;
const LEAD_IN = "Ride times aren't posted yet — they'll appear here automatically once ShowConnect publishes the schedule.";

const preEntry = (rider, horse, opts = {}) => F.entry({
  pinny: null, rider, horse,
  division: opts.division || 'Open Beginner Novice B',
  divisionShort: opts.divisionShort || 'OBNB',
  status: opts.status || 'Accepted',
  details: F.unscheduledDetails(),
  ...('pinny' in opts ? { pinny: opts.pinny } : {}),
});

// Snapshot of the pre-schedule view.
const preState = page => page.evaluate(() => ({
  leadIn: (el => el && el.textContent)(document.querySelector('#list .pre-note.lead-in')),
  note: (el => el && el.textContent)(document.querySelector('#list .office-note')),
  cards: [...document.querySelectorAll('#list .row.roster')].map(el => ({
    // Card text without the popover's (display:none until pinned/hover).
    text: (c => { const p = c.querySelector('.pop'); if (p) p.remove(); return c.textContent.replace(/\s+/g, ' ').trim(); })(el.cloneNode(true)),
    pop: (p => p && [...p.querySelectorAll('h3, .pop-sub, td')]
      .map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '))(el.querySelector('.pop')),
    out: el.classList.contains('out'),
    opacity: getComputedStyle(el).opacity,
    pinnyBold: (b => b && b.textContent)(el.querySelector('.horse b')),
    short: (p => p && p.textContent)(el.querySelector('.phase')),
    division: (v => v && v.textContent)(el.querySelector('.venue')),
  })),
  chips: document.querySelectorAll('#days .day-chip').length,
  status: document.getElementById('status').textContent,
  label: document.getElementById('edit-riders').textContent,
  nowBtnHidden: document.getElementById('now-btn').hidden,
}));

test('83/84: pre-event load with followed riders — roster + lead-in, no chips, status Updated (not "Loading…")', async () => {
  const feed = F.feed([
    preEntry(F.FOLLOWED.zook, 'Eddy'),
    preEntry(F.FOLLOWED.aulita, 'Ellie', { division: 'Open Preliminary A', divisionShort: 'OPA' }),
    preEntry('Unfollowed, Rider', 'Other Horse'),
  ]);
  const s = await openPage({
    server, feed, eventId: PRE_EVENT_ID, now: NOON,
    riders: [F.FOLLOWED.zook, F.FOLLOWED.aulita],
  });
  try {
    assert.equal(s.page.__pageError, undefined);
    const r = await preState(s.page);
    assert.equal(r.leadIn, LEAD_IN);
    assert.equal(r.note, null, 'no Event notes line without an OfficeComment');
    assert.equal(r.chips, 0, 'no day chips pre-schedule');
    assert.equal(r.cards.length, 2, 'only followed entries get cards');
    assert.equal(r.cards[0].text, 'Zook, Penelope Eddy OBNB Open Beginner Novice B');
    assert.equal(r.cards[0].short, 'OBNB');
    assert.equal(r.cards[0].division, 'Open Beginner Novice B');
    assert.equal(r.cards[0].pinnyBold, null, 'null pinny → no #pinny');
    assert.equal(r.cards[0].out, false);
    assert.equal(r.cards[1].text, 'Aulita, Brittany Ellie OPA Open Preliminary A');
    // THE regression: the early return used to leave the static "Loading…".
    assert.equal(r.status, 'Updated 12:00 PM');
    assert.equal(r.label, '＋ my riders (2)', 'header shows the live follow count');
    assert.equal(r.nowBtnHidden, true);
  } finally { await s.context.close(); }
});

test('83: roster details — stored-list then feed order, scratched dimmed + annotated, ghost flagged, pinny shown, OfficeComment escaped', async () => {
  const feed = F.feed([
    // Feed order deliberately differs from stored order; Zook has two horses.
    preEntry(F.FOLLOWED.crocker, 'LS Chez Bond', { status: 'Scratched' }),
    preEntry(F.FOLLOWED.zook, 'Eddy', { pinny: 472 }),
    preEntry(F.FOLLOWED.zook, 'Second Horse'),
    preEntry('Unfollowed, Rider', 'Other Horse'),
  ]);
  feed.EventDetails.OfficeComment = 'Times post <b>Friday</b> & "soon"';
  const s = await openPage({
    server, feed, eventId: PRE_EVENT_ID, now: NOON,
    riders: [F.FOLLOWED.zook, F.FOLLOWED.crocker, 'Ghost, Nobody'],
  });
  try {
    const r = await preState(s.page);
    assert.equal(r.leadIn, LEAD_IN);
    // OfficeComment is untrusted prose: shown verbatim, escaped.
    assert.equal(r.note, 'Event notes: Times post <b>Friday</b> & "soon"');
    assert.equal(await s.page.$('#list .office-note b'), null, 'no element injection');
    assert.equal(r.cards.length, 4);
    // Stored-list order first (zook before crocker), feed order within a rider.
    assert.equal(r.cards[0].text, 'Zook, Penelope Eddy · #472 OBNB Open Beginner Novice B');
    assert.equal(r.cards[0].pinnyBold, '#472', 'non-null pinny rendered bold');
    assert.equal(r.cards[1].text, 'Zook, Penelope Second Horse OBNB Open Beginner Novice B');
    // Scratched: annotated and dimmed via the existing .out treatment.
    assert.equal(r.cards[2].text, 'Crocker, Shelby LS Chez Bond · scratched OBNB Open Beginner Novice B');
    assert.equal(r.cards[2].out, true);
    assert.equal(r.cards[2].opacity, '0.75');
    // Ghost follow: same wording as the sheet annotation.
    assert.equal(r.cards[3].text, 'Ghost, Nobody no entries found');
    assert.equal(r.cards[3].out, true);
    // Only Zook matched an *accepted* entry (scratched/ghost don't count).
    assert.equal(r.status, 'Updated 12:00 PM · 1 of 3 riders found');
  } finally { await s.context.close(); }
});

test('83: roster renders from a warm cache while fully offline', async () => {
  const feed = F.feed([preEntry(F.FOLLOWED.zook, 'Eddy')]);
  const s = await openPage({
    server, eventId: PRE_EVENT_ID, now: NOON, network: 'abort',
    riders: [F.FOLLOWED.zook],
    localStorage: { [`sc:${PRE_EVENT_ID}:event`]: cacheBlob(NOON - 60_000, feed) },
  });
  try {
    await s.page.waitForSelector('#list .pre-note.lead-in');
    await s.page.waitForFunction(() =>
      document.getElementById('fetch-err').textContent !== '');
    const r = await preState(s.page);
    assert.equal(r.leadIn, LEAD_IN);
    assert.equal(r.cards.length, 1);
    assert.equal(r.cards[0].text, 'Zook, Penelope Eddy OBNB Open Beginner Novice B');
    assert.equal(r.status, 'Updated 11:59 AM',
      'status stamped from the cache, not left as Loading…');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('84: adding the first rider from the empty state immediately swaps the prompt for the roster and updates status + header count', async () => {
  const feed = F.feed([preEntry(F.FOLLOWED.zook, 'Eddy')]);
  const s = await openPage({ server, feed, eventId: PRE_EVENT_ID, now: NOON, riders: null });
  try {
    // Empty state first: prompt + adapted status + plain header label.
    let r = await preState(s.page);
    assert.ok(await s.page.$('#add-riders-btn'), 'empty-state prompt shown');
    assert.equal(r.status, 'Updated 12:00 PM · no riders followed yet');
    assert.equal(r.label, '＋ my riders');

    // Add the first rider through the real UI — no reload.
    await s.page.click('#add-riders-btn');
    await s.page.fill('#rider-search', 'zook');
    await s.page.click('#rider-results button.rbtn.add[data-n="Zook, Penelope"]');
    await s.page.click('#sheet-close');

    // The user-reported bug: prompt must swap to the roster AND the status
    // line must update in the same render (it used to stay
    // "no riders followed yet" because the branch returned early).
    r = await preState(s.page);
    assert.equal(await s.page.$('#add-riders-btn'), null, 'prompt gone');
    assert.equal(r.leadIn, LEAD_IN, 'roster shown immediately');
    assert.equal(r.cards.length, 1);
    assert.equal(r.cards[0].text, 'Zook, Penelope Eddy OBNB Open Beginner Novice B');
    assert.equal(r.status, 'Updated 12:00 PM', 'no follow-count suffix when all found');
    assert.equal(r.label, '＋ my riders (1)');
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('84: removing the last rider swaps back to the empty-state prompt with correct status and label', async () => {
  const feed = F.feed([preEntry(F.FOLLOWED.zook, 'Eddy')]);
  const s = await openPage({
    server, feed, eventId: PRE_EVENT_ID, now: NOON, riders: [F.FOLLOWED.zook],
  });
  try {
    assert.equal((await preState(s.page)).label, '＋ my riders (1)');
    await s.page.click('#edit-riders');
    await s.page.click('#my-riders-list button.rm[data-n="Zook, Penelope"]');
    await s.page.click('#sheet-close');
    const r = await preState(s.page);
    assert.ok(await s.page.$('#add-riders-btn'), 'empty-state prompt back');
    assert.equal(r.leadIn, null, 'roster gone');
    assert.equal(r.status, 'Updated 12:00 PM · no riders followed yet');
    assert.equal(r.label, '＋ my riders');
  } finally { await s.context.close(); }
});

test('84: the "No rides on this day" branch updates #status too (regression: early return skipped the status block)', async () => {
  // Scheduled feed on Jul 18 for one followed rider (default 1187 event,
  // nine seeded names → "1 of 9 riders found").
  const feed = F.feed([
    F.entry({ pinny: 720, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON });
  try {
    // Force the rides-exist-but-selected-day-empty branch: an EXTRAS item
    // whose time reads valid while the day chips are built (first
    // parseConfigTime call, two property reads) and invalid for the row
    // pass — a chip-only day. Then poison #status to prove the branch
    // rewrites it.
    const r = await s.page.evaluate(() => {
      let reads = 0;
      const x = { date: '2026-07-25', title: 'chip only', detail: '' };
      Object.defineProperty(x, 'time', { get: () => (++reads <= 2 ? '9:00 AM' : '') });
      EXTRAS.push(x);
      selectedDay = '2026-07-25';
      document.getElementById('status').textContent = 'STALE SENTINEL';
      render();
      return {
        empty: (el => el && el.textContent)(document.querySelector('#list .empty')),
        status: document.getElementById('status').textContent,
        nowBtnHidden: document.getElementById('now-btn').hidden,
      };
    });
    assert.equal(r.empty, 'No rides on this day for the followed riders.');
    assert.equal(r.status, 'Updated 12:00 PM · 1 of 9 riders found',
      'status rewritten by the empty-day branch');
    assert.equal(r.nowBtnHidden, true, 'floating now button cleared too');
  } finally { await s.context.close(); }
});

test('84: header follow-count label tracks the stored list on the normal timeline view', async () => {
  const feed = F.feed([
    F.entry({ pinny: 720, rider: F.FOLLOWED.zook, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 13, 0) })] }),
    F.entry({ pinny: 721, rider: F.FOLLOWED.aulita, details: [
      F.ridingDetail({ phase: 'Dressage', venue: 'R4', time: F.rideTimeStr(2026, 7, 18, 14, 0) })] }),
  ]);
  const s = await openPage({ server, feed, now: NOON }); // nine seeded names
  try {
    const label = () => s.page.$eval('#edit-riders', el => el.textContent);
    assert.equal(await label(), '＋ my riders (9)');
    // Remove one via the sheet: label follows without a reload.
    await s.page.click('#edit-riders');
    await s.page.click(`#my-riders-list button.rm[data-n="${F.FOLLOWED.aulita}"]`);
    assert.equal(await label(), '＋ my riders (8)');
    // Adding back through the search (feed-indexed riders only) updates it too.
    await s.page.fill('#rider-search', 'aulita');
    await s.page.click(`#rider-results button.rbtn.add[data-n="${F.FOLLOWED.aulita}"]`);
    assert.equal(await label(), '＋ my riders (9)');
  } finally { await s.context.close(); }
});

test('85: roster cards tap-to-pin a detail popover — division size, ring assignments, stabling, status; pin survives re-render; ghosts have none', async () => {
  const ringed = ['Dressage', 'Cross Country', 'Show Jumping'].map((phase, i) =>
    F.ridingDetail({ phase, venue: ['R4', 'DXC', 'SJR3'][i], time: '' }));
  const feed = F.feed([
    { ...preEntry(F.FOLLOWED.zook, 'Eddy'), RidingDetails: ringed, stableWith: 'Brittany Aulita' },
    preEntry('Peer, One', 'H1'), preEntry('Peer, Two', 'H2'),          // same division: 3 accepted total
    preEntry(F.FOLLOWED.crocker, 'LS Chez Bond', { status: 'Scratched' }),
  ]);
  const s = await openPage({
    server, feed, eventId: PRE_EVENT_ID, now: NOON,
    riders: [F.FOLLOWED.zook, F.FOLLOWED.crocker, 'Ghost, Nobody'],
  });
  try {
    const r = await preState(s.page);
    assert.equal(r.cards.length, 3);
    assert.ok(r.cards[0].pop.includes('Division | Open Beginner Novice B (3 entered)'), r.cards[0].pop);
    assert.ok(r.cards[0].pop.includes('Rings | Dressage R4 · XC DXC · SJ SJR3'), 'phase venues shown pre-times');
    assert.ok(r.cards[0].pop.includes('Stabling with | Brittany Aulita'));
    assert.ok(r.cards[0].pop.includes('Ride times not posted yet'));
    assert.ok(!r.cards[0].pop.includes('Status'), 'accepted entry shows no status row');
    // Scratched card: status row, no rings (null venues), not counted in "entered".
    assert.ok(r.cards[1].pop.includes('Status | scratched'), r.cards[1].pop);
    assert.ok(!r.cards[1].pop.includes('Rings'));
    // Ghost row: no popover, default cursor.
    assert.equal(r.cards[2].pop, null);
    assert.equal(await s.page.$eval('#list .row.roster.out:not(.has-pop)', el =>
      getComputedStyle(el).cursor), 'default');

    // Tap pins; a second tap unpins; the pin survives a poll re-render.
    const card = '#list .row.roster.has-pop';
    await s.page.click(card);
    assert.equal(await s.page.$eval(card, el => el.classList.contains('pinned')), true);
    assert.equal(await s.page.$eval(`${card} .pop`, el => getComputedStyle(el).display), 'block');
    await s.page.evaluate(() => render());
    assert.equal(await s.page.$eval(card, el => el.classList.contains('pinned')), true,
      'pin survives the 20s poll re-render');
    await s.page.click(card);
    assert.equal(await s.page.$eval(card, el => el.classList.contains('pinned')), false);
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});
