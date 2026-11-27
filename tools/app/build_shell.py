#!/usr/bin/env python3
"""Second stage: new app shell. Run after build_app.py.

  python3 tools/app/build_shell.py <index.html from build_app.py> <output index.html>

  * dark / light theme (toggle remembered in the browser)
  * one animated sidebar for admin AND agent
  * agent page split into tabs (Home, Calls, Breaks, Requests)
  * requests (time off and other) with a message thread, and for the admin an approve / deny list plus a month calendar

Every replacement must match exactly once, so the script fails loudly on a version it does not know."""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
raw = open(src, newline='', encoding='utf-8').read()
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')
req_sql = open(os.path.join(HERE, 'requests_setup.sql'), encoding='utf-8').read()
assert '`' not in req_sql and '${' not in req_sql
bonus_sql = open(os.path.join(HERE, 'bonus_setup.sql'), encoding='utf-8').read()
assert '`' not in bonus_sql and '${' not in bonus_sql
BONUS_JS = open(os.path.join(HERE, 'bonus.js'), encoding='utf-8').read().replace('__BONUS_SQL__', bonus_sql)


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:90], s.count(old))
    s = s.replace(old, new)


def drop_lines(starts):
    """remove whole CSS lines that start with one of `starts` (after leading spaces); every prefix must exist"""
    global s
    lines = s.split('\n'); kept = []; hit = {p: 0 for p in starts}
    for l in lines:
        t = l.lstrip(' ')
        p = next((p for p in starts if t.startswith(p)), None)
        if p: hit[p] += 1; continue
        kept.append(l)
    assert all(hit.values()), [p for p, n in hit.items() if not n]
    s = '\n'.join(kept)


# ═════════════════════════════ 1. theme + CSS ═════════════════════════════
rep("<style>\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}",
    "<script>(function(){var t='dark';try{var v=localStorage.getItem('bt_theme');if(v==='light'||v==='dark')t=v;}catch(e){}document.documentElement.setAttribute('data-theme',t);})();</script>\n"
    "<style>\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}")

# colours that were fixed for the dark theme become variables, so light mode can change them
for a, b in (("#ff8fa3", "var(--bad-txt)"), ("#f7b3c1", "var(--bad-txt)"), ("#fca5a5", "var(--bad-txt)"),
             ("#ffb86b", "var(--warn-txt)"), ("#ffc966", "var(--warn-txt)"), ("#ffd98c", "var(--warn-txt)"),
             ("#bcc5ff", "var(--acc-txt)"), ("#b9c2ff", "var(--acc-txt)"), ("#b3bdff", "var(--acc-txt)"), ("#c6cdff", "var(--acc-txt)"), ("#9aa6ff", "var(--acc-txt)")):
    s = s.replace(a, b)
rep("  --r-card:16px;\n}", "  --r-card:22px;\n  --top-bg:rgba(23,23,28,.86);--pop:#202027;--tile:#212128;--track:#2a2a33;--shadow:0 24px 60px rgba(0,0,0,.5);\n"
    "  --bad-txt:#ff8fa3;--warn-txt:#ffb86b;--acc-txt:#bcc5ff;\n"
    "  --sb-bg:#1b1b21;--sb-bdr:#2b2b33;--sb-txt:#b4b4c0;--sb-hover:rgba(255,255,255,.06);--sb-on:rgba(255,255,255,.09);--sb-acc:#8e9cff;--sb-w:272px;--sb-wc:86px;\n}")

# the old sidebar is replaced by the new one
drop_lines(['.side{width:340px', '.side-org{', '.side-org .chev', '.side-nav{', '.side-sec{', '.ni{', '.ni svg', '.ni:hover', '.ni.on{', '.ni.on svg', '.ni .nbadge',
            '.side-ft{', '.side-ft .muted', '.scrim{display:none}', '.side{width:280px}', '.side{position:fixed', '.side.open{', '.scrim.open{'])
rep(".top{height:94px;padding:0 120px 0 120px;display:flex;align-items:center;gap:24px;position:sticky;top:0;z-index:20;background:rgba(23,23,28,.86);",
    ".top{height:84px;padding:0 44px;display:flex;align-items:center;gap:24px;position:sticky;top:0;z-index:20;background:var(--top-bg);")
rep(".page{padding:44px 120px 90px;max-width:1660px;width:100%}", ".page{padding:30px 44px 90px;max-width:none;width:100%}")
rep(".panel{padding:44px 120px 90px;max-width:1660px}", ".panel{padding:30px 44px 90px;max-width:none}")
rep("  .top,.page,.panel{padding-left:56px;padding-right:56px}\n", "  .top,.page,.panel{padding-left:36px;padding-right:36px}\n")

