'use strict';
// TESTPLAN P66–P71: URL-based event selection, the picker view (calendar
// sections, filter, manual entry) and the calendar cache.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer, openPage, openPicker, closeBrowser, DEFAULT_NOW, cacheBlob,
} = require('./helpers');
const F = require('./fixtures/builders');

let server;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); await closeBrowser(); });

const pickerRows = page => page.$$eval('#picker-list .erow', els => els.map(e => ({
  id: e.dataset.id,
  name: e.querySelector('.ename').textContent,
  meta: e.querySelector('.emeta').textContent,
  note: e.querySelector('.enote') ? e.querySelector('.enote').textContent : null,
})));
const sectionLabels = page => page.$$eval('#picker-list .psec', els => els.map(e => e.textContent));

test('P66: bare URL with no last-event shows the picker; app chrome hidden; title set', async () => {
  const s = await openPicker({ server });
  try {
    const r = await s.page.evaluate(() => ({
      picker: document.getElementById('picker').hidden,
      header: document.querySelector('header').hidden,
      main: document.querySelector('main').hidden,
      footer: document.querySelector('footer').hidden,
      title: document.title,
    }));
    assert.deepEqual(r, {
      picker: false, header: true, main: true, footer: true,
      title: 'Choose an event — Ride Times',
    });
    assert.equal(s.page.__pageError, undefined);
  } finally { await s.context.close(); }
});

test('P66: ?choose forces the picker even with sc:last-event set; invalid ?event falls to the picker too', async () => {
  const s = await openPicker({ server, path: '?choose', localStorage: { 'sc:last-event': '1187' } });
  try {
    assert.equal(await s.page.$eval('#picker', el => el.hidden), false);
    assert.equal(await s.page.$eval('header', el => el.hidden), true);
  } finally { await s.context.close(); }

  for (const bad of ['?event=abc', '?event=12x', '?event=']) {
    const b = await openPicker({ server, path: bad, localStorage: { 'sc:last-event': '1187' } });
    try {
      assert.equal(await b.page.$eval('#picker', el => el.hidden), false, `${bad} shows the picker`);
      assert.equal(b.page.__pageError, undefined);
    } finally { await b.context.close(); }
  }
});

test('P66: bare URL with sc:last-event auto-loads that event and canonicalizes the URL; sc:last-event written on event loads; switch-event goes to ?choose', async () => {
  const s = await openPage({ server, url: server.url, localStorage: { 'sc:last-event': '1187' } });
  try {
    const r = await s.page.evaluate(() => ({
      search: location.search,
      picker: document.getElementById('picker').hidden,
      header: document.querySelector('header').hidden,
      last: localStorage.getItem('sc:last-event'),
    }));
    assert.equal(r.search, '?event=1187', 'replaceState upgraded the bare URL');
    assert.equal(r.picker, true);
    assert.equal(r.header, false);
    assert.equal(r.last, '1187', 'last-event refreshed');

    // "switch event" is a full navigation to ?choose (the picker).
    await Promise.all([
      s.page.waitForNavigation(),
      s.page.click('#switch-event'),
    ]);
    await s.page.waitForSelector('#picker', { state: 'visible' });
    assert.equal(new URL(s.page.url()).search, '?choose');
  } finally { await s.context.close(); }

  // A direct ?event load writes sc:last-event too.
  const d = await openPage({ server });
  try {
    assert.equal(await d.page.evaluate(() => localStorage.getItem('sc:last-event')), '1187');
  } finally { await d.context.close(); }
});

test('P67: sections render from the calendar by CalendarPosition; empty sections omitted; unpublished-entries note shown', async () => {
  // Fixture as-is: no pos-1 events -> only Upcoming + Recent.
  const s = await openPicker({ server });
  try {
    await s.page.waitForSelector('#picker-list .erow');
    assert.deepEqual(await sectionLabels(s.page), ['Upcoming', 'Recent'],
      'empty "Happening now" section omitted');
    const rows = await pickerRows(s.page);
    assert.deepEqual(rows.map(r => r.id),
      ['1211', '1212', '1188', '1214', '1187', '1209', '1221', '1220'],
      'calendar order preserved within sections');
    const rebecca = rows.find(r => r.id === '1187');
    assert.equal(rebecca.name, 'The Event at Rebecca Farm');
    assert.equal(rebecca.meta, 'Jul 15 - Jul 19, 2026 · Rebecca Farm, Kalispell, Montana');
    assert.equal(rebecca.note, null, 'published entries: no note');
    const beat = rows.find(r => r.id === '1211');
    assert.equal(beat.note, 'entries not published yet', 'PublishEntryList=false flagged');
  } finally { await s.context.close(); }

  // A pos-1 event earns the "Happening now" section, listed first.
  const cal = F.calendar();
  cal.find(e => e.ShowConnectId === 1187).CalendarPosition = 1;
  const h = await openPicker({ server, calendar: cal });
  try {
    await h.page.waitForSelector('#picker-list .erow');
    assert.deepEqual(await sectionLabels(h.page), ['Happening now', 'Upcoming', 'Recent']);
    assert.equal((await pickerRows(h.page))[0].id, '1187', 'happening-now event first');
  } finally { await h.context.close(); }
});

