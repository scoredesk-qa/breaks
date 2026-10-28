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
const mkdb = () => ({
  bt_settings: [{ id: 1, max_concurrent_breaks: 5, lunch_start: 12, slot_schedule: [], slot_tz: 'UTC', trainees: [], trainee_lunch: '12:00', shift_end: '16:30' }],
  bt_clocklogs: ['Jane Doe', 'Rick Roe', 'Pat Poe', 'Kay Kim'].map((n, k) => ({ id: k + 1, user_id: 'u' + k, agent_name: n, clock_in: TODAY + 'T08:00:00.000Z', clock_out: null, date: TODAY })),
  bt_logs: [], bt_lunch_schedule: [], bt_swap_requests: [],
});

(async () => {
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
  const open = async (cfg, w = 1500) => {
    const c = await b.newContext({ timezoneId: 'UTC', viewport: { width: w, height: 1000 } });
    const q = await c.newPage(); q.on('pageerror', e => errs.push(e.message));
    await q.addInitScript(([d, cf]) => { window.__USER = { id: 'adm', email: 'b@x.com', user_metadata: { role: 'admin', display_name: 'Boss' } }; window.__DB = d; if (cf) localStorage.setItem('bt_cx_cfg', cf); }, [mkdb(), cfg || null]);
    await q.clock.setFixedTime(new Date(TODAY + 'T13:10:00.000Z'));
    await q.goto('file://' + page);
    await q.waitForSelector('text=3CX (test)', { timeout: 20000 });
    await q.locator('text=3CX (test)').first().evaluate(el => el.click()); await q.waitForSelector('text=Load log');   // works when the menu is collapsed (phone width)
    return q;
  };
  const text = q => q.locator('body').innerText();

  let p = await open();
  check('N1 banner says this is a test copy', (await p.locator('.testribbon').innerText()).includes('TEST COPY'));
  let body = await text(p);
  check('P1 empty state before a log is loaded', /Load a 3CX status log/.test(body) && await p.locator('.cx-card').count() === 0);
  check('P2 Home-style header (title, subtitle, action buttons)', await p.locator('.hello').count() === 1 && await p.locator('.acts .bp').count() === 1);

  await p.click('text=Use sample data'); await p.waitForSelector('.cx-card');
  body = await text(p);
  check('S1 subtitle: day, calls and alerts', /Tuesday, October 27 · 3 calls · 5 alerts/.test(body), (body.match(/Tuesday[^\n]*/) || [''])[0]);
  check('S2 day strip shows the days in the log, today selected', await p.locator('.cx-day').count() === 2 && (await p.locator('.cx-day.on').innerText()).replace(/\s+/g, ' ') === '27 Tue', (await p.locator('.cx-day').allInnerTexts()).join('|'));
  check('S3 Statistics card with tiles and a chart with two lines', /\nStatistics\n/.test(body) && await p.locator('.cx-chart svg').count() === 1 && await p.locator('.cx-chart svg path[stroke]').count() === 2);
  check('S4 one profile card per matching agent (8; Ada is not in the app)', await p.locator('.cx-card').count() === 8, String(await p.locator('.cx-card').count()));
  check('S5 hidden extension explained', /1 other 3CX extension isn't in the app and is hidden/.test(body));
  check('S6 no card for Ada Ash', !/Ada Ash/.test(body));
  const rick = p.locator('.cx-card:has-text("Rick Roe")');
  const rt = (await rick.innerText()).replace(/\s+/g, ' ');
  check('C1 card shows name, ext, status and stats', /Rick Roe/.test(rt) && /ext 602/.test(rt) && /Calls 0/.test(rt) && /Ignored 3/.test(rt), rt);
  check('C2 ignored calls show as red rings on the timeline (3 rings, in 2 half-hour dots: 09:05 and 09:25 share one)', await rick.locator('.cx-dot.ign').count() === 2, String(await rick.locator('.cx-dot.ign').count()));
  check('C3 short call shows as an orange halo on Pat\'s timeline', await p.locator('.cx-card:has-text("Pat Poe") .cx-dot.sc').count() >= 1);
  check('C4 Kay\'s timeline has admin (yellow) and break (teal) dots', await p.locator('.cx-card:has-text("Kay Kim") .cx-dot[style*="245, 196, 81"]').count() >= 1 && await p.locator('.cx-card:has-text("Kay Kim") .cx-dot[style*="79, 209, 197"]').count() >= 1);
  check('C5 cards have initials avatars with a status ring', await rick.locator('.cx-av').innerText() === 'RR');
  check('C6 alerts card lists reasons', /Rang 25s, not answered/.test(body) && /Lasted 35s/.test(body) && /Repeated/.test(body));
  check('C7 breaks from 3CX listed', /Breaks from 3CX/.test(body) && /Lunch/.test(body) && /still on break/.test(body));
  await p.screenshot({ path: path.join(mods, 'cx_team.png'), fullPage: true });

  // profile
  await rick.click(); await p.waitForSelector('text=All agents');
  body = await text(p);
  check('R1 profile opens: name, ext, tiles, day at a glance', /Rick Roe/.test(body) && /ext 602/.test(body) && /Ignored rings\n3/.test(body) && /Day at a glance/.test(body));
  check('R2 profile lists the 3 rings as ignored', (body.match(/Ignored\n/g) || []).length >= 3 || (await p.locator('.badge:has-text("Ignored")').count()) >= 3, String(await p.locator('.badge:has-text("Ignored")').count()));
  check('R3 profile has a large timeline', await p.locator('.cx-tlbig .cx-dot').count() >= 12);
  await p.screenshot({ path: path.join(mods, 'cx_profile.png'), fullPage: true });
  await p.click('text=All agents'); await p.waitForSelector('.cx-card');
  check('R4 back returns to the team page', await p.locator('.cx-card').count() === 8);
  await p.click('.cx-card:has-text("Pat Poe")'); await p.waitForSelector('text=Day at a glance');
  check('R5 Pat\'s profile: 2 calls, one flagged Short', /Calls 2|Calls\n2/.test(await text(p)) && await p.locator('.badge:text-is("Short")').count() === 1);
  await p.click('text=All agents');
  await p.click('.cx-card:has-text("Kay Kim")'); await p.waitForSelector('text=Day at a glance');
  const kb = await text(p);
  check('R6 Kay\'s profile: admin and two breaks listed', /Admin and breaks\s*3/.test(kb.replace(/\n/g, ' ')) && /Lunch/.test(kb) && /30m 00s/.test(kb));
  await p.click('text=All agents');
  await p.click('.onb-row.link >> nth=0'); await p.waitForSelector('text=Day at a glance');
  check('R7 clicking an alert opens that agent\'s profile', /Rick Roe/.test(await text(p)));
  await p.click('text=All agents');

  // another day
  await p.click('.cx-day:has-text("26")'); await p.waitForTimeout(250);
  body = await text(p);
  check('D1 choosing 26 Mon shows that day', /Monday, October 26/.test(body) && await p.locator('.cx-card').count() === 1 && /Gail Gray/.test(body), String(await p.locator('.cx-card').count()));
  await p.click('.cx-day:has-text("27")'); await p.waitForTimeout(200);

  // settings
  await p.click('text=Settings >> nth=0'); await p.waitForSelector('text=3CX call alerts');
  const box = p.locator('h2:has-text("3CX call alerts")').locator('xpath=..');
  const inputs = box.locator('input[type=number]');
  check('T1 Settings has the 3CX section with five values and the defaults', await inputs.count() === 5 && await inputs.nth(0).inputValue() === '0' && await inputs.nth(1).inputValue() === '10' && await inputs.nth(2).inputValue() === '60');
  await inputs.nth(1).fill('30'); await box.locator('button.bp').click(); await p.waitForTimeout(300);
  check('T2 saved in this browser', JSON.parse(await p.evaluate(() => localStorage.getItem('bt_cx_cfg') || '{}')).ignoreRingSec === 30);
  await p.click('text=3CX (test)'); await p.waitForSelector('text=Load log'); await p.click('text=Use sample data'); await p.waitForSelector('.cx-card');
  check('T3 the new limit is used (30s ring + short call = 2 alerts)', /3 calls · 2 alerts/.test(await text(p)));

  // logger clock vs the file's own save time
  const csv = path.join(work, 'logger.csv'); fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'status_log.sample.csv'), csv);
  const t = Date.UTC(2026, 9, 27, 14, 20, 1) / 1000; fs.utimesSync(csv, t, t);       // saved right after its last row (14:20:00), logger PC on UTC+0
  await p.context().close();
  p = await open();
  await p.setInputFiles('input[type=file]', csv); await p.waitForSelector('.cx-card'); await p.waitForTimeout(200);
  body = await text(p);
  check('Z1 a log from the app\'s own agents: 4 cards (Jane, Rick, Pat, Kay)', await p.locator('.cx-card').count() === 4, String(await p.locator('.cx-card').count()));
  check('Z2 logger clock UTC+0 matches the file: no warning', !/suggests the 3CX logger PC runs on/.test(body));
  await p.context().close();
  p = await open(JSON.stringify({ logTz: 1 }));
  await p.setInputFiles('input[type=file]', csv); await p.waitForSelector('.cx-card'); await p.waitForTimeout(200);
  body = await text(p);
  check('Z3 logger clock set to UTC+1: a warning says the logger PC looks like UTC+0', /suggests the 3CX logger PC runs on UTC\+0, but Settings says UTC\+1/.test(body));
  await p.click('button:has-text("Open Settings")'); await p.waitForSelector('text=3CX call alerts');
  check('Z4 the warning\'s button opens Settings', true);
  await p.context().close();

  // narrow screen
  p = await open(null, 520);
  await p.click('text=Use sample data'); await p.waitForSelector('.cx-card');
  check('M1 phone width: no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await p.screenshot({ path: path.join(mods, 'cx_phone.png') });
  const dbNow = await p.evaluate(() => window.__DB);
  check('W1 nothing was written to the database', dbNow.bt_logs.length === 0 && dbNow.bt_clocklogs.length === 4);
  check('E1 no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