NEW_CSS = r"""
/* ═════ new shell: floating sidebar, theme, requests, calendar ═════ */
:root[data-theme="light"]{
  --bg:#f2f3f8;--side:#fff;--surf:#ffffff;--card:#eceef5;--card2:#e2e5ef;--hover:#f0f2f8;
  --bdr:#e4e7ef;--bdr-lt:#d6dae6;
  --txt:#15161c;--txt2:#3a3d4b;--mut:#6b7081;--mut2:#98a0b3;
  --violet:#4f5fe6;--violet-hi:#5d6cf0;--link:#4251d6;
  --amber:#4f5fe6;--amber-d:rgba(79,95,230,.1);--amber-r:rgba(79,95,230,.3);--amber-glow:rgba(79,95,230,.3);
  --indigo:#8a4fc4;--indigo-d:rgba(138,79,196,.1);--indigo-r:rgba(138,79,196,.28);
  --blue:#2c7fd0;--blue-d:rgba(44,127,208,.1);--blue-r:rgba(44,127,208,.28);
  --green:#17915f;--green-d:rgba(23,145,95,.1);--green-r:rgba(23,145,95,.28);--green-glow:rgba(23,145,95,.3);
  --red:#d3425c;--red-d:rgba(211,66,92,.09);--red-r:rgba(211,66,92,.26);
  --top-bg:rgba(242,243,248,.86);--pop:#ffffff;--tile:#f1f3f9;--track:#e3e6ef;--shadow:0 24px 60px rgba(30,34,60,.16);
  --bad-txt:#c1304b;--warn-txt:#a35a05;--acc-txt:#3f4ed0;
  --sb-bg:#0f1014;--sb-bdr:#0f1014;--sb-txt:#aeb0bf;--sb-hover:rgba(255,255,255,.07);--sb-on:rgba(255,255,255,.13);--sb-acc:#9aa8ff;
}
:root[data-theme="light"] ::selection{background:rgba(79,95,230,.25);color:inherit}
:root[data-theme="light"] ::-webkit-scrollbar-thumb{background:#c9cddb}
.theming *,.theming *::before,.theming *::after{transition:background-color .35s,color .35s,border-color .35s,fill .35s,stroke .35s,box-shadow .35s!important}

/* light theme: the places that used fixed dark colours */
[data-theme="light"] .card,[data-theme="light"] .sblk,[data-theme="light"] .stat,[data-theme="light"] .sc,[data-theme="light"] .lunch-group-card,[data-theme="light"] .tile,[data-theme="light"] .rq-card,[data-theme="light"] .lunch-pill{box-shadow:0 1px 2px rgba(25,28,50,.04),0 10px 30px rgba(25,28,50,.05)}
[data-theme="light"] .wm-icon{background:#e9ebf3;box-shadow:none}
[data-theme="light"] .wm-t{color:var(--txt)}
[data-theme="light"] select.fi option,[data-theme="light"] select.fi option,[data-theme="light"] .type-sel option{background:#fff}
[data-theme="light"] .srch-in:focus{border-color:var(--link);background:#fff}
[data-theme="light"] .kbd span{background:#e9ebf3}
[data-theme="light"] .srch-pop,[data-theme="light"] .mn-pop{background:var(--pop);box-shadow:var(--shadow)}
[data-theme="light"] .avb{background:linear-gradient(145deg,#6b7bff,#4251d6);color:#fff}
[data-theme="light"] .vbadge{background:#e6e9ff}
[data-theme="light"] .seg{background:#eceef5}[data-theme="light"] .seg button.on{background:#fff}
[data-theme="light"] .ch-tip,[data-theme="light"] .acc-tip,[data-theme="light"] .toast,[data-theme="light"] .modal-box{background:#fff;box-shadow:var(--shadow)}
[data-theme="light"] .acc-ic{background:#eef0f7;box-shadow:inset 0 0 0 1.5px #c3c8d8}
[data-theme="light"] .acc-ic.brk{background:#e8ebff}[data-theme="light"] .acc-ic.lun{background:#f2e9fb}[data-theme="light"] .acc-ic.bth{background:#e5f1fc}[data-theme="light"] .acc-ic.more{background:#e9ebf3}
[data-theme="light"] .onb-bar,[data-theme="light"] .bar,[data-theme="light"] .tbar-track span{background:#e3e6ef}
[data-theme="light"] .legend i.f{background:#b9bfd0}
[data-theme="light"] .tiles>div,[data-theme="light"] .cx-tiles>div{background:var(--tile)}
[data-theme="light"] .fab{background:#fff;box-shadow:0 8px 28px rgba(25,28,50,.16)}[data-theme="light"] .fab:hover{background:#f3f4fa}
[data-theme="light"] .av,[data-theme="light"] .cx-av{background:#eef0f7;box-shadow:inset 0 0 0 1.5px #c3c8d8}
[data-theme="light"] .cx-card{background:linear-gradient(180deg,#ffffff,#f6f7fc)}
[data-theme="light"] .cx-bar,[data-theme="light"] .cx-mix,[data-theme="light"] .cx-tl-track,[data-theme="light"] .al-bar{background:var(--track)}
[data-theme="light"] .cx-seg{border-right-color:#fff}
[data-theme="light"] .cx-tip{background:#fff;color:var(--txt);box-shadow:var(--shadow)}
[data-theme="light"] .cx-day.on{background:#4f5fe6;border-color:#4f5fe6;color:#fff}[data-theme="light"] .cx-day.on span{color:#dfe3ff}
[data-theme="light"] .cx-lt em{background:rgba(20,22,40,.08)}
[data-theme="light"] .al-bar b{background:#15161c}
[data-theme="light"] .al-flag{color:#fff;background:#d98a0b}
[data-theme="light"] .cx-bad{background:rgba(211,66,92,.12)}
[data-theme="light"] .cx-two2>.card{scrollbar-color:#c9cddb transparent}
[data-theme="light"] .cx-two2>.card::-webkit-scrollbar-thumb{background:#c9cddb}
[data-theme="light"] .lunch-pill.now{border-color:#d98a0b;color:#a35a05;background:#fff8ea}[data-theme="light"] .lunch-pill.now b{color:#7a4303}
[data-theme="light"] .instr.connecting .lite{background:#e0a02c}
[data-theme="light"] svg [stroke="#2b2b33"]{stroke:#e4e7ef}
[data-theme="light"] svg [fill="#7c7c88"]{fill:#6b7081}
[data-theme="light"] .ebox,[data-theme="light"] .awrn{background:var(--red-d)}
[data-theme="light"] .b-on,[data-theme="light"] .b-brk,[data-theme="light"] .b-a{background:var(--amber-d);color:var(--acc-txt)}
[data-theme="light"] .spin{border-color:#d6dae6;border-top-color:#15161c}
[data-theme="light"] .tbar-track i{background:linear-gradient(90deg,#4f5fe6,#8e9cff)}

/* ── sidebar ── */
.shell{display:flex;min-height:100vh}
.sb{position:sticky;top:12px;align-self:flex-start;height:calc(100vh - 24px);margin:12px 0 12px 12px;width:var(--sb-w);flex-shrink:0;background:var(--sb-bg);border:1px solid var(--sb-bdr);border-radius:30px;display:flex;flex-direction:column;overflow:hidden;z-index:30;transition:width .42s var(--ease),transform .4s var(--ease);box-shadow:0 18px 50px rgba(0,0,0,.28)}
.sb.col{width:var(--sb-wc)}
.sb-hd{height:92px;display:flex;align-items:center;gap:14px;padding:0 20px;flex-shrink:0}
.sb-logo{width:46px;height:46px;border-radius:15px;background:linear-gradient(145deg,#5266eb,#8e9cff);display:grid;place-items:center;color:#fff;flex-shrink:0;box-shadow:0 10px 24px rgba(82,102,235,.45);animation:sbLogo .8s var(--ease) both}
@keyframes sbLogo{0%{transform:scale(.6) rotate(-20deg);opacity:0}100%{transform:none;opacity:1}}
.sb-name{font-size:18px;font-weight:500;color:#fff;white-space:nowrap;letter-spacing:-.01em;transition:opacity .25s,transform .4s var(--ease)}
.sb-nav{position:relative;flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 14px 12px;display:flex;flex-direction:column;gap:4px;scrollbar-width:none}
.sb-nav::-webkit-scrollbar{display:none}
.sb-ind{position:absolute;left:14px;right:14px;top:0;border-radius:17px;background:var(--sb-on);pointer-events:none;transition:transform .45s var(--ease),height .3s var(--ease),opacity .2s;z-index:0}
.sb-ind::before{content:'';position:absolute;left:-14px;top:24%;bottom:24%;width:4px;border-radius:0 5px 5px 0;background:var(--sb-acc);box-shadow:0 0 14px var(--sb-acc)}
.sb-i{position:relative;z-index:1;height:52px;flex-shrink:0;display:flex;align-items:center;gap:16px;padding:0 15px;border:none;background:none;border-radius:17px;color:var(--sb-txt);font-size:15.5px;font-family:inherit;cursor:pointer;text-align:left;white-space:nowrap;width:100%;transition:color .2s,background .2s;animation:sbIn .6s var(--ease) both;animation-delay:calc(var(--i,0)*32ms + 120ms)}
@keyframes sbIn{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:none}}
.sb-i:hover{color:#fff;background:var(--sb-hover)}
.sb-i:hover .sb-ic{transform:translateX(2px) scale(1.1)}
.sb-i:focus-visible{outline:2px solid var(--sb-acc);outline-offset:-2px}
.sb-ic{width:24px;height:24px;display:grid;place-items:center;flex-shrink:0;transition:transform .3s var(--ease),color .2s}
.sb-i.on{color:#fff}
.sb-i.on .sb-ic{color:var(--sb-acc);animation:sbPop .55s var(--ease)}
@keyframes sbPop{0%{transform:scale(.7) rotate(-14deg)}55%{transform:scale(1.2) rotate(5deg)}100%{transform:none}}
.sb-lb{flex:1;transition:opacity .25s,transform .4s var(--ease)}
.sb-badge{min-width:24px;height:24px;padding:0 7px;border-radius:99px;background:var(--sb-acc);color:#13141c;font-size:12.5px;font-weight:600;display:grid;place-items:center;font-variant-numeric:tabular-nums;animation:sbBadge .5s var(--ease);transition:opacity .2s}
@keyframes sbBadge{0%{transform:scale(0)}70%{transform:scale(1.25)}100%{transform:none}}
.sb.col .sb-badge{position:absolute;top:7px;right:9px;min-width:18px;height:18px;font-size:10.5px;padding:0 4px}
.sb-sec{padding:20px 15px 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6e7081;white-space:nowrap;flex-shrink:0;transition:opacity .25s}
.sb.col .sb-name,.sb.col .sb-lb{opacity:0;transform:translateX(-10px);pointer-events:none}
.sb.col .sb-sec{padding:12px 0 6px;font-size:0}.sb.col .sb-sec::after{content:'';display:block;height:1px;background:var(--sb-hover)}
.sb-ft{padding:10px 14px 16px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--sb-hover);flex-shrink:0}
.sb-meta{display:flex;align-items:center;gap:10px;padding:8px 15px 10px;font-size:13px;color:#7e8092;white-space:nowrap;overflow:hidden}
.sb-meta span{transition:opacity .25s}.sb.col .sb-meta span{opacity:0}
.sb .instr{background:rgba(255,255,255,.08);color:#c9cad6}
.sb-sm{height:46px;font-size:14.5px}
.theme-ic{position:relative;width:22px;height:22px;display:block}
.theme-ic svg{position:absolute;inset:0;transition:transform .55s var(--ease),opacity .3s}
[data-theme="dark"] .theme-ic .t-sun{transform:rotate(-90deg) scale(.4);opacity:0}
[data-theme="light"] .theme-ic .t-moon{transform:rotate(90deg) scale(.4);opacity:0}
.sb-col-ic{transition:transform .45s var(--ease)}.sb.col .sb-col-ic{transform:rotate(180deg)}
.scrim{display:none}
.theme-fab{position:fixed;top:16px;right:16px;width:46px;height:46px;border-radius:999px;border:1px solid var(--bdr);background:var(--surf);color:var(--txt2);display:grid;place-items:center;cursor:pointer;z-index:5;transition:transform .2s}
.theme-fab:hover{transform:scale(1.06)}
@media(max-width:960px){
  .sb{position:fixed;left:12px;top:12px;bottom:12px;height:auto;margin:0;width:290px;transform:translateX(calc(-100% - 30px))}
  .sb.col{width:290px}.sb.open{transform:none}
  .sb.col .sb-name,.sb.col .sb-lb{opacity:1;transform:none;pointer-events:auto}.sb.col .sb-sec{font-size:12px;padding:20px 15px 8px}.sb.col .sb-sec::after{display:none}.sb.col .sb-meta span{opacity:1}
  .sb.col .sb-badge{position:static;min-width:24px;height:24px;font-size:12.5px}
  .sb-col-btn{display:none}
  .scrim.open{display:block;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:29;animation:fadeIn .25s}
  .top{padding:0 20px}
}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.sb,.sb *{animation:none!important}}

/* ── requests ── */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin-bottom:22px}
.kpi{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r-card);padding:20px 22px;display:flex;flex-direction:column;gap:6px}
.kpi-ic{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;margin-bottom:8px;background:var(--amber-d);color:var(--acc-txt)}
.kpi-ic.g{background:var(--green-d);color:var(--green)}.kpi-ic.r{background:var(--red-d);color:var(--red)}.kpi-ic.b{background:var(--blue-d);color:var(--blue)}.kpi-ic.p{background:var(--indigo-d);color:var(--indigo)}
.kpi b{font-size:32px;font-weight:400;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi span{font-size:14px;color:var(--mut)}
.pills{display:inline-flex;gap:4px;background:var(--card);border-radius:999px;padding:4px;flex-wrap:wrap}
.pills button{border:none;background:none;color:var(--txt2);font:inherit;font-size:14.5px;padding:8px 18px;border-radius:999px;cursor:pointer;transition:background .2s,color .2s}
.pills button.on{background:var(--txt);color:var(--bg);font-weight:500}
.pills button .n{margin-left:7px;opacity:.65;font-variant-numeric:tabular-nums}
.rq-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px}
.rq-grid{display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:22px;align-items:start}
@media(max-width:1100px){.rq-grid{grid-template-columns:1fr}}
.rq-form{padding:26px;display:flex;flex-direction:column;gap:14px}
.rq-form h2,.rq-h{font-size:18px;font-weight:500;margin-bottom:2px}
.rq-form label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--mut)}
.rq-form textarea,.rq-compose textarea{min-height:84px;resize:vertical;font:inherit}
.rq-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.rq-two>label,.rq-form .fi{min-width:0}.rq-form input[type=date]{padding-left:10px;padding-right:8px}
.rq-list{display:flex;flex-direction:column;gap:14px}
.rq-card{background:var(--surf);border:1px solid var(--bdr);border-radius:var(--r-card);padding:20px 22px;display:flex;flex-direction:column;gap:12px;animation:rqIn .4s var(--ease) both}
@keyframes rqIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.rq-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.rq-ico{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;flex-shrink:0;background:var(--amber-d);color:var(--acc-txt)}
.rq-ico.document{background:var(--green-d);color:var(--green)}.cal-c.document{background:var(--green-d);color:var(--green)}.rq-ico.sick{background:var(--red-d);color:var(--red)}.rq-ico.shift{background:var(--blue-d);color:var(--blue)}.rq-ico.other{background:var(--indigo-d);color:var(--indigo)}
.rq-t{font-size:16.5px;font-weight:500}.rq-s{font-size:13.5px;color:var(--mut);margin-top:2px}
.rq-sp{margin-left:auto}
.rq-note{font-size:14.5px;color:var(--txt2);line-height:1.5;white-space:pre-wrap}
.rq-dec{font-size:13.5px;color:var(--mut);border-left:3px solid var(--bdr-lt);padding-left:12px}
.rq-ov{font-size:13.5px;color:var(--warn-txt);display:flex;gap:8px;align-items:flex-start}
.rq-acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.st{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 12px;font-size:12.5px;font-weight:500;background:var(--card);color:var(--txt2)}
.st.pending{background:rgba(245,165,36,.16);color:var(--warn-txt)}.st.approved{background:var(--green-d);color:var(--green)}.st.denied{background:var(--red-d);color:var(--red)}.st.cancelled{background:var(--card);color:var(--mut)}
.btn-ok{background:var(--green);color:#fff;border:none;border-radius:999px;padding:9px 18px;font:inherit;font-size:14.5px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:filter .15s,transform .1s}
.btn-ok:hover{filter:brightness(1.08)}.btn-ok:active{transform:scale(.97)}
.btn-no{background:var(--red-d);color:var(--red);border:1px solid var(--red-r);border-radius:999px;padding:9px 18px;font:inherit;font-size:14.5px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
.btn-no:hover{background:var(--red-r)}
.thread{border-top:1px solid var(--bdr);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.msgs{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;padding-right:4px}
.msg{max-width:86%;padding:10px 14px;border-radius:16px;background:var(--card);font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.msg small{display:block;font-size:11.5px;color:var(--mut);margin-bottom:3px}
.msg.mine{align-self:flex-end;background:var(--violet);color:#fff;border-bottom-right-radius:5px}.msg.mine small{color:rgba(255,255,255,.75)}
.msg.theirs{border-bottom-left-radius:5px}
.rq-compose{display:flex;gap:10px;align-items:flex-end}.rq-compose textarea{min-height:44px;height:44px;flex:1}
.rq-empty{padding:46px 20px;text-align:center;color:var(--mut)}
/* calendar */
.cal-head{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}.cal-head h2{font-size:22px;font-weight:400;min-width:190px}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.cal-w{font-size:12.5px;color:var(--mut);padding:0 8px 4px;text-transform:uppercase;letter-spacing:.06em}
.cal-d{position:relative;min-height:112px;border:1px solid var(--bdr);border-radius:16px;padding:8px 8px 6px;background:var(--surf);display:flex;flex-direction:column;gap:4px;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .15s,transform .15s,background .15s}
.cal-d:hover{border-color:var(--link);transform:translateY(-1px)}
.cal-d.out{opacity:.45}.cal-d.we{background:var(--bg)}
.cal-d.today .cal-n{background:var(--violet);color:#fff}
.cal-d.sel{border-color:var(--link);box-shadow:0 0 0 2px var(--amber-r)}
.cal-d.busy{background:linear-gradient(180deg,rgba(245,165,36,.12),transparent 70%)}
.cal-n{font-size:13px;width:26px;height:26px;border-radius:99px;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.cal-c{font-size:12px;border-radius:7px;padding:2px 7px;background:var(--amber-d);color:var(--acc-txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-c.sick{background:var(--red-d);color:var(--red)}.cal-c.shift{background:var(--blue-d);color:var(--blue)}.cal-c.other{background:var(--indigo-d);color:var(--indigo)}
.cal-c.pending{background:transparent;border:1px dashed var(--mut2);color:var(--txt2)}
.cal-m{font-size:11.5px;color:var(--mut);padding-left:3px}
.cal-cnt{position:absolute;top:8px;right:9px;font-size:11.5px;color:var(--warn-txt);font-weight:600}
.cal-side{padding:22px;display:flex;flex-direction:column;gap:12px}
.cal-wrap{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start}
@media(max-width:1200px){.cal-wrap{grid-template-columns:1fr}}
.cal-leg{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--mut);margin-top:14px}.cal-leg i{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:6px;vertical-align:-1px;background:var(--amber-d);border:1px solid var(--amber-r)}.cal-leg i.sick{background:var(--red-d);border-color:var(--red-r)}.cal-leg i.shift{background:var(--blue-d);border-color:var(--blue-r)}.cal-leg i.pend{background:transparent;border:1px dashed var(--mut2)}
@media(max-width:680px){.cal-d{min-height:64px;padding:5px}.cal-c{display:none}.cal-m{display:none}.cal-cnt{position:static;margin-top:auto}.cal{gap:5px}.rq-two{grid-template-columns:1fr}}
/* agent breaks tab */
.bk-bar{height:10px;border-radius:99px;background:var(--track);overflow:hidden;min-width:120px}.bk-bar i{display:block;height:100%;border-radius:99px;background:var(--violet);transition:width .6s var(--ease)}.bk-bar i.over{background:var(--red)}
.tbl{width:100%;border-collapse:collapse}.tbl th{font-weight:400;color:var(--mut);font-size:13px;text-align:left;padding:10px 12px;border-bottom:1px solid var(--bdr)}.tbl td{padding:14px 12px;border-bottom:1px solid var(--bdr)}.tbl tr:last-child td{border-bottom:0}
.tbl tr.row{cursor:pointer}.tbl tr.row:hover td{background:var(--hover)}
.tbl td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
.tab-h{margin-bottom:24px}.tab-h h1{font-size:34px;font-weight:400;letter-spacing:-.015em;line-height:1.15}.tab-h p{color:var(--mut);margin-top:6px}
"""
i = s.rindex('</style>')
s = s[:i] + NEW_CSS + s[i:]

