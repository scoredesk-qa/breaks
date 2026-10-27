#!/usr/bin/env node
// 3CX presence logger: watches the Favourites grid in the web client and
// appends a CSV row whenever an agent's status changes.
//
//   node logger.js            run hidden in the background (no window)
//   node logger.js login      one-time: sign in to 3CX in a visible browser
//   node logger.js watch      visible browser, for troubleshooting (Enter = snapshot)
//   node logger.js summary    minutes per status per agent for today
//   node logger.js summary 2026-10-27
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const CFG = {
  url: process.env.CX_URL || 'https://zzps.3cx.uk',
  pollMs: Number(process.env.POLL_MS || 1000),
  stablePolls: Number(process.env.STABLE_POLLS || 2), // ignore flicker shorter than this many polls
  profileDir: path.join(__dirname, 'profile'),       // keeps you signed in between runs
  logFile: path.join(__dirname, 'status_log.csv'),
  noteFile: path.join(__dirname, 'logger.log'),      // start/stop, sign-outs, gaps
  pidFile: path.join(__dirname, 'logger.pid'),
};
const FAV_URL = CFG.url.replace(/\/+$/, '') + '/#/people/favorites';

// Status text under each name -> what gets written in the log.
// First match wins. A phone number line with no status text means the agent is on a call.
const STATUS_RULES = [
  [/not registered/i, 'Offline'],
  [/out of office|holiday/i, 'Out of office'],
  [/break|away/i, 'Break'],
  [/admin|do not disturb|dnd/i, 'Admin'],
  [/remote|available 2/i, 'Available (Remote)'],
  [/available/i, 'Available'],
];
const redact = t => String(t).replace(/\+?\d{6,}/g, '[number]');   // never write phone numbers to disk
// s = {state, inCall, text} from the tile. state is the status dot's CSS class
// (busy, ringing, off, ...); text is the status label the tile shows.
function statusFrom(s) {
  if (/ringing/i.test(s.state)) return 'Ringing';
  if (s.inCall || /busy/i.test(s.state)) return 'On call';
  const text = s.text || '';
  for (const [re, name] of STATUS_RULES) if (re.test(text)) return name;
  return text || s.state || 'Unknown';             // custom status: log it as written
}

// Runs inside the page. Reads each people tile via its data-qa attributes.
// Returns {ext: {name, state, inCall, text}} (no phone numbers are read).
function scan(withHtml) {
  const out = {};
  for (const tile of document.querySelectorAll('[data-qa="people-tile"]')) {
    if (!tile.offsetParent) continue;
    const q = sel => tile.querySelector(sel);
    const extEl = q('[data-qa="ext-number"]');
    const ext = extEl && extEl.textContent.trim();
    if (!ext || out[ext]) continue;
    const nameEl = q('[data-qa="ext-name"]');
    const ind = q('[data-qa="status-indicator"]');
    const label = q('[data-qa="status"]') || q('.avatar-container');
    out[ext] = {
      name: nameEl ? (nameEl.getAttribute('title') || nameEl.textContent).trim() : ext,
      state: ind ? ind.className.replace('status-indicator', '').trim() : '',
      inCall: tile.classList.contains('in-call'),
      text: label ? (label.getAttribute('title') || label.textContent || '').trim() : '',
    };
    if (withHtml) out[ext].html = tile.outerHTML;
  }
  return out;
}

const pad = n => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const csv = v => `"${String(v).replace(/"/g, '""')}"`;

