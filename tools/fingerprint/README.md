# Fingerprint clock — test pages

Two standalone HTML test pages (no changes to the app's `index.html`):

| File | For | What it does |
|---|---|---|
| `FP_Agent_TEST.html` | agents (no accounts) | badge number + personal code → clock-in / clock-out, live "on shift" timer, breaks, this week |
| `FP_Admin_TEST.html` | the one admin | today's board, weekly report (CSV download), every scan, agents and their codes, the setup SQL |

```
python3 tools/fingerprint/build.py <output folder>            # writes both pages
node tools/fingerprint/core_test.js                           # shift / break / report logic
node tools/fingerprint/test_pages.js <output folder>          # browser test (demo data + a stand-in for Supabase)
```

Both pages open on **demo data** (the four people in the Fusion24 rota, "now" = Tue 3 Nov 17:15, with a Fingerprint scan button and a clock you can move on).
Open "Using demo data … (change)" and put in a Supabase URL + public key to use the real tables from `fp_setup.sql` instead.

## What the scanner app has to write

One row per scan into `public.fp_punches`: `badge_id` (the user ID on the scanner), `punched_at` (the real time, with time zone) and, if the scanner
knows it, `punch_type` (`in`, `out`, `break_start`, `break_end`). With no `punch_type` the pages work it out from the order of the scans:
first scan = clock-in, then break start / break end, and the scan 6 hours after clock-in or within 45 minutes of the rota end = clock-out.
Double scans within a minute are ignored; a shift still open after 16 hours is shown as "no clock-out".

## Security

* The scanner app uses the public key and may only **add** punches. Nobody with that key can read anything.
* Agents have no accounts: `fp_agent_view(badge, code)` returns only that badge's punches; 5 wrong codes lock the badge for 15 minutes. Codes are stored hashed.
* Exactly one account is the admin: the one marked `app_metadata.fp_admin = true` (see the end of `fp_setup.sql`). Row-level security enforces it in the database, not just in the page.
