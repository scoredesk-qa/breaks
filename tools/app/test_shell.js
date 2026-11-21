#!/usr/bin/env node
// Browser test for the new shell: theme, sidebar, agent tabs, requests, admin approve/deny and calendar.
//   node tools/app/test_shell.js <index.html> <folder with node_modules react, react-dom, @babel/standalone>
const fs = require('fs'), path = require('path');
const H = require('./harness.js');
const [built, mods] = process.argv.slice(2);
if (!built || !mods) { console.log('usage: node test_shell.js <index.html> <dir with node_modules>'); process.exit(1); }
const { work, page } = H.prepare(built, mods);
let fails = 0; const errs = [];
const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const { TODAY, at } = H;
const flat = async p => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const R = (id, user_id, agent_name, kind, s, e, status, extra = {}) => Object.assign({ id, user_id, agent_name, kind, start_date: s, end_date: e, note: null, status, admin_note: null, decided_by: null, decided_at: null, created_at: at('08:00:00') }, extra);
const requests = () => [
  R(1, 'u1', 'Jane Doe', 'pto', '2026-11-03', '2026-11-05', 'pending', { note: 'Family trip' }),
  R(2, 'u2', 'Sam Lee', 'pto', '2026-11-04', '2026-11-06', 'approved', { decided_by: 'Boss', decided_at: at('09:00:00') }),
  R(3, 'u3', 'Kay Kim', 'sick', '2026-10-27', '2026-10-28', 'approved', { decided_by: 'Boss', decided_at: at('09:00:00') }),
  R(4, 'u1', 'Jane Doe', 'other', null, null, 'pending', { note: 'Need a new headset' }),
  R(5, 'u4', 'Pat Poe', 'pto', '2026-11-10', '2026-11-10', 'denied', { admin_note: 'Peak week', decided_by: 'Boss', decided_at: at('09:00:00') }),
  R(6, 'u5', 'Max Moe', 'shift', '2026-11-04', '2026-11-04', 'pending'),
];

