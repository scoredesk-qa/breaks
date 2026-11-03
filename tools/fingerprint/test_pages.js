#!/usr/bin/env node
// Browser test for the two fingerprint test pages.  node tools/fingerprint/test_pages.js <folder with FP_Agent_TEST.html and FP_Admin_TEST.html>
const fs = require('fs'), path = require('path');
const dir = process.argv[2]; if (!dir) { console.log('usage: node test_pages.js <build folder>'); process.exit(1); }
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const AG = 'file://' + path.resolve(dir, 'FP_Agent_TEST.html'), AD = 'file://' + path.resolve(dir, 'FP_Admin_TEST.html');
let fails = 0; const errs = [];
const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const flat = async p => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const ctx = async (w = 1300) => { const c = await b.newContext({ timezoneId: 'UTC', viewport: { width: w, height: 1000 }, acceptDownloads: true }); return c; };
  const page = async (c, url) => { const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.goto(url); return p; };
  const signInAgent = async (p, badge, code) => { await p.fill('#badge', badge); await p.fill('#code', code); await p.click('#go'); await p.waitForSelector('#out'); };

  /* ───────────── agent page, demo data ───────────── */
  let c = await ctx(), p = await page(c, AG);
  check('A0 test ribbon, sign-in form, demo logins listed', await p.locator('.ribbon').count() === 1 && await p.locator('#go').count() === 1 && /Ziad · 194627/.test(await flat(p)));
  await signInAgent(p, 'Ziad', '000000').catch(() => {}); await p.waitForTimeout(300);
  check('A1 a wrong code is refused with a plain message', /not recognised/.test(await flat(p)) && await p.locator('#out').count() === 0);
  await signInAgent(p, 'Ziad', '194627');
  let t = await flat(p);
  check('A2 Ziad (rota 06:00-13:30, done for the day): "Shift finished", in 5:55, out 13:34', /Shift finished/.test(t) && (await p.locator('#k-in').innerText()) === '05:55' && (await p.locator('#k-out').innerText()) === '13:34', await p.locator('#k-in').innerText());
  check('A3 Ziad: break 1 x 15m, worked 7h 24m', (await p.locator('#k-brk').innerText()) === '15m 00s' && (await p.locator('#k-work').innerText()) === '7h 24m' && /Break time \(1\)/.test(t), await p.locator('#k-work').innerText());
  check('A4 the rota for today is shown', /Your rota today 06:00–13:30/.test(t));
  await p.click('#out'); await signInAgent(p, 'Yousra', '735018');
  t = await flat(p);
  check('A5 Yousra at 17:15: on a break since 17:10, clocked in 15:07, on shift ~2h08m', /On a break/.test(t) && (await p.locator('#k-in').innerText()) === '15:07' && /^2:0[89]:\d\d$/.test(await p.locator('#k-shift').innerText()), await p.locator('#k-shift').innerText());
  const big0 = await p.locator('#big').innerText();
  check('A6 the big timer is the current break (about 5 minutes) and counts', /^0:0[56]:\d\d$/.test(big0), big0);
  await p.waitForTimeout(2100); const big1 = await p.locator('#big').innerText();
  check('A7 ...and moves on by itself every second', big1 !== big0, big0 + ' -> ' + big1);
  check('A8 week table: Monday late 6 min (rota 15:00, in 15:06), Tuesday shows on shift', /6 min late/.test(t) && /on shift|On shift/.test(t));
  check('A9 the scan button says what the next scan will be recorded as', /would be recorded as: Break end/.test(t));
  await p.click('#scan'); await p.waitForTimeout(400);
  t = await flat(p);
  check('A10 after the scan: on shift again, 1 break counted; a second scan within a minute would be ignored as a double scan', /On shift/.test(t) && /Break time \(1\)/.test(t) && /would be recorded as: ignored/.test(t));
  await p.click('#s15'); await p.waitForTimeout(300);
  check('A11 demo clock +15 min moves "now" forward, and the next scan would now be a Break start', /17:30/.test(await flat(p)) && /would be recorded as: Break start/.test(await flat(p)));
  await p.click('#pw'); await p.waitForTimeout(300); t = await flat(p);
  check('A12 previous week is browsable; history exists', /Week of Mon,? 26 Oct/.test(t) && /Clock in/.test(t) && (await p.locator('.tbl tbody tr.past').count()) === 7);
  await p.click('#tw'); await p.click('#out'); await signInAgent(p, 'Youness', '482913'); await p.click('#pw'); await p.waitForTimeout(300);
  check('A13 Youness Thu 29 Oct forgot to clock out: flagged "no clock-out", no invented hours', /no clock-out/.test(await flat(p)) && (await p.locator('.tbl tbody tr:has-text("29 Oct") td').nth(5).innerText()) === '—');
  check('A14 no page errors so far', errs.length === 0, errs.join(' | '));

  /* ───────────── admin page, demo data (same browser: shares the demo store with the agent page) ───────────── */
  await c.close(); c = await ctx(); const a = await page(c, AG);
  await signInAgent(a, 'Yousra', '735018');                           // Yousra on break
  const d = await page(c, AD);
  check('D0 admin sign-in page, wrong password refused', await d.locator('#go').count() === 1);
  await d.fill('#em', 'admin@demo.test'); await d.fill('#pw', 'nope'); await d.click('#go'); await d.waitForTimeout(200);
  check('D1 wrong password: error, still signed out', /Wrong email or password/.test(await flat(d)));
  await d.fill('#em', 'admin@demo.test'); await d.fill('#pw', 'admin123'); await d.click('#go'); await d.waitForSelector('.tiles');
  t = await flat(d);
  check('D2 Today tiles at 17:15 Tue: 0 on shift, 1 on break (Yousra), 1 finished (Ziad), 2 day off', (await d.locator('.tile b').allInnerTexts()).join(',') === '0,1,0,1,2', (await d.locator('.tile b').allInnerTexts()).join(','));
  check('D3 cards: one per agent, status chips', await d.locator('.ag').count() === 4 && /On a break/.test(t) && /Finished/.test(t) && /Day off/.test(t));
  check('D4 Yousra card: in 15:07, 7 min late, rota 15:00–22:00', /In 15:07/.test(t) && /7 min late/.test(t) && /Rota 15:00–22:00/.test(t));
  check('D5 Ziad card: worked 7h 24m today, out 13:34', /7h 24m/.test(t) && /out 13:34/.test(t));
  const secs0 = await d.locator('.ag [data-since]').first().innerText(); await d.waitForTimeout(2100);
  check('D6 live timers count up', secs0 !== await d.locator('.ag [data-since]').first().innerText());
  // the agent page scans -> admin updates (other tab, same demo store)
  await a.click('#scan'); await a.waitForTimeout(500);
  await d.waitForFunction(() => /On shift/.test(document.body.innerText) && document.querySelectorAll('.tile b')[0].innerText === '1', null, { timeout: 5000 }).catch(() => {});
  check('D7 a scan on the agent page shows on the admin board without reloading', (await d.locator('.tile b').allInnerTexts()).join(',') === '1,0,0,1,2', (await d.locator('.tile b').allInnerTexts()).join(','));
  check('D8 the missing clock-out from 29 Oct is called out on Today', /Shifts with no clock-out: Youness/.test(await flat(d)));
  // weekly report
  await d.click('[data-tab=week]'); await d.waitForSelector('.tbl');
  t = await flat(d);
  check('D9 weekly report, week of 2 Nov: 4 agents x 7 days + totals', /Week of Mon,? 2 Nov – Sun,? 8 Nov/.test(t) && await d.locator('.tbl tbody tr').count() === 4 && await d.locator('.tbl thead th').count() === 12);
  check('D10 Youness Monday has in/out, worked and breaks; Thursday (not yet) shows the rota only', /0[56]:\d\d–1[23]:\d\d/.test(await d.locator('.tbl tbody tr').first().innerText()) && /06:00–13:00/.test(await d.locator('.tbl tbody tr').first().innerText()));
  const [dl] = await Promise.all([d.waitForEvent('download'), d.click('#dl')]); const csvPath = await dl.path(); const csv = fs.readFileSync(csvPath, 'utf8');
  check('D11 the CSV downloads with a sensible name and content', /^weekly-report-2026-11-02\.csv$/.test(dl.suggestedFilename()) && csv.startsWith('﻿Weekly report') && /Yousra,2026-11-02,Mon,15:00-22:00,15:06/.test(csv) && /Ziad,2026-11-03,Tue,06:00-13:30,05:55,13:34,1,00:15/.test(csv), csv.split('\r\n')[3]);
  const [dl2] = await Promise.all([d.waitForEvent('download'), d.click('[data-csv="2"]')]);
  const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
  check('D12 the per-agent CSV only has that agent', /Ziad/.test(csv2) && !/Yousra/.test(csv2) && /Ziad_/.test(dl2.suggestedFilename().replace('.csv', '_')) );
  await d.click('#pw'); await d.waitForTimeout(400); t = await flat(d);
  check('D13 previous week: Khalil never clocked in on 29 Oct (rota says he works) is marked', /no clock-in/.test(t) && /no clock-out|no out/.test(t));
  // punch log
  await d.click('[data-tab=log]'); await d.waitForSelector('#ld');
  t = await flat(d);
  check('D14 punch log lists today\'s scans with what each was taken as', /Clock in/.test(t) && /Break start/.test(t) && /Break end/.test(t) && /worked out from the order/.test(t));
  await d.selectOption('#la', 'Ziad'); await d.waitForTimeout(200);
  check('D15 filter by agent', await d.locator('.tbl tbody tr').count() === 4 && !/Yousra/.test(await d.locator('.tbl tbody').innerText()), String(await d.locator('.tbl tbody tr').count()));
  // agents + setup
  await d.click('[data-tab=agents]'); await d.waitForSelector('#asave');
  await d.fill('#an', 'Salma'); await d.click('#asave'); await d.waitForTimeout(300);
  check('D16 a new agent needs a code', /Set a code/.test(await flat(d)));
  await d.fill('#an', 'Salma'); await d.fill('#ac', '12'); await d.click('#asave'); await d.waitForTimeout(200);
  check('D17 a code must be 4 to 8 digits', /4 to 8 digits/.test(await flat(d)));
  await d.fill('#an', 'Salma'); await d.fill('#ac', '556677'); await d.click('#asave'); await d.waitForTimeout(400);
  check('D18 agent added', /Saved Salma/.test(await flat(d)) && /Salma/.test(await d.locator('.tbl').last().innerText()));
  const sql = await d.locator('.sql').innerText();
  check('D19 the setup SQL is on the page (your pt_punches table, one admin, agent lookup)', /create table if not exists public\.pt_punches/.test(sql) && /pt_admin/.test(sql) && /pt_agent_view/.test(sql));
  const a2 = await page(c, AG); await signInAgent(a2, 'Salma', '556677');
  check('D20 the new agent can sign in on the agent page with the code the admin set', /Hi Salma/.test(await flat(a2)) && /Not clocked in/.test(await flat(a2)));
  await d.click('[data-tab=today]'); await d.waitForTimeout(300);
  await d.reload(); await d.waitForSelector('.tiles');
  check('D21 signing in on the admin page survives a reload (demo)', await d.locator('.tiles').count() === 1);
  await d.click('#so'); await d.waitForSelector('#go');
  check('D22 sign out returns to the login', await d.locator('#go').count() === 1);
  check('D23 no page errors', errs.length === 0, errs.join(' | '));
  await c.close();

  /* ───────────── narrow screen ───────────── */
  c = await ctx(420); const n = await page(c, AG); await signInAgent(n, 'Yousra', '735018');
  check('M1 phone width: no sideways scroll on the agent page', await n.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await n.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  const nd = await page(c, AD); await nd.fill('#em', 'admin@demo.test'); await nd.fill('#pw', 'admin123'); await nd.click('#go'); await nd.waitForSelector('.tiles');
  check('M2 phone width: no sideways scroll on the admin page', await nd.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await nd.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await nd.screenshot({ path: path.join(dir, 'fp_admin_phone.png') }); await c.close();

  /* ───────────── live mode (Supabase) with a stand-in for the database ───────────── */
  const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
  const live = async (user, w = 1300) => { const c = await ctx(w); await c.addInitScript(`window.__USER = ${JSON.stringify(user)}; ${MOCK}; localStorage.setItem('fp_conn', JSON.stringify({ url: 'https://x.supabase.co', key: 'k'.repeat(40) }));`); return c; };
  c = await live({ email: 'boss@x.com', app_metadata: { pt_admin: true } });
  let L = await page(c, AD); await L.fill('#em', 'boss@x.com'); await L.fill('#pw', 'pw'); await L.click('#go'); await L.waitForSelector('.tiles');
  t = await flat(L);
  check('V1 live admin: signs in through Supabase auth and reads pt_agents / pt_punches', /Connected to your Supabase project/.test(t) && await L.locator('.ag').count() === 3 && /Zed/.test(t) && /Newbie/.test(t), String(await L.locator('.ag').count()));
  check('V1b live: your pt_punches rows are understood (shift IN/OUT, break IN/OUT): Zed on a break, Amal on shift', /Zed On a break/.test(t.replace(/\s+/g, ' ')) && /Amal On shift/.test(t.replace(/\s+/g, ' ')), t.replace(/\s+/g, ' ').slice(200, 520));
  check('V2 live: no demo tools, no demo logins', await L.locator('.demo').count() === 0 && !/admin123/.test(t));
  await L.evaluate(() => window.__RT.forEach(h => h.cb({ new: {} })));
  await L.waitForTimeout(400);
  check('V3 live: a realtime INSERT makes the page re-read', (await L.evaluate(() => window.__READS.punches)) >= 2, String(await L.evaluate(() => window.__READS.punches)));
  await L.click('[data-tab=agents]'); await L.waitForSelector('#asave');
  await L.fill('#an', 'Nour'); await L.fill('#ac', '4321'); await L.click('#asave'); await L.waitForTimeout(400);
  check('V4 live: adding an agent calls the pt_upsert_agent function (the code is never stored by the page)', (await L.evaluate(() => window.__RPC)).some(r => r.fn === 'pt_upsert_agent' && r.args.p_name === 'Nour' && r.args.p_code === '4321'));
  await L.click('[data-tab=agents]'); await L.waitForSelector('#asave');
  check('V4b live: a name that has scans but is not in pt_agents is flagged, so the admin can give it a code', /Newbie has scans, not added yet/.test(await flat(L)));
  await c.close();
  c = await live({ email: 'agent@x.com', app_metadata: {} });
  L = await page(c, AD); await L.fill('#em', 'agent@x.com'); await L.fill('#pw', 'pw'); await L.click('#go'); await L.waitForSelector('#so');
  check('V5 live: any other account is told it has no access and sees no data', /not the fingerprint admin/.test(await flat(L)) && await L.locator('.tiles').count() === 0);
  await c.close();
  c = await live({}); const LA = await page(c, AG); await signInAgent(LA, 'Zed', '1234');
  check('V6 live agent page: signs in through pt_agent_view, shows the shift', /Hi Zed/.test(await flat(LA)) && (await LA.evaluate(() => window.__RPC)).some(r => r.fn === 'pt_agent_view' && r.args.p_name === 'Zed' && r.args.p_code === '1234'));
  check('V7 live agent page reads nothing from the tables directly', (await LA.evaluate(() => window.__READS.punches + window.__READS.agents)) === 0);
  check('V7b live agent page: Zed is on a break (his break finger was scanned)', /On a break/.test(await flat(LA)));
  await LA.click('#out'); await signInAgent(LA, 'Zed', 'wrong').catch(() => {}); await LA.waitForTimeout(300);
  check('V8 live: wrong code message', /not recognised/.test(await flat(LA)));
  await c.close();

  check('E9 no page errors anywhere', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