# ═════════════════════════════ 2. icons ═════════════════════════════
rep("const PATHS = {", """const PATHS = {
  chevleft: "M15 18l-6-6 6-6",
  brand:    ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z","M10 9v6","M14 9v6"],
  calendar: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z","M16 2v4","M8 2v4","M3 10h18"],
  message:  "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  inbox:    ["M22 12h-6l-2 3h-4l-2-3H2","M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  award:    ["M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z","M8.2 13.9L7 22l5-3 5 3-1.2-8.1"],
  file:     ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6","M8 13h8","M8 17h5"],
  palm:     ["M12 22V10","M12 10c-1-4-4-6-8-5 3 0 5 2 5.5 4","M12 10c1-4 4-6 8-5-3 0-5 2-5.5 4","M12 10c-3-3-6-3-8-1 3-.5 5 .5 6.5 2","M12 10c3-3 6-3 8-1-3-.5-5 .5-6.5 2"],""")

# ═════════════════════════════ 3. components ═════════════════════════════
SHELL_JS = r"""/* ═══ Theme, sidebar, requests, calendar ═══ */
const REQ_SQL=`__REQ_SQL__`;
const THEME_KEY='bt_theme', SIDE_KEY='bt_side';
function useTheme(){
  const [t,setT]=useState(()=>document.documentElement.getAttribute('data-theme')==='light'?'light':'dark');
  const toggle=useCallback(()=>{
    const root=document.documentElement, n=root.getAttribute('data-theme')==='light'?'dark':'light';
    root.classList.add('theming'); root.setAttribute('data-theme',n);
    try{ localStorage.setItem(THEME_KEY,n); }catch(e){}
    setT(n); setTimeout(()=>root.classList.remove('theming'),450);
  },[]);
  return [t,toggle];
}
function ThemeIcon(){ return <span className="theme-ic"><span className="t-sun"><Ic n="sun" size={22}/></span><span className="t-moon"><Ic n="moon" size={22}/></span></span>; }
function ThemeFab(){
  const [t,toggle]=useTheme();
  return <button className="theme-fab" onClick={toggle} title={t==='light'?'Switch to dark mode':'Switch to light mode'} aria-label="Toggle theme"><ThemeIcon/></button>;
}

/* The BreakTrack mark: the company's folded-shard logo, recoloured to the page palette */
function BrandMark({size=32}){
  return(
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="bm">
      <defs><linearGradient id="bmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a3aeff"/><stop offset="1" stopColor="#5266eb"/></linearGradient></defs>
      <path d="M4.3 14.8L4.3 24.6L10.4 24.6Z" fill="#3b47a8" stroke="#3b47a8" strokeWidth=".8" strokeLinejoin="round"/>
      <path className="bm-w" d="M4.6 14.5L16.6 14.6L19.1 18.2L13.2 27.8Z" stroke="#f4f5ff" strokeWidth=".8" strokeLinejoin="round"/>
      <path d="M27.7 4.3L26.1 27.8L13.4 27.8Z" fill="url(#bmg)" stroke="#6b7cf0" strokeWidth=".8" strokeLinejoin="round"/>
    </svg>);
}

/* Desktop (Windows) notifications need a click to switch on */
function useNotifPerm(){
  const get=()=>('Notification' in window)?Notification.permission:'unsupported';
  const [perm,setPerm]=useState(get);
  useEffect(()=>{ const f=()=>setPerm(get()); window.addEventListener('bt-notif-perm',f); window.addEventListener('focus',f); return()=>{ window.removeEventListener('bt-notif-perm',f); window.removeEventListener('focus',f); }; },[]);
  const ask=useCallback(()=>{
    if(!('Notification' in window)) return;
    if(Notification.permission==='denied'){ fireNotification({title:'Notifications are blocked',body:'Click the padlock next to the address bar, set Notifications to Allow, then reload this page.',type:'warn',duration:14000}); return; }
    const done=p=>{ window.dispatchEvent(new Event('bt-notif-perm')); if(p==='granted'){ try{ new Notification('Notifications are on',{body:'You will get lunch and message alerts here.'}); }catch(e){} } };
    try{ const r=Notification.requestPermission(done); if(r&&r.then) r.then(done); }catch(e){}
  },[]);
  return [perm,ask];
}
function NotifBanner(){
  const [perm,ask]=useNotifPerm();
  if(perm==='granted'||perm==='unsupported') return null;
  return(
    <div className="notice hi" id="notif-banner">
      <div className="acc-ic"><Ic n="bell" size={17}/></div>
      <div className="notice-b">
        <div className="notice-t">{perm==='denied'?'Desktop notifications are blocked':'Turn on desktop notifications'}</div>
        <div className="notice-s">{perm==='denied'?'You will miss lunch reminders and messages from your supervisor. Allow notifications for this site in the browser, then reload.':'Get lunch reminders and messages from your supervisor even when this tab is in the background.'}</div>
      </div>
      <div className="notice-a"><button className="bp" onClick={ask}>{perm==='denied'?'How to fix':'Turn on'}</button></div>
    </div>);
}

/* One sidebar for admin and agent: slides a highlight to the active item, collapses to icons, remembers its state. */
function Sidebar({items,active,onGo,open,onClose,role,onLogout}){
  const [theme,toggleTheme]=useTheme();
  const [nperm,askNotif]=useNotifPerm();
  const [col,setCol]=useState(()=>{ try{ return localStorage.getItem(SIDE_KEY)!=='0'; }catch(e){ return true; } });
  const refs=useRef({});
  const [ind,setInd]=useState({y:0,h:0,on:false});
  const measure=useCallback(()=>{ const el=refs.current[active]; setInd(el?{y:el.offsetTop,h:el.offsetHeight,on:true}:{y:0,h:0,on:false}); },[active]);
  useLayoutEffect(()=>{ measure(); },[measure,items.length,col]);
  useEffect(()=>{ const id=setTimeout(measure,460); return()=>clearTimeout(id); },[col,measure]);
  useEffect(()=>{ window.addEventListener('resize',measure); return()=>window.removeEventListener('resize',measure); },[measure]);
  const toggleCol=()=>setCol(c=>{ try{ localStorage.setItem(SIDE_KEY,c?'0':'1'); }catch(e){} return !c; });
  return(<>
    <div className={`scrim${open?' open':''}`} onClick={onClose}/>
    <aside className={`sb${col?' col':''}${open?' open':''}`} aria-label="Main navigation">
      <div className="sb-hd"><div className="sb-logo"><BrandMark size={42}/></div><span className="sb-name">BreakTrack</span></div>
      <nav className="sb-nav">
        <i className="sb-ind" style={{transform:`translateY(${ind.y}px)`,height:ind.h,opacity:ind.on?1:0}}/>
        {items.filter(it=>!(col&&it.more)).map((it,i)=>it.section
          ?<div key={'s'+i} className="sb-sec">{it.section}</div>
          :<button key={it.id} ref={el=>{ refs.current[it.id]=el; }} className={`sb-i${active===it.id?' on':''}`} style={{'--i':i}} onClick={()=>onGo(it.id)}
             title={col?it.label:undefined} aria-current={active===it.id?'page':undefined} data-nav={it.id}>
            <span className="sb-ic"><Ic n={it.n} size={21} sw={1.7}/></span><span className="sb-lb">{it.label}</span>
            {it.badge>0&&<span className="sb-badge">{it.badge}</span>}
          </button>)}
      </nav>
      <div className="sb-ft">
        <div className="sb-meta"><ConnInstrument compact/><span>{role}</span></div>
        {(nperm==='default'||nperm==='denied')&&<button className="sb-i sb-sm" onClick={askNotif} data-act="notif" title="Desktop notifications are off">
          <span className="sb-ic"><Ic n="bell" size={20}/></span><span className="sb-lb">{nperm==='denied'?'Alerts blocked':'Turn on alerts'}</span>
        </button>}
        <button className="sb-i sb-sm" onClick={toggleTheme} data-act="theme" title={theme==='light'?'Switch to dark mode':'Switch to light mode'}>
          <span className="sb-ic"><ThemeIcon/></span><span className="sb-lb">{theme==='light'?'Dark mode':'Light mode'}</span>
        </button>
        <button className="sb-i sb-sm sb-col-btn" onClick={toggleCol} data-act="collapse" title={col?'Expand menu':'Collapse menu'}>
          <span className="sb-ic sb-col-ic"><Ic n="chevleft" size={20}/></span><span className="sb-lb">Collapse</span>
        </button>
        <button className="sb-i sb-sm sb-out" onClick={onLogout} data-act="logout" title="Sign out">
          <span className="sb-ic"><Ic n="logout" size={20}/></span><span className="sb-lb">Sign out</span>
        </button>
      </div>
    </aside>
  </>);
}

/* ── requests: shared bits ── */
const REQ_KINDS={pto:'Time off',document:'Document',other:'Other',sick:'Sick leave',shift:'Shift change'};
const REQ_NEW=['pto','document','other'];   // what an agent can ask for (older sick/shift requests still show)
const REQ_STATUS={pending:'Pending',approved:'Approved',denied:'Denied',cancelled:'Cancelled'};
const REQ_ICON={pto:'palm',document:'file',sick:'drop',shift:'swap',other:'message'};
const isoAdd=(iso,n)=>new Date(Date.parse(iso+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const dShort=iso=>new Date(iso+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const reqRange=r=>{ if(!r.start_date) return 'No dates'; const a=dShort(r.start_date), b=dShort(r.end_date||r.start_date); return a===b?a:`${a} – ${b}`; };
const reqDays=r=>r.start_date?Math.round((Date.parse((r.end_date||r.start_date)+'T00:00:00Z')-Date.parse(r.start_date+'T00:00:00Z'))/86400000)+1:0;
const reqOn=(r,d)=>!!r.start_date&&r.start_date<=d&&d<=(r.end_date||r.start_date);
const reqMissing=e=>/bt_requests|bt_request_msgs|schema cache|does not exist/i.test((e&&e.message)||'');
const StatusChip=({s})=><span className={`st ${s}`}>{REQ_STATUS[s]||s}</span>;

function ReqThread({req,me}){
  const [msgs,setMsgs]=useState([]);
  const [text,setText]=useState('');
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const box=useRef(null);
  const load=useCallback(async()=>{
    const {data,error}=await run(SB.from('bt_request_msgs').select('*').eq('request_id',req.id).order('created_at',{ascending:true}));
    if(!error) setMsgs(data||[]);
  },[req.id]);
  useEffect(()=>{ load(); },[load]);
  useAutoRefresh(load,8000);
  useReqChanged(load);
  useEffect(()=>{ if(box.current) box.current.scrollTop=box.current.scrollHeight; },[msgs.length]);
  const send=async()=>{
    const body=text.trim(); if(!body||busy) return;
    setBusy(true); setErr('');
    const {error}=await run(SB.from('bt_request_msgs').insert({request_id:req.id,user_id:me.id,author_name:me.name,is_admin:me.isAdmin,body}));
    setBusy(false);
    if(error){ setErr(error.message); return; }
    setText(''); load();
  };
  return(
    <div className="thread" data-thread={req.id}>
      <div className="msgs" ref={box}>
        {msgs.length===0&&<div className="rq-s">No messages yet.</div>}
        {msgs.map(m=>(
          <div key={m.id} className={`msg ${m.user_id===me.id?'mine':'theirs'}`}><small>{m.user_id===me.id?'You':m.author_name}{m.is_admin&&m.user_id!==me.id?' · admin':''} · {fmtD(m.created_at)} {hhmm(m.created_at)}</small>{m.body}</div>
        ))}
      </div>
      {err&&<div className="ebox" style={{marginBottom:0}}><Ic n="alert" size={14}/>{err}</div>}
      <div className="rq-compose">
        <textarea className="fi" placeholder="Write a message…" value={text} maxLength={2000} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } }}/>
        <button className="bp" onClick={send} disabled={busy||!text.trim()}><Ic n="send" size={15}/> Send</button>
      </div>
    </div>
  );
}

/* toasts for new requests, decisions and messages (live); screens refresh themselves through the 'bt-req' event */
const reqChanged=()=>window.dispatchEvent(new Event('bt-req'));
function useReqChanged(load){ useEffect(()=>{ window.addEventListener('bt-req',load); return()=>window.removeEventListener('bt-req',load); },[load]); }
function useRequestToasts(user,isAdmin){
  const cb=useRef(reqChanged);
  useEffect(()=>{
    const ch=SB.channel('req-toast-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'bt_requests'},({new:r})=>{
        if(isAdmin&&r.user_id!==user.id) fireNotification({title:'📥 New request',body:`${r.agent_name}: ${REQ_KINDS[r.kind]||r.kind}${r.start_date?' · '+reqRange(r):''}`,type:'info',duration:9000});
        cb.current&&cb.current();
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'bt_requests'},({new:r})=>{
        if(!isAdmin&&r.user_id===user.id&&(r.status==='approved'||r.status==='denied'))
          fireNotification({title:r.status==='approved'?'✅ Request approved':'❌ Request denied',body:`${REQ_KINDS[r.kind]||r.kind}${r.start_date?' · '+reqRange(r):''}`,type:r.status==='approved'?'info':'warn',duration:10000});
        cb.current&&cb.current();
      })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'bt_request_msgs'},({new:m})=>{
        if(m.user_id!==user.id&&(isAdmin||m.is_admin)) fireNotification({title:isAdmin?`💬 ${m.author_name}`:'💬 Message from admin',body:String(m.body).slice(0,120),type:'custom',duration:8000});
        cb.current&&cb.current();
      })
      .subscribe();
    return()=>SB.removeChannel(ch);
  },[user.id,isAdmin]);
}
/* sidebar badge: admin = requests waiting; agent = decisions and admin messages since they last opened Requests */
function useReqBadge(user,isAdmin,onTab){
  const [n,setN]=useState(0);
  const key='bt_req_seen_'+user.id;
  const load=useCallback(async()=>{
    if(isAdmin){ const {data,error}=await run(SB.from('bt_requests').select('id').eq('status','pending')); setN(error?0:(data||[]).length); return; }
    let seen=0; try{ seen=Number(localStorage.getItem(key)||0); }catch(e){}
    if(onTab||!seen){ try{ localStorage.setItem(key,String(Date.now())); }catch(e){} setN(0); return; }
    const iso=new Date(seen).toISOString();
    const [a,b]=await Promise.all([
      run(SB.from('bt_requests').select('id').eq('user_id',user.id).in('status',['approved','denied']).gte('decided_at',iso)),
      run(SB.from('bt_request_msgs').select('id').eq('is_admin',true).gte('created_at',iso)),
    ]);
    setN((a.error?0:(a.data||[]).length)+(b.error?0:(b.data||[]).length));
  },[user.id,isAdmin,onTab]);
  useEffect(()=>{ load(); },[load]);
  useAutoRefresh(load,15000);
  useReqChanged(load);
  return [n,load];
}

/* ── agent: Requests tab ── */
function AgentRequests({user,name}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [needSetup,setNeedSetup]=useState(false);
  const [err,setErr]=useState('');
  const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(null);
  const today=todayISO();
  const [f,setF]=useState({kind:'pto',start:today,end:today,note:''});
  const load=useCallback(async()=>{
    const {data,error}=await run(SB.from('bt_requests').select('*').eq('user_id',user.id).order('created_at',{ascending:false}));
    if(error){ if(reqMissing(error)) setNeedSetup(true); else setErr(error.message); }
    else{ setNeedSetup(false); setErr(''); setRows(data||[]); }
    setLoading(false); bumpSync();
  },[user.id]);
  useEffect(()=>{ load(); },[load]);
  useAutoRefresh(load,10000);
  useReqChanged(load);
  const needsDates=f.kind==='pto';
  const valid=(!needsDates||(f.start&&f.end&&f.end>=f.start))&&(f.kind==='pto'||f.note.trim().length>0);
  const submit=async()=>{
    if(!valid||busy) return;
    setBusy(true); setErr('');
    const row={user_id:user.id,agent_name:name,kind:f.kind,start_date:needsDates?f.start:null,end_date:needsDates?f.end:null,note:f.note.trim()||null,status:'pending'};
    const {data,error}=await run(SB.from('bt_requests').insert(row).select().single());
    setBusy(false);
    if(error){ if(reqMissing(error)) setNeedSetup(true); else setErr('Could not send: '+error.message); return; }
    setRows(p=>[data,...p]); setOpen(data.id); setF(x=>({...x,note:''}));
    fireNotification({title:'Request sent',body:`${REQ_KINDS[data.kind]}${data.start_date?' · '+reqRange(data):''} is waiting for approval.`,type:'info',duration:5000});
  };
  const cancel=async r=>{
    const {error}=await run(SB.from('bt_requests').update({status:'cancelled'}).eq('id',r.id).eq('status','pending'));
    if(error){ setErr('Could not cancel: '+error.message); return; }
    setRows(p=>p.map(x=>x.id===r.id?{...x,status:'cancelled'}:x));
  };
  const cnt=s=>rows.filter(r=>r.status===s).length;
  const me={id:user.id,name,isAdmin:false};
  return(
    <div className="panel" style={{padding:0}} id="tab-requests">
      <div className="tab-h"><h1>Requests</h1><p>Ask for time off or anything else, and message the admin about it.</p></div>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      {needSetup?(
        <div className="sblk"><h2 className="sh">Requests are not set up yet</h2><p className="sd">Your admin needs to finish a one-time setup first. It takes a minute and then this page works.</p></div>
      ):(<>
        <div className="kpis">
          <div className="kpi"><div className="kpi-ic"><Ic n="timer" size={20}/></div><b>{cnt('pending')}</b><span>Waiting for a decision</span></div>
          <div className="kpi"><div className="kpi-ic g"><Ic n="check" size={20}/></div><b>{cnt('approved')}</b><span>Approved</span></div>
          <div className="kpi"><div className="kpi-ic r"><Ic n="x" size={20}/></div><b>{cnt('denied')}</b><span>Denied</span></div>
        </div>
        <div className="rq-grid">
          <div className="card rq-form" id="rq-form">
            <h2>New request</h2>
            <label>Type
              <select className="fi" value={f.kind} onChange={e=>setF({...f,kind:e.target.value})} aria-label="Request type">
                {REQ_NEW.map(k=><option key={k} value={k}>{k==='document'?'Document request':REQ_KINDS[k]}</option>)}
              </select>
            </label>
            {needsDates&&<div className="rq-two">
              <label>From<input className="fi" type="date" min={today} value={f.start} onChange={e=>setF({...f,start:e.target.value,end:f.end<e.target.value?e.target.value:f.end})} aria-label="From date"/></label>
              <label>To<input className="fi" type="date" min={f.start||today} value={f.end} onChange={e=>setF({...f,end:e.target.value})} aria-label="To date"/></label>
            </div>}
            <label>{f.kind==='document'?'Which document do you need?':f.kind==='other'?'What do you need?':'Note (optional)'}
              <textarea className="fi" value={f.note} maxLength={2000} onChange={e=>setF({...f,note:e.target.value})} placeholder={f.kind==='pto'?'e.g. family trip':f.kind==='document'?'e.g. employment letter, payslip, reference':''} aria-label="Note"/>
            </label>
            <button className="bp" onClick={submit} disabled={!valid||busy}>{busy?<span className="spin-sm"/>:<><Ic n="send" size={15}/> Send request</>}</button>
          </div>
          <div className="rq-list" id="rq-list">
            {loading?<div className="es"><div className="spin"/></div>
             :rows.length===0?<div className="card rq-empty">No requests yet. Your requests and the admin's replies will show up here.</div>
             :rows.map(r=>(
              <div key={r.id} className="rq-card" data-req={r.id}>
                <div className="rq-top">
                  <div className={`rq-ico ${r.kind}`}><Ic n={REQ_ICON[r.kind]||'message'} size={20}/></div>
                  <div><div className="rq-t">{REQ_KINDS[r.kind]||r.kind}{r.start_date?` · ${reqRange(r)}`:''}</div>
                    <div className="rq-s">{r.start_date?`${reqDays(r)} day${reqDays(r)===1?'':'s'} · `:''}sent {fmtD(r.created_at)}</div></div>
                  <span className="rq-sp"><StatusChip s={r.status}/></span>
                </div>
                {r.note&&<div className="rq-note">{r.note}</div>}
                {r.admin_note&&<div className="rq-dec"><b>{r.decided_by||'Admin'}:</b> {r.admin_note}</div>}
                <div className="rq-acts">
                  <button className="bs" onClick={()=>setOpen(open===r.id?null:r.id)}><Ic n="message" size={15}/> {open===r.id?'Hide messages':'Messages'}</button>
                  {r.status==='pending'&&<button className="bs" onClick={()=>cancel(r)}>Cancel request</button>}
                </div>
                {open===r.id&&<ReqThread req={r} me={me}/>}
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}

/* ── admin: Requests tab (list + calendar) ── */
function calGrid(month){      // month = 'YYYY-MM-01'
  const dow=(new Date(month+'T00:00:00Z').getUTCDay()+6)%7, start=isoAdd(month,-dow), cells=[];
  for(let i=0;i<42;i++){ const d=isoAdd(start,i); cells.push({d,out:d.slice(0,7)!==month.slice(0,7)}); }
  while(cells.length>35&&cells.slice(-7).every(c=>c.out)) cells.length-=7;
  return cells;
}
const monthAdd=(month,n)=>{ const d=new Date(month+'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)).toISOString().slice(0,10); };
function ARequests({user,name}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [needSetup,setNeedSetup]=useState(false);
  const [err,setErr]=useState('');
  const [view,setView]=useState('list');
  const [filter,setFilter]=useState('pending');
  const [open,setOpen]=useState(null);
  const [deny,setDeny]=useState(null);       // {id,reason}
  const [showPend,setShowPend]=useState(true);
  const today=todayISO();
  const [month,setMonth]=useState(today.slice(0,7)+'-01');
  const [sel,setSel]=useState(today);
  const load=useCallback(async()=>{
    const {data,error}=await run(SB.from('bt_requests').select('*').order('created_at',{ascending:false}));
    if(error){ if(reqMissing(error)) setNeedSetup(true); else setErr(error.message); }
    else{ setNeedSetup(false); setErr(''); setRows(data||[]); }
    setLoading(false); bumpSync();
  },[]);
  useEffect(()=>{ load(); },[load]);
  useAutoRefresh(load,10000);
  useReqChanged(load);
  const me={id:user.id,name,isAdmin:true};
  const decide=async(r,status,reason)=>{
    const patch={status,decided_by:name,decided_at:nowISO(),admin_note:reason?reason:null};
    const {error}=await run(SB.from('bt_requests').update(patch).eq('id',r.id));
    if(error){ setErr('Could not save: '+error.message); return; }
    setRows(p=>p.map(x=>x.id===r.id?{...x,...patch}:x)); setDeny(null); reqChanged();
  };
  const live=r=>r.status==='approved'||r.status==='pending';
  const overlaps=r=>r.start_date?rows.filter(o=>o.id!==r.id&&o.user_id!==r.user_id&&live(o)&&o.start_date&&o.start_date<=(r.end_date||r.start_date)&&(o.end_date||o.start_date)>=r.start_date):[];
  const cnt=s=>s==='all'?rows.length:rows.filter(r=>r.status===s).length;
  const week=[0,1,2,3,4,5,6].map(i=>isoAdd(today,i));
  const offToday=new Set(rows.filter(r=>r.status==='approved'&&reqOn(r,today)).map(r=>r.user_id)).size;
  const offWeek=new Set(rows.filter(r=>r.status==='approved'&&week.some(d=>reqOn(r,d))).map(r=>r.user_id)).size;
  const shown=rows.filter(r=>filter==='all'||r.status===filter)
    .sort((a,b)=>filter==='pending'?String(a.start_date||'9').localeCompare(String(b.start_date||'9')):0);
  const Card=({r,compact})=>{
    const ov=overlaps(r), dn=deny&&deny.id===r.id;
    return(
      <div className="rq-card" data-req={r.id}>
        <div className="rq-top">
          <div className={`rq-ico ${r.kind}`}><Ic n={REQ_ICON[r.kind]||'message'} size={20}/></div>
          <div><div className="rq-t">{r.agent_name}</div>
            <div className="rq-s">{REQ_KINDS[r.kind]||r.kind}{r.start_date?` · ${reqRange(r)} · ${reqDays(r)} day${reqDays(r)===1?'':'s'}`:''}</div></div>
          <span className="rq-sp"><StatusChip s={r.status}/></span>
        </div>
        {r.note&&<div className="rq-note">{r.note}</div>}
        {r.admin_note&&<div className="rq-dec"><b>{r.decided_by||'Admin'}:</b> {r.admin_note}</div>}
        {ov.length>0&&r.status!=='denied'&&r.status!=='cancelled'&&<div className="rq-ov"><Ic n="alert" size={15}/><span>Also off then: {ov.slice(0,4).map(o=>`${o.agent_name} (${reqRange(o)}${o.status==='pending'?', pending':''})`).join(', ')}{ov.length>4?` +${ov.length-4} more`:''}</span></div>}
        {r.status!=='cancelled'&&(dn?(
          <div className="rq-acts" style={{alignItems:'stretch'}}>
            <input className="fi" style={{flex:1,minWidth:200}} autoFocus placeholder="Reason (optional)" value={deny.reason} onChange={e=>setDeny({id:r.id,reason:e.target.value})} aria-label="Reason for denying"/>
            <button className="btn-no" onClick={()=>decide(r,'denied',deny.reason.trim())}><Ic n="x" size={15}/> Confirm deny</button>
            <button className="bs" onClick={()=>setDeny(null)}>Back</button>
          </div>
        ):(
          <div className="rq-acts">
            <button className="btn-ok" onClick={()=>decide(r,'approved','')} disabled={r.status==='approved'}><Ic n="check" size={15}/> {r.status==='denied'?'Approve instead':'Approve'}</button>
            <button className="btn-no" onClick={()=>setDeny({id:r.id,reason:''})} disabled={r.status==='denied'}><Ic n="x" size={15}/> {r.status==='approved'?'Revoke':'Deny'}</button>
            {!compact&&<button className="bs" onClick={()=>setOpen(open===r.id?null:r.id)}><Ic n="message" size={15}/> {open===r.id?'Hide messages':'Messages'}</button>}
          </div>
        ))}
        {open===r.id&&!compact&&<ReqThread req={r} me={me}/>}
      </div>
    );
  };
  const cells=calGrid(month);
  const onDay=d=>rows.filter(r=>reqOn(r,d)&&r.status==='approved'||(showPend&&reqOn(r,d)&&r.status==='pending'));
  const selRows=onDay(sel);
  return(
    <div className="panel" id="tab-requests">
      <div className="phd"><div><h1 className="pt">Requests</h1><p className="ps">Approve or deny time off and other requests, and see who is away when</p></div></div>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      {needSetup?(
        <div className="sblk"><h2 className="sh">One-time setup</h2><p className="sd">Copy this SQL, paste it into the Supabase SQL Editor, run it, then reload this page.</p><CopySql sql={REQ_SQL}/></div>
      ):loading?<div className="es"><div className="spin"/></div>:(<>
        <div className="kpis">
          <div className="kpi"><div className="kpi-ic"><Ic n="timer" size={20}/></div><b>{cnt('pending')}</b><span>Waiting for a decision</span></div>
          <div className="kpi"><div className="kpi-ic g"><Ic n="check" size={20}/></div><b>{cnt('approved')}</b><span>Approved</span></div>
          <div className="kpi"><div className="kpi-ic b"><Ic n="palm" size={20}/></div><b>{offToday}</b><span>Away today</span></div>
          <div className="kpi"><div className="kpi-ic p"><Ic n="calendar" size={20}/></div><b>{offWeek}</b><span>Away in the next 7 days</span></div>
        </div>
        <div className="rq-bar">
          <div className="pills" role="tablist" aria-label="View">
            <button className={view==='list'?'on':''} onClick={()=>setView('list')} data-view="list">List</button>
            <button className={view==='calendar'?'on':''} onClick={()=>setView('calendar')} data-view="calendar">Calendar</button>
          </div>
          {view==='list'&&<div className="pills" aria-label="Filter">
            {['pending','approved','denied','all'].map(k=><button key={k} className={filter===k?'on':''} onClick={()=>setFilter(k)} data-filter={k}>{k==='all'?'All':REQ_STATUS[k]}<span className="n">{cnt(k)}</span></button>)}
          </div>}
        </div>
        {view==='list'?(
          <div className="rq-list" style={{maxWidth:880}}>
            {shown.length===0?<div className="card rq-empty">{filter==='pending'?'No requests are waiting for a decision.':'Nothing here.'}</div>:shown.map(r=><Card key={r.id} r={r}/>)}
          </div>
        ):(
          <div className="cal-wrap" id="cal">
            <div>
              <div className="cal-head">
                <h2 id="cal-title">{new Date(month+'T00:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</h2>
                <button className="bs" onClick={()=>setMonth(monthAdd(month,-1))} aria-label="Previous month"><Ic n="chevleft" size={16}/></button>
                <button className="bs" onClick={()=>{ setMonth(today.slice(0,7)+'-01'); setSel(today); }}>Today</button>
                <button className="bs" onClick={()=>setMonth(monthAdd(month,1))} aria-label="Next month"><Ic n="chevron" size={16}/></button>
                <span className="rq-sp"/>
                <div className="pills"><button className={showPend?'on':''} onClick={()=>setShowPend(v=>!v)} data-act="pend">Show pending</button></div>
              </div>
              <div className="cal">
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(w=><div key={w} className="cal-w">{w}</div>)}
                {cells.map(c=>{
                  const list=onDay(c.d), dow=(new Date(c.d+'T00:00:00Z').getUTCDay()+6)%7;
                  return(
                    <button key={c.d} data-day={c.d} className={`cal-d${c.out?' out':''}${dow>4?' we':''}${c.d===today?' today':''}${c.d===sel?' sel':''}${list.length>=3?' busy':''}`} onClick={()=>setSel(c.d)}>
                      <span className="cal-n">{Number(c.d.slice(8))}</span>
                      {list.length>=3&&<span className="cal-cnt">{list.length} away</span>}
                      {list.slice(0,3).map(r=><span key={r.id} className={`cal-c ${r.kind} ${r.status}`} title={`${r.agent_name} · ${REQ_KINDS[r.kind]}${r.status==='pending'?' (pending)':''}`}>{r.agent_name.split(' ')[0]}</span>)}
                      {list.length>3&&<span className="cal-m">+{list.length-3} more</span>}
                    </button>
                  );
                })}
              </div>
              <div className="cal-leg"><span><i/>Approved time off</span><span><i className="sick"/>Sick leave</span><span><i className="shift"/>Shift change</span><span><i className="pend"/>Pending</span></div>
            </div>
            <div className="card cal-side" id="cal-day">
              <h2 className="rq-h">{new Date(sel+'T00:00:00Z').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'})}</h2>
              {selRows.length===0?<div className="rq-s">Nobody is away.</div>:<div className="rq-s">{selRows.length} {selRows.length===1?'person is':'people are'} away</div>}
              {selRows.map(r=><Card key={r.id} r={r} compact/>)}
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}

/* ── admin: add accounts from the page ── */
let _addClient=null;
function addClient(){
  if(!_addClient) _addClient=supabase.createClient(window.BT_URL,window.BT_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'bt_add_user'}});
  return _addClient;
}
function AAccounts(){
  const blank={name:'',email:'',pw:'',role:'agent'};
  const [f,setF]=useState(blank);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const [made,setMade]=useState([]);
  const [show,setShow]=useState(false);
  const valid=f.name.trim()&&/^\S+@\S+\.\S+$/.test(f.email.trim())&&f.pw.length>=6;
  const gen=()=>{ const c='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a=new Uint32Array(10); crypto.getRandomValues(a); setF(x=>({...x,pw:Array.from(a,n=>c[n%c.length]).join('')})); setShow(true); };
  const submit=async()=>{
    if(!valid||busy) return;
    setBusy(true); setErr('');
    const email=f.email.trim().toLowerCase(), nm=f.name.trim();
    try{
      const {data,error}=await addClient().auth.signUp({email,password:f.pw,options:{data:{display_name:nm,role:f.role}}});
      if(error) throw error;
      if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0) throw new Error('That email already has an account.');
      const confirmed=!!data.session||!!(data.user&&data.user.email_confirmed_at);
      setMade(m=>[{name:nm,email,role:f.role,pw:f.pw,confirmed},...m]);
      setF(blank); setShow(false);
      fireNotification({title:'Account created',body:nm,type:'info',duration:5000});
    }catch(e){ setErr(e.message||'Could not create the account.'); }
    setBusy(false);
  };
  const copy=m=>{ try{ navigator.clipboard.writeText(`BreakTrack login\nEmail: ${m.email}\nPassword: ${m.pw}`); fireNotification({title:'Login details copied',body:m.email,type:'info',duration:3000}); }catch(e){} };
  return(
    <div className="panel" id="tab-accounts">
      <div className="tab-h"><h1>Accounts</h1><p>Create a login for a new agent or admin.</p></div>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      <div className="rq-grid">
        <div className="card rq-form" id="acc-form">
          <h2>New account</h2>
          <label>Full name<input className="fi" value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="e.g. Sara Ahmed" aria-label="Full name" autoComplete="off"/></label>
          <label>Email<input className="fi" type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="name@company.com" aria-label="Email" autoComplete="off"/></label>
          <label>Password
            <div className="acc-pw"><input className="fi" type={show?'text':'password'} value={f.pw} onChange={e=>setF({...f,pw:e.target.value})} placeholder="At least 6 characters" aria-label="Password" autoComplete="new-password"/>
            <button type="button" className="bs" onClick={gen}>Generate</button></div>
          </label>
          <label>Role
            <select className="fi" value={f.role} onChange={e=>setF({...f,role:e.target.value})} aria-label="Role"><option value="agent">Agent</option><option value="admin">Admin</option></select>
          </label>
          <button className="bp" onClick={submit} disabled={!valid||busy}>{busy?<span className="spin-sm"/>:<><Ic n="plus" size={15}/> Create account</>}</button>
        </div>
        <div className="rq-list" id="acc-list">
          {made.length===0?<div className="card rq-empty">Accounts you create here show up with their login details so you can pass them on.</div>
           :made.map((m,i)=>(
            <div key={m.email+i} className="rq-card" data-acc={m.email}>
              <div className="rq-top"><div className="rq-ico other"><Ic n="users" size={20}/></div>
                <div><div className="rq-t">{m.name}</div><div className="rq-s">{m.email} · {m.role==='admin'?'Admin':'Agent'}</div></div></div>
              <div className="rq-note">Password: <b>{m.pw}</b></div>
              {!m.confirmed&&<div className="rq-dec">Supabase is set to confirm emails, so they must click the link in their email before the first sign-in. To skip that, turn off "Confirm email" under Authentication, Sign In / Providers, Email.</div>}
              <div className="rq-acts"><button className="bs" onClick={()=>copy(m)}><Ic n="send" size={15}/> Copy login details</button></div>
            </div>))}
        </div>
      </div>
    </div>
  );
}

/* ── agent: Calls tab ── */
function AgentCalls({st}){
  return(
    <div id="tab-calls">
      <div className="tab-h"><h1>Calls</h1><p>Your calls today, from the phone system.</p></div>
      {st&&st.me&&!st.off&&!st.empty?<AgentCallStats st={st}/>
        :<div className="card rq-empty">{st===null?'Loading your calls…':'No call activity recorded for you today yet.'}</div>}
    </div>
  );
}

""".replace('__REQ_SQL__', req_sql)
rep("function App() {", SHELL_JS + BONUS_JS + "function App() {")


