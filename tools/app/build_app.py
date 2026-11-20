#!/usr/bin/env python3
"""Applies the agent-view changes and the Settings clean-up to the app's index.html.

  python3 tools/app/build_app.py <current index.html> <output index.html>

Every replacement is checked to match exactly once, so running it on a different version of the page fails loudly instead of half-applying."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
raw = open(src, newline='', encoding='utf-8').read()
crlf = '\r\n' in raw
s = raw.replace('\r\n', '\n')
sql = open(os.path.join(HERE, 'agent_stats_setup.sql'), encoding='utf-8').read()
assert '`' not in sql and '${' not in sql


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (old[:90], s.count(old))
    s = s.replace(old, new)


def cut(start, end, new=''):
    """replace everything from `start` up to (not including) `end`"""
    global s
    i = s.index(start); j = s.index(end, i)
    assert s.count(start) == 1, start[:60]
    s = s[:i] + new + s[j:]


# ───────────────────────── 1. shared settings: the 3CX limits and the break allowance now live in the database ─────────────────────────
rep("let _team = { trainees:[], lunch:'12:00', shiftEnd:null, ready:false };",
    "let _team = { trainees:[], lunch:'12:00', shiftEnd:null, allowanceMin:105, fullShiftH:8, ready:false };")
rep("    _team={ trainees:t, lunch:HM_RE.test(data.trainee_lunch||'')?data.trainee_lunch:'12:00', shiftEnd:HM_RE.test(data.shift_end||'')?data.shift_end:null, ready:true };",
    "    const am=Number(data.break_allowance_min), fh=Number(data.full_shift_hours);\n"
    "    _team={ trainees:t, lunch:HM_RE.test(data.trainee_lunch||'')?data.trainee_lunch:'12:00', shiftEnd:HM_RE.test(data.shift_end||'')?data.shift_end:null,\n"
    "            allowanceMin:am>0?am:105, fullShiftH:fh>0?fh:8, ready:true };\n"
    "    if(data.cx_config&&typeof data.cx_config==='object'&&Object.keys(data.cx_config).length) _cxCfg=cxClean(data.cx_config);   // the 3CX limits are shared: agents' stats use the same ones")

# ───────────────────────── 2. Settings clean-up: 3CX settings that no longer apply ─────────────────────────
cut("/* ═══ 3CX settings (shown in Settings → \"3CX call alerts\") ═══", "const CX_SAMPLE_USERS=",
    """/* ═══ 3CX settings (shown in Settings → "3CX call alerts") ═══
   Saved in the database (bt_settings.cx_config) so the admin page and every agent's own stats use the same limits.
   Until the one-time setup SQL has been run they stay in this browser. */
