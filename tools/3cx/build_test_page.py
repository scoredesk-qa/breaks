#!/usr/bin/env python3
"""Builds a LOCAL test copy of the app with the 3CX page added. Nothing is uploaded and index.html is not changed.

  python3 tools/3cx/build_test_page.py <path to the app's index.html> <output .html>

Typical use, to test against what is on GitHub (main):
  git show origin/main:index.html > /tmp/main_index.html
  python3 tools/3cx/build_test_page.py /tmp/main_index.html BreakTrack_TEST_3cx.html
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
raw = open(src, newline='').read()
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')

analyze = open(os.path.join(HERE, 'analyze.js')).read()
sample = open(os.path.join(HERE, 'fixtures', 'status_log.sample.csv')).read()
settings = open(os.path.join(HERE, 'page', 'settings.jsx')).read()
page = open(os.path.join(HERE, 'page', 'page.jsx')).read()
css = open(os.path.join(HERE, 'page', 'page.css')).read()
assert '`' not in sample and '${' not in sample          # the sample is embedded in a template string


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:70], s.count(old))
    s = s.replace(old, new)


rep('</head>', '<style>\n.testribbon{position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:99999;background:#b45309;color:#fff;'
    'font:600 12px/1 system-ui,sans-serif;letter-spacing:.04em;padding:6px 14px;border-radius:0 0 8px 8px;pointer-events:none}\n'
    + css + '\n</style>\n</head>')
rep('<title>', '<title>TEST COPY · ')
rep('<div id="root"></div>', '<div class="testribbon">TEST COPY · not the live page · the 3CX page saves nothing</div>\n<div id="root"></div>')

module = ('/* ═══ 3CX analysis (copy of tools/3cx/analyze.js) ═══ */\nconst CX = (function(){ const module = { exports: {} }; const exports = module.exports;\n'
          + analyze + '\nreturn module.exports; })();\nconst CX_SAMPLE = `' + sample + '`;\n')
rep('/* ── Icons ── */', module + '\n/* ── Icons ── */')
rep('const PATHS = {', 'const PATHS = {\n  phone:    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",')
rep("    {id:'trainees', n:'users',    label:'Trainees'},", "    {id:'trainees', n:'users',    label:'Trainees'},\n    {id:'cx',       n:'phone',    label:'3CX (test)'},")
rep("          {tab==='trainees'  &&<ATrainees/>}", "          {tab==='trainees'  &&<ATrainees/>}\n          {tab==='cx'        &&<A3cx go={go}/>}")
rep("      <AShiftEnd/>", "      <AShiftEnd/>\n      <A3cxSettings/>")
rep('function AShiftEnd(){', settings + page + 'function AShiftEnd(){')

open(out, 'w', newline='').write(s.replace('\n', '\r\n') if crlf else s)
print('written', out, len(s))
