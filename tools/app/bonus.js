/* ═══ Bonus audit and Late & extra time (admin) ═══ */
const BONUS_SQL=`__BONUS_SQL__`;
const BR={start:'08:30',end:'17:30',graceSec:60,lunchSec:3600,brkSec:900,flexSec:900,lunchMin:3000,brkMin:800};
const BEV={late_start:'Late start',late_lunch:'Lunch over',late_break:'Break over',flex_over:'Short breaks over',extra_break:'Extra break',stayed_late:'On a call after 17:30'};
const hmSec=hm=>{ const [h,m]=hm.split(':').map(Number); return h*3600+m*60; };
const ymd=t=>{ const w=wall(t); return `${w.getUTCFullYear()}-${pad(w.getUTCMonth()+1)}-${pad(w.getUTCDate())}`; };
const secInDay=t=>{ const w=wall(t); return w.getUTCHours()*3600+w.getUTCMinutes()*60+w.getUTCSeconds(); };
const fmtMin=m=>m>=60?`${Math.floor(m/60)}h${m%60?` ${m%60}m`:''}`:`${m}m`;
async function fetchAllRows(make){
  let out=[],i=0,last=false;
  while(!last&&i<120){
    const {data,error}=await run(make().range(i*1000,i*1000+999));
    if(error) return {data:out,error};
    out=out.concat(data||[]); last=!data||data.length<1000; i++;
  }
  return {data:out,error:null};
}
function dlCsv(name,head,rows){
  const q=v=>{ const s=String(v==null?'':v); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const txt='﻿'+[head,...rows].map(r=>r.map(q).join(',')).join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}

/* Everything here comes from the 3CX status log: when an agent came online, their break and lunch statuses, and their calls. */
const hmOf=sec=>`${pad(Math.floor(sec/3600))}:${pad(Math.floor(sec%3600/60))}`;
const CXR_CACHE={};   // status_log rows per date range, so going back and forth is quick
async function loadCxRange(first,last,setProg){
  const tz=clockOff(), today=todayISO();
  const lo=Date.parse(first+'T00:00:00Z')-tz*3600000-36*3600000, hi=Date.parse(isoAdd(last,1)+'T00:00:00Z')-tz*3600000;
  const k=first+'|'+last, c=CXR_CACHE[k];
  let rows;
  if(c&&Date.now()-c.at<(last<today?3600000:90000)) rows=c.rows;
  else{
    let n=0;
    const r=await fetchAllRows(()=>{ n++; setProg(`Reading the 3CX log, page ${n}`); return SB.from('status_log').select('changed_at,extension,agent,old_status,new_status,detail').gte('changed_at',new Date(lo).toISOString()).lt('changed_at',new Date(hi).toISOString()).order('changed_at',{ascending:true}); });
    if(r.error) return {error:r.error.message||String(r.error),days:{}};
    rows=r.data.map(x=>({...x,ms:Date.parse(x.changed_at)})); CXR_CACHE[k]={at:Date.now(),rows};
  }
  const days={}, cfg=_cxCfg, now=appNow(), notWork=x=>['off','hol'].includes(cxCat(x));
  for(let d=first;d<=last&&d<=today;d=isoAdd(d,1)){
    const [from,to]=CX.dayRange(d,tz);
    const part=rows.filter(x=>x.ms>=from-36*3600000&&x.ms<to);
    if(!part.length) continue;
    setProg(`Working out ${d}`);
    try{
      const R=CX.analyze(CX.rowsFromStatusLog(part),{day:d,now:Math.min(now,to),...cfg,tzOffsetHours:0,dayOffsetHours:tz});
      const end=iv=>iv.end==null?R.now:iv.end, cutoff=from+hmSec(BR.end)*1000, rec={};
      Object.values(R.agents).forEach(a=>{
        const ivs=R.intervals.filter(iv=>iv.ext===a.ext);
        const carried=ivs.find(iv=>iv.start<from&&end(iv)>from);
        const inDayIvs=ivs.filter(iv=>iv.start>=from&&iv.start<to);
        const firstIv=(!carried||notWork(carried.status))?inDayIvs.find(iv=>!notWork(iv.status)):null;
        const brks=inDayIvs.filter(iv=>CX.isBreak(iv.status)&&(iv.end!=null||(d===today&&iv.end==null))).map(iv=>({start:iv.start,end:iv.end,secs:Math.round((end(iv)-iv.start)/1000),type:CX.breakType(iv.status,iv.detail)})).filter(x=>x.secs>=(cfg.minBreakSec||10));
        let afterSecs=0, afterN=0;
        R.calls.filter(cl=>cl.ext===a.ext&&cl.start<to).forEach(cl=>{ const ce=cl.end==null?R.now:cl.end; if(ce>cutoff){ afterSecs+=(Math.min(ce,to)-Math.max(cl.start,cutoff))/1000; afterN++; } });
        const k2=CX.nameKey(a.agent);
        rec[k2]={name:a.agent,calls:a.calls,answered:a.answered,ignored:a.ignored,
          present:inDayIvs.some(iv=>!notWork(iv.status))||a.calls>0,
          firstSec:firstIv&&!firstIv.partialStart?(firstIv.start-from)/1000:null,
          breaks:brks,afterSecs:Math.round(afterSecs),afterN};
      });
      days[d]=rec;
    }catch(e){}
    await new Promise(r=>setTimeout(r,0));
  }
  return {days,error:null};
}

/* Every late event, from the per-day 3CX records. A start, a break or a lunch counts as late from one full minute over.
   Staying past the end of the shift only counts as time spent on calls after it (the client pays for calls, not for being logged in). */
function cxEvents(days){
  const ev=[];
  Object.entries(days).forEach(([day,rec])=>Object.values(rec).forEach(a=>{
    const add=(type,secOver,detail)=>ev.push({day,agent:CX.displayName?CX.displayName(a.name):a.name,key:CX.nameKey(a.name),type,mins:Math.floor(secOver/60),detail});
    if(a.firstSec!=null){ const over=a.firstSec-hmSec(BR.start); if(over>=BR.graceSec) add('late_start',over,`Came online at ${hmOf(a.firstSec)}, shift starts ${BR.start}`); }
    if(a.afterSecs>=BR.graceSec) add('stayed_late',a.afterSecs,`On ${a.afterN} call${a.afterN===1?'':'s'} for ${fmtMin(Math.floor(a.afterSecs/60))} after ${BR.end}`);
    const span=x=>`${hhmm(x.start)}–${x.end!=null?hhmm(x.end):'now'}`, m=x=>fmtMin(Math.round(x.secs/60));
    const items=a.breaks.slice().sort((p,q)=>q.secs-p.secs);
    const li=items.findIndex(x=>x.type==='Lunch Break'||x.secs>=BR.lunchMin), lunch=li>=0?items.splice(li,1)[0]:null;
    if(lunch&&lunch.secs-BR.lunchSec>=BR.graceSec) add('late_lunch',lunch.secs-BR.lunchSec,`Lunch ${span(lunch)} took ${m(lunch)}, 1h allowed`);
    const flex=items.filter(x=>x.type==='Bathroom Break'||(x.type!=='Lunch Break'&&x.secs<BR.brkMin)), reg=items.filter(x=>!flex.includes(x));
    reg.forEach((x,i)=>{
      if(i<2){ if(x.secs-BR.brkSec>=BR.graceSec) add('late_break',x.secs-BR.brkSec,`Break ${span(x)} took ${m(x)}, 15m allowed`); }
      else add('extra_break',x.secs,`Third break ${span(x)} (${m(x)}); only two 15m breaks are allowed`);
    });
    const ft=flex.reduce((t,x)=>t+x.secs,0);
    if(ft-BR.flexSec>=BR.graceSec) add('flex_over',ft-BR.flexSec,`${flex.length} short break${flex.length===1?'':'s'} added up to ${fmtMin(Math.round(ft/60))}, 15m allowed`);
  }));
  return ev.sort((a,b)=>b.day.localeCompare(a.day)||a.agent.localeCompare(b.agent)||a.type.localeCompare(b.type));
}

/* Bonus rules (the same as the October sheet) */
function bonusOf({abs,punct,qa,calls,ign}){
  const out=abs>=2||punct>=3;
  const att=out?0:(abs===1?100:200);
  const qaB=out?0:(qa>=1?150:qa>=0.9?75:0);
  const prod=out?0:((calls<600||ign>0.02)?0:(abs===1?75:150));
  return {att,qaB,prod,total:att+qaB+prod};
}

function ABonus({go}){
  const cur=todayISO().slice(0,7);
  const [ym,setYm]=useState(cur);
  const [data,setData]=useState(null);
  const [cx,setCx]=useState(null);
  const [prog,setProg]=useState('');
  const [inp,setInp]=useState({});
  const [off,setOff]=useState(false);
  const [err,setErr]=useState('');
  const [showSet,setShowSet]=useState(false);
  const first=ym+'-01', next=monthAdd(first,1);
  useEffect(()=>{
    let dead=false;
    (async()=>{
      setData(null); setCx(null); setErr(''); setProg('Reading 3CX');
      const [q,i]=await Promise.all([
        run(SB.from('bt_requests').select('*').eq('status','approved').in('kind',['pto','sick']).lte('start_date',isoAdd(next,-1)).gte('end_date',first)),
        run(SB.from('bt_bonus_inputs').select('*').eq('month',ym)),
      ]);
      if(dead) return;
      const missing=!!(i.error&&/bt_bonus_inputs|schema cache|does not exist/i.test(i.error.message||''));
      setOff(missing);
      const m={}; (i.data||[]).forEach(r=>{ m[r.agent_name]=r; }); setInp(m);
      setData({reqs:q.data||[]});
      const r=await loadCxRange(first,isoAdd(next,-1),t=>{ if(!dead) setProg(t); });
      if(dead) return;
      if(r.error) setErr("Couldn't read the 3CX log: "+r.error);
      setCx(r); setProg('');
    })();
    return()=>{ dead=true; };
  },[ym]);
  const month=inp.__month__||{};
  const workdays=(month.workdays||'12345'), holidays=new Set((month.holidays||'').split(/[\s,;]+/).filter(Boolean)), leaveCounts=!!month.leave_counts;
  const save=async(name,patch)=>{
    const row={...(inp[name]||{}),month:ym,agent_name:name,...patch,updated_at:nowISO()};
    delete row.id;
    setInp(p=>({...p,[name]:row}));
    if(off) return;
    const {error}=await run(SB.from('bt_bonus_inputs').upsert({month:ym,agent_name:name,qa_rate:row.qa_rate??null,absent_override:row.absent_override??null,punct_adj:row.punct_adj??0,workdays:row.workdays??null,holidays:row.holidays??null,leave_counts:!!row.leave_counts,updated_at:row.updated_at},{onConflict:'month,agent_name'}));
    if(error){ if(/bt_bonus_inputs|schema cache/i.test(error.message||'')) setOff(true); else setErr('Save: '+error.message); }
  };
  const rowsOut=useMemo(()=>{
    if(!data||!cx) return [];
    const today=todayISO();
    const days=[]; for(let d=first;d<next&&d<today;d=isoAdd(d,1)){ const wd=new Date(d+'T00:00:00Z').getUTCDay()||7; if(workdays.includes(String(wd))&&!holidays.has(d)) days.push(d); }
    const people={}, tot={}, worked={};
    Object.entries(cx.days).forEach(([d,rec])=>Object.entries(rec).forEach(([k,a])=>{
      people[k]=people[k]||{key:k,name:CX.displayName?CX.displayName(a.name):a.name};
      const t=tot[k]=tot[k]||{calls:0,answered:0,ignored:0}; t.calls+=a.calls; t.answered+=a.answered; t.ignored+=a.ignored;
      if(a.present) (worked[k]=worked[k]||new Set()).add(d);
    }));
    const ev=cxEvents(cx.days).filter(e=>e.type!=='stayed_late');
    return Object.values(people).filter(p=>worked[p.key]&&worked[p.key].size>0||tot[p.key].calls>0).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
      const leave=new Set(); data.reqs.filter(r=>CX.nameKey(r.agent_name)===p.key).forEach(r=>{ for(let d=r.start_date;d<=(r.end_date||r.start_date);d=isoAdd(d,1)) leave.add(d); });
      const auto=days.filter(d=>!(worked[p.key]&&worked[p.key].has(d))&&(leaveCounts||!leave.has(d))).length;
      const i=inp[p.name]||inp[Object.keys(inp).find(n=>CX.nameKey(n)===p.key)]||{};
      const abs=i.absent_override!=null?i.absent_override:auto;
      const n=ev.filter(e=>e.key===p.key).length, adj=i.punct_adj||0, punct=Math.max(0,n+adj);
      const a=tot[p.key], rings=a.answered+a.ignored, ign=rings?a.ignored/rings:0;
      const qa=i.qa_rate!=null?Number(i.qa_rate):0;
      return {...p,auto,abs,n,adj,punct,qa,qaSet:i.qa_rate!=null,calls:a.calls,ign,ignN:a.ignored,over:i.absent_override!=null,...bonusOf({abs,punct,qa,calls:a.calls,ign})};
    });
  },[data,cx,inp,ym]);
  const sum=k=>rowsOut.reduce((t,r)=>t+r[k],0);
  const monthName=new Date(first+'T00:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
  const toggleDay=d=>{ const s=new Set(workdays.split('')); s.has(String(d))?s.delete(String(d)):s.add(String(d)); save('__month__',{workdays:[...s].sort().join('')}); };
  const exportCsv=()=>dlCsv(`bonus-audit-${ym}.csv`,['Employee','Days absent','Punctuality events','QA pass rate','Handled calls','Ignored calls rate','Attendance bonus (MAD)','QA bonus (MAD)','Productivity bonus (MAD)','Total bonus (MAD)'],
    rowsOut.map(r=>[r.name,r.abs,r.punct,r.qaSet?Math.round(r.qa*1000)/10+'%':'',r.calls,(Math.round(r.ign*1000)/10)+'%',r.att,r.qaB,r.prod,r.total]));
  const numIn=(r,field,val,parse)=>(
    <input className="fi bn-in" defaultValue={val} key={r.key+field+ym+String(val)} inputMode="decimal"
      onBlur={e=>{ const t=e.target.value.trim(); const v=parse(t); if(v!==undefined) save(r.name,{[field]:v}); }}
      onKeyDown={e=>{ if(e.key==='Enter') e.target.blur(); }} aria-label={`${field} for ${r.name}`}/>);
  return(
    <div className="panel" id="tab-bonus">
      <div className="tab-h"><h1>Bonus audit</h1><p>Attendance, QA and productivity bonus for the month, all from the 3CX status log.</p></div>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      {off&&<div className="sblk" style={{marginBottom:18}}><h2 className="sh">One-time setup</h2><p className="sd">QA rates and corrections need a small table. Copy this SQL into the Supabase SQL Editor and run it, then reload. Until then what you type is kept only on this page.</p><CopySql sql={BONUS_SQL}/></div>}
      <div className="pf-nav">
        <button className="icb" onClick={()=>setYm(monthAdd(first,-1).slice(0,7))} aria-label="Previous month"><Ic n="chevleft" size={18}/></button>
        <b>{monthName}</b>
        <button className="icb" onClick={()=>setYm(monthAdd(first,1).slice(0,7))} disabled={ym>=cur} aria-label="Next month"><span style={{display:'inline-flex',transform:'rotate(180deg)'}}><Ic n="chevleft" size={18}/></span></button>
        {prog&&<span className="rq-s" style={{marginLeft:8}}>{prog}…</span>}
        <span style={{marginLeft:'auto',display:'flex',gap:10}}>
          <button className="bs" onClick={()=>setShowSet(s=>!s)}><Ic n="settings" size={15}/> Month settings</button>
          <button className="bs" onClick={()=>go&&go('late')}><Ic n="clock" size={15}/> Late events</button>
          <button className="bs" onClick={exportCsv} disabled={!rowsOut.length}><Ic n="download" size={15}/> Export CSV</button>
        </span>
      </div>
      {showSet&&<div className="sblk" id="bn-set" style={{marginBottom:18}}>
        <h2 className="sh">Month settings</h2>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:14}}>
          <span style={{minWidth:130}}>Working days</span>
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((n,i)=><button key={n} className={`fchip${workdays.includes(String(i+1))?' on':''}`} onClick={()=>toggleDay(i+1)}>{n}</button>)}
        </div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center',marginBottom:14}}>
          <span style={{minWidth:130}}>Days nobody works</span>
          <input className="fi" style={{maxWidth:420}} defaultValue={month.holidays||''} key={ym+'h'+(month.holidays||'')} placeholder="2026-10-06, 2026-10-20" onBlur={e=>save('__month__',{holidays:e.target.value.trim()})} aria-label="Holidays"/>
        </div>
        <label style={{display:'flex',gap:10,alignItems:'center',cursor:'pointer'}}><input type="checkbox" checked={leaveCounts} onChange={e=>save('__month__',{leave_counts:e.target.checked})}/> Count approved time off as days absent</label>
      </div>}
      {(data===null||cx===null)?<div className="es"><div className="spin"/></div>:(
        <div className="card" style={{padding:'10px 18px 14px',overflowX:'auto'}}>
          <table className="tbl bn-tbl"><thead><tr><th>Employee</th><th title="Working days with no 3CX activity. Type a number to replace it.">Days absent</th><th title="Late starts and break or lunch time passed by a minute or more. Add or remove events with the adjustment.">Punctuality events</th><th>QA pass rate</th><th>Handled calls</th><th title="Ignored rings out of the rings the agent was offered">Ignored calls</th><th>Attendance</th><th>QA</th><th>Productivity</th><th>Total (MAD)</th></tr></thead><tbody>
            {rowsOut.length===0&&<tr><td colSpan={10} style={{color:'var(--mut)',padding:'22px 10px'}}>No 3CX activity in {monthName}.</td></tr>}
            {rowsOut.map(r=>(
              <tr key={r.key} data-agent={r.name}>
                <td>{r.name}</td>
                <td className="n">{numIn(r,'absent_override',r.abs,t=>t===''?null:(/^\d+$/.test(t)?Number(t):undefined))}{r.over&&<span className="bn-flag" title={`Worked out: ${r.auto}`}>edited</span>}</td>
                <td className="n"><span className={r.punct>=3?'bn-bad':''}>{r.punct}</span>{r.adj!==0&&<span className="bn-flag" title={`${r.n} found, ${r.adj>0?'+':''}${r.adj} adjusted`}>{r.adj>0?'+':''}{r.adj}</span>}
                  <button className="bn-adj" title="Adjust the number of events" onClick={()=>{ const t=prompt(`Adjust ${r.name}'s punctuality events (found ${r.n}). Use -1 to forgive one, +1 to add one:`,String(r.adj)); if(t!==null&&/^-?\d+$/.test(t.trim())) save(r.name,{punct_adj:Number(t)}); }}>±</button></td>
                <td className="n">{numIn(r,'qa_rate',r.qaSet?Math.round(r.qa*1000)/10:'',t=>t===''?null:(Number.isFinite(Number(t))&&Number(t)>=0&&Number(t)<=100?Number(t)/100:undefined))}<span className="bn-pct">%</span></td>
                <td className="n">{r.calls}</td>
                <td className="n"><span className={r.ign>0.02?'bn-bad':''}>{(Math.round(r.ign*1000)/10).toFixed(1)}%</span></td>
                <td className="n">{r.att}</td><td className="n">{r.qaB}</td><td className="n">{r.prod}</td><td className="n"><b>{r.total}</b></td>
              </tr>))}
            {rowsOut.length>0&&<tr className="bn-tot"><td>Total</td><td/><td/><td/><td className="n">{sum('calls')}</td><td/><td className="n">{sum('att')}</td><td className="n">{sum('qaB')}</td><td className="n">{sum('prod')}</td><td className="n">{sum('total')}</td></tr>}
          </tbody></table>
        </div>)}
    </div>
  );
}