function logRow(ext, name, oldS, newS, detail) {
  if (!fs.existsSync(CFG.logFile)) {
    fs.writeFileSync(CFG.logFile, 'timestamp,extension,agent,old_status,new_status,detail\n');
  }
  fs.appendFileSync(CFG.logFile, [stamp(), ext, csv(name), oldS, newS, csv(detail)].join(',') + '\n');
  console.log(`${stamp()}  ${ext} ${name}: ${oldS || '(start)'} -> ${newS}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function note(msg) {
  const line = `${stamp()}  ${msg}`;
  console.log(line);
  fs.appendFileSync(CFG.noteFile, line + '\n');
}

function takeLock() {
  try {
    const old = Number(fs.readFileSync(CFG.pidFile, 'utf8'));
    if (old && old !== process.pid) {
      process.kill(old, 0);                          // throws if that process is gone
      console.log('The logger is already running. Run stop-logger.bat first.');
      process.exit(0);
    }
  } catch (e) { /* no live logger */ }
  fs.writeFileSync(CFG.pidFile, String(process.pid));
  process.on('exit', () => { try { fs.unlinkSync(CFG.pidFile); } catch (e) { /* already gone */ } });
}

const onLoginPage = page => page.locator('input[type=password]').count().then(n => n > 0, () => false);

// Best effort, only if CX_USER and CX_PASS are set in the environment.
async function tryAutoLogin(page) {
  const { CX_USER: user, CX_PASS: pass } = process.env;
  if (!user || !pass) return false;
  try {
    await page.locator('input[type=password]').first().fill(pass);
    await page.locator('input[type=text], input[type=email], input:not([type])').first().fill(user);
    await page.keyboard.press('Enter');
    return true;
  } catch (e) { return false; }
}

async function run(mode) {
  const { chromium } = require('playwright');
  takeLock();
  const headless = mode === 'headless';
  const ctx = await chromium.launchPersistentContext(CFG.profileDir, headless
    ? { headless: true, viewport: { width: 1600, height: 1000 } }
    : { headless: false, viewport: null });
  const page = ctx.pages()[0] || await ctx.newPage();

  if (mode === 'login') {
    await page.goto(CFG.url);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(res => rl.question(
      '\nSign in to 3CX in the browser window. When you can see your Team page,\npress Enter here to save the sign-in and close... ', () => { rl.close(); res(); }));
    await ctx.close();
    console.log('Saved. Now run:  node logger.js   (or double-click start-logger.vbs)');
    process.exit(0);
  }

  await page.goto(FAV_URL).catch(() => {});
  await page.waitForSelector('[data-qa="people-tile"]', { timeout: 30000 }).catch(() => {});
  note(`logger started (${mode})`);

  if (mode === 'watch') {
    // Press Enter while an agent's phone is ringing to save what the page looks like.
    readline.createInterface({ input: process.stdin }).on('line', async () => {
      const snap = await page.evaluate(scan, true).catch(() => ({}));
      const text = Object.entries(snap).map(([e, v]) =>
        redact(`=== ${e} ${v.name} | ${statusFrom(v)} | ${v.state} | ${v.text}\n${v.html}\n`)).join('\n');
      fs.writeFileSync(path.join(__dirname, 'snapshot.txt'), `${stamp()}\n\n${text}`);
      console.log(`${stamp()}  snapshot saved to snapshot.txt`);
    });
  }

  const current = {};   // confirmed status per ext
  const pending = {};   // candidate status + how many polls seen
  const names = {};
  let empty = 0;
  let warned = false;

  for (;;) {
    let seen = {};
    try { seen = await page.evaluate(scan); } catch (e) {
      if (/closed/i.test(e.message)) { note('browser closed - logger stopped'); process.exit(0); }
      if (!warned) { warned = true; note(`scan error: ${e.message}`); }
    }
    const exts = Object.keys(seen);
    if (!exts.length) {
      empty++;
      if (empty === 5) {
        const dump = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(e => String(e));
        fs.writeFileSync(path.join(__dirname, 'debug.txt'), page.url() + '\n\n' + redact(dump));
      }
      if (empty === 30) note('no agents visible - trying to recover (signed out, or wrong page?)');
      if (empty >= 30 && empty % 30 === 0) {
        if (await onLoginPage(page)) {
          if (empty === 30) note('3CX is showing the sign-in page: the sign-in has expired. Run: node logger.js login');
          if (await tryAutoLogin(page)) note('tried automatic sign-in');
        } else if (!page.url().includes('/people/favorites')) {
          await page.goto(FAV_URL).catch(() => {});
        } else {
          await page.reload().catch(() => {});
        }
      }
    } else {
      if (empty >= 30) note('agents visible again - logging resumed');
      empty = 0;
    }

    for (const ext of exts) {
      const s = seen[ext];
      if (!names[ext] || s.name.length > names[ext].length) names[ext] = s.name;
      const status = statusFrom(s);
      if (current[ext] === status) { delete pending[ext]; continue; }
      const p = pending[ext];
      if (p && p.status === status) p.n++; else pending[ext] = { status, n: 1 };
      if (pending[ext].n >= CFG.stablePolls) {
        logRow(ext, names[ext], current[ext] || '', status, s.text);
        current[ext] = status;
        delete pending[ext];
      }
    }
    await sleep(CFG.pollMs);
  }
}

function summary(day) {
  day = day || stamp().slice(0, 10);
  if (!fs.existsSync(CFG.logFile)) return console.log('No log yet.');
  const rows = fs.readFileSync(CFG.logFile, 'utf8').trim().split('\n').slice(1)
    .map(l => l.match(/^([^,]+),(\d+),"((?:[^"]|"")*)",([^,]*),([^,]*),/))
    .filter(Boolean)
    .map(m => ({ t: new Date(m[1].replace(' ', 'T')), ext: m[2], name: m[3], status: m[5] }));
  const dayStart = new Date(day + 'T00:00:00'), dayEnd = new Date(dayStart.getTime() + 864e5);
  const now = new Date();
  const totals = {}; const cols = new Set();
  const byExt = {};
  for (const r of rows) (byExt[r.ext] = byExt[r.ext] || []).push(r);
  for (const [ext, list] of Object.entries(byExt)) {
    list.sort((a, b) => a.t - b.t);
    list.forEach((r, i) => {
      const from = Math.max(r.t, dayStart);
      const to = Math.min(i + 1 < list.length ? list[i + 1].t : now, dayEnd);
      if (to <= from) return;
      const k = `${ext} ${r.name}`;
      totals[k] = totals[k] || {};
      totals[k][r.status] = (totals[k][r.status] || 0) + (to - from) / 6e4;
      cols.add(r.status);
    });
  }
  console.log(`Minutes per status on ${day}`);
  const c = [...cols];
  console.log(['agent', ...c].join('\t'));
  for (const [k, v] of Object.entries(totals).sort())
    console.log([k, ...c.map(s => Math.round(v[s] || 0))].join('\t'));
}

module.exports = { scan, statusFrom };
if (require.main === module) {
  if (process.argv[2] === 'summary') summary(process.argv[3]);
  else run(process.argv[2] === 'login' ? 'login' : process.argv[2] === 'watch' ? 'watch' : 'headless');
}