test('P67: Recent section caps at 15 events; searching uncaps it', async () => {
  const cal = Array.from({ length: 20 }, (_, i) => ({
    ShowConnectId: 2000 + i,
    EventName: `Past Event ${String(i).padStart(2, '0')}`,
    EventDate: 'Jun 2026', EventLocation: 'Somewhere, Ohio',
    PublishEntryList: true, CalendarPosition: 3,
  }));
  const s = await openPicker({ server, calendar: cal });
  try {
    await s.page.waitForSelector('#picker-list .erow');
    assert.equal((await pickerRows(s.page)).length, 15, 'Recent capped at 15');

    await s.page.fill('#picker-search', 'past event');
    assert.equal((await pickerRows(s.page)).length, 20, 'search reaches past the cap');
    await s.page.fill('#picker-search', 'past event 19');
    assert.deepEqual((await pickerRows(s.page)).map(r => r.id), ['2019'],
      'the capped-out event is reachable by search');
  } finally { await s.context.close(); }
});

test('P68: filter matches name or location, case-insensitively; no-match message', async () => {
  const s = await openPicker({ server });
  try {
    await s.page.waitForSelector('#picker-list .erow');

    await s.page.fill('#picker-search', 'REBECCA');
    assert.deepEqual((await pickerRows(s.page)).map(r => r.id), ['1187'], 'name match, case-insensitive');

    await s.page.fill('#picker-search', 'loon lake');
    assert.deepEqual((await pickerRows(s.page)).map(r => r.id), ['1211', '1212'], 'location match');

    await s.page.fill('#picker-search', 'onalaska');
    assert.deepEqual(await sectionLabels(s.page), ['Recent'], 'sections without hits vanish');

    await s.page.fill('#picker-search', 'zzz-nothing');
    assert.equal(await s.page.$eval('#picker-list .empty', el => el.textContent), 'No events match.');

    await s.page.fill('#picker-search', '');
    assert.equal((await pickerRows(s.page)).length, 8, 'clearing restores all');
  } finally { await s.context.close(); }
});

test('P69: clicking an event row navigates to ?event=<id> and lands in the event view', async () => {
  const s = await openPicker({ server });
  try {
    await s.page.waitForSelector('#picker-list .erow');
    await Promise.all([
      s.page.waitForNavigation(),
      s.page.click('.erow[data-id="1187"]'),
    ]);
    await s.page.waitForFunction(() => typeof lastUpdatedMs !== 'undefined' && lastUpdatedMs !== null);
    const r = await s.page.evaluate(() => ({
      search: location.search,
      picker: document.getElementById('picker').hidden,
      header: document.querySelector('header').hidden,
    }));
    assert.equal(r.search, '?event=1187');
    assert.equal(r.picker, true, 'picker hidden in event view');
    assert.equal(r.header, false);
  } finally { await s.context.close(); }
});

test('P70: manual entry accepts a numeric id or a pasted showconnect URL; Enter submits; invalid input errors in place', async () => {
  // Numeric id, submitted via the Go button.
  let s = await openPicker({ server, eventId: 1211 });
  try {
    await s.page.fill('#picker-manual', ' 1211 ');
    await Promise.all([s.page.waitForNavigation(), s.page.click('#picker-go')]);
    assert.equal(new URL(s.page.url()).search, '?event=1211');
  } finally { await s.context.close(); }

  // Pasted showconnect.org URL containing ShowConnectId=NNN, via Enter.
  s = await openPicker({ server });
  try {
    await s.page.fill('#picker-manual',
      'https://showconnect.org/EventPage?foo=1&ShowConnectId=1187&bar=2');
    await Promise.all([s.page.waitForNavigation(), s.page.press('#picker-manual', 'Enter')]);
    assert.equal(new URL(s.page.url()).search, '?event=1187');
  } finally { await s.context.close(); }

  // Invalid input: error message, no navigation.
  s = await openPicker({ server });
  try {
    const urlBefore = s.page.url();
    await s.page.fill('#picker-manual', 'not an id');
    await s.page.click('#picker-go');
    assert.equal(await s.page.$eval('#manual-err', el => el.hidden), false);
    assert.equal(await s.page.$eval('#manual-err', el => el.textContent),
      'Enter a numeric ShowConnectId or a showconnect.org link.');
    assert.equal(s.page.url(), urlBefore, 'stayed on the picker');

    // A later valid entry clears the error and navigates.
    await s.page.fill('#picker-manual', '1187');
    await Promise.all([s.page.waitForNavigation(), s.page.click('#picker-go')]);
    assert.equal(new URL(s.page.url()).search, '?event=1187');

    // Unit probes for the parser.
    const p = await s.page.evaluate(() => [
      parseManualEvent('1187'),
      parseManualEvent('  42  '),
      parseManualEvent('https://showconnect.org/x?showconnectid=77'), // case-insensitive
      parseManualEvent('ShowConnectId=5&other=6'),
      parseManualEvent('12.5'),
      parseManualEvent('id 1187 maybe'),
      parseManualEvent(''),
      parseManualEvent(null),
    ]);
    assert.deepEqual(p, [1187, 42, 77, 5, null, null, null, null]);
  } finally { await s.context.close(); }
});