# ═════════════════════════════ 4. admin shell ═════════════════════════════
rep("const { useState, useEffect, useRef, useCallback } = React;", "const { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } = React;")
cut_start = s.index("  const NavItem=({id,n,label,badge})=>(")
cut_end = s.index("      <div className=\"main\">", cut_start)
s = s[:cut_start] + """  const sideItems=[...main, {section:'More',more:true}, ...flows];

  return (
    <div className="shell">
      <Sidebar items={sideItems} active={tab} onGo={go} open={navOpen} onClose={()=>setNavOpen(false)} role="Admin" onLogout={onLogout}/>

""" + s[cut_end:]
_a=s.index("  const main=["); _b=s.index("  const exportToday", _a)
s = s[:_a] + """  const main=[
    {id:'home',      n:'home',     label:'Home'},
    {id:'cx',        n:'phone',    label:'3CX'},
    {id:'live',      n:'activity', label:'Live Rack', badge:counts.live},
    {id:'clocks',    n:'clock',    label:'Clock In/Out'},
    {id:'requests',  n:'inbox',    label:'Requests', badge:reqN},
    {id:'lunch',     n:'utensils', label:'Lunch Schedule'},
    {id:'settings',  n:'settings', label:'Settings'},
  ];
  const flows=[
    {id:'accounts',  n:'users',    label:'Accounts', more:true},
    {id:'analytics', n:'bars',     label:'Analytics', more:true},
    {id:'logs',      n:'list',     label:'All Logs', more:true},
    {id:'trainees',  n:'users',    label:'Trainees', more:true},
    {id:'swaps',     n:'swap',     label:'Lunch Swaps', badge:counts.swaps, more:true},
    {id:'bonus',     n:'award',    label:'Bonus Audit', more:true},
    {id:'late',      n:'clock',    label:'Late & Extra Time', more:true},
    {id:'notifs',    n:'bell',     label:'Notifications', more:true},
  ];
""" + s[_b:]
rep("  useAdminLunchBroadcast(5); // auto-broadcast 5 min before each group's lunch\n", "  useAdminLunchBroadcast(5); // auto-broadcast 5 min before each group's lunch\n  const [reqN]=useReqBadge(user,true,false);\n  useRequestToasts(user,true);\n")
rep("          {tab==='clocks'    &&<AClocks/>}\n", "          {tab==='clocks'    &&<AClocks/>}\n          {tab==='requests'  &&<ARequests user={user} name={name}/>}\n          {tab==='accounts'  &&<AAccounts/>}\n          {tab==='bonus'     &&<ABonus go={go}/>}\n          {tab==='late'      &&<ALate/>}\n")


