#!/usr/bin/env python3
"""Builds the two standalone TEST pages (agent view and admin view) from the sources in this folder.
   python3 tools/fingerprint/build.py <output folder>"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); out = sys.argv[1]; os.makedirs(out, exist_ok=True)
rd = lambda n: open(os.path.join(HERE, n), encoding='utf-8').read()
rota = json.dumps(json.load(open(os.path.join(HERE, 'rota.json'), encoding='utf-8')), ensure_ascii=False)
scripts = '\n'.join([rd('core.js'), 'const FP_ROTA = ' + rota + ';', rd('db.js'), rd('ui.js')])
sql = rd('pt_setup.sql'); assert '`' not in sql and '${' not in sql and '</script' not in sql
scripts += '\nconst FP_SETUP_SQL = `' + sql + '`;'
assert '</script' not in scripts
for name, dest in (('agent.html', 'FP_Agent_TEST.html'), ('admin.html', 'FP_Admin_TEST.html')):
    s = rd(name).replace('<!--CSS-->', rd('shared.css')).replace('<!--SCRIPTS-->', scripts)
    open(os.path.join(out, dest), 'w', encoding='utf-8').write(s); print('written', os.path.join(out, dest), len(s))
