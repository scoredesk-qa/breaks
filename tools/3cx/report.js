#!/usr/bin/env node
// Prints the per-agent report and alerts for a status_log.csv written by logger.js.
//   node tools/3cx/report.js path/to/status_log.csv [YYYY-MM-DD] [--tz 1] [--now "2026-10-27 13:00:00"]
// --tz   UTC offset of the clock the log was written in (default 0)
// --now  treat this moment as "now" for calls and breaks still in progress (default: the real now)
const fs = require('fs');
const A = require('./analyze');

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const tz = Number(flag('--tz') ?? 0);
const nowArg = flag('--now');
const [file, day] = args;
if (!file) { console.log('usage: node tools/3cx/report.js status_log.csv [YYYY-MM-DD] [--tz 1] [--now "YYYY-MM-DD HH:MM:SS"]'); process.exit(1); }

// Accept the logger's folder as well as the file itself, and say what's wrong in plain words
let csvPath = file;
if (fs.existsSync(csvPath) && fs.statSync(csvPath).isDirectory()) csvPath = require('path').join(csvPath, 'status_log.csv');
if (!fs.existsSync(csvPath)) { console.log(`Can't find ${csvPath}\nPoint this at the logger's status_log.csv (or the folder that contains it).`); process.exit(1); }

const rows = A.parseCsv(fs.readFileSync(csvPath, 'utf8'));
if (!rows.length) { console.log(`${csvPath} has no rows yet. Let the logger run for a while, then try again.`); process.exit(1); }
const result = A.analyze(rows, { day: day || rows.length && rows[rows.length - 1].timestamp.slice(0, 10), tzOffsetHours: tz,
  now: nowArg ? A.parseStamp(nowArg, tz) : Date.now() });
console.log(A.report(result));