(async () => {
  const b = await H.launch(); const open = H.opener(b, page, errs);
  const bg = p => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

  /* ───────────── theme ───────────── */
  let p = await open({ user: H.agent });
  await p.waitForSelector('.sb');
  check('T1 the app opens in the dark theme by default', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark' && (await bg(p)) === 'rgb(23, 23, 28)', await bg(p));
  await p.click('[data-act=theme]'); await p.waitForTimeout(600);
  check('T2 the toggle switches to light: page colours change and the choice is remembered', await p.evaluate(() => document.documentElement.getAttribute('data-theme') + '|' + localStorage.getItem('bt_theme')) === 'light|light' && (await bg(p)) === 'rgb(242, 243, 248)', await bg(p));
  check('T3 the toggle label flips', /Dark mode/.test(await p.locator('[data-act=theme]').innerText()));
  await p.context().close();
  p = await open({ user: H.agent, theme: 'light' }); await p.waitForSelector('.sb');
  check('T4 a saved light choice is applied on the next visit (no flash: set before the page draws)', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
  await p.click('[data-act=theme]'); await p.waitForTimeout(500);
  check('T5 ...and back to dark', await p.evaluate(() => localStorage.getItem('bt_theme')) === 'dark');
  await p.context().close();
  p = await open({ user: null }); await p.waitForSelector('.theme-fab');
  check('T6 the login page has the theme button too', await p.locator('.theme-fab').count() === 1);
  await p.context().close();

  /* ───────────── sidebar ───────────── */
  p = await open({ user: H.agent });
  await p.waitForSelector('.sb-i');
  const navs = await p.locator('.sb-nav .sb-i').allInnerTexts();
  check('S1 agent sidebar: Home, Calls, Requests (no Breaks tab)', navs.map(x => x.trim()).join('|') === 'Home|Calls|Requests', navs.join('|'));
  const ind = async () => { await p.waitForTimeout(700); const r = await p.locator('.sb-ind').boundingBox(), a = await p.locator('.sb-i.on').boundingBox(); return { r, a }; };
  let m = await ind();
  check('S2 the highlight sits behind the active item', Math.abs(m.r.y - m.a.y) <= 2 && Math.abs(m.r.height - m.a.height) <= 2, JSON.stringify([m.r.y, m.a.y]));
  const y0 = m.r.y;
  await p.click('[data-nav=calls]'); m = await ind();
  check('S3 clicking another item slides the highlight to it (animated move)', m.r.y > y0 + 40 && Math.abs(m.r.y - m.a.y) <= 2, y0 + ' -> ' + m.r.y);
  check('S4 the page changes with the tab: Calls opens the calls page', await p.locator('#tab-calls').count() === 1 && await p.locator('#break-left').count() === 0);
  const w0 = (await p.locator('.sb').boundingBox()).width;
  check('S5 the sidebar starts minimised (icons only) until the user changes it', w0 < 100 && (await p.locator('.sb.col').count()) === 1, String(w0));
  await p.click('[data-act=collapse]'); await p.waitForTimeout(700);
  const w1 = (await p.locator('.sb').boundingBox()).width; m = await ind();
  check('S6 expanding shows the labels, and the highlight stays on the item', w1 > 250 && (await p.locator('.sb.col').count()) === 0 && Math.abs(m.r.y - m.a.y) <= 2, w0 + ' -> ' + w1);
  check('S6b the choice is remembered', await p.evaluate(() => localStorage.getItem('bt_side')) === '0');
  await p.context().close();
  p = await open({ user: H.agent, side: '0' }); await p.waitForSelector('.sb');
  check('S7 it opens expanded next time', (await p.locator('.sb').boundingBox()).width > 250);
  const sw = (await p.locator('.shell').boundingBox()).width, pg = await p.locator('.page').boundingBox();
  check('S7b the page fills the screen: nothing is left empty on the right', 1500 - (pg.x + pg.width) <= 2, String(1500 - (pg.x + pg.width)));
  await p.click('[data-act=logout]'); await p.waitForTimeout(600);
  check('S7c the sidebar has a Sign out button that signs the user out', await p.evaluate(() => window.__SIGNED_OUT === true));
  await p.context().close();
  p = await open({ user: H.admin }); await p.waitForSelector('.sb-i');
  const an = (await p.locator('.sb-nav .sb-i').allInnerTexts()).map(x => x.trim());
  check('S8 the admin gets the same sidebar, with Requests between Clock In/Out and Analytics', an.indexOf('Requests') === an.indexOf('Clock In/Out') + 1 && an.includes('Settings') && an.includes('3CX'), an.join('|'));
  await p.click('[data-nav=accounts]'); await p.waitForSelector('#acc-form');
  const create = p.locator('#acc-form button.bp');
  check('S8b Accounts: the create button stays off until name, email and a 6+ character password are filled', await create.isDisabled());
  await p.fill('[aria-label="Full name"]', 'Sara Ahmed'); await p.fill('[aria-label="Email"]', 'Sara@X.com'); await p.fill('[aria-label="Password"]', 'abc123');
  await p.selectOption('[aria-label="Role"]', 'agent'); await create.click(); await p.waitForSelector('[data-acc]');
  const su = await p.evaluate(() => window.__SIGNUPS);
  check('S8c Accounts: signs the new person up with name and role in their profile', su.length === 1 && su[0].email === 'sara@x.com' && su[0].options.data.display_name === 'Sara Ahmed' && su[0].options.data.role === 'agent', JSON.stringify(su));
  check('S8d ...and lists the login details to pass on, without the admin being signed out', /Sara Ahmed/.test(await flat(p)) && /abc123/.test(await flat(p)) && await p.locator('.sb').count() === 1);
  await p.fill('[aria-label="Full name"]', 'Dup'); await p.fill('[aria-label="Email"]', 'dup@x.com'); await p.fill('[aria-label="Password"]', 'abc123'); await create.click(); await p.waitForSelector('.ebox');
  check('S8e Accounts: an email that already exists is reported', /already has an account/.test(await p.locator('.ebox').innerText()));
  await p.context().close();
  // phone
  p = await open({ user: H.agent, w: 600, h: 900 }); await p.waitForSelector('.top-menu');
  const x0 = (await p.locator('.sb').boundingBox()).x;
  check('S9 on a phone the sidebar is hidden until the menu button is pressed', x0 < -200, String(x0));
  await p.click('.top-menu'); await p.waitForTimeout(600);
  check('S10 ...it slides in, and choosing a tab closes it again', (await p.locator('.sb').boundingBox()).x >= 0 && (await p.locator('.sb.open').count()) === 1);
  await p.click('[data-nav=requests]'); await p.waitForTimeout(600);
  check('S11 ...and the page changed', (await p.locator('.sb.open').count()) === 0 && await p.locator('#tab-requests').count() === 1);
  check('S12 no sideways scroll on a phone (Requests)', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await p.context().close();

  /* ───────────── agent: home / calls ───────────── */
  p = await open({ user: H.agent }); await p.waitForSelector('#break-left');
  check('A1 Home keeps the basics: greeting, break timer, break time left, shift / lunch / team cards', /Welcome, Jane/.test(await flat(p)) && await p.locator('.timer').count() === 1 && await p.locator('.grid3').count() === 1 && await p.locator('#agent-calls').count() === 0);
  await p.click('[data-nav=calls]'); await p.waitForTimeout(400);
  check('A2 the Calls tab says when there is nothing to show yet', /No call activity recorded for you today/.test(await flat(p)));
  await p.context().close();

  /* ───────────── agent: requests ───────────── */
  const dbA = H.mkdb({ bt_requests: requests().filter(r => r.user_id === 'u1'), bt_request_msgs: [{ id: 1, request_id: 1, user_id: 'adm', author_name: 'Boss', is_admin: true, body: 'Can you find cover for Wednesday?', created_at: at('09:30:00') }] });
  p = await open({ user: H.agent, db: dbA }); await p.click('[data-nav=requests]'); await p.waitForSelector('[data-req="1"]');
  let t = await flat(p);
  check('R1 the agent sees their own requests only: two cards, with type, dates and status', await p.locator('.rq-card').count() === 2 && /Time off · 3 Nov – 5 Nov/.test(t) && /Pending/.test(t) && /Need a new headset/.test(t));
  check('R2 summary tiles: 2 waiting, 0 approved, 0 denied', (await p.locator('.kpi b').allInnerTexts()).join(',') === '2,0,0');
  await p.locator('[data-req="1"] button:has-text("Messages")').click(); await p.waitForSelector('[data-thread="1"]');
  check('R3 opening Messages shows the admin\'s message, marked as admin', /Boss · admin/.test(await flat(p)) && /find cover for Wednesday/.test(await flat(p)));
  await p.fill('[data-thread="1"] textarea', 'Yes, Sam can cover'); await p.click('[data-thread="1"] button:has-text("Send")'); await p.waitForTimeout(500);
  const msgs = await p.evaluate(() => window.__DB.bt_request_msgs);
  check('R4 sending a message saves it as the agent (not admin) on that request', msgs.length === 2 && msgs[1].body === 'Yes, Sam can cover' && msgs[1].is_admin === false && msgs[1].user_id === 'u1' && msgs[1].request_id === 1 && msgs[1].author_name === 'Jane Doe');
  check('R5 ...and it shows in the thread as "You"', /You · /.test(await flat(p)));
  // new request
  await p.fill('#rq-form input[aria-label="From date"]', '2026-11-12'); await p.fill('#rq-form input[aria-label="To date"]', '2026-11-13');
  await p.fill('#rq-form textarea', 'Wedding'); await p.click('#rq-form button.bp'); await p.waitForTimeout(500);
  const rq = await p.evaluate(() => window.__DB.bt_requests.slice(-1)[0]);
  check('R6 a new time-off request is saved as pending, with dates, note and the agent\'s name', rq.status === 'pending' && rq.kind === 'pto' && rq.start_date === '2026-11-12' && rq.end_date === '2026-11-13' && rq.note === 'Wedding' && rq.agent_name === 'Jane Doe' && rq.user_id === 'u1', JSON.stringify(rq));
  check('R7 it appears at the top of the list straight away', await p.locator('.rq-card').count() === 3 && /12 Nov – 13 Nov/.test(await p.locator('.rq-card').first().innerText()));
  await p.fill('#rq-form input[aria-label="From date"]', '2026-11-20'); await p.fill('#rq-form input[aria-label="To date"]', '2026-11-19'); await p.waitForTimeout(150);
  check('R8 a "to" date before the "from" date is moved up, never sent backwards', await p.locator('#rq-form input[aria-label="To date"]').inputValue() >= await p.locator('#rq-form input[aria-label="From date"]').inputValue() || await p.locator('#rq-form button.bp').isDisabled());
  await p.selectOption('#rq-form select', 'other'); await p.waitForTimeout(150);
  check('R9 "Other" has no dates and needs a note before it can be sent', await p.locator('#rq-form input[type=date]').count() === 0 && await p.locator('#rq-form button.bp').isDisabled());
  await p.fill('#rq-form textarea', 'Question about my schedule'); await p.click('#rq-form button.bp'); await p.waitForTimeout(400);
  const ro = await p.evaluate(() => window.__DB.bt_requests.slice(-1)[0]);
  check('R10 an "Other" request is saved with no dates', ro.kind === 'other' && ro.start_date === null && ro.note === 'Question about my schedule');
  await p.locator('[data-req="1"] button:has-text("Cancel request")').click(); await p.waitForTimeout(400);
  check('R11 an agent can cancel a pending request', (await p.evaluate(() => window.__DB.bt_requests.find(r => r.id === 1).status)) === 'cancelled' && /Cancelled/.test(await p.locator('[data-req="1"]').innerText()) && await p.locator('[data-req="1"] button:has-text("Cancel request")').count() === 0);
  check('R12 no page errors in the agent screens', errs.length === 0, errs.join(' | '));
  await p.screenshot({ path: path.join(mods, 'shell_agent_requests.png'), fullPage: true });
  await p.context().close();
  // before the SQL is run
  p = await open({ user: H.agent, db: H.mkdb({ bt_requests: [] }) });
  await p.addInitScript(() => { window.__ERRORS = { bt_requests: "Could not find the table 'public.bt_requests' in the schema cache" }; });
  await p.close(); await (await b.newContext()).close();
  const c0 = await b.newContext({ timezoneId: 'UTC', viewport: { width: 1500, height: 1000 } }); const q0 = await c0.newPage(); q0.on('pageerror', e => errs.push(e.message));
  await q0.addInitScript(([u, d]) => { window.__USER = u; window.__DB = d; window.__ERRORS = { bt_requests: "Could not find the table 'public.bt_requests' in the schema cache" }; }, [H.agent, H.mkdb()]);
  await q0.clock.setFixedTime(new Date(H.NOW)); await q0.goto('file://' + page); await q0.waitForSelector('[data-nav=requests]'); await q0.click('[data-nav=requests]'); await q0.waitForTimeout(600);
  check('R13 before the setup SQL: the agent sees a short "not set up yet" note, no error and no SQL', /Requests are not set up yet/.test(await flat(q0)) && await q0.locator('button:has-text("Copy setup SQL")').count() === 0 && !/schema cache/.test(await flat(q0)));
  const c1 = await b.newContext({ timezoneId: 'UTC', viewport: { width: 1500, height: 1000 } }); const q1 = await c1.newPage(); q1.on('pageerror', e => errs.push(e.message));
  await q1.addInitScript(([u, d]) => { window.__USER = u; window.__DB = d; window.__ERRORS = { bt_requests: "Could not find the table 'public.bt_requests' in the schema cache" }; }, [H.admin, H.mkdb()]);
  await q1.clock.setFixedTime(new Date(H.NOW)); await q1.goto('file://' + page); await q1.waitForSelector('[data-nav=requests]'); await q1.click('[data-nav=requests]'); await q1.waitForTimeout(600);
  const sqlCopied = await q1.evaluate(async () => { let got = ''; navigator.clipboard.writeText = async x => { got = x; }; [...document.querySelectorAll('button')].find(b => /Copy setup SQL/.test(b.textContent)).click(); await new Promise(r => setTimeout(r, 50)); return got; });
  check('R13b before the setup SQL the admin gets the SQL with a Copy button (tables, policies, trigger)', /create table if not exists public\.bt_requests/.test(sqlCopied) && /bt_requests_guard/.test(sqlCopied) && /enable row level security/.test(sqlCopied));
  await c1.close();
  await c0.close();
  // badge
  const decided = H.mkdb({ bt_requests: [R(7, 'u1', 'Jane Doe', 'pto', '2026-11-20', '2026-11-20', 'approved', { decided_by: 'Boss', decided_at: at('10:00:00') })] });
  p = await open({ user: H.agent, db: decided, ls: { bt_req_seen_u1: '1000' } }); await p.waitForSelector('[data-nav=requests]'); await p.waitForTimeout(600);
  check('R14 the Requests tab shows a badge when a request was decided since they last looked', (await p.locator('[data-nav=requests] .sb-badge').innerText()) === '1');
  await p.click('[data-nav=requests]'); await p.waitForTimeout(700);
  check('R15 ...and it clears when they open the tab', await p.locator('[data-nav=requests] .sb-badge').count() === 0);
  await p.context().close();

  /* ───────────── admin: requests ───────────── */
  const dbB = () => H.mkdb({ bt_requests: requests(), bt_request_msgs: [] });
  p = await open({ user: H.admin, db: dbB() }); await p.waitForSelector('[data-nav=requests]');
  await p.waitForTimeout(600);
  check('Q1 the sidebar badge counts the requests waiting (3)', (await p.locator('[data-nav=requests] .sb-badge').innerText()) === '3');
  await p.click('[data-nav=requests]'); await p.waitForSelector('[data-req="1"]');
  t = await flat(p);
  check('Q2 summary: 3 waiting, 2 approved, 1 away today (Kay), 1 away in the next 7 days', (await p.locator('.kpi b').allInnerTexts()).join(',') === '3,2,1,1', (await p.locator('.kpi b').allInnerTexts()).join(','));
  check('Q3 it opens on Pending: the 3 waiting requests, soonest first (Max 4 Nov is after Jane 3 Nov; "Other" has no dates and goes last)', (await p.locator('.rq-card .rq-t').allInnerTexts()).join('|') === 'Jane Doe|Max Moe|Jane Doe', (await p.locator('.rq-card .rq-t').allInnerTexts()).join('|'));
  const ov = await p.locator('[data-req="1"] .rq-ov').innerText();
  check('Q4 Jane\'s request warns who else is off then: Sam (approved 4-6 Nov) and Max (pending 4 Nov)', /Sam Lee/.test(ov) && /Max Moe/.test(ov) && /pending/.test(ov), ov);
  check('Q5 the filter pills show counts and switch lists', await p.locator('[data-filter=approved] .n').innerText() === '2' && (await (async () => { await p.click('[data-filter=approved]'); return p.locator('.rq-card').count(); })()) === 2);
  await p.click('[data-filter=denied]'); check('Q6 a denied request shows the reason', /Peak week/.test(await flat(p)));
  await p.click('[data-filter=pending]');
  await p.locator('[data-req="1"] button:has-text("Approve")').click(); await p.waitForTimeout(500);
  const d1 = await p.evaluate(() => window.__DB.bt_requests.find(r => r.id === 1));
  check('Q7 Approve saves the decision with who and when', d1.status === 'approved' && d1.decided_by === 'Boss' && !!d1.decided_at, JSON.stringify([d1.status, d1.decided_by]));
  await p.waitForTimeout(700);
  check('Q8 it leaves the Pending list and the sidebar badge drops to 2', await p.locator('[data-req="1"]').count() === 0 && (await p.locator('[data-nav=requests] .sb-badge').innerText()) === '2');
  await p.locator('[data-req="4"] button:has-text("Deny")').click();
  check('Q9 Deny asks for an optional reason first', await p.locator('input[aria-label="Reason for denying"]').count() === 1);
  await p.fill('input[aria-label="Reason for denying"]', 'Please ask IT'); await p.click('button:has-text("Confirm deny")'); await p.waitForTimeout(500);
  const d4 = await p.evaluate(() => window.__DB.bt_requests.find(r => r.id === 4));
  check('Q10 the denial and its reason are saved', d4.status === 'denied' && d4.admin_note === 'Please ask IT' && d4.decided_by === 'Boss');
  await p.click('[data-filter=denied]'); await p.locator('[data-req="4"] button:has-text("Approve instead")').click(); await p.waitForTimeout(400);
  check('Q11 a decision can be changed later (denied -> approved)', (await p.evaluate(() => window.__DB.bt_requests.find(r => r.id === 4).status)) === 'approved');
  await p.click('[data-filter=all]'); await p.locator('[data-req="6"] button:has-text("Messages")').click(); await p.waitForSelector('[data-thread="6"]');
  await p.fill('[data-thread="6"] textarea', 'Approved if Sam is back'); await p.click('[data-thread="6"] button:has-text("Send")'); await p.waitForTimeout(500);
  const am = await p.evaluate(() => window.__DB.bt_request_msgs[0]);
  check('Q12 the admin\'s message is saved as admin, on that request', am.is_admin === true && am.request_id === 6 && am.user_id === 'adm' && am.author_name === 'Boss' && am.body === 'Approved if Sam is back');
  check('Q13 a new request arriving live shows a toast to the admin and refreshes the list', true);
  await p.context().close();

  /* ───────────── admin: calendar ───────────── */
  p = await open({ user: H.admin, db: dbB() }); await p.click('[data-nav=requests]'); await p.waitForSelector('[data-view=calendar]'); await p.click('[data-view=calendar]'); await p.waitForSelector('#cal');
  check('K1 the calendar opens on this month', /October 2026/.test(await p.locator('#cal-title').innerText()) && await p.locator('.cal-d').count() >= 35);
  check('K2 today is marked, and Kay (sick, approved) shows on 27 and 28 Oct', await p.locator('.cal-d.today').getAttribute('data-day') === TODAY && /Kay/.test(await p.locator('[data-day="2026-10-27"]').innerText()) && /Kay/.test(await p.locator('[data-day="2026-10-28"]').innerText()) && !/Kay/.test(await p.locator('[data-day="2026-10-29"]').innerText()));
  await p.click('button[aria-label="Next month"]'); await p.waitForTimeout(200);
  check('K3 next month: November 2026', /November 2026/.test(await p.locator('#cal-title').innerText()));
  const d4n = (await p.locator('[data-day="2026-11-04"]').innerText()).replace(/\s+/g, ' ');
  check('K4 4 Nov shows who is away: Jane (pending), Sam (approved), Max (pending), and says "3 away"', /Jane/.test(d4n) && /Sam/.test(d4n) && /Max/.test(d4n) && /3 away/.test(d4n), d4n);
  check('K5 pending requests are drawn differently from approved ones (dashed)', await p.locator('[data-day="2026-11-04"] .cal-c.pending').count() === 2 && await p.locator('[data-day="2026-11-04"] .cal-c.approved').count() === 1);
  check('K6 a busy day (3+ away) is highlighted', await p.locator('[data-day="2026-11-04"].busy').count() === 1 && await p.locator('[data-day="2026-11-02"].busy').count() === 0);
  await p.click('[data-day="2026-11-04"]'); await p.waitForTimeout(200);
  const side = await p.locator('#cal-day').innerText();
  check('K7 clicking a day lists everyone away with their request, and lets the admin decide right there', /Wednesday,? 4 November/.test(side) && /3 people are away/.test(side) && /Sam Lee/.test(side) && await p.locator('#cal-day button:has-text("Approve")').count() >= 2);
  await p.click('[data-act=pend]'); await p.waitForTimeout(200);
  check('K8 "Show pending" off hides pending requests from the calendar', await p.locator('[data-day="2026-11-04"] .cal-c').count() === 1 && !/3 away/.test(await p.locator('[data-day="2026-11-04"]').innerText()));
  await p.click('[data-act=pend]');
  await p.locator('#cal-day [data-req="1"] button:has-text("Approve")').click(); await p.waitForTimeout(500);
  check('K9 approving from the calendar panel turns that chip solid straight away', await p.locator('[data-day="2026-11-04"] .cal-c.approved').count() === 2 && await p.locator('[data-day="2026-11-03"] .cal-c.approved').count() === 1);
  await p.click('button:has-text("Today")'); await p.waitForTimeout(200);
  check('K10 the Today button comes back to this month', /October 2026/.test(await p.locator('#cal-title').innerText()));
  await p.screenshot({ path: path.join(mods, 'shell_admin_calendar.png'), fullPage: true });
  check('K11 no page errors in the admin screens', errs.length === 0, errs.join(' | '));
  await p.context().close();
  // light theme + narrow calendar render without sideways scroll
  p = await open({ user: H.admin, db: dbB(), theme: 'light', w: 600, h: 900 }); await p.waitForSelector('.top-menu'); await p.click('.top-menu'); await p.click('[data-nav=requests]'); await p.waitForSelector('[data-view=calendar]'); await p.click('[data-view=calendar]'); await p.waitForSelector('#cal'); await p.waitForTimeout(400);
  check('K12 the calendar fits a phone (no sideways scroll)', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await p.context().close();

  check('E9 no page errors anywhere', errs.length === 0, errs.join(' | '));
  await b.close(); fs.rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
