#!/usr/bin/env node
// Browser test for the 3CX test page (a local copy of the app; no real database is used).
//   node tools/3cx/page/test_page.js <built test page .html> <folder that has node_modules/react, react-dom, @babel/standalone>
// Needs Playwright with Chromium (set PLAYWRIGHT_CHROMIUM if it is not found automatically).
const fs = require('fs'), path = require('path');
const [built, mods] = process.argv.slice(2);
if (!built || !mods) { console.log('usage: node test_page.js <BreakTrack_TEST_3cx.html> <dir with node_modules>'); process.exit(1); }
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

// make a runnable copy: local React/Babel and the mock Supabase instead of the CDN scripts
const work = fs.mkdtempSync(path.join(mods, 'run_'));
let html = fs.readFileSync(built, 'utf8').replace(/\r\n/g, '\n').split('\n');
const i = html.findIndex(l => l.includes('unpkg.com/react@'));
if (i < 0 || !html[i + 3].includes('supabase-js')) throw new Error('CDN script lines not found');
html.splice(i, 4,
  `<script src="${path.join(mods, 'node_modules/react/umd/react.development.js')}"></script>`,
  `<script src="${path.join(mods, 'node_modules/react-dom/umd/react-dom.development.js')}"></script>`,
  `<script src="${path.join(mods, 'node_modules/@babel/standalone/babel.min.js')}"></script>`,
  `<script src="${path.join(__dirname, 'mock_supabase.js')}"></script>`);
const page = path.join(work, 'app.html'); fs.writeFileSync(page, html.join('\n'));

const TODAY = '2026-10-27';
let fails = 0; const errs = [];
const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const iso = (hm) => TODAY + 'T' + hm + ':00.000Z';
const mkdb = (extra = {}) => Object.assign({
  bt_settings: [{ id: 1, max_concurrent_breaks: 5, lunch_start: 12, slot_schedule: [], slot_tz: 'UTC', trainees: [], trainee_lunch: '12:00', shift_end: '16:30' }],
  bt_clocklogs: ['Jane Doe', 'Rick Roe', 'Pat Poe', 'Kay Kim'].map((n, k) => ({ id: k + 1, user_id: 'u' + k, agent_name: n, clock_in: iso('08:00'), clock_out: null, date: TODAY })),
  bt_logs: [], bt_lunch_schedule: [], bt_swap_requests: [],
}, extra);

