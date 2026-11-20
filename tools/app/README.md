# App changes: agent view, Settings clean-up, new shell, requests

The app's `index.html` is built in two steps from the current page:

```
python3 tools/app/build_app.py   <current index.html>  stage1.html     # agent break-time-left + call stats, Settings clean-up
python3 tools/app/build_shell.py stage1.html           index.html      # theme, sidebar, agent tabs, requests + calendar
```

Each replacement must match exactly once, so the scripts fail loudly on a version they do not know.

| One-time SQL (Supabase SQL Editor) | What it adds |
|---|---|
| `agent_stats_setup.sql` | break allowance + shared 3CX limits in `bt_settings`, and `cx_team_day` (an agent's own call data + anonymous team data) |
| `requests_setup.sql` | `bt_requests`, `bt_request_msgs` (row-level security, decision guard trigger, realtime) |

Tests (stand-in database, real browser): `test_app.js` (agent view, Settings), `test_shell.js` (theme, sidebar, tabs, requests, calendar). `harness.js` is shared.
Run them with `node tools/app/test_app.js <index.html> <dir with node_modules>` (React, ReactDOM and @babel/standalone installed there).

Both SQL files were also run on a throwaway Postgres: an agent can only see and create their own requests, cannot approve, change decision fields or post as admin,
and other agents cannot read or write someone else's thread.