# ═════════════════════════════ notifications: reliable delivery ═════════════════════════════
_i = s.index("function useAgentNotifListener(userId, lunchInfo) {")
_j = s.index("/* ══════════════════════════════════════════════════════════════\n   LUNCH REMINDER HOOKS")
s = s[:_i] + open(os.path.join(HERE, 'notif_listener.js'), encoding='utf-8').read() + s[_j:]
rep("    const show = () => new Notification(title, { body, tag: type + '-' + appNow() });\n    if (Notification.permission === 'granted') show();\n    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if(p==='granted') show(); });\n",
    "    try { if (Notification.permission === 'granted') new Notification(title, { body, tag: type + '-' + appNow(), requireInteraction: type === 'lunch' }); } catch (e) {}\n")
_i = s.index("function useNotifPermission() {"); _j = s.index("/* ══", _i)
s = s[:_i] + "function useNotifPermission() { /* switched on with a button now: browsers ignore permission requests that come without a click */ }\n\n" + s[_j:]
rep('        {err&&<div className="aerr"><Ic n="alert" size={15}/> {err}</div>}\n', '        <NotifBanner/>\n        {err&&<div className="aerr"><Ic n="alert" size={15}/> {err}</div>}\n')

# ═════════════════════════════ 5. agent shell: tabs ═════════════════════════════
rep("  const cxs = useAgentCx(name);\n", "  const cxs = useAgentCx(name);\n  const [tab,setTab]=useState('home');\n  const [navOpen,setNavOpen]=useState(false);\n  const [reqN]=useReqBadge(user,false,tab==='requests');\n  useRequestToasts(user,false);\n")
rep("  const idleWord=!isClockedIn?(isClockedOut?'Shift ended':'Off shift'):breakHint?'Paused':'Ready';\n",
    "  const idleWord=!isClockedIn?(isClockedOut?'Shift ended':'Off shift'):breakHint?'Paused':'Ready';\n"
    "  const agentNav=[{id:'home',n:'home',label:'Home'},{id:'calls',n:'phone',label:'Calls'},{id:'lunch',n:'utensils',label:'Lunch'},{id:'requests',n:'message',label:'Requests',badge:reqN}];\n"
    "  const goTab=id=>{ setTab(id); setNavOpen(false); window.scrollTo({top:0}); };\n")
