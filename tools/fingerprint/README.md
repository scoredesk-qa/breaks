# Fingerprint clock — test pages

Two standalone HTML test pages (no changes to the app's `index.html`):

| File | For | What it does |
|---|---|---|
| `FP_Agent_TEST.html` | agents (no accounts) | name + personal code → clock-in / clock-out, live "on shift" timer, breaks, this week |
| `FP_Admin_TEST.html` | the one admin | today's board, weekly report (CSV download), every scan, agents and their codes, the setup SQL |

```
python3 tools/fingerprint/build.py <output folder>            # writes both pages
node tools/fingerprint/core_test.js                           # shift / break / report logic
node tools/fingerprint/test_pages.js <output folder>          # browser test (demo data + a stand-in for Supabase)
```

Both pages open on **demo data** (the four people in the Fusion24 rota, "now" = Tue 3 Nov 17:15, with a Fingerprint scan button and a clock you can move on).
Open "Using demo data … (change)" and put in a Supabase URL + public key to use your real pt_punches table (after running `pt_setup.sql`) instead.

## How it fits the clock app (`zkclock`)

Nothing changes in the clock app. The clock server already uploads part-time punches to `public.pt_punches` (`emp, ts, day, name, kind, dir`) once
`supabase_url` and `supabase_key` (the service_role key) are set in `server.json`. Part-timers have two fingers: `Sara (PT)` = shift (IN = clock in, OUT = clock out)
and `Sara (PT break)` = break (IN = break start, OUT = break end). The pages group both fingers under the name `Sara`.

`pt_setup.sql` keeps your table and `pt_admin` rule and adds `pt_agents` (a code per agent), `pt_agent_view` (an agent sees only their own punches) and live updates.

## Security

* The clock server writes with its service_role key (never put that key in a web page). Nobody with the public key can read or write punches.
* Agents have no accounts: `pt_agent_view(name, code)` returns only that agent's punches; 5 wrong codes lock the name for 15 minutes. Codes are stored hashed.
* Exactly one account is the admin: the one marked `app_metadata.pt_admin = true` (the same flag your Part-time tab uses; see the end of `pt_setup.sql`). Row-level security enforces it in the database, not just in the page.