function ALate(){
  const today=todayISO();
  const [from,setFrom]=useState(today.slice(0,8)+'01');
  const [to,setTo]=useState(today);
  const [agent,setAgent]=useState('');
  const [types,setTypes]=useState([]);       // empty = all
  const [data,setData]=useState(null);
  const [err,setErr]=useState('');
  const [prog,setProg]=useState('');
  const seq=useRef(0);
  const load=useCallback(async()=>{
    if(!from||!to||to<from) return;
    const my=++seq.current;
    const r=await loadCxRange(from,to,setProg);
    if(my!==seq.current) return;   // a newer range was asked for meanwhile
    setProg('');
    if(r.error){ setErr("Couldn't read the 3CX log: "+r.error); return; }
    setErr(''); setData(r);
  },[from,to]);
  useEffect(()=>{ setData(null); load(); },[load]);
  useAutoRefresh(load,60000);
  const all=useMemo(()=>data?cxEvents(data.days):[],[data]);
  const names=[...new Set(all.map(e=>e.agent))].sort((a,b)=>a.localeCompare(b));
  const list=all.filter(e=>(!agent||e.agent===agent)&&(!types.length||types.includes(e.type)));
  const isLate=e=>e.type!=='stayed_late';
  const nStart=list.filter(e=>e.type==='late_start').length, nBrk=list.filter(e=>isLate(e)&&e.type!=='late_start').length;
  const extra=list.filter(e=>e.type==='stayed_late').reduce((t,e)=>t+e.mins,0);
  const preset=k=>{ const t=todayISO(); if(k==='today'){ setFrom(t); setTo(t); } else if(k==='week'){ const d=new Date(t+'T00:00:00Z'); const wd=(d.getUTCDay()||7)-1; setFrom(isoAdd(t,-wd)); setTo(t); } else if(k==='month'){ setFrom(t.slice(0,8)+'01'); setTo(t); } else { const pm=monthAdd(t.slice(0,8)+'01',-1); setFrom(pm); setTo(isoAdd(monthAdd(pm,1),-1)); } };
  const toggle=t=>setTypes(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t]);
  const exportCsv=()=>dlCsv(`late-and-extra-time-${from}-to-${to}.csv`,['Date','Agent','Type','Minutes over','Details'],list.map(e=>[e.day,e.agent,BEV[e.type],e.mins,e.detail]));
  return(
    <div className="panel" id="tab-late">
      <div className="tab-h"><h1>Late &amp; extra time</h1><p>From the 3CX log: late starts, break and lunch time passed by a minute or more, and time on calls after {BR.end}.</p></div>
      {err&&<div className="ebox"><Ic n="alert" size={14}/>{err}</div>}
      <div className="lt-filters">
        <label>From<input className="fi" type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} aria-label="From date"/></label>
        <label>To<input className="fi" type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} aria-label="To date"/></label>
        <label>Agent<select className="fi" value={agent} onChange={e=>setAgent(e.target.value)} aria-label="Agent"><option value="">Everyone</option>{names.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <div className="lt-pre">{[['today','Today'],['week','This week'],['month','This month'],['last','Last month']].map(([k,l])=><button key={k} className="fchip" onClick={()=>preset(k)}>{l}</button>)}</div>
        <button className="bs" onClick={exportCsv} disabled={!list.length} style={{marginLeft:'auto'}}><Ic n="download" size={15}/> Export CSV</button>
      </div>
      <div className="lt-types">{Object.entries(BEV).map(([k,l])=><button key={k} data-type={k} className={`fchip${types.includes(k)?' on':''}`} onClick={()=>toggle(k)}>{l}</button>)}{types.length>0&&<button className="fchip" onClick={()=>setTypes([])}>Clear</button>}</div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-ic r"><Ic n="clock" size={20}/></div><b id="lt-k-start">{nStart}</b><span>Late starts</span></div>
        <div className="kpi"><div className="kpi-ic"><Ic n="coffee" size={20}/></div><b id="lt-k-brk">{nBrk}</b><span>Break and lunch overruns</span></div>
        <div className="kpi"><div className="kpi-ic p"><Ic n="timer" size={20}/></div><b id="lt-k-extra">{fmtMin(extra)}</b><span>Time on calls after {BR.end}</span></div>
        <div className="kpi"><div className="kpi-ic b"><Ic n="users" size={20}/></div><b>{new Set(list.map(e=>e.agent)).size}</b><span>Agents involved</span></div>
      </div>
      {data===null?<div className="es"><div className="spin"/>{prog&&<div className="rq-s" style={{marginTop:10}}>{prog}…</div>}</div>:(
        <div className="card" style={{padding:'10px 18px 14px',overflowX:'auto'}}>
          <table className="tbl"><thead><tr><th>Date</th><th>Agent</th><th>Type</th><th>Over by</th><th>Details</th></tr></thead><tbody>
            {list.length===0&&<tr><td colSpan={5} style={{color:'var(--mut)',padding:'22px 10px'}}>Nothing late or extra in this period.</td></tr>}
            {list.map((e,i)=>(<tr key={i} data-ev={e.type}><td>{fmtD(e.day+'T12:00:00Z')}</td><td>{e.agent}</td><td><span className={`lt-t ${e.type}`}>{BEV[e.type]}</span></td><td className="n">{e.mins}m</td><td style={{color:'var(--mut)'}}>{e.detail}</td></tr>))}
          </tbody></table>
        </div>)}
    </div>
  );
}

