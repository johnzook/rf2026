'use strict';
// Shared test harness: local http server for index.html, one chromium per
// test file (playwright-core, system chromium — never `playwright install`),
// per-test contexts with both API routes stubbed and the clock pinned.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const INDEX_HTML = fs.readFileSync(INDEX_PATH, 'utf8');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

// Epoch ms for a given event-local (America/Denver) wall-clock time.
// All fixtures are in July 2026, i.e. MDT = UTC-6, so this is exact.
function denverMs(y, m, d, h = 0, min = 0, sec = 0) {
  return Date.UTC(y, m - 1, d, h + 6, min, sec);
}

// Default pinned "now": Sat Jul 18 2026, 12:00 event-local. Deliberately
// NOT the baked DELAY_DATE (2026-07-17), so venue delays stay inert
// unless a test opts into the delay day.
const DEFAULT_NOW = denverMs(2026, 7, 18, 12, 0, 0);

// ---- Local server for the page itself (mutable bytes for deploy tests) ----

function startServer() {
  let pageBytes = INDEX_HTML;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(pageBytes);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        setPage: bytes => { pageBytes = bytes; },
        reset: () => { pageBytes = INDEX_HTML; },
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

// ---- Deterministic clock ----
// Replaces Date so that zero-arg `new Date()` / `Date.now()` return a fixed
// instant, while component/epoch constructors pass through untouched. This
// pins both eventLocalNow() (Intl over `new Date()`) and staleness math
// (Date.now) without touching page code. window.__setNow(ms) advances it.

function clockScript(fixedMs) {
  return `(() => {
    const RealDate = Date;
    let nowMs = ${fixedMs};
    class FakeDate extends RealDate {
      constructor(...args) { args.length ? super(...args) : super(nowMs); }
      static now() { return nowMs; }
    }
    Object.defineProperty(window, 'Date', { value: FakeDate, writable: true, configurable: true });
    window.__setNow = ms => { nowMs = ms; };
    // Kill the polling/re-render intervals so tests fully own when fetches
    // and renders happen (the initial direct calls still run).
    window.__realSetInterval = window.setInterval.bind(window);
    window.setInterval = () => 0;
  })();`;
}

// ---- Browser lifecycle (one per test file / process) ----

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  }
  return browserPromise;
}
async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

const CORS = { 'access-control-allow-origin': '*' };

// Open the app in a fresh context.
//   feed / scoring : fixture objects served by the stubbed API routes
//   now            : epoch ms for the pinned clock (default Sat Jul 18 12:00 MDT)
//   timezoneId     : browser timezone (default UTC — proves TZ independence)
//   localStorage   : {key: string} seeded before page scripts run
//   network        : 'ok' (default) | 'abort' (fetches fail) | 'stall' (never answer)
//   server         : a startServer() handle (required)
//   url            : override target URL (e.g. file://)
//   waitLoaded     : wait for the initial event fetch + network idle (default true)
async function openPage(opts) {
  const {
    feed = { EntryList: [] },
    scoring = { DivisionsList: [], ScoringList: [] },
    now = DEFAULT_NOW,
    timezoneId = 'UTC',
    localStorage: lsItems = null,
    network = 'ok',
    server,
    url = server && server.url,
    viewport = { width: 420, height: 800 },
    waitLoaded = network === 'ok',
  } = opts;

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport, timezoneId });
  await context.addInitScript(clockScript(now));
  if (lsItems) {
    await context.addInitScript(items => {
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, lsItems);
  }

  const serve = body => async route => {
    if (network === 'abort') return route.abort('failed');
    if (network === 'stall') return; // leave the request hanging forever
    return route.fulfill({ contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
  };
  await context.route('**/api/sc/event/1187', serve(feed));
  await context.route('**/api/sc/event/1187/scoringLive', serve(scoring));

  const page = await context.newPage();
  page.on('pageerror', e => { page.__pageError = e; });
  await page.goto(url);
  if (waitLoaded) {
    // lastUpdatedMs is set synchronously with rides+render, so once visible
    // the event fetch is fully applied; networkidle then covers scoring.
    await page.waitForFunction(() => lastUpdatedMs !== null);
    await page.waitForLoadState('networkidle');
  }
  return { context, page };
}

// Convenience: cache blobs in the exact format cachePut writes.
function cacheBlob(atMs, value) {
  return JSON.stringify({ at: atMs, value });
}

const rowTexts = page => page.$$eval('#list .row', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));

// Snapshot of the rendered row for a given pinny (rows show "#<pinny>").
function rowInfo(page, pinny) {
  return page.evaluate(pinny => {
    const rows = [...document.querySelectorAll('#list .row')];
    const el = rows.find(r => {
      const b = r.querySelector('.horse b');
      return b && b.textContent === '#' + pinny;
    });
    if (!el) return null;
    const cd = el.querySelector('.countdown');
    const est = el.querySelector('.est');
    const clean = s => s.replace(/\s+/g, ' ').trim();
    return {
      index: rows.indexOf(el),
      classes: [...el.classList],
      adj: el.querySelector('.adj') ? el.querySelector('.adj').textContent : null,
      orig: el.querySelector('.orig') ? el.querySelector('.orig').textContent : null,
      countdown: cd ? clean(cd.textContent) : null,
      countdownClasses: cd ? [...cd.classList] : null,
      est: est ? clean(est.textContent) : null,
      nextTag: el.querySelector('.next-tag') ? el.querySelector('.next-tag').textContent : null,
      pop: el.querySelector('.pop') ? clean(el.querySelector('.pop').textContent) : null,
      opacity: getComputedStyle(el).opacity,
      borderColor: getComputedStyle(el).borderTopColor,
    };
  }, pinny);
}

const chipLabels = page => page.$$eval('#days .day-chip', els =>
  els.map(b => b.textContent + (b.classList.contains('active') ? '*' : '')));

module.exports = {
  INDEX_PATH, INDEX_HTML, startServer, denverMs, DEFAULT_NOW, clockScript,
  getBrowser, closeBrowser, openPage, cacheBlob, rowTexts, rowInfo, chipLabels,
};