const CX_CFG_KEY='bt_cx_cfg';
const CX_CFG_DEFAULT={ignoreRingSec:10,shortCallSec:60,repeatIgnoreCount:3,repeatIgnoreWindowMin:60,breakToleranceMin:3,breakCheckLeadMin:10,timelineStart:7,timelineEnd:18};
// keeps only the settings that still exist (older saved copies also had the logger PC clock and a separate database connection)
const cxClean=o=>{ const c={}; for(const k of Object.keys(CX_CFG_DEFAULT)){ const n=o&&o[k]!==''&&o[k]!=null?Number(o[k]):NaN; c[k]=Number.isFinite(n)?n:CX_CFG_DEFAULT[k]; } return c; };
let _cxCfg=(()=>{ try{ return cxClean(JSON.parse(localStorage.getItem(CX_CFG_KEY)||'{}')); }catch(e){ return {...CX_CFG_DEFAULT}; } })();
""")

cut("function A3cxSettings(){", "/* What the agents themselves entered on the sample day",
    r"""function A3cxSettings(){
  const [v,setV]=useState({..._cxCfg});
  const [ok,setOk]=useState(false);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState('');
  const [needSetup,setNeedSetup]=useState(false);
  useEffect(()=>{
    run(SB.from('bt_settings').select('*').eq('id',1).maybeSingle()).then(({data})=>{
      if(!data) return;
      if(!('cx_config' in data)){ setNeedSetup(true); return; }
      if(data.cx_config&&Object.keys(data.cx_config).length){ _cxCfg=cxClean(data.cx_config); setV({..._cxCfg}); }
    });
  },[]);
  const set=k=>e=>setV(p=>({...p,[k]:e.target.value}));
  const NUM=['ignoreRingSec','shortCallSec','repeatIgnoreCount','repeatIgnoreWindowMin','breakToleranceMin','breakCheckLeadMin'];
  const winOk=Number.isInteger(Number(v.timelineStart))&&Number.isInteger(Number(v.timelineEnd))&&Number(v.timelineStart)>=0&&Number(v.timelineEnd)<=24&&Number(v.timelineEnd)>Number(v.timelineStart);
  const valid=winOk&&NUM.every(k=>Number(v[k])>=1);
  const save=async()=>{
    const c={}; for(const k of NUM) c[k]=Math.max(1,Math.round(Number(v[k])));
    c.timelineStart=Number(v.timelineStart); c.timelineEnd=Number(v.timelineEnd);
    _cxCfg=c; try{ localStorage.setItem(CX_CFG_KEY,JSON.stringify(c)); }catch(e){}
    setV(c); setBusy(true); setErr('');
    const {error}=await run(SB.from('bt_settings').update({cx_config:c,updated_at:nowISO()}).eq('id',1));
    setBusy(false);
    if(error){ if(/cx_config/.test(error.message||'')) setNeedSetup(true); setErr('Saved in this browser only: '+error.message); return; }
    setNeedSetup(false); setOk(true); setTimeout(()=>setOk(false),3000);
  };
  const row=(label,k,unit)=>(
    <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:14}}>
      <span style={{minWidth:300,fontSize:15}}>{label}</span>
      <input className="fi" type="number" min={1} step={1} value={v[k]} onChange={set(k)} style={{width:100}}/>
      <span style={{fontSize:15,color:'var(--mut)'}}>{unit}</span>
    </div>
  );
  return(
    <div className="sblk">
      <h2 className="sh">3CX call alerts</h2>
      <p className="sd">When the 3CX page raises an alert, and what counts as an ignored or short call in the agents' own stats. Saved for everyone.</p>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      {row('Ignored call: a call rings at least','ignoreRingSec','seconds without being answered')}
      {row('Possible dropped call: a call shorter than','shortCallSec','seconds')}
      {row('Repeated ignores: this many ignored calls','repeatIgnoreCount','calls')}
      {row('...within','repeatIgnoreWindowMin','minutes')}
      {row('Break check: an agent\'s total break time may differ from 3CX by up to','breakToleranceMin','minutes')}
      {row('Break check notification, before shift end by','breakCheckLeadMin','minutes (the shift end is set above)')}
      <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:14}}>
        <span style={{minWidth:300,fontSize:15}}>Agent timeline shows the hours from</span>
        <input className="fi" type="number" min={0} max={23} step={1} value={v.timelineStart} onChange={set('timelineStart')} style={{width:80}} aria-label="Timeline start hour"/>
        <span style={{fontSize:15,color:'var(--mut)'}}>to</span>
        <input className="fi" type="number" min={1} max={24} step={1} value={v.timelineEnd} onChange={set('timelineEnd')} style={{width:80}} aria-label="Timeline end hour"/>
        <span style={{fontSize:15,color:'var(--mut)'}}>o'clock (company time)</span>
      </div>
      {needSetup&&(
        <div style={{marginTop:6,marginBottom:6}}>
          <p className="sd" style={{marginBottom:10}}>One-time setup so these are saved for everyone (and not just in this browser): copy this SQL, paste it into the Supabase SQL Editor, run it, then reload this page.</p>
          <CopySql sql={AGENT_STATS_SQL}/>
        </div>
      )}
      <div style={{marginTop:20,display:'flex',alignItems:'center',gap:12}}>
        <button className="bp" onClick={save} disabled={!valid||busy}>{busy?<span className="spin-sm"/>:'Save'}</button>
        {ok&&<span style={{color:'var(--green)',fontSize:14,display:'flex',alignItems:'center',gap:6}}><Ic n="check" size={15}/> Saved</span>}
      </div>
    </div>
  );
}

