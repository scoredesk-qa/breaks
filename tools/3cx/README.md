# 3CX status logger: analysis and tests

**Status: test only. Nothing here is connected to the app or to Supabase.**

`logger.js` (from the 3CX status logger) watches the 3CX web client and writes one CSV row each time an
agent's presence changes (`Available`, `Ringing`, `On call`, `Break`, `Admin`, `Offline`, or any custom status).
`analyze.js` turns that log into the things the admin wants:

| Wanted | How it is worked out |
|---|---|
| **Agent breaks, pulled from 3CX** | every `Break`/`Lunch`/`Bathroom` stretch is recorded and compared with the agent's own entries (`toBreakLogs`, `compareBreaks`); 3CX never overwrites them |
| **Admin time per agent** | total time in the `Admin` status |
| **Calls and total call time per agent** | every `On call` stretch is a call; talk time is the sum |
| **Ringing but not answered** | a `Ringing` stretch that ends in anything other than `On call` |
| **Calls under 1 minute** | an `On call` stretch shorter than 60 s (possible dropped call) |
| **Alerts to admin** | `ignored_call`, `repeated_ignore` (3 in an hour), `short_call` |

## Run it

```
node tools/3cx/test.js                                   # 95 checks on made-up data (tools/3cx/fixtures)
node tools/3cx/report.js path/to/status_log.csv 2026-10-27 --tz 0     # --tz = UTC offset of the logger PC
CX_REAL_CSV=path/to/status_log.csv node tools/3cx/test.js   # also sanity-checks a real log
```

No packages to install (the logger itself needs Playwright, the analysis does not).

## The rules, and what they can't know

These come from presence only, so they are good guesses and not proof. All the numbers are settings
(`DEFAULTS` in `analyze.js`).

- **Ignored call:** the ring lasted at least `ignoreRingSec` (10 s) and ended without the agent going on a call.
  - If **another agent answered at the same moment** (a group or queue ring), it is *not* an ignore (`taken_by_other`).
  - A ring shorter than 10 s is a `short_ring`: the caller most likely hung up first. It is counted, but never alerted.
  - A ring that ends with the phone going `Offline` still counts as ignored, and the alert says so.
- **Short call:** an `On call` stretch under `shortCallSec` (60 s) that has finished. A call still going is never flagged.
  Presence can't tell a dropped call from a wrong number or a quick transfer, so this is "worth a look".
- **Partial calls:** when the logger starts (or restarts) it only sees the current status, not when it began.
  Those stretches are marked `partialStart`: counted, but never called "short", and the time is understated.
- **Timestamps** in the CSV are written on the clock of the PC that runs the logger, with no zone. Tell the analysis that
  PC's UTC offset (`--tz` on the command line, `tzOffsetHours` in code; **0 if the PC is on UTC+0**). A wrong value shifts
  everything by that many hours, and a break or call still in progress then shows the wrong length. Cutting the log into days
  can use a different clock (`dayOffsetHours`, the app's Settings → Clock).
- **Names:** 3CX has `Sghir, Abdulkarim`, the app has `Abdulkarim Sghir`. They are matched ignoring order, case and accents.
  Anyone without a match is returned as `unmatched` (never guessed).
- **Gaps:** if the logger stops (PC off, 3CX signed out), the last status is assumed to continue until the next row.
  `logger.log` records those stops; the analysis doesn't read it yet.

## The logger now uploads to Supabase

`logger.js` can also post every status change to a Supabase table (`status_log`: `changed_at`, `extension`, `agent`, `old_status`,
`new_status`, `detail`) when a `supabase.json` (`url`, `key`, optional `table`) is next to it; unsent rows wait in `outbox.jsonl`.
`agents.txt` limits which extensions are logged. `supabase.json.example` shows the format. **Never commit** `supabase.json`,
`outbox.jsonl` or `agents.txt` (`.gitignore` covers them).

`rowsFromStatusLog` (in `analyze.js`) turns those rows into the same form as the CSV. They hold real instants (`changed_at` is UTC),
so the logger PC's time zone does not matter for them. The test page's **Live from Supabase** button reads the table (read-only,
refreshed every 30 seconds). The key the logger uses is the public `anon` key, so the table needs a policy that lets the logger insert;
admins need one that lets them read (the page offers the SQL if Supabase refuses).

## The test page (a local copy of the app with a 3CX page)

`build_test_page.py` builds a copy of the app's `index.html` with a **3CX (test)** admin page and a "3CX call alerts"
section in Settings. It never changes `index.html` and uploads nothing; open the file it writes straight from your disk.

```
git show origin/main:index.html > main_index.html
python3 tools/3cx/build_test_page.py main_index.html BreakTrack_TEST_3cx.html
```

The page source is in `tools/3cx/page/` (`page.jsx`, `settings.jsx`, `page.css`). It shows a day strip, team statistics with a
calls-per-hour chart, an alerts list, one profile card per agent (stats and a dotted timeline of the working day) and the
breaks that would be logged. Click a card for the agent's full profile. Only agents that exist in the app are shown.

Browser test (Playwright; uses a mock database, never the real one):

```
node tools/3cx/page/test_page.js BreakTrack_TEST_3cx.html <folder containing node_modules/react, react-dom, @babel/standalone>
```

## Proposed integration (not built)

1. **Collect.** Keep the logger on one PC. Instead of (or as well as) the CSV, it posts each row to a new table
   `bt_3cx_events (id, at timestamptz, ext, agent, old_status, new_status, detail)`. The key stays on the logger PC only.
2. **Admin page "3CX".** Day picker, one row per agent (calls, talk time, average, short calls, rings, ignored,
   admin time, break time) and an alerts list. Alerts also go to the existing admin notification toast as they happen.
3. **Breaks.** 3CX breaks are only *recorded* (in their own table) and compared with what the agents entered in the app (`bt_logs`).
   They are never written into `bt_logs` and never change an agent's entry (`compareBreaks`). The admin page shows, per agent,
   what the agent logged, what 3CX shows and the difference. The comparison is **not** added to the alerts. The only notification is one
   a day, `breakCheckLeadMin` (10) minutes before the shift end set in Settings, naming the agents whose breaks differ (none if nothing does).
4. **Alerts.** Raised as the rows arrive, so the admin sees an ignored call within seconds, not at the end of the day.

Decisions that change the build: which is the source of truth for breaks (the app's button or 3CX); whether a
ring of 10 s is the right "ignored" limit; whether inbound and outbound calls need separating (the logger can't see direction);
and who may see these pages.

## Never commit

`.gitignore` here already excludes `profile/` (the logger's browser profile **contains the 3CX sign-in**),
`status_log.csv`, `logger.log`, `logger.pid`, `debug.txt` and `snapshot.txt`.
