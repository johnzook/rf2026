#!/usr/bin/env node
'use strict';
// Encrypt a pasted evententries "Order of Go" into snapshots/ee-<key>.json
// for a snapshot event (?event=ee:<key>&k=<token>). Mirrors the page's
// decryptSnapshot(): AES-256-GCM, key = SHA-256(token + ":" + saltB64).
//
//   node tools/snapshot-encrypt.js --key ZAsNB86e3r89ldK9 \
//     --name "The Eventing Championships at Galway Downs (Oct 2026)" \
//     --start 2026-10-28 --state California --in /path/to/order-of-go.txt
//
// Options:
//   --key <key>       show-center key from the evententries link (#ShowCenter<key>)
//   --name <name>     event name for the header/title
//   --start <date>    ISO first day of the show; weekday names resolve from here
//   --state <state>   US state name of the venue (sets the event timezone)
//   --in <file>       the pasted text (one table cell per line, or tab-separated)
//   --token <token>   reuse an existing link token (default: generate a new one)
//   --captured <str>  provenance note shown in the footer (default: now, local)
//   --out <file>      output path (default: snapshots/ee-<key>.json)
//   --schedule <file> the show center's "General Schedule" tab, pasted: per-division
//                     ring + time block per phase; fills phases the order of go has no
//                     rider rows for yet (show jumping) with the division's block start
//   --scores-url <u>  evententries Live Scores page for the show (linked from ride details)
//   --links <file>    JSON {"<division code>": "<url>", …} per-level Live Scores links
//   --scores          encrypt a pasted Live Scores board instead (requires --token;
//                     writes snapshots/ee-<key>-scores.json; --name/--start/--state unused)
//   --decrypt         with --key/--token: print the stored plaintext's meta instead
//                     (add --scores for the scores file)
//
// The plaintext never enters the repo: keep the pasted file outside it.
// Re-run with the same --token to re-publish a revised order of go without
// invalidating links already sent.

const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'decrypt' || k === 'scores') { out[k] = true; continue; }
    out[k] = argv[++i];
  }
  return out;
}

const b64 = bytes => Buffer.from(bytes).toString('base64');
const unb64 = s => new Uint8Array(Buffer.from(String(s || ''), 'base64'));

async function keyFor(token, saltB64, usage) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(token + ':' + saltB64));
  return subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [usage]);
}

function randomToken(n = 20) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = webcrypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

// Pure core (also used by the test suite): build the payload object the
// page's decryptSnapshot() consumes, and its inverse.
async function encryptSnapshot({ key, token, name = '', start, state = '', text, captured, kind = 'schedule', scoresUrl = '', links = null, schedule = '' }) {
  if (!key || !/^[A-Za-z0-9_-]{1,40}$/.test(key)) throw new Error('key must be 1-40 letters/digits/_/-');
  if (kind !== 'scores' && !/^\d{4}-\d{2}-\d{2}$/.test(start || '')) throw new Error('start must be YYYY-MM-DD');
  if (kind === 'scores' && !token) throw new Error('a scores snapshot needs the schedule\'s --token');
  token = token || randomToken();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) throw new Error('token must be 8-64 url-safe chars');
  const salt = b64(webcrypto.getRandomValues(new Uint8Array(16)));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const capturedAt = captured || new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  const body = kind === 'scores'
    ? { kind, capturedAt, text: String(text == null ? '' : text) }
    : { kind, name, startDate: start, state, scoresUrl, links: links && typeof links === 'object' ? links : {},
        schedule: String(schedule == null ? '' : schedule),
        capturedAt, text: String(text == null ? '' : text) };
  const plain = JSON.stringify(body);
  const k = await keyFor(token, salt, 'encrypt');
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain));
  return { token, payload: { v: 1, key, salt, iv: b64(iv), data: b64(new Uint8Array(data)) } };
}

async function decryptSnapshot(payload, token) {
  const k = await keyFor(token, payload.salt, 'decrypt');
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, k, unb64(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function encrypt({ key, name, start, state, inFile, token, captured, out, scores, scoresUrl, linksFile, scheduleFile }) {
  if (!inFile) throw new Error('--in <file> is required');
  const text = fs.readFileSync(inFile, 'utf8');
  const links = linksFile ? JSON.parse(fs.readFileSync(linksFile, 'utf8')) : null;
  const schedule = scheduleFile ? fs.readFileSync(scheduleFile, 'utf8') : '';
  const kind = scores ? 'scores' : 'schedule';
  const r = await encryptSnapshot({ key, token, name, start, state, text, captured, kind, scoresUrl, links, schedule });
  out = out || path.join(__dirname, '..', 'snapshots', `ee-${key}${scores ? '-scores' : ''}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(r.payload) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), out)} (${fs.statSync(out).size} bytes, ${text.split('\n').length} lines of text)`);
  console.log(`token: ${r.token}`);
  console.log(`link:  ?event=ee:${key}&k=${r.token}`);
}

async function decrypt({ key, token, out, scores }) {
  const file = out || path.join(__dirname, '..', 'snapshots', `ee-${key}${scores ? '-scores' : ''}.json`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const snap = await decryptSnapshot(payload, token);
  const { text, schedule, ...meta } = snap;
  console.log(JSON.stringify(meta, null, 2));
  console.log(`text: ${text.length} chars, ${text.split('\n').length} lines`);
  if (schedule) console.log(`schedule: ${schedule.length} chars, ${schedule.split('\n').length} lines`);
}

module.exports = { encryptSnapshot, decryptSnapshot, randomToken };

if (require.main === module) {
  (async () => {
    const a = parseArgs(process.argv.slice(2));
    try {
      if (a.decrypt) await decrypt({ key: a.key, token: a.token, out: a.out, scores: a.scores });
      else await encrypt({ key: a.key, name: a.name, start: a.start, state: a.state, inFile: a.in, token: a.token,
        captured: a.captured, out: a.out, scores: a.scores, scoresUrl: a['scores-url'], linksFile: a.links, scheduleFile: a.schedule });
    } catch (e) {
      console.error('error:', e.message);
      process.exit(1);
    }
  })();
}