rep('''    <div className="main solo" style={{minHeight:'100vh'}}>
      <header className="top">
        <div className="wm" style={{marginRight:'auto'}}>
          <div className="wm-icon"><Ic n="tower" size={16} col="#c9c9d2" sw={1.8}/></div>
          <span className="wm-t">BreakTrack</span>
        </div>
        <div className="top-ic">''', '''    <div className="shell">
      <Sidebar items={agentNav} active={tab} onGo={goTab} open={navOpen} onClose={()=>setNavOpen(false)} role={trainee?'Agent · Trainee':'Agent'} onLogout={onLogout}/>
      <div className="main">
      <header className="top">
        <button className="icb top-menu" onClick={()=>setNavOpen(true)} aria-label="Menu"><Ic n="menu" size={20}/></button>
        <span style={{marginRight:'auto'}}/>
        <div className="top-ic">''')
rep('''        <h1 className="hello">Welcome, {firstName(name)}</h1>''', '''        {tab==='home'&&(<>
        <h1 className="hello">Welcome, {firstName(name)}</h1>''')
rep('''        <AgentCallStats st={cxs}/>
      </div>

      {confirmOut&&(''', '''        </>)}
        {tab==='calls'    &&<AgentCalls st={cxs}/>}
        {tab==='requests' &&<AgentRequests user={user} name={name}/>}
        {tab==='lunch'&&(()=>{
          const mins=x=>{ const [h,m]=x.split(':').map(Number); return h*60+m; };
          const slot=trainee?{from:team.lunch,to:addMin(team.lunch,60)}:li?.group?li.slot:null;
          const nowM=mins(hhmm(nowA)), a=slot?mins(slot.from):0, z=slot?mins(slot.to):0;
          const lm=x=>x>=60?`${Math.floor(x/60)}h ${x%60}m`:`${x}m`;
          const when=!slot?'':nowM<a?`Starts in ${lm(a-nowM)}`:nowM<z?`Now, ends in ${lm(z-nowM)}`:'Finished for today';
          const Grp=({g,names})=>(
            <div className={`lg${li?.group===g?' mine':''}`}>
              <div className="lg-h"><b>Group {g}</b><span>{li?.slots?.[g]?`${li.slots[g].from}–${li.slots[g].to}`:''}</span></div>
              {(names||[]).length===0?<div className="rq-s">Nobody yet</div>:(names||[]).map(n=><div key={n} className={`lg-n${n===name?' me':''}`}>{n}{n===name?' · you':''}</div>)}
            </div>);
          return(
            <div id="tab-lunch">
              <div className="tab-h"><h1>Lunch</h1><p>Your lunch group today, and swapping with a colleague.</p></div>
              {!slot?<div className="card rq-empty">You are not in a lunch group today.</div>:(
                <div className="grid2">
                  <div className="card" id="lunch-main" style={{padding:"24px 28px"}}>
                    <div className="card-hd"><div className="card-t">Your lunch</div></div>
                    <div className="timer-big idle" style={{fontSize:56}}>{slot.from}–{slot.to}</div>
                    <div className="timer-sub">{trainee?'Trainee lunch':`Group ${li.group}`} · {when}</div>
                    {!trainee&&<div className="acts" style={{marginTop:22}}>
                      {!outgoingSwap&&<button className="bp" onClick={()=>setShowSwapModal(true)} disabled={!isClockedIn} title={isClockedIn?'':'Clock in first'}><Ic n="swap" size={16}/> Swap lunch</button>}
                      {outgoingSwap&&<><span className="lunch-pill"><Ic n="timer" size={15}/> Waiting for {outgoingSwap.to_name} to answer</span><button className="bs" onClick={cancelSwapRequest}>Cancel request</button></>}
                    </div>}
                  </div>
                  {!trainee&&<div className="card" id="lunch-groups" style={{padding:"24px 28px"}}>
                    <div className="card-hd"><div className="card-t">Today's groups</div></div>
                    <div className="lg-wrap"><Grp g="A" names={li.allA}/><Grp g="B" names={li.allB}/></div>
                  </div>}
                </div>)}
            </div>);
        })()}
      </div>
      </div>

      {confirmOut&&(''')
