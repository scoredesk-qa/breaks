# App changes: agent view and Settings clean-up

`build_app.py <current index.html> <new index.html>` applies the changes (each replacement must match exactly once, so it fails loudly on a different version).
`test_app.js` is the browser test (stand-in database). `agent_stats_setup.sql` is the one-time SQL the app also shows in Settings.

* Settings: removed the 3CX logger PC clock (only for CSV files) and the separate "where the logger uploads" connection; 3CX limits are saved in `bt_settings.cx_config` for everyone; new "Break allowance" section.
* Agent page: "Break time left" (1h 45m per full 8h shift, earned by the hour), "Your calls today" (calls, talk time, admin time, ignored rings, short-call warning) and calls per hour against the team average.
