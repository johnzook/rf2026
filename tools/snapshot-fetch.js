#!/usr/bin/env node
'use strict';
// Fetch the three evententries pages a snapshot event is built from — the
// show center's "Order of Go" and "General Schedule" tabs and the show's
// "Live Scores" board — exactly as a browser renders them, and save their
// text. Optionally encrypt them into snapshots/ and commit + push.
//
// This is the copy-paste step, done by a headless browser instead of your
// hands: it loads the same pages a visitor loads, once, when YOU run it.
// Keep it that way — it is not a scraper and must never run on a timer
// (evententries' Terms of Use forbid systematic retrieval). The script
// refuses to re-fetch within 10 minutes of the last run unless --force.
//
//   node tools/snapshot-fetch.js --key ZAsNB86e3r89ldK9 \
//     --scores-url "https://evententries.com/#LiveScoresg4ODAsyNRb0uodpdkV2Lvg==" \
//     --out ~/galway            # writes galway-order-of-go.txt, galway-general.txt, galway-scores.txt
//
//   …add --publish --token <token> --name "…" --start 2026-10-28 --state California
//     to also write snapshots/ee-<key>.json and snapshots/ee-<key>-scores.json,
//   and --push to git add/commit/push the snapshots afterwards.
//
// Options:
//   --key <key>         show-center key from the evententries link (#ShowCenter<key>)
//   --center <url>      the show center's own URL (default: read from the iframe on
//                       evententries.com/#ShowCenter<key>)
//   --scores-url <url>  the show's Live Scores page; omit to skip scores
//   --out <dir>         where the text files go (default: ~/<prefix>); keep it OUTSIDE the repo
//   --prefix <name>     file-name prefix (default: "galway" → galway-order-of-go.txt …)
//   --only <list>       comma list of oog,general,scores (default: all)
//   --publish           also encrypt into snapshots/ (needs --token, --name, --start, --state)
//   --push              after --publish: git add snapshots && git commit && git push
//   --browser <path>    chromium executable if `playwright` isn't installed (uses playwright-core)
//   --force             ignore the 10-minute spacing guard
//
// One-time setup on the laptop (inside tools/):  npm install   then   npx playwright install chromium

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (['publish', 'push', 'force'].includes(k)) { out[k] = true; continue; }
    out[k] = argv[++i];
  }
  return out;
}

function loadPlaywright(browserPath) {
  try { return { chromium: require('playwright').chromium, executablePath: browserPath }; }
  catch (e) { /* fall through */ }
  const { chromium } = require('playwright-core');
  const exe = browserPath || process.env.PLAYWRIGHT_CHROMIUM
    || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
  if (!exe) throw new Error('playwright is not installed: run `npm install` in tools/ and `npx playwright install chromium`, or pass --browser <chromium path>');
  return { chromium, executablePath: exe };
}

const MIN_SPACING_MS = 10 * 60_000;
function spacingGuard(files, force) {
  if (force) return;
  const newest = Math.max(0, ...files.filter(f => fs.existsSync(f)).map(f => fs.statSync(f).mtimeMs));
  const age = Date.now() - newest;
  if (newest && age < MIN_SPACING_MS) {
    throw new Error(`last fetch was ${Math.round(age / 60_000)} min ago; wait ${Math.ceil((MIN_SPACING_MS - age) / 60_000)} min (or --force). Be gentle with their server.`);
  }
}

// Body text from the first line matching `startRe` onward (drops the
// page chrome above the table). Falls back to the whole text.
function fromLine(text, startRe) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex(l => startRe.test(l.trim()));
  return (i === -1 ? lines : lines.slice(i)).join('\n').trim() + '\n';
}