rep('''    <div className="auth-bg">
      <div className="auth-card">''', '''    <div className="auth-bg">
      <ThemeFab/>
      <div className="auth-card">''')

i = s.rindex('</style>')
s = s[:i] + "#tab-calls #agent-calls{margin-top:0!important}\n.top-title{font-size:15px;color:var(--mut)}\n.top-ic{margin-left:auto}.bm-w{fill:#f4f5ff}[data-theme='light'] .wm-icon .bm-w{fill:#aab4ff;stroke:#aab4ff}\n.lg-wrap{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px}.lg{background:var(--tile);border-radius:16px;padding:14px 16px}.lg.mine{outline:2px solid var(--sb-acc)}.lg-h{display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px}.lg-h span{color:var(--mut)}.lg-n{padding:4px 0;font-size:14.5px}.lg-n.me{font-weight:600}\n.pf-nav{display:flex;align-items:center;gap:12px;margin-bottom:20px;font-size:17px}.pf-nav b{min-width:150px;text-align:center;font-weight:500}\n.sb-logo{background:none!important;box-shadow:none!important;width:46px;height:46px}\n.fchip{border:none;background:var(--card);color:var(--txt);border-radius:999px;padding:7px 15px;font-size:14px;cursor:pointer;font-family:inherit;transition:background .15s}.fchip:hover{background:var(--hover)}.fchip.on{background:var(--violet);color:#fff}\n.bn-in{width:84px;text-align:right;padding:8px 10px}.bn-pct{margin-left:4px;color:var(--mut)}.bn-flag{margin-left:6px;font-size:11px;color:var(--mut)}.bn-bad{color:var(--bad-txt)}.bn-tot td{font-weight:600;border-top:1px solid var(--bdr)}.bn-adj{margin-left:6px;border:none;background:var(--card);color:var(--mut);border-radius:8px;cursor:pointer;padding:2px 7px}.bn-tbl td.n,.bn-tbl th{white-space:nowrap}\n.lt-filters{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}.lt-filters label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--mut)}.lt-filters .fi{width:auto}.lt-pre,.lt-types{display:flex;gap:8px;flex-wrap:wrap}.lt-types{margin-bottom:18px}.lt-t{display:inline-block;padding:3px 11px;border-radius:999px;font-size:13px;background:var(--amber-d);color:var(--acc-txt)}.lt-t.late_start,.lt-t.late_lunch{background:var(--red-d);color:var(--bad-txt)}.lt-t.stayed_late{background:var(--indigo-d);color:var(--indigo)}\n.acc-pw{display:flex;gap:8px}.acc-pw .fi{flex:1;min-width:0}.sb-out:hover{color:#ff8a9a}\n" + s[i:]