(async () => {
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
  // open the app as admin on the 3CX page; `now` = the PC/server clock for this test
  const open = async ({ cfg, w = 1500, now = TODAY + 'T13:10:00.000Z', db } = {}) => {
    const c = await b.newContext({ timezoneId: 'UTC', viewport: { width: w, height: 1000 } });
    const q = await c.newPage(); q.on('pageerror', e => errs.push(e.message));
    await q.addInitScript(([d, cf]) => { window.__USER = { id: 'adm', email: 'b@x.com', user_metadata: { role: 'admin', display_name: 'Boss' } }; window.__DB = d; if (cf) localStorage.setItem('bt_cx_cfg', cf); }, [db || mkdb(), cfg || null]);
    await q.clock.setFixedTime(new Date(now));
    await q.goto('file://' + page);
    await q.waitForSelector('text=3CX (test)', { timeout: 20000 });
    await q.locator('text=3CX (test)').first().evaluate(el => el.click()); await q.waitForSelector('text=Load log');   // works when the menu is collapsed (phone width)
    return q;
  };
  const text = q => q.locator('body').innerText();
  const flat = async q => (await text(q)).replace(/\s+/g, ' ');

  let p = await open();
  check('N1 banner says this is a test copy', (await p.locator('.testribbon').innerText()).includes('TEST COPY'));
  let body = await text(p);
  check('P1 empty state before a log is loaded', /Load a 3CX status log/.test(body) && await p.locator('.cx-card').count() === 0);
  check('P2 Home-style header (title, subtitle, action buttons)', await p.locator('.hello').count() === 1 && await p.locator('.acts .bp').count() === 1);
  check('P3 a calendar is there from the start, set to today', await p.locator('.acts input[type=date]').inputValue() === TODAY);

  await p.click('text=Use sample data'); await p.waitForSelector('.cx-card');
  body = await text(p);
  check('S1 loading a log keeps today selected: subtitle shows the day, calls and alerts', /Tuesday, October 27 \(today\) · 3 calls · 5 alerts/.test(body), (body.match(/Tuesday[^\n]*/) || [''])[0]);
  check('S2 day strip shows the days in the log, today selected', await p.locator('.cx-day').count() === 2 && (await p.locator('.cx-day.on').innerText()).replace(/\s+/g, ' ') === '27 Tue');
  check('S3 Statistics card with tiles and a chart with two lines', /\nStatistics\n/.test(body) && await p.locator('.cx-chart svg').count() === 1 && await p.locator('.cx-chart svg path[stroke]').count() === 2);
  check('S4 one profile card per matching agent (8; Ada is not in the app)', await p.locator('.cx-card').count() === 8, String(await p.locator('.cx-card').count()));
  check('S5 hidden extension explained', /1 other 3CX extension isn't in the app and is hidden/.test(body));
  check('S6 no card for Ada Ash', !/Ada Ash/.test(body));
  check('S7 no dots anywhere', await p.locator('.cx-dot, .cx-tl').count() === 0);
  const rick = p.locator('.cx-card:has-text("Rick Roe")');
  const rt = (await rick.innerText()).replace(/\s+/g, ' ');
  check('C1 card shows name, ext, status and stats', /Rick Roe/.test(rt) && /ext 602/.test(rt) && /Calls 0/.test(rt) && /Ignored 3/.test(rt), rt);
  check('C2 cards have initials avatars with a status ring', await rick.locator('.cx-av').innerText() === 'RR');
  check('C3 alerts card lists reasons', /Rang 25s, not answered/.test(body) && /Lasted 35s/.test(body) && /Repeated/.test(body));
  await p.screenshot({ path: path.join(mods, 'cx_team.png'), fullPage: true });

  // alerts can be marked as dealt with
  check('A1 5 open alerts', /5\s*open/.test(await flat(p)));
  await p.locator('.onb-row.link button[aria-label="Mark as dealt with"]').first().click(); await p.waitForTimeout(150);
  check('A2 dealing with one leaves 4 open and shows "Dealt with (1)"', /4\s*open/.test(await flat(p)) && /Dealt with \(1\)/.test(await text(p)));
  check('A3 the choice is remembered in this browser', Object.keys(JSON.parse(await p.evaluate(() => localStorage.getItem('bt_cx_dismissed') || '{}'))).length === 1);
  await p.click('text=Dealt with (1)'); await p.click('button:has-text("Restore")'); await p.waitForTimeout(150);
  check('A4 restore brings it back (5 open)', /5\s*open/.test(await flat(p)));
  await p.click('button:has-text("Clear all")'); await p.waitForTimeout(150);
  body = await text(p);
  check('A5 Clear all: nothing open, "All alerts dealt with"', /0\s*open/.test(await flat(p)) && /All alerts dealt with/.test(body) && /Dealt with \(5\)/.test(body));
  check('A6 the subtitle count follows', /3 calls · 0 alerts/.test(body));
  for (let i = 0; i < 5; i++) await p.locator('button:has-text("Restore")').first().click();
  await p.waitForTimeout(150);
  check('A7 all restored again', /5\s*open/.test(await flat(p)));

  // break check: 3CX against what the agents entered
  body = await text(p);
  check('K1 Break check section: 3 differ, 0 match (and nothing about a final check or notifications)', /Break check/.test(body) && /3\s*differ/.test(await flat(p)) && /0\s*match/.test(await flat(p)) && !/Final check|Run break check/.test(body));
  const kr = async n => (await p.locator(`.cxr tr:has-text("${n}")`).innerText()).replace(/\s+/g, ' ');
  check('K2 the break check is a small table: agent, agent\'s log, 3CX, difference (no sentences)', /Agent's log 3CX Difference/.test((await p.locator('.cxr thead').last().innerText()).replace(/\s+/g, ' ')) && !/that is not in the agent's log|that 3CX doesn't show|Totals differ/.test(body));
  check('K2b Kay: log 2 · 1h 05m, 3CX 2 · 1h 15m, difference −10m 00s', /Kay Kim 2 · 1h 05m 2 · 1h 15m −10m 00s/.test(await kr('Kay Kim')), await kr('Kay Kim'));
  check('K2c Finn: log 0 · 0s, 3CX 1 · 10m 00s, difference −10m 00s', /Finn Fox 0 · 0s 1 · 10m 00s −10m 00s/.test(await kr('Finn Fox')), await kr('Finn Fox'));
  check('K2d Jane: log 1 · 10m 00s, 3CX 0 · 0s, difference +10m 00s', /Jane Doe 1 · 10m 00s 0 · 0s \+10m 00s/.test(await kr('Jane Doe')), await kr('Jane Doe'));
  check('K3 break-check differences are NOT added to the alerts: still 5 open, no "Break check" badge', /5\s*open/.test(await flat(p)) && await p.locator('.cx-alerts .badge:has-text("Break check")').count() === 0);
  check('K4 and no notification was raised', !/differ from their own log/.test(await text(p)) && await p.locator('button:has-text("Run break check")').count() === 0);
  // the sample's checks above are in the table; here: totals 1s apart but the breaks sit an hour apart on the clock -> not a difference
  const apart = mkdb({ bt_logs: [{ id: 'x1', user_id: 'u3', agent_name: 'Kay Kim', start_time: iso('10:00'), end_time: iso('10:15'), break_type: 'Break' }, { id: 'x2', user_id: 'u3', agent_name: 'Kay Kim', start_time: iso('10:30'), end_time: iso('11:30'), break_type: 'Lunch Break' }] });
  const csvA = path.join(work, 'apart.csv'); fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'status_log.sample.csv'), csvA);
  const tA = Date.UTC(2026, 9, 27, 14, 20, 1) / 1000; fs.utimesSync(csvA, tA, tA);
  const pa = await open({ db: apart }); await pa.setInputFiles('input[type=file]', csvA); await pa.waitForSelector('.cx-card'); await pa.waitForTimeout(300);
  const kayRow = (await pa.locator('.cxr tr:has-text("Kay Kim")').innerText()).replace(/\s+/g, ' ');
  check('K6 same totals and counts but an hour apart on the clock: shows the plain difference (0s), not flagged', /Kay Kim 2 · 1h 15m 2 · 1h 15m 0s/.test(kayRow) && /0\s*differ/.test(await flat(pa)), kayRow);
  await pa.context().close();

  // profile
  await rick.click(); await p.waitForSelector('text=All agents');
  body = await text(p);
  check('R1 profile opens: name, ext, tiles, time split', /Rick Roe/.test(body) && /ext 602/.test(body) && /Ignored rings\n3/.test(body) && /Where the time went/.test(body));
  check('R2 profile lists the 3 rings as not answered, flagged Ignored', (await p.locator('.badge:text-is("Ignored")').count()) >= 3);
  check('R3 time split is a bar with a legend, not dots', await p.locator('.cx-bar i').count() >= 2 && await p.locator('.cx-dot').count() === 0);
  await p.screenshot({ path: path.join(mods, 'cx_profile.png'), fullPage: true });
  await p.click('text=All agents'); await p.waitForSelector('.cx-card');
  await p.click('.cx-card:has-text("Kay Kim")'); await p.waitForSelector('text=Where the time went');
  body = await text(p);
  check('R4 Kay\'s profile lists her breaks in 3CX next to her log, no explanations', /Breaks: agent's log and 3CX/.test(body) && /3CX\s*log 11:00 – 11:15/.test(body.replace(/\n/g, ' ')) && !/Totals differ/.test(body));
  await p.click('text=All agents');
  await p.click('.cx-card:has-text("Finn Fox")'); await p.waitForSelector('text=Where the time went');
  check('R5 Finn\'s profile: 3CX only, not in the agent\'s log', /3CX only/.test(await text(p)) && await p.locator('.badge:has-text("Not in agent\'s log")').count() === 1);
  await p.click('text=All agents');
  await p.click('.onb-row.link >> nth=0'); await p.waitForSelector('text=Where the time went');
  check('R6 clicking an alert opens that agent\'s profile', /Rick Roe/.test(await text(p)));
  await p.click('text=All agents');

  // choosing another day (chips and calendar)
  await p.click('.cx-day:has-text("26")'); await p.waitForTimeout(250);
  body = await text(p);
  check('D1 choosing 26 Mon shows that day, with a Today button', /Monday, October 26/.test(body) && await p.locator('.cx-card').count() === 1 && /Gail Gray/.test(body) && await p.locator('button:text-is("Today")').count() === 1, String(await p.locator('.cx-card').count()));
  await p.click('button:text-is("Today")'); await p.waitForTimeout(150);
  check('D2 Today goes back to today', /Tuesday, October 27 \(today\)/.test(await text(p)));
  await p.fill('.acts input[type=date]', '2026-10-26'); await p.waitForTimeout(250);
  check('D3 the calendar picks a day too', /Monday, October 26/.test(await text(p)));
  await p.fill('.acts input[type=date]', TODAY); await p.waitForTimeout(150);

  // settings
  await p.click('text=Settings >> nth=0'); await p.waitForSelector('text=3CX call alerts');
  const box = p.locator('h2:has-text("3CX call alerts")').locator('xpath=..');
  const inputs = box.locator('input[type=number]');
  check('T1 Settings has the 3CX section with six values and the defaults', await inputs.count() === 6 && await inputs.nth(0).inputValue() === '0' && await inputs.nth(1).inputValue() === '10' && await inputs.nth(5).inputValue() === '3');
  await inputs.nth(1).fill('30'); await inputs.nth(5).fill('15'); await box.locator('button.bp').click(); await p.waitForTimeout(300);
  const saved = JSON.parse(await p.evaluate(() => localStorage.getItem('bt_cx_cfg') || '{}'));
  check('T2 saved in this browser', saved.ignoreRingSec === 30 && saved.breakToleranceMin === 15);
  await p.click('text=3CX (test)'); await p.waitForSelector('text=Load log'); await p.click('text=Use sample data'); await p.waitForSelector('.cx-card');
  check('T3 the new limits are used: ignored after 30s (2 call alerts) and totals within 15 min are fine for Kay (Finn and Jane still differ)', /3 calls · 2 alerts/.test(await text(p)) && /2\s*differ/.test(await flat(p)), (await flat(p)).match(/\d+\s*differ/)[0]);
  await p.context().close();

  // the day follows today, not the log
  p = await open({ now: '2026-10-29T13:10:00.000Z' });
  await p.click('text=Use sample data'); await p.waitForSelector('text=No 3CX activity on');
  body = await text(p);
  check('D4 a log with nothing for today still shows today, and says where the activity is', /Thursday, October 29 \(today\)/.test(body) && /No 3CX activity on Thursday, October 29/.test(body) && /The log has activity on (26 Oct, 27 Oct|Oct 26, Oct 27)/.test(body), (body.match(/The log has[^\n]*/) || [''])[0]);
  check('D5 today is in the day strip and selected', (await p.locator('.cx-day.on').innerText()).replace(/\s+/g, ' ') === '29 Thu');
  await p.click('.cx-day:has-text("27")'); await p.waitForSelector('.cx-card');
  check('D6 picking 27 shows that day, then Today returns', /Tuesday, October 27 · 3 calls/.test(await text(p)));
  await p.click('button:text-is("Today")'); await p.waitForSelector('text=No 3CX activity on');
  await p.context().close();

  // late in the day (after what used to be the check time) the differences stay out of the alerts and notifications
  p = await open({ now: TODAY + 'T16:21:00.000Z' });
  await p.click('text=Use sample data'); await p.waitForSelector('.cx-card'); await p.waitForTimeout(600);
  body = await text(p);
  check('E1 at 16:21: still 5 open alerts, no notification, 3 agents differ in the table', /5\s*open/.test(await flat(p)) && !/differ from their own log/.test(body) && /3\s*differ/.test(await flat(p)));
  check('E2 nothing was stored for a notification', await p.evaluate(() => localStorage.getItem('bt_cx_notified_2026-10-27')) === null);
  await p.context().close();

  // with a real log (not the sample), the agents' entries come from the database, read-only
  const logsDb = mkdb({ bt_logs: [
    { id: 'l1', user_id: 'u3', agent_name: 'Kay Kim', start_time: iso('11:00'), end_time: iso('11:15'), break_type: 'Break' },
    { id: 'l2', user_id: 'u3', agent_name: 'Kay Kim', start_time: iso('11:30'), end_time: iso('12:30'), break_type: 'Lunch Break' }] });
  const csv = path.join(work, 'logger.csv'); fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'status_log.sample.csv'), csv);
  const t = Date.UTC(2026, 9, 27, 14, 20, 1) / 1000; fs.utimesSync(csv, t, t);       // saved right after its last row (14:20:00), logger PC on UTC+0
  p = await open({ db: logsDb });
  await p.setInputFiles('input[type=file]', csv); await p.waitForSelector('.cx-card'); await p.waitForTimeout(300);
  body = await text(p);
  check('F1 a log from the app\'s own agents: 4 cards (Jane, Rick, Pat, Kay)', await p.locator('.cx-card').count() === 4, String(await p.locator('.cx-card').count()));
  check('F2 Kay\'s entries in the database match 3CX exactly: difference 0s, 0 differ', /0\s*differ/.test(await flat(p)) && /Kay Kim 2 · 1h 15m 2 · 1h 15m 0s/.test((await p.locator('.cxr tr:has-text("Kay Kim")').innerText()).replace(/\s+/g, ' ')));
  check('F3 logger clock UTC+0 matches the file: no warning', !/suggests the 3CX logger PC runs on/.test(body));
  const dbAfter = await p.evaluate(() => window.__DB.bt_logs);
  check('F4 the agents\' entries were not changed', dbAfter.length === 2 && dbAfter[1].end_time === iso('12:30'));
  await p.context().close();
  p = await open({ cfg: JSON.stringify({ logTz: 1 }) });
  await p.setInputFiles('input[type=file]', csv); await p.waitForSelector('.cx-card'); await p.waitForTimeout(200);
  check('Z1 logger clock set to UTC+1: a warning says the logger PC looks like UTC+0', /suggests the 3CX logger PC runs on UTC\+0, but Settings says UTC\+1/.test(await text(p)));
  await p.click('button:has-text("Open Settings")'); await p.waitForSelector('text=3CX call alerts');
  check('Z2 the warning\'s button opens Settings', true);
  await p.context().close();

  // narrow screen
  p = await open({ w: 520 });
  await p.click('text=Use sample data'); await p.waitForSelector('.cx-card');
  check('M1 phone width: no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await p.screenshot({ path: path.join(mods, 'cx_phone.png') });
  const dbNow = await p.evaluate(() => window.__DB);
  check('W1 nothing was written to the database', dbNow.bt_logs.length === 0 && dbNow.bt_clocklogs.length === 4);
  check('E9 no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