test('P71: calendar fetch failure with no cache — error note, manual entry still works', async () => {
  const s = await openPicker({ server, network: 'abort' });
  try {
    await s.page.waitForSelector('#picker-err', { state: 'visible' });
    assert.equal(await s.page.$eval('#picker-err', el => el.textContent),
      "Can't reach the ShowConnect calendar — you can still enter an event ID below.");
    assert.equal(await s.page.$eval('#picker-list .empty', el => el.textContent), 'No events loaded.');
    assert.equal(s.page.__pageError, undefined);

    // Manual entry is the escape hatch (the event feed also fails here —
    // the event view still boots fail-soft on its own URL).
    await s.page.fill('#picker-manual', '1187');
    await Promise.all([s.page.waitForNavigation(), s.page.click('#picker-go')]);
    assert.equal(new URL(s.page.url()).search, '?event=1187');
  } finally { await s.context.close(); }
});

test('P71: a stale cached calendar renders while offline, with the saved-list note', async () => {
  const s = await openPicker({
    server, network: 'abort',
    localStorage: { 'sc:calendar': cacheBlob(DEFAULT_NOW - 7 * 3600_000, F.calendar()) },
  });
  try {
    await s.page.waitForSelector('#picker-list .erow');
    assert.equal((await pickerRows(s.page)).length, 8, 'stale cache rendered');
    await s.page.waitForSelector('#picker-err', { state: 'visible' });
    assert.equal(await s.page.$eval('#picker-err', el => el.textContent),
      "Can't reach the ShowConnect calendar — showing a saved list.");
  } finally { await s.context.close(); }
});

test('P71: a fresh cached calendar (within TTL) renders without refetching', async () => {
  const cachedOnly = [{
    ShowConnectId: 4242, EventName: 'Cached Only Event',
    EventDate: 'Jul 2026', EventLocation: 'Cache, Utah',
    PublishEntryList: true, CalendarPosition: 2,
  }];
  const s = await openPicker({
    server,
    calendar: F.calendar(), // would serve 8 events IF fetched
    localStorage: { 'sc:calendar': cacheBlob(DEFAULT_NOW - 60_000, cachedOnly) },
  });
  try {
    await s.page.waitForLoadState('networkidle');
    const rows = await pickerRows(s.page);
    assert.deepEqual(rows.map(r => r.name), ['Cached Only Event'],
      'rendered the fresh cache; the stub payload never replaced it');
    assert.equal(await s.page.$eval('#picker-err', el => el.hidden), true, 'no error note');
  } finally { await s.context.close(); }
});

test('P71: degenerate calendar payloads never throw and never clobber a good cache', async () => {
  // A null response body with no cache: clean "No events loaded." state.
  const s = await openPicker({ server, calendar: null });
  try {
    await s.page.waitForSelector('#picker-err', { state: 'visible' });
    assert.equal(s.page.__pageError, undefined, 'null payload did not crash');
    assert.equal(await s.page.$eval('#picker-list .empty', el => el.textContent), 'No events loaded.');

    // sanitizeCalendar unit probes across degenerate shapes.
    const r = await s.page.evaluate(() => ({
      nul: sanitizeCalendar(null),
      num: sanitizeCalendar(42),
      str: sanitizeCalendar('nope'),
      obj: sanitizeCalendar({ ShowConnectId: 1 }),
      junk: sanitizeCalendar([
        null, 42, 'x', {},
        { ShowConnectId: 'abc' },              // non-numeric id -> dropped
        { ShowConnectId: '123' },              // digit string id -> kept, defaults filled
        { ShowConnectId: 7, EventName: 8, EventDate: null, EventLocation: 9,
          CalendarPosition: 9, PublishEntryList: false },
      ]),
    }));
    assert.deepEqual(r.nul, []);
    assert.deepEqual(r.num, []);
    assert.deepEqual(r.str, []);
    assert.deepEqual(r.obj, []);
    assert.deepEqual(r.junk, [
      { id: 123, name: 'Event 123', date: '', location: '', pos: 3, entries: true },
      { id: 7, name: 'Event 7', date: '', location: '', pos: 3, entries: false },
    ]);
  } finally { await s.context.close(); }

  // With a good list already loaded, a degenerate response is ignored: the
  // rendered list and the stored cache both survive.
  const g = await openPicker({ server });
  try {
    await g.page.waitForSelector('#picker-list .erow');
    await g.context.route('**/api/sc/event', r => r.fulfill({
      contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: 'null',
    }));
    await g.page.evaluate(() => fetchCalendar());
    assert.equal((await pickerRows(g.page)).length, 8, 'good list kept');
    assert.equal(await g.page.$eval('#picker-err', el => el.hidden), true,
      'no error while a good list is shown');
    const cache = await g.page.evaluate(() => JSON.parse(localStorage.getItem('sc:calendar')));
    assert.equal(cache.value.length, 8, 'cache not clobbered by the null payload');
    assert.equal(g.page.__pageError, undefined);
  } finally { await g.context.close(); }
});