rep("  const [hide,setHide]=useState(false);\n", "  const hide=false;\n")
rep("  useEffect(()=>{ document.body.classList.toggle('privacy',hide); return()=>document.body.classList.remove('privacy'); },[hide]);\n", "")
s = re.sub(r"[ ]*<button className=\{`icb hide-s[^\n]*setHide[^\n]*\n", "", s)
assert 'setHide' not in s
s = s.replace('<div className="wm-icon"><Ic n="tower" size={16} col="#c9c9d2" sw={2}/></div>', '<div className="wm-icon"><BrandMark size={20}/></div>')
FAV = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23a3aeff'/%3E%3Cstop offset='1' stop-color='%235266eb'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='%231c1d26'/%3E%3Cpath d='M4.3 14.8L4.3 24.6L10.4 24.6Z' fill='%233b47a8' stroke='%233b47a8' stroke-width='.8' stroke-linejoin='round'/%3E%3Cpath d='M4.6 14.5L16.6 14.6L19.1 18.2L13.2 27.8Z' fill='%23f4f5ff' stroke='%23f4f5ff' stroke-width='.8' stroke-linejoin='round'/%3E%3Cpath d='M27.7 4.3L26.1 27.8L13.4 27.8Z' fill='url(%23g)' stroke='%236b7cf0' stroke-width='.8' stroke-linejoin='round'/%3E%3C/svg%3E"
s, _n = re.subn(r'<link rel="icon"[^>]*/>', lambda m: '<link rel="icon" type="image/svg+xml" href="' + FAV + '"/>', s)
assert _n == 1, _n

open(out, 'w', newline='', encoding='utf-8').write(s.replace('\n', '\r\n') if crlf else s)
print('written', out, len(s))

