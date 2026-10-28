
/* ═══ 3CX page: reads a status_log.csv from this PC and shows calls, ignored rings, short calls, admin time and
   breaks per agent. Saves nothing in the database and never changes what agents entered. Only agents that exist in the app are shown. ═══ */
const CXC={call:'#8e9cff',admin:'#ef6b5b',brk:'#f5a524',avail:'#2fb344',avail2:'#2ec4b6',away:'#7f8ab0',hol:'#2a8fe0',off:'#3a3d4a',ring:'#f5d04e',other:'#7d86a8'};   // the 3CX status colours: Available green, Away/Break orange, Do Not Disturb/Admin red, Available 2 teal, Holiday/Out of office blue
const CX_LABEL={call:'On a call',admin:'Admin',brk:'On break',avail:'Available',avail2:'Available 2',hol:'Out of office',off:'Offline',ring:'Ringing',other:'Other'};
const cxCat=s=>/^on call$/i.test(s)?'call':/admin|do not disturb|^dnd$/i.test(s)?'admin':/break|lunch|bathroom|toilet|^away/i.test(s)?'brk':/^ringing$/i.test(s)?'ring':/out of (the )?office|holiday/i.test(s)?'hol':/offline|not registered/i.test(s)?'off':/^available\s*2|remote/i.test(s)?'avail2':/^available/i.test(s)?'avail':'other';
const CX_DISMISS_KEY='bt_cx_dismissed';
// The 3CX data can live in a different Supabase project from the app: use its own client then (no sign-in, nothing stored).
let _cxClient=null,_cxClientId='';
function cxDb(){
  const u=(_cxCfg.dbUrl||'').trim().replace(/\/+$/,''), k=(_cxCfg.dbKey||'').trim();
  if(!u||!k) return SB;
  const id=u+'|'+k;
  if(_cxClientId!==id){ _cxClient=supabase.createClient(u,k,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}); _cxClientId=id; }
  return _cxClient;
}
const cxOwnDb=()=>!!((_cxCfg.dbUrl||'').trim()&&(_cxCfg.dbKey||'').trim());

// smooth line through points for the chart
const cxSmooth=pts=>{
  if(pts.length<2) return '';
  let d=`M${pts[0][0]},${pts[0][1]}`;
  for(let i=1;i<pts.length;i++){ const [x0,y0]=pts[i-1],[x1,y1]=pts[i],mx=(x0+x1)/2; d+=` C${mx},${y0} ${mx},${y1} ${x1},${y1}`; }
  return d;
};
function CxChart({labels,series}){
  const W=760,H=300,L=34,R=24,T=14,B=28;
  const max=Math.max(...series.flatMap(s=>s.vals),1);
  const step=Math.max(1,Math.ceil(max/4)), top=step*4;
  const x=i=>L+(W-L-R)*(labels.length>1?i/(labels.length-1):.5);
  const y=v=>T+(H-T-B)*(1-v/top);
  const area=series[0]&&labels.length>1?`${cxSmooth(series[0].vals.map((v,i)=>[x(i),y(v)]))} L${x(labels.length-1)},${y(0)} L${x(0)},${y(0)} Z`:'';
  return(
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calls per hour">
      <defs><linearGradient id="cxg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={CXC.call} stopOpacity=".45"/><stop offset="1" stopColor={CXC.call} stopOpacity="0"/></linearGradient></defs>
      {[0,1,2,3,4].map(i=>(<g key={i}><line x1={L} x2={W-R} y1={y(i*step)} y2={y(i*step)} stroke="#2b2b33" strokeWidth="1"/><text x={L-8} y={y(i*step)+4} textAnchor="end" fontSize="11" fill="#7c7c88">{i*step}</text></g>))}
      {area&&<path d={area} fill="url(#cxg)"/>}
      {series.map((s,k)=>labels.length>1
        ?<path key={k} d={cxSmooth(s.vals.map((v,i)=>[x(i),y(v)]))} fill="none" stroke={s.color} strokeWidth="2.2" strokeDasharray={s.dashed?'5 5':undefined} strokeLinecap="round"/>
        :<circle key={k} cx={x(0)} cy={y(s.vals[0]||0)} r="4" fill={s.color}/>)}
      {labels.map((l,i)=>(i%Math.max(1,Math.ceil(labels.length/10))===0)&&<text key={i} x={x(i)} y={H-8} textAnchor="middle" fontSize="11" fill="#7c7c88">{l}</text>)}
    </svg>
  );
}