""")

# the separate-project connection and its SQL are gone: the logger writes to the app's own project
cut("/* For the logger's own project: the page reads with the public key", "/* One-time setup for the table the logger uploads to")
cut("// The 3CX data can live in a different Supabase project from the app", "// smooth line through points for the chart",
    "")
rep("      const key=lo+'|'+hi+'|'+(_cxCfg.dbUrl||'')+'|'+(_cxCfg.dbTable||'');", "      const key=lo+'|'+hi;")
rep("const cols='id,changed_at,extension,agent,old_status,new_status,detail', tbl=_cxCfg.dbTable||'status_log';", "const cols='id,changed_at,extension,agent,old_status,new_status,detail', tbl='status_log';")
rep("      const c=cxDb(), tbl=_cxCfg.dbTable||'status_log';\n", "      const c=SB, tbl='status_log';\n")
rep("try{ ch&&cxDb().removeChannel(ch); }catch(e){} };", "try{ ch&&SB.removeChannel(ch); }catch(e){} };")
rep("let q=cxDb().from(tbl)", "let q=SB.from(tbl)")

# the logger PC's clock only mattered for CSV files, and the page no longer reads files
rep("  const logTz=_cxCfg.logTz;\n", "")
rep("tzOffsetHours:isDb?0:logTz,dayOffsetHours:tz}); }", "tzOffsetHours:0,dayOffsetHours:tz}); }")
rep("  },[rowsAll,day,tz,logTz,isDb]);", "  },[rowsAll,day,tz]);")
rep("CX.toBreakLogs(R.intervals,match,{tzOffsetHours:logTz})", "CX.toBreakLogs(R.intervals,match,{tzOffsetHours:0})")
cut("  /* Warn if the file itself says the logger PC is on a different clock than Settings", "  /* everything below is limited to agents that match an app agent")
cut("      {isDb&&dbErr&&<div className=\"ebox\" style={{flexDirection:'column'", "      {clockHint!==null&&<div className=\"ebox\">",
    """      {isDb&&dbErr&&<div className="ebox" style={{flexDirection:'column',alignItems:'flex-start',gap:10}}><span><Ic n="alert" size={15}/> Couldn't read the status_log table: {dbErr}</span><span style={{color:'var(--mut)',fontSize:14}}>{missingTable?'The table doesn\\'t exist in this project yet. Run the SQL once in the Supabase SQL Editor (it also lets the logger add rows and admins read them), then reload the page. The logger must upload to this same project.':'If it says "permission denied", or the table is empty when it shouldn\\'t be, admins need permission to read it.'}</span>{missingTable?<CopySql sql={CX_SETUP_SQL} label="Copy SQL to create the table"/>:<CopySql sql={CX_READ_SQL} label="Copy SQL to allow admins to read it"/>}</div>}
""")
cut("      {clockHint!==null&&<div className=\"ebox\">", "      {R&&R.error&&<div className=\"ebox\">")
rep("{isDb&&<CopySql sql={cxOwnDb()?CX_READ_SQL_ANON:CX_READ_SQL} label={cxOwnDb()?'Copy SQL to allow reading it':'Copy SQL to allow admins to read it'}/>}", "{isDb&&<CopySql sql={CX_READ_SQL} label=\"Copy SQL to allow admins to read it\"/>}")

# ───────────────────────── 3. agent view: break time left + their own call stats ─────────────────────────
NEW_COMPONENTS = r"""/* ═══ Agent view: 3CX call stats ═══
   An agent sees their own numbers plus a team average. The database function cx_team_day hands them their own status changes in full
   and everybody else's without names or extensions, so one analysis can still tell a call a colleague picked up from an ignored one. */
const AGENT_STATS_SQL=`__SQL__`;

function cxAgentStats(data,name){
  const tz=clockOff(), day=todayISO(), now=appNow(), cfg=_cxCfg;
  const rows=CX.rowsFromStatusLog([...(data.mine||[]),...(data.team||[])]);
  if(!rows.length) return {empty:true};
  const R=CX.analyze(rows,{day,now,...cfg,tzOffsetHours:0,dayOffsetHours:tz});
  const key=CX.nameKey(name);
  const me=Object.values(R.agents).find(a=>CX.nameKey(a.agent)===key);
  if(!me) return {empty:true};
  const [from]=CX.dayRange(day,tz);
  const working=a=>Object.keys(a.statusSecs).some(st=>!['off','hol'].includes(cxCat(st)));
  const others=Object.values(R.agents).filter(a=>a.ext!==me.ext&&working(a));
  const around=(ext,hs,he)=>R.intervals.some(iv=>iv.ext===ext&&iv.start<he&&(iv.end==null?R.now:iv.end)>hs&&!['off','hol'].includes(cxCat(iv.status)));
  const hours=[];
  for(let h=cfg.timelineStart;h<cfg.timelineEnd;h++){
    const hs=from+h*3600000, he=hs+3600000; if(hs>now) break;
    const n=ext=>R.calls.filter(c=>c.ext===ext&&c.start>=hs&&c.start<he).length;
    const here=others.filter(a=>around(a.ext,hs,he));            // colleagues who were logged in that hour
    hours.push({h,label:fmtH(h),mine:n(me.ext),avg:here.length?here.reduce((t,a)=>t+n(a.ext),0)/here.length:null,mates:here.length,partial:he>now});
  }
  return {me,hours,mates:others.length,teamCalls:others.length?others.reduce((t,a)=>t+a.calls,0)/others.length:null};
}
function useAgentCx(name){
  const [raw,setRaw]=useState(null);       // null while loading; {off:true} if the setup SQL has not been run yet
  const load=useCallback(async()=>{
    const [from,to]=CX.dayRange(todayISO(),clockOff());
    const {data,error}=await run(SB.rpc('cx_team_day',{p_from:new Date(from-36*3600000).toISOString(),p_to:new Date(to).toISOString(),p_name:name}));
    setRaw(error||!data||Array.isArray(data)?{off:true}:data);
  },[name]);
  useEffect(()=>{ load(); },[load]);
  useAutoRefresh(load,15000);
  const cfgKey=JSON.stringify(_cxCfg);      // the shared 3CX limits arrive a moment after the page opens: work the numbers out again when they do
  return React.useMemo(()=>{ if(!raw||raw.off) return raw; try{ return cxAgentStats(raw,name); }catch(e){ return {off:true}; } },[raw,name,cfgKey]);
}

// calls per hour: the agent's bars against the team average per logged-in colleague
function CxHourBars({rows}){
  const W=760,H=180,L=30,R=12,T=12,B=26;
  const max=Math.max(1,...rows.map(r=>Math.max(r.mine,r.avg||0)));
  const step=Math.max(1,Math.ceil(max/4)), top=step*4;
  const bw=(W-L-R)/rows.length, x=i=>L+bw*i+bw/2, y=v=>T+(H-T-B)*(1-v/top);
  let line=''; rows.forEach((r,i)=>{ if(r.avg==null){ line+=' '; return; } line+=(line.trim()&&!line.endsWith(' ')?' L':(line.trim()?' M':'M'))+`${x(i)},${y(r.avg)}`; });
  return(
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calls per hour: you compared with the team average">
      {[0,1,2,3,4].map(i=>(<g key={i}><line x1={L} x2={W-R} y1={y(i*step)} y2={y(i*step)} stroke="#2b2b33" strokeWidth="1"/><text x={L-8} y={y(i*step)+4} textAnchor="end" fontSize="11" fill="#7c7c88">{i*step}</text></g>))}
      {rows.map((r,i)=>(
        <g key={i} className="hb">
          <rect x={x(i)-bw*.27} width={bw*.54} y={y(r.mine)} height={Math.max(0,y(0)-y(r.mine))} rx="4" fill={CXC.call} opacity={r.partial?.6:1}/>
          <rect x={x(i)-bw/2} y={T} width={bw} height={H-T-B} fill="transparent"/>
          <title>{`${r.label}–${fmtH(r.h+1)}${r.partial?' (so far)':''}: you ${r.mine} call${r.mine===1?'':'s'} · team average ${r.avg==null?'–':(Math.round(r.avg*10)/10)} per agent`}</title>
          <text x={x(i)} y={H-8} textAnchor="middle" fontSize="11" fill="#7c7c88">{String(r.h).padStart(2,'0')}</text>
        </g>))}
      {line.trim()&&<path d={line.trim()} fill="none" stroke={CXC.admin} strokeWidth="2.2" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round"/>}
      {rows.map((r,i)=>r.avg==null?null:<circle key={'d'+i} cx={x(i)} cy={y(r.avg)} r="3.5" fill={CXC.admin}/>)}
    </svg>
  );
}

function AgentCallStats({st}){
  if(!st||st.off||st.empty||!st.me) return null;
  const m=st.me, hrs=st.hours, avgOk=hrs.filter(r=>r.avg!=null);
  const above=avgOk.filter(r=>r.mine>r.avg).length, below=avgOk.filter(r=>r.mine<r.avg).length;
  return(
    <div className="card acc" style={{marginBottom:34}} id="agent-calls">
      <div className="card-hd"><div><div className="card-t">Your calls today</div><div className="al-sub">From the phone system · updates live</div></div></div>
      <div className="cx-tiles pv">
        <div><span>Calls taken</span><b>{m.calls}</b></div>
        <div><span>Talk time</span><b>{CX.fmtDur(m.callSecs)}</b></div>
        <div><span>Average call</span><b>{CX.fmtDur(m.avgCallSecs)}</b></div>
        <div><span>Admin time</span><b>{CX.fmtDur(m.adminSecs)}</b></div>
        <div><span>Ignored rings</span><b style={m.ignored?{color:'#ff8fa3'}:null}>{m.ignored}</b></div>
        <div><span>Short calls</span><b style={m.shortCalls?{color:'#ffb86b'}:null}>{m.shortCalls}</b></div>
      </div>
      {m.shortCalls>0&&<div className="al-warn amber">Warning: {m.shortCalls} short call{m.shortCalls===1?'':'s'} under {_cxCfg.shortCallSec} seconds today. Calls this short can look like dropped calls, so your admin may ask about them.</div>}
      {m.ignored>0&&<div className="al-warn red">{m.ignored} ignored ring{m.ignored===1?'':'s'}: the phone rang for {_cxCfg.ignoreRingSec} seconds or more and the call was not answered by you or a colleague.</div>}
      {hrs.length>0&&<>
        <div className="card-t" style={{fontSize:16,margin:'6px 12px 4px'}}>Calls per hour, compared with the team</div>
        <div className="cx-chart"><CxHourBars rows={hrs}/></div>
        <div className="cx-leg"><span><i style={{background:CXC.call}}/>You</span><span><i style={{background:CXC.admin}}/>Team average per logged-in agent</span></div>
        <p className="al-sub" style={{margin:'10px 12px 0'}}>
          {st.teamCalls==null?'No colleagues have taken calls yet today.':`Today you took ${m.calls} call${m.calls===1?'':'s'}; the team average is ${Math.round(st.teamCalls*10)/10} per agent.`}
          {avgOk.length>0&&` You were above the average in ${above} of ${avgOk.length} hour${avgOk.length===1?'':'s'} and below it in ${below}.`}
        </p>
      </>}
    </div>
  );
}

/* Settings → how much break time an agent earns */
function ABreakAllowance(){
  const [mins,setMins]=useState(105);
  const [hrs,setHrs]=useState(8);
  const [busy,setBusy]=useState(false);
  const [ok,setOk]=useState(false);
  const [err,setErr]=useState('');
  const [needSetup,setNeedSetup]=useState(false);
  useEffect(()=>{
    run(SB.from('bt_settings').select('*').eq('id',1).maybeSingle()).then(({data,error})=>{
      if(error){ setErr('Load: '+error.message); return; }
      if(!data) return;
      if(!('break_allowance_min' in data)){ setNeedSetup(true); return; }
      setMins(data.break_allowance_min); setHrs(Number(data.full_shift_hours));
    });
  },[]);
  const m=Number(mins), h=Number(hrs), valid=Number.isFinite(m)&&m>=1&&m<=600&&Number.isFinite(h)&&h>=1&&h<=24;
  const save=async()=>{
    setBusy(true); setErr('');
    const {error}=await run(SB.from('bt_settings').update({break_allowance_min:Math.round(m),full_shift_hours:h,updated_at:nowISO()}).eq('id',1));
    setBusy(false);
    if(error){ if(/break_allowance_min|full_shift_hours/.test(error.message||'')) setNeedSetup(true); setErr('Save: '+error.message); return; }
    setNeedSetup(false); setOk(true); setTimeout(()=>setOk(false),3000);
  };
  return(
    <div className="sblk">
      <h2 className="sh">Break allowance</h2>
      <p className="sd">Agents see on their page how much break time they have left today. They earn it as they work{valid?`: ${durStr(Math.round(m)*60)} for a full ${h}-hour shift, about ${Math.round(m/h*10)/10} minutes for every hour on shift`:''}. Every break counts: bathroom, break and lunch.</p>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      {needSetup?(
        <div>
          <p className="sd" style={{marginBottom:10}}>One-time setup: copy this SQL, paste it into the Supabase SQL Editor, run it, then reload this page. It also lets agents see their own call stats.</p>
          <CopySql sql={AGENT_STATS_SQL}/>
        </div>
      ):(<>
        <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:14}}>
          <span style={{minWidth:300,fontSize:15}}>Break time for a full shift</span>
          <input className="fi" type="number" min={1} max={600} step={1} value={mins} onChange={e=>setMins(e.target.value)} style={{width:100}} aria-label="Break minutes for a full shift"/>
          <span style={{fontSize:15,color:'var(--mut)'}}>minutes</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
          <span style={{minWidth:300,fontSize:15}}>A full shift is</span>
          <input className="fi" type="number" min={1} max={24} step={0.5} value={hrs} onChange={e=>setHrs(e.target.value)} style={{width:100}} aria-label="Hours in a full shift"/>
          <span style={{fontSize:15,color:'var(--mut)'}}>hours</span>
        </div>
        <div style={{marginTop:20,display:'flex',alignItems:'center',gap:12}}>
          <button className="bp" onClick={save} disabled={!valid||busy}>{busy?<span className="spin-sm"/>:'Save'}</button>
          {ok&&<span style={{color:'var(--green)',fontSize:14,display:'flex',alignItems:'center',gap:6}}><Ic n="check" size={15}/> Saved</span>}
        </div>
      </>)}
    </div>
  );
}