async function showCenterUrl(page, key) {
  // evententries.com polls its server every few seconds, so "networkidle"
  // never arrives there: wait for the DOM and then for the element we need.
  await page.goto(`https://evententries.com/#ShowCenter${key}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const src = await page.waitForFunction(() => {
    const f = document.querySelector('iframe.gwt-Frame');
    return f && /^https?:/.test(f.src) ? f.src : null;
  }, null, { timeout: 30_000 }).then(h => h.jsonValue());
  return src;
}

// Click a show-center tab and return the page text once its RPC answered.
async function centerTab(page, label, startRe) {
  const waitInfo = page.waitForResponse(r => /\/heoshowcenter\/info$/.test(r.url()), { timeout: 60_000 }).catch(() => null);
  await page.getByText(label, { exact: true }).first().click({ timeout: 15_000 });
  await waitInfo;
  await page.waitForTimeout(1500); // GWT renders after the response lands
  const text = await page.evaluate(() => document.body.innerText);
  const body = fromLine(text, startRe);
  if (body.split('\n').length < 5) throw new Error(`"${label}" tab rendered no table (got ${body.length} chars)`);
  return body;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.key || !/^[A-Za-z0-9_-]{1,40}$/.test(a.key)) throw new Error('--key <show center key> is required');
  const prefix = a.prefix || 'galway';
  const outDir = a.out ? a.out.replace(/^~(?=$|\/)/, os.homedir()) : path.join(os.homedir(), prefix);
  const only = new Set((a.only || 'oog,general,scores').split(',').map(s => s.trim()));
  if (!a['scores-url']) only.delete('scores');
  const files = {
    oog: path.join(outDir, `${prefix}-order-of-go.txt`),
    general: path.join(outDir, `${prefix}-general.txt`),
    scores: path.join(outDir, `${prefix}-scores.txt`),
  };
  spacingGuard(Object.values(files), a.force);
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium, executablePath } = loadPlaywright(a.browser);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    if (only.has('oog') || only.has('general')) {
      const center = a.center || await showCenterUrl(page, a.key);
      console.log(`show center: ${center}`);
      await page.goto(center, { waitUntil: 'networkidle', timeout: 60_000 });
      if (only.has('oog')) {
        fs.writeFileSync(files.oog, await centerTab(page, 'Order of Go', /^Pinney\b/i));
        console.log(`wrote ${files.oog}`);
      }
      if (only.has('general')) {
        fs.writeFileSync(files.general, await centerTab(page, 'General Schedule', /^Date\b/i));
        console.log(`wrote ${files.general}`);
      }
    }
    if (only.has('scores')) {
      await page.goto(a['scores-url'], { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // The board arrives by RPC after load; wait for a division header
      // ("… (CODE)<event name>" followed by a judge line) to render.
      await page.waitForFunction(() => /\n(Jdg @ [A-Z]:|Judge:)/.test(document.body.innerText), null, { timeout: 60_000 });
      await page.waitForTimeout(1500);
      const text = await page.evaluate(() => document.body.innerText);
      fs.writeFileSync(files.scores, fromLine(text, /Results are not final/i));
      console.log(`wrote ${files.scores}`);
    }
  } finally {
    await browser.close();
  }

  if (a.publish) {
    const enc = path.join(__dirname, 'snapshot-encrypt.js');
    const repo = path.join(__dirname, '..');
    const run = args => { console.log('$ node tools/snapshot-encrypt.js ' + args.join(' ')); execFileSync(process.execPath, [enc, ...args], { stdio: 'inherit', cwd: repo }); };
    if (!a.token) throw new Error('--publish needs --token (the schedule\'s link token)');
    if (fs.existsSync(files.oog)) {
      const args = ['--key', a.key, '--token', a.token, '--in', files.oog];
      for (const k of ['name', 'start', 'state', 'scores-url', 'links']) if (a[k]) args.push(`--${k}`, a[k]);
      if (fs.existsSync(files.general)) args.push('--schedule', files.general);
      run(args);
    }
    if (fs.existsSync(files.scores) && only.has('scores')) {
      run(['--scores', '--key', a.key, '--token', a.token, '--in', files.scores]);
    }
    if (a.push) {
      const git = args => execFileSync('git', args, { stdio: 'inherit', cwd: repo });
      git(['add', 'snapshots']);
      try { git(['commit', '-m', `Snapshot refresh ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`]); }
      catch (e) { console.log('nothing to commit'); return; }
      git(['push']);
    }
  }
}

main().catch(e => { console.error('error:', e.message); process.exit(1); });