function A3cx({go}){
  const [text,setText]=useState('');
  const [fileName,setFileName]=useState('Supabase · live');
  const [fileMod,setFileMod]=useState(0);
  const [picked,setPicked]=useState(null);          // a day chosen by hand; null = always follow today
  const [, setTick]=useState(0);
  const [source,setSource]=useState('db');         // always 'db' (read live from the Supabase status_log table); 'file' is only reachable from the browser test hook below
  const [dbRows,setDbRows]=useState([]);
  const [dbErr,setDbErr]=useState('');
  const [dbAt,setDbAt]=useState(0);
  const [users,setUsers]=useState([]);
  const [shiftEnd,setShiftEnd]=useState('16:30');
  const [dbLogs,setDbLogs]=useState([]);            // what the agents entered (bt_logs) for the day
  const [err,setErr]=useState('');
  const [sel,setSel]=useState(null);
  const [showDone,setShowDone]=useState(false);
  const [dismissed,setDismissed]=useState(()=>{ try{ return JSON.parse(localStorage.getItem(CX_DISMISS_KEY)||'{}'); }catch(e){ return {}; } });
  const tz=clockOff();
  const isSample=fileName==='sample data';
  const isDb=source==='db';
  const missingTable=/could not find the table|does not exist|schema cache/i.test(dbErr);
  const todayStr=todayISO();
  const day=picked||todayStr;
  const [from,to]=CX.dayRange(day,tz);
  const inDay=t=>t>=from&&t<to;

  useEffect(()=>{ const id=setInterval(()=>setTick(n=>n+1),5000); return()=>clearInterval(id); },[]);   // so "today" and the check time move on by themselves

  useEffect(()=>{      // the app's agents: only agents who exist in the app are shown
    Promise.all([
      run(SB.from('bt_clocklogs').select('user_id,agent_name').order('clock_in',{ascending:false}).limit(2000)),
      run(SB.from('bt_logs').select('user_id,agent_name').order('start_time',{ascending:false}).limit(2000)),
      run(SB.from('bt_settings').select('*').eq('id',1).maybeSingle()),
    ]).then(([a,b,c])=>{
      const m=new Map();
      [...(a.data||[]),...(b.data||[])].forEach(r=>{ if(r.user_id&&r.agent_name&&!m.has(r.user_id)) m.set(r.user_id,{id:r.user_id,name:r.agent_name}); });
      setUsers([...m.values()]);
      if(c.data&&HM_RE.test(c.data.shift_end||'')) setShiftEnd(c.data.shift_end);
    });
  },[]);

  const loadApp=useCallback(async()=>{     // read-only: the agents' own break entries for this day
    const {data}=await run(SB.from('bt_logs').select('id,user_id,agent_name,start_time,end_time,break_type').gte('start_time',new Date(from).toISOString()).lt('start_time',new Date(to).toISOString()).order('start_time'));
    setDbLogs(data||[]);
  },[from,to]);
  useEffect(()=>{ loadApp(); },[loadApp]);
  useAutoRefresh(loadApp,30000);

  // Live: the first read for a day gets everything; after that only rows newer than the last one seen (by id) are fetched, every 5 seconds,
  // and a full re-read every 2 minutes in case anything was missed.
  const dbKeyRef=useRef(''), dbLastIdRef=useRef(null), dbFullAtRef=useRef(0), dbBusyRef=useRef(false), dbAllRef=useRef([]);
  const reloadDb=useCallback(async()=>{
    if(dbBusyRef.current) return; dbBusyRef.current=true;
    try{
      const lo=new Date(from-36*3600000).toISOString(), hi=new Date(to).toISOString();   // a day and a half before, so each agent's status at the start of the day is known
      const key=lo+'|'+hi+'|'+(_cxCfg.dbUrl||'')+'|'+(_cxCfg.dbTable||'');
      const full=key!==dbKeyRef.current||dbLastIdRef.current==null||Date.now()-dbFullAtRef.current>120000;
      const cols='id,changed_at,extension,agent,old_status,new_status,detail', tbl=_cxCfg.dbTable||'status_log';
      let got=[],i=0,last=false;
      while(!last&&i<60){
        let q=cxDb().from(tbl).select(cols).gte('changed_at',lo).lt('changed_at',hi);
        q=full?q.order('changed_at',{ascending:true}):q.gt('id',dbLastIdRef.current).order('id',{ascending:true});
        const {data,error}=await run(q.range(i*1000,i*1000+999));
        if(error){ setDbErr(error.message||String(error)); return; }
        got=got.concat(data||[]); last=!data||data.length<1000; i++;
      }
      let all;
      if(full) all=got;
      else if(got.length){ const seen=new Set(dbAllRef.current.map(r=>r.id)); all=dbAllRef.current.concat(got.filter(r=>!seen.has(r.id))).sort((a,b)=>Date.parse(a.changed_at)-Date.parse(b.changed_at)); }
      else all=dbAllRef.current;
      const ids=all.map(r=>Number(r.id)).filter(Number.isFinite);
      dbKeyRef.current=key; dbAllRef.current=all; dbLastIdRef.current=ids.length&&ids.length===all.length?Math.max(...ids):null;   // rows without an id can't be read incrementally: always re-read everything
      if(full) dbFullAtRef.current=Date.now();
      setDbErr(''); if(full||got.length||!dbAt) setDbRows(all); setDbAt(appNow()); bumpSync();
    } finally { dbBusyRef.current=false; }
  },[from,to]);
  useEffect(()=>{ if(source==='db') reloadDb(); },[source,reloadDb]);
  const reloadIfLive=useCallback(()=>{ if(source==='db') return reloadDb(); },[source,reloadDb]);
  useAutoRefresh(reloadIfLive,5000);                     // live: new rows every 5 seconds
  const goLive=()=>{ setErr(''); setDbErr(''); setSel(null); setText(''); setFileMod(0); setFileName('Supabase · live'); setSource('db'); reloadDb(); };

  const load=(t,name,mod)=>{
    const rows=CX.parseCsv(t);
    if(!rows.length){ setErr('That file has no rows yet. Let the logger run for a while and try again.'); return; }
    setErr(''); setDbErr(''); setSource('file'); setText(t); setFileName(name); setFileMod(mod||0); setSel(null);   // the day is NOT changed: it stays on today (or the day you picked)
  };
  useEffect(()=>{ window.__CX_TEST={ sample:()=>load(CX_SAMPLE,'sample data'), csv:(t,n,m)=>load(t,n||'test.csv',m), live:goLive }; });   // browser tests only: there is no manual upload in the page
  const chooseDay=d=>setPicked(!d||d===todayISO()?null:d);

  const match=isSample?CX_SAMPLE_USERS:users;
  const appLogs=isSample?CX_SAMPLE_APP.filter(l=>inDay(Date.parse(l.start_time))):dbLogs;
  const logTz=_cxCfg.logTz;
  const rowsAll=React.useMemo(()=>isDb?(dbAt?CX.rowsFromStatusLog(dbRows):null):(text?CX.parseCsv(text):null),[isDb,dbRows,dbAt,text]);
  const R=React.useMemo(()=>{
    if(!rowsAll) return null;
    // a CSV is on the logger PC's clock; rows from Supabase are real instants, so the logger clock setting doesn't apply to them.
    // "which day" and the times shown use the app's company clock.
    try{ return CX.analyze(rowsAll,{day,now:appNow(),..._cxCfg,tzOffsetHours:isDb?0:logTz,dayOffsetHours:tz}); }
    catch(e){ return {error:e.message}; }
  },[rowsAll,day,tz,logTz,isDb]);
  /* Warn if the file itself says the logger PC is on a different clock than Settings: the file's last save time
     is (almost) the time of its last row, so the gap between the two is the logger PC's offset from UTC. */
  const clockHint=React.useMemo(()=>{
    if(isDb||!fileMod||!text||isSample) return null;
    const last=CX.parseCsv(text).slice(-1)[0]; if(!last) return null;
    const m=/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(last.timestamp||''); if(!m) return null;
    const diffH=(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])-fileMod)/3600000;
    const off=Math.round(diffH);
    if(Math.abs(diffH-off)>0.1) return null;            // not saved at about the time of its last row (copied or edited later): can't tell
    return off!==logTz?off:null;
  },[fileMod,text,isSample,logTz,isDb]);

  /* everything below is limited to agents that match an app agent */
  const ok=R&&!R.error;
  const byKey=new Map(match.map(u=>[CX.nameKey(u.name),u]));
  const all=ok?Object.values(R.agents):[];
  const matchedAny=all.some(a=>byKey.has(CX.nameKey(a.agent)));
  const agents=all.filter(a=>byKey.has(CX.nameKey(a.agent))&&Object.keys(a.statusSecs).some(st=>!['off','hol'].includes(cxCat(st)))).map(a=>({...a,app:byKey.get(CX.nameKey(a.agent)).name,uid:byKey.get(CX.nameKey(a.agent)).id})).sort((a,b)=>a.app.localeCompare(b.app));
  const shown=new Set(agents.map(a=>a.ext));
  const hidden=all.filter(a=>!byKey.has(CX.nameKey(a.agent))).length;
  const tot=agents.reduce((t,a)=>({calls:t.calls+a.calls,talk:t.talk+a.callSecs,ans:t.ans+a.answered,ign:t.ign+a.ignored,short:t.short+a.shortCalls,admin:t.admin+a.adminSecs}),{calls:0,talk:0,ans:0,ign:0,short:0,admin:0});
  const rate=tot.ans+tot.ign?Math.round(tot.ans/(tot.ans+tot.ign)*100)+'%':'–';

  /* break check: 3CX against what the agents entered. Read-only, and only shown in its own table:
     it is never added to the alerts or to notifications, and nothing the agents entered is changed. */
  const uids=new Set(agents.map(a=>a.uid));
  const cxBreaks=ok?CX.toBreakLogs(R.intervals,match,{tzOffsetHours:logTz}).logs.filter(l=>inDay(Date.parse(l.start_time))&&uids.has(l.user_id)):[];
  const appBreaks=appLogs.filter(l=>uids.has(l.user_id));
  const cmp=ok?CX.compareBreaks(cxBreaks,appBreaks,{tzOffsetHours:tz,now:R.now,breakToleranceSec:_cxCfg.breakToleranceMin*60}):[];
  // a row differs when the totals are further apart than the tolerance, or the number of breaks isn't the same
  const isDiff=c=>Math.abs(c.diffSecs)>_cxCfg.breakToleranceMin*60||c.cxCount!==c.appCount;
  const flagged=cmp.filter(isDiff);
  const extOfUid={}; agents.forEach(a=>{ extOfUid[a.uid]=a.ext; });

  /* The ONLY thing the break check does besides the table: one notification a day, `breakCheckLeadMin` minutes before shift end
     (Settings), if any agent's breaks differ. It is not added to the alerts list. */
  const checkAt=addMin(shiftEnd,-_cxCfg.breakCheckLeadMin);
  const notifyDue=day===todayStr&&wallHM()>=checkAt;
  const names=flagged.map(c=>c.agent_name);
  useEffect(()=>{
    if(!ok||!notifyDue||names.length===0) return;
    const k='bt_cx_notified_'+day;
    try{ if(localStorage.getItem(k)) return; localStorage.setItem(k,'1'); }catch(e){}
    fireNotification({title:'Break check',body:`${names.slice(0,4).join(', ')}${names.length>4?` and ${names.length-4} more`:''}: breaks in 3CX differ from what they logged`,type:'custom',duration:12000});
  },[ok,notifyDue,names.length,day]);

  /* alerts: the call alerts from the analysis */
  const alertsAll=ok?R.alerts.filter(a=>shown.has(a.ext)).map(a=>({...a,agent:(byKey.get(CX.nameKey(a.agent))||{}).name||a.agent})).sort((a,b)=>a.at-b.at):[];
  const akey=a=>`${a.type}|${a.ext}|${a.at}`;
  const alerts=alertsAll.filter(a=>!dismissed[akey(a)]);
  const done=alertsAll.filter(a=>dismissed[akey(a)]);
  const saveDismissed=n=>{ setDismissed(n); try{ localStorage.setItem(CX_DISMISS_KEY,JSON.stringify(n)); }catch(e){} };
  const dismiss=a=>saveDismissed({...dismissed,[akey(a)]:1});
  const restore=a=>{ const n={...dismissed}; delete n[akey(a)]; saveDismissed(n); };
  const clearAll=()=>{ const n={...dismissed}; alerts.forEach(a=>{ n[akey(a)]=1; }); saveDismissed(n); };

  // days that appear in the log (company clock), plus today; newest 14
  const days=ok?[...new Set([day,todayStr,...R.intervals.map(iv=>{ const w=wall(iv.start); return `${w.getUTCFullYear()}-${pad(w.getUTCMonth()+1)}-${pad(w.getUTCDate())}`; })])].sort().slice(-14):[];
  const dayLabel=new Date(day+'T00:00:00Z').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});

  // chart range: real activity that started this day (idle "Available" and last night's carry-over don't set it)
  let startH=8,endH=18,capEnd=appNow();
  const mine=ok?R.intervals.filter(iv=>shown.has(iv.ext)):[];
  if(ok&&mine.length){
    const logEnd=Math.max(...mine.map(iv=>iv.end??iv.start));
    capEnd=Math.min(appNow(),Math.max(logEnd,from));
    const act=mine.filter(iv=>['call','ring','admin','brk'].includes(cxCat(iv.status))&&iv.start>=from&&iv.start<to);
    if(act.length){
      const mn=Math.min(...act.map(iv=>iv.start)), mx=Math.max(...act.map(iv=>Math.min(iv.end??capEnd,to)));
      startH=Math.max(0,Math.floor((mn-from)/3600000)); endH=Math.min(24,Math.ceil((mx-from)/3600000)+1);
      if(endH-startH<6) endH=Math.min(24,startH+6);
    }
  }
  const hours=[...Array(Math.max(0,endH-startH)).keys()].map(i=>startH+i);
  const callsAt=ok?R.calls.filter(c=>shown.has(c.ext)&&inDay(c.start)):[];
  const look=ok?[...R.rings.filter(r=>shown.has(r.ext)&&r.outcome==='ignored'&&inDay(r.start)).map(r=>r.start),
                 ...callsAt.filter(c=>!c.open&&!c.partialStart&&c.secs<_cxCfg.shortCallSec).map(c=>c.start)]:[];
  const bucket=list=>hours.map(h=>list.filter(t=>Math.floor((t-from)/3600000)===h).length);
  const chartCalls=bucket(callsAt.map(c=>c.start)), chartLook=bucket(look);

  const latest={};
  if(ok) for(const iv of R.intervals) if(iv.start<to&&(!latest[iv.ext]||iv.start>=latest[iv.ext].start)) latest[iv.ext]=iv;
  const statusOf=ext=>latest[ext]?latest[ext].status:'';
  const nowCount=cat=>agents.filter(a=>cxCat(statusOf(a.ext))===cat).length;

  const sgn=d=>Math.abs(d)<1?'0s':`${d>0?'+':'−'}${CX.fmtDur(Math.abs(d))}`;   // the agent's log minus 3CX
  const kind=a=>a.type==='short_call'?{t:'Short call',cls:'b-bath',ic:'bth',d:`Lasted ${a.secs}s`}
    :a.type==='repeated_ignore'?{t:'Repeated',cls:'',ic:'brk',d:`${a.count} ignored calls within ${_cxCfg.repeatIgnoreWindowMin} min`,red:true}
    :{t:'Ignored',cls:'b-brk',ic:'brk',d:`Rang ${a.secs}s, not answered`};
  const alertText=a=>`${a.agent}: ${kind(a).d}`;
  const redBadge={background:'rgba(220,38,38,.18)',color:'#fca5a5'};

  const header=(
    <>
      <div className="acts">
        <input className="fi" type="date" value={day} onChange={e=>chooseDay(e.target.value)} style={{width:190,height:47}} aria-label="Choose a day"/>
        {picked&&<button className="bs" onClick={()=>setPicked(null)}>Today</button>}
        <div className="acts-r"><ConnInstrument/></div>
      </div>
      {err&&<div className="ebox"><Ic n="alert" size={15}/>{err}</div>}
      {isDb&&dbErr&&<div className="ebox" style={{flexDirection:'column',alignItems:'flex-start',gap:10}}><span><Ic n="alert" size={15}/> Couldn't read the {_cxCfg.dbTable||'status_log'} table{cxOwnDb()?` in ${(_cxCfg.dbUrl||'').replace(/^https?:\/\//,'')}`:''}: {dbErr}</span><span style={{color:'var(--mut)',fontSize:14}}>{missingTable?'The table doesn\'t exist in this project yet. Run the SQL once in the Supabase SQL Editor (it also lets the logger add rows and admins read them), then reload the page. The logger must upload to this same project.':cxOwnDb()?'If it says "permission denied", the project needs a rule that lets the public key read it. If it says the table is not found, check the URL and key in Settings → 3CX call alerts.':'If it says "permission denied" or the table is empty when it shouldn\'t be, admins need permission to read it. If the logger uploads to a different Supabase project, set it in Settings → 3CX call alerts.'}</span>{missingTable?<CopySql sql={CX_SETUP_SQL} label="Copy SQL to create the table"/>:<CopySql sql={cxOwnDb()?CX_READ_SQL_ANON:CX_READ_SQL} label={cxOwnDb()?'Copy SQL to allow reading it':'Copy SQL to allow admins to read it'}/>}</div>}
      {clockHint!==null&&<div className="ebox"><Ic n="alert" size={15}/>This file suggests the 3CX logger PC runs on UTC{clockHint>=0?'+':''}{clockHint}, but Settings says UTC{logTz>=0?'+':''}{logTz}. Calls and breaks still in progress will show the wrong length until it matches. <button className="bs" style={{marginLeft:10}} onClick={()=>go&&go('settings')}>Open Settings</button></div>}
      {R&&R.error&&<div className="ebox"><Ic n="alert" size={15}/>{R.error}</div>}
    </>
  );

  /* ─────────────── one agent's profile ─────────────── */
  const profile=sel&&ok?agents.find(a=>a.ext===sel):null;
  if(profile){
    const a=profile, cat=cxCat(statusOf(a.ext)), col=CXC[cat];
    const myCalls=R.calls.filter(c=>c.ext===a.ext&&inDay(c.start));
    const myRings=R.rings.filter(r=>r.ext===a.ext&&inDay(r.start)&&r.outcome!=='ringing');
    const myAdmin=R.intervals.filter(iv=>iv.ext===a.ext&&cxCat(iv.status)==='admin'&&inDay(iv.start));
    const myAlerts=alerts.filter(x=>x.ext===a.ext);
    const mine=cmp.find(c=>c.user_id===a.uid);
    const ringLabel={answered:'Answered',ignored:'Not answered',taken_by_other:'Answered by a colleague',short_ring:'Caller hung up first'};
    const longest=myCalls.reduce((m,c)=>Math.max(m,c.secs),0);
    const split={}; Object.entries(a.statusSecs).forEach(([st,v])=>{ const c=cxCat(st); split[c]=(split[c]||0)+v; });
    const order=['call','admin','brk','avail','avail2','hol','ring','other','off'].filter(c=>split[c]>0);
    const total=order.reduce((t,c)=>t+split[c],0)||1;
    const hmOf=ms=>wallHM(ms);
    const row=(key,left,mid,right,flag)=>(
      <div key={key} className="acc-row" style={{minHeight:54}}>
        <div style={{width:112,fontVariantNumeric:'tabular-nums',color:'var(--mut)',fontSize:15}} className="pv">{left}</div>
        <div className="acc-n pv" style={{fontSize:16}}>{mid}{flag}</div>
        <div className="acc-v pv" style={{fontSize:16}}>{right}</div>
      </div>
    );
    return(
      <div className="page">
        <button className="bs cx-back" onClick={()=>setSel(null)}><span aria-hidden="true">←</span> All agents</button>
        {header}
        <div className="cx-prof">
          <div className="cx-av lg" style={{boxShadow:`inset 0 0 0 3px ${col}`}}>{ini(a.app)}</div>
          <div>
            <h1 className="pv">{a.app}</h1>
            <p className="hello-s" style={{marginBottom:10}}><span className="pv">ext {a.ext}</span> · {dayLabel}</p>
            <span className="cx-st" style={{'--c':col}}>{statusOf(a.ext)||'No activity'}</span>
          </div>
        </div>
        <div className="card acc" style={{marginBottom:34}}>
          <div className="cx-tiles pv">
            <div><span>Calls</span><b>{a.calls}</b></div>
            <div><span>Talk time</span><b>{CX.fmtDur(a.callSecs)}</b></div>
            <div><span>Average call</span><b>{CX.fmtDur(a.avgCallSecs)}</b></div>
            <div><span>Longest call</span><b>{CX.fmtDur(longest)}</b></div>
            <div><span>Answer rate</span><b>{a.answerRate==null?'–':Math.round(a.answerRate*100)+'%'}</b></div>
            <div><span>Ignored rings</span><b style={a.ignored?{color:'#ff8fa3'}:null}>{a.ignored}</b></div>
            <div><span>Short calls</span><b style={a.shortCalls?{color:'#ffb86b'}:null}>{a.shortCalls}</b></div>
            <div><span>Admin time</span><b>{CX.fmtDur(a.adminSecs)}</b></div>
            <div><span>Breaks</span><b>{a.breaks}</b></div>
            <div><span>Break time</span><b>{CX.fmtDur(a.breakSecs)}</b></div>
          </div>
          <div style={{padding:'0 12px'}}>
            <div className="card-t" style={{fontSize:16,marginBottom:6}}>Timeline of the day</div>
            {(()=>{
              const segs=R.intervals.filter(iv=>iv.ext===a.ext&&iv.start<to&&(iv.end==null?R.now:iv.end)>from).map(iv=>({st:iv.status,s:Math.max(iv.start,from),e:Math.min(iv.end==null?R.now:iv.end,to,R.now),part:iv.partialStart})).filter(x=>x.e>x.s).sort((p,q)=>p.s-q.s);
              if(!segs.length) return null;
              const t0=segs[0].s, t1=segs[segs.length-1].e, span=Math.max(t1-t0,1);
              const h0=Math.ceil(wall(t0).getTime()/3600000), h1=Math.floor(wall(t1).getTime()/3600000);
              const ticks=[]; for(let h=h0;h<=h1;h++) ticks.push(h);
              return(<div className="cx-tl pv">
                <div className="cx-tl-track">{segs.map((x,i)=>{ const l=(x.s-t0)/span*100, w=(x.e-x.s)/span*100, mid=l+w/2; return(
                  <div key={i} className={`cx-seg${mid<14?' l':mid>86?' r':''}`} style={{left:`${l}%`,width:`${w}%`,background:CXC[cxCat(x.st)]}}>
                    <span className="cx-tip"><b>{x.st}</b>{CX.fmtDur((x.e-x.s)/1000)}<em>{wallHM(x.s)} – {wallHM(x.e)}{x.part?' · started before logging':''}</em></span>
                  </div>); })}</div>
                <div className="cx-tl-axis">{ticks.map(h=>{ const p=(h*3600000-wall(0).getTime()-t0)/span*100; return <span key={h} style={{left:`${p}%`}}>{String(((h%24)+24)%24).padStart(2,'0')}:00</span>; })}</div>
              </div>);
            })()}
            <div className="cx-split pv">{order.map(c=><div key={c}><i style={{background:CXC[c]}}/>{CX_LABEL[c]}<b>{CX.fmtDur(split[c])} · {Math.round(split[c]/total*100)}%</b></div>)}</div>
          </div>
        </div>
        <div className="cx-two2">
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Calls <span className="cx-list-sub">{myCalls.length}</span></div></div>
            {myCalls.length===0?<div className="onb-empty"><div>No calls this day</div></div>:myCalls.map((c,i)=>row(i,`${hmOf(c.start)} – ${c.open?'now':hmOf(c.end)}`,'Call',CX.fmtDur(c.secs),
              !c.open&&!c.partialStart&&c.secs<_cxCfg.shortCallSec?<span className="badge b-bath">Short</span>:c.partialStart?<span className="badge">Started before logging</span>:null))}
          </div>
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Rings <span className="cx-list-sub">{myRings.length}</span></div></div>
            {myRings.length===0?<div className="onb-empty"><div>No rings this day</div></div>:myRings.map((r,i)=>row(i,hmOf(r.start),ringLabel[r.outcome]||r.outcome,`${Math.round(r.secs)}s`,
              r.outcome==='ignored'?<span className="badge" style={redBadge}>Ignored</span>:null))}
          </div>
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Breaks: agent's log and 3CX <span className="cx-list-sub">{mine?(mine.flagged?'differs':'matches'):'none'}</span></div></div>
            {!mine?<div className="onb-empty"><div>No breaks this day</div></div>:<>
              {mine.pairs.map((p,i)=>row('p'+i,`${hmOf(p.cx.s)} – ${p.cx.open?'now':hmOf(p.cx.e)}`,'3CX',`log ${hmOf(p.app.s)} – ${p.app.open?'now':hmOf(p.app.e)}`,null))}
              {mine.onlyCx.map((x,i)=>row('c'+i,`${hmOf(x.s)} – ${x.open?'now':hmOf(x.e)}`,'3CX only','',<span className="badge" style={redBadge}>Not in agent's log</span>))}
              {mine.onlyApp.map((x,i)=>row('a'+i,`${hmOf(x.s)} – ${x.open?'now':hmOf(x.e)}`,"Agent's log only",'',<span className="badge" style={redBadge}>Not in 3CX</span>))}
            </>}
          </div>
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Admin <span className="cx-list-sub">{myAdmin.length}</span></div></div>
            {myAdmin.length===0?<div className="onb-empty"><div>No admin time this day</div></div>:myAdmin.map((iv,i)=>row(i,`${hmOf(iv.start)} – ${iv.end?hmOf(iv.end):'now'}`,iv.status,CX.fmtDur(((iv.end??capEnd)-iv.start)/1000),iv.partialStart?<span className="badge">Started before logging</span>:null))}
          </div>
          <div className="card acc" style={{gridColumn:'1 / -1'}}>
            <div className="card-hd"><div className="card-t">Alerts <span className="cx-list-sub">{myAlerts.length}</span></div></div>
            {myAlerts.length===0?<div className="onb-empty"><div>No open alerts for {a.app.split(' ')[0]} this day</div></div>:myAlerts.map((x,i)=>{ const k=kind(x); return(
              <div key={i} className="acc-row" style={{minHeight:54}}>
                <div style={{width:112,color:'var(--mut)',fontSize:15}} className="pv">{hmOf(x.at)}</div>
                <div className="acc-n pv" style={{fontSize:16,whiteSpace:'normal'}}>{k.d} <span className={`badge ${k.cls}`} style={k.red?redBadge:null}>{k.t}</span></div>
                <button className="cx-done" title="Mark as dealt with" aria-label="Mark as dealt with" onClick={()=>dismiss(x)}><Ic n="check" size={16}/></button>
              </div>); })}
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── the team page ─────────────── */
  return(
    <div className="page">
      <h1 className="hello">3CX calls</h1>
      <p className="hello-s">{ok?`${dayLabel}${day===todayStr?' (today)':''} · ${tot.calls} calls · ${alerts.length} alert${alerts.length===1?'':'s'}`:'Reads what the 3CX logger uploads to Supabase · nothing is written'}</p>
      {header}

      {!R&&(
        <div className="card acc"><div className="onb-empty">
          <div className="es-ic"><Ic n="phone" size={24}/></div>
          <div>{dbErr?'Waiting for the status log':'Reading the status_log table…'}</div>
          <span>This reads what the 3CX logger uploads. Nothing is written.</span>
        </div></div>
      )}

      {ok&&agents.length>0&&day===todayStr&&(()=>{
        const T=[['call','On a call','phone'],['brk','On break','coffee'],['admin','On admin','edit'],['avail','Available','check']];
        const here=agents.filter(a=>!['off','hol'].includes(cxCat(statusOf(a.ext)))).length, n=here||1, other=here-T.reduce((t,x)=>t+nowCount(x[0]),0);
        return(<div className="cx-live" aria-label="Right now">
          <div className="cx-live-t">Right now <small>{here} logged in</small></div>
          <div className="cx-live-g">
            {T.map(([c,l,ic])=>{ const v=nowCount(c); return(
              <div key={c} className={`cx-lt${v?'':' zero'}`} style={{'--c':CXC[c]}}>
                <div className="cx-lt-ic"><Ic n={ic} size={20}/></div>
                <b>{v}</b><span>{l}</span>
                <em><i style={{width:`${v/n*100}%`}}/></em>
              </div>); })}
          </div>
          <div className="cx-mix" title="Whole team right now">
            {T.map(([c,l])=>nowCount(c)>0&&<i key={c} style={{flex:nowCount(c),background:CXC[c]}} title={`${l} ${nowCount(c)}`}/>)}
            {other>0&&<i style={{flex:other,background:'#3a3d4a'}} title={`Other ${other}`}/>}
          </div>
        </div>);
      })()}

      {ok&&all.length===0&&(
        <div className="card acc"><div className="onb-empty">
          <div className="es-ic"><Ic n="phone" size={24}/></div>
          <div>No rows in the log for {dayLabel}</div>
          <span>{isDb?'Either the logger has not uploaded anything for this period yet, or admins are not allowed to read the table (a table that only lets the logger add rows looks empty to everyone else).':'Let the logger run for a while and load the file again.'}</span>
          {isDb&&<CopySql sql={cxOwnDb()?CX_READ_SQL_ANON:CX_READ_SQL} label={cxOwnDb()?'Copy SQL to allow reading it':'Copy SQL to allow admins to read it'}/>}
        </div></div>
      )}
      {ok&&all.length>0&&!matchedAny&&(
        <div className="card acc"><div className="onb-empty">
          <div className="es-ic"><Ic n="users" size={24}/></div>
          <div>No agents in this log match agents in the app</div>
          <span>3CX names must match the agent's name in the app, in either order (for example "Sghir, Abdulkarim" and "Abdulkarim Sghir"). {all.length} 3CX extension{all.length===1?'':'s'} hidden.</span>
        </div></div>
      )}
      {ok&&matchedAny&&agents.length===0&&(
        <div className="card acc"><div className="onb-empty">
          <div className="es-ic"><Ic n="phone" size={24}/></div>
          <div>No 3CX activity on {dayLabel}</div>
          <span>The log has activity on {days.filter(d=>d!==day&&R.intervals.some(iv=>{ const w=wall(iv.start); return `${w.getUTCFullYear()}-${pad(w.getUTCMonth()+1)}-${pad(w.getUTCDate())}`===d; })).map(d=>new Date(d+'T00:00:00Z').toLocaleDateString([],{day:'numeric',month:'short',timeZone:'UTC'})).join(', ')||'no other day'}. Pick one above.</span>
        </div></div>
      )}

      {ok&&agents.length>0&&<>
        <div className="cx-two">
          <div className="card acc">
            <div className="card-hd"><div><div className="card-t">Statistics</div></div></div>
            <div className="cx-tiles pv">
              <div><span>Calls</span><b>{tot.calls}</b></div>
              <div><span>Talk time</span><b>{CX.fmtDur(tot.talk)}</b></div>
              <div><span>Average call</span><b>{CX.fmtDur(tot.calls?tot.talk/tot.calls:0)}</b></div>
              <div><span>Answer rate</span><b>{rate}</b></div>
              <div><span>Ignored rings</span><b>{tot.ign}</b></div>
              <div><span>Short calls</span><b>{tot.short}</b></div>
              <div><span>Admin time</span><b>{CX.fmtDur(tot.admin)}</b></div>
            </div>
            <div className="cx-chart"><CxChart labels={hours.map(h=>`${String(h).padStart(2,'0')}:00`)} series={[{vals:chartCalls,color:CXC.call},{vals:chartLook,color:CXC.admin,dashed:true}]}/></div>
            <div className="cx-leg"><span><i style={{background:CXC.call}}/>Calls started per hour</span><span><i style={{background:CXC.admin}}/>Ignored rings + short calls</span></div>
          </div>

          <div className="card acc onb cx-alerts">
            <div className="card-hd">
              <div>
                <div className="card-t">Alerts</div>
                <div className="big pv" style={{marginTop:6}}><Amt main={<TNum value={alerts.length}/>} sup=" open"/></div>
              </div>
              <div className="card-ctl">
                {alerts.length>0&&<button className="bs" onClick={clearAll} title="Mark every alert as dealt with">Clear all</button>}
                <button className="icb sm" onClick={()=>go&&go('settings')} title="3CX alert settings"><Ic n="settings" size={16}/></button>
              </div>
            </div>
            {alerts.length===0?(
              <div className="onb-empty">
                <div className="es-ic"><Ic n="check" size={24}/></div>
                <div>{done.length?'All alerts dealt with':'No alerts for this day'}</div>
                <span>Ignored after {_cxCfg.ignoreRingSec}s · short call under {_cxCfg.shortCallSec}s</span>
              </div>
            ):alerts.slice(0,6).map(a=>{ const k=kind(a); return(
              <div key={akey(a)} className="acc-row onb-row link" onClick={()=>a.ext&&setSel(a.ext)} title="Open profile">
                <div className={`acc-ic ${k.ic}`}>{ini(a.agent)}</div>
                <div className="onb-mid">
                  <div className="acc-n pv">{a.agent}</div>
                  <div className="cx-reason pv"><span className={`badge ${k.cls}`} style={k.red?redBadge:null}>{k.t}</span>{k.d}</div>
                </div>
                <div className="onb-r"><div className="acc-v pv">{wallHM(a.at)}</div></div>
                <button className="cx-done" title="Mark as dealt with" aria-label="Mark as dealt with" onClick={e=>{ e.stopPropagation(); dismiss(a); }}><Ic n="check" size={16}/></button>
              </div>
            );})}
            {alerts.length>6&&<div className="acc-row"><div className="acc-ic more">+{alerts.length-6}</div><div className="acc-n" style={{color:'var(--mut)'}}>more alerts</div></div>}
            {done.length>0&&<div style={{padding:'10px 12px 0'}}>
              <button className="bs" onClick={()=>setShowDone(v=>!v)}>Dealt with ({done.length})</button>
              {showDone&&done.map(a=>(
                <div key={akey(a)} className="acc-row" style={{minHeight:48,opacity:.7}}>
                  <div className="acc-n pv" style={{fontSize:15}}>{a.agent} <small>{kind(a).t} · {wallHM(a.at)}</small></div>
                  <button className="bs" onClick={()=>restore(a)}>Restore</button>
                </div>))}
            </div>}
          </div>
        </div>

        <div className="cx-sec">Agents <small>{agents.length} in the app{hidden>0?` · ${hidden} other 3CX extension${hidden===1?'':'s'} ${hidden===1?'isn\'t':'aren\'t'} in the app and ${hidden===1?'is':'are'} hidden`:''}</small></div>
        <div className="cx-grid">
          {agents.map(a=>{ const st=statusOf(a.ext), col=CXC[cxCat(st)]; return(
            <button key={a.ext} className="cx-card" onClick={()=>setSel(a.ext)} aria-label={`Open ${a.app}`}>
              <div className="cx-top">
                <div className="cx-av" style={{boxShadow:`inset 0 0 0 2px ${col}`}}>{ini(a.app)}</div>
                <div className="cx-who"><div className="cx-name pv">{a.app}</div><span className="cx-st" style={{'--c':col}}>{st||'No activity'}</span></div>
                <div className="cx-ext pv">ext {a.ext}</div>
              </div>
              <div className="cx-stats pv">
                <div><span>Calls</span><b>{a.calls}</b></div>
                <div><span>Talk time</span><b>{CX.fmtDur(a.callSecs)}</b></div>
                <div><span>Break</span><b>{CX.fmtDur(a.breakSecs)}</b></div>
                <div><span>Ignored</span><b className={a.ignored?'warn':''}>{a.ignored}</b></div>
                <div><span>Short calls</span><b className={a.shortCalls?'note':''}>{a.shortCalls}</b></div>
                <div><span>Admin</span><b>{CX.fmtDur(a.adminSecs)}</b></div>
              </div>
            </button>
          );})}
        </div>

        <div className="cx-sec" style={{marginTop:34}}>Break check <small>agent's log vs 3CX</small></div>
        <div className="cx-chips">
          <span className="cx-chip"><b>{flagged.length}</b> differ</span>
          <span className="cx-chip"><b>{cmp.length-flagged.length}</b> match</span>
        </div>
        <div className="card acc">
          {cmp.length===0?(
            <div className="onb-empty"><div className="es-ic"><Ic n="coffee" size={24}/></div><div>No breaks in 3CX or in the agents' log for this day</div></div>
          ):<div className="tbl-wrap"><table className="dt cxr">
            <thead><tr><th>Agent</th><th>Agent's log</th><th>3CX</th><th>Difference</th></tr></thead>
            <tbody>{cmp.map(c=>{ const ext=extOfUid[c.user_id]; return(
              <tr key={c.user_id} onClick={()=>ext&&setSel(ext)} style={ext?{cursor:'pointer'}:null}>
                <td className="pv"><AvC name={c.agent_name}/></td>
                <td className="pv">{c.appCount} · {CX.fmtDur(c.appSecs)}</td>
                <td className="pv">{c.cxCount} · {CX.fmtDur(c.cxSecs)}</td>
                <td className="pv" style={isDiff(c)?{color:'#ff8fa3',fontWeight:500}:{color:'var(--mut)'}}>{sgn(c.diffSecs)}</td>
              </tr>); })}</tbody>
          </table></div>}
        </div>
      </>}
    </div>
  );
}