""".replace('__SQL__', sql)
rep("function A3cx({go}){", NEW_COMPONENTS + "function A3cx({go}){")
rep("      <AShiftEnd/>\n      <A3cxSettings/>", "      <AShiftEnd/>\n      <ABreakAllowance/>\n      <A3cxSettings/>")

# agent page: the call stats hook, the allowance figures and the two new cards
rep("  const team = useTeamConfig();\n  const trainee = isTrainee(name);", "  const team = useTeamConfig();\n  const cxs = useAgentCx(name);\n  const trainee = isTrainee(name);")
rep("  const pct=maxB>0?Math.min(100,teamCount/maxB*100):100;",
    r"""  // Break allowance: earned by the hour (the full amount for a full shift), and every break counts. Leaving early means a smaller allowance.
  const allowSec=team.allowanceMin*60;
  const earnedSec=Math.min(allowSec,allowSec*(shiftSec/3600)/team.fullShiftH);
  const totalAllow=isClockedOut?earnedSec:allowSec;
  const leftSec=Math.round(totalAllow-todaySec);
  const aheadSec=isClockedOut?0:Math.round(todaySec-earnedSec);
  const usedPct=totalAllow>0?Math.min(100,todaySec/totalAllow*100):100, earnedPct=totalAllow>0?Math.min(100,earnedSec/totalAllow*100):0;
  const perHour=Math.round(team.allowanceMin/team.fullShiftH*10)/10;
  const pct=maxB>0?Math.min(100,teamCount/maxB*100):100;""")
rep("""        <div className="grid3">
          <div className="card sm">
            <div className="card-hd">
              <div>
                <div className="card-t">Shift</div>""",
    r"""        <div className="card acc" style={{marginBottom:34}} id="break-left">
          <div className="card-hd">
            <div>
              <div className="card-t">Break time left</div>
              <div className="al-sub">{durStr(team.allowanceMin*60)} for a full {team.fullShiftH}-hour shift · {perHour} min for every hour you work</div>
            </div>
            <div className="card-ctl">{leftSec>=0?<span className="al-big">{durStr(leftSec)}</span>:<span className="al-big over">Over by {durStr(-leftSec)}</span>}</div>
          </div>
          <div className="al-bar" role="img" aria-label={`Used ${durStr(todaySec)} of ${durStr(Math.round(totalAllow))}`}>
            <i className={leftSec<0?'over':''} style={{width:`${usedPct}%`}}/>
            {!isClockedOut&&<b style={{left:`calc(${earnedPct}% - 1px)`}} title="Earned so far"/>}
          </div>
          <div className="sm-cols" style={{marginTop:16}}>
            <div><div className="sm-l">Used today</div><div className="sm-v">{durStr(todaySec)}</div></div>
            <div><div className="sm-l">Earned so far</div><div className="sm-v">{durStr(Math.round(earnedSec))}</div></div>
            <div><div className="sm-l">{isClockedOut?'Allowance today':'Full-day allowance'}</div><div className="sm-v">{durStr(Math.round(totalAllow))}</div></div>
          </div>
          {aheadSec>60&&<div className="al-note amber">You have used {durStr(aheadSec)} more than you have earned so far. It evens out as the shift goes on (about {perHour} min for every hour you work).</div>}
        </div>

        <div className="grid3">
          <div className="card sm">
            <div className="card-hd">
              <div>
                <div className="card-t">Shift</div>""")


# the lunch group is shown right under the greeting, so nobody has to scroll for it
rep("""        <div className="acts">
          {!clockRow&&<button className="bp" onClick={clockIn}>""", r"""        <div className="lunch-strip" id="lunch-strip">
          {(()=>{
            const mins=x=>{ const [h,m]=x.split(':').map(Number); return h*60+m; };
            const slot=trainee?{from:team.lunch,to:addMin(team.lunch,60)}:li?.group?li.slot:null;
            if(!slot) return <span className="lunch-pill"><Ic n="utensils" size={15}/> Lunch · <b>Unassigned</b></span>;
            const nowM=mins(hhmm(nowA)), a=mins(slot.from), z=mins(slot.to);
            const lm=x=>x>=60?`${Math.floor(x/60)}h ${x%60}m`:`${x}m`;
            const when=nowM<a?`starts in ${lm(a-nowM)}`:nowM<z?`now · ends in ${lm(z-nowM)}`:'finished';
            return(<>
              <span className={`lunch-pill${nowM>=a&&nowM<z?' now':''}`}><Ic n="utensils" size={15}/> Lunch · <b>{trainee?'Trainee':`Group ${li.group}`}</b> · <b>{slot.from}–{slot.to}</b> · {when}</span>
            </>);
          })()}
        </div>

        <div className="acts">
          {!clockRow&&<button className="bp" onClick={clockIn}>""")
rep("""            </div>
          </div>
        </div>
      </div>

      {confirmOut&&(""", """            </div>
          </div>
        </div>

        <AgentCallStats st={cxs}/>
      </div>

      {confirmOut&&(""")

css = """
/* agent view: break time left, call stats */
.al-sub{font-size:13px;color:var(--mut);margin-top:4px}
.al-big{font-size:34px;font-weight:300;font-variant-numeric:tabular-nums;line-height:1.1}.al-big.over{color:#ff8fa3}
.al-bar{position:relative;height:12px;border-radius:99px;background:#23252f;margin:10px 0 4px}
.al-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:#8e9cff}.al-bar i.over{background:#ef6b5b}
.al-bar b{position:absolute;top:-4px;bottom:-4px;width:2px;background:#f5f5fa;border-radius:2px}
.al-note{font-size:13.5px;margin-top:14px}.al-note.amber{color:#ffb86b}
.al-warn{font-size:14px;line-height:1.5;margin:4px 12px 14px;padding:10px 14px;border-radius:12px}
.al-warn.amber{background:rgba(245,165,36,.12);color:#ffc966}.al-warn.red{background:rgba(220,38,38,.14);color:#fca5a5}
.lunch-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-6px 0 18px}
.lunch-pill{display:inline-flex;align-items:center;gap:8px;background:var(--surf);border:1px solid var(--bdr);border-radius:999px;padding:8px 16px;font-size:14.5px;color:var(--txt2)}.lunch-pill b{font-weight:500;color:var(--txt)}.lunch-pill.now{border-color:#b3812a;color:#ffc966}.lunch-pill.now b{color:#ffd98c}
"""
i = s.rindex('</style>')
s = s[:i] + css + s[i:]

open(out, 'w', newline='', encoding='utf-8').write(s.replace('\n', '\r\n') if crlf else s)
print('written', out, len(s))
