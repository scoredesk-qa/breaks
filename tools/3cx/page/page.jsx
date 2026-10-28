
/* ═══ 3CX test page: reads a status_log.csv from this PC and shows calls, ignored rings, short calls, admin time and
   breaks per agent. Saves nothing. Only agents that exist in the app are shown. ═══ */
const CXC={call:'#8e9cff',admin:'#f5c451',brk:'#4fd1c5',avail:'#414760',off:'#272a36',ring:'#ff8a65',other:'#7d86a8'};
const CX_LABEL={call:'On a call',admin:'Admin',brk:'On break',avail:'Available',off:'Offline',ring:'Ringing',other:'Other'};
const cxCat=s=>/^on call$/i.test(s)?'call':/^admin$/i.test(s)?'admin':/break|lunch|bathroom|toilet/i.test(s)?'brk':/^ringing$/i.test(s)?'ring':/offline|out of office|not registered/i.test(s)?'off':/^available/i.test(s)?'avail':'other';

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

// 30-minute dots across the working day: purple = on a call, yellow = admin, teal = break, grey = available.
// A red ring marks an ignored call, an orange halo a short call.
function cxSlots(ivs,rings,calls,from,startH,endH,capEnd,shortSec){
  const out=[];
  for(let i=0;i<(endH-startH)*2;i++){
    const a=from+(startH*60+i*30)*60000, b=a+30*60000, ov={};
    for(const iv of ivs){ const s=Math.max(iv.start,a), e=Math.min(iv.end??capEnd,b); if(e>s){ const c=cxCat(iv.status); ov[c]=(ov[c]||0)+(e-s); } }
    let cat=['call','admin','brk'].find(c=>(ov[c]||0)>=60000);
    if(!cat){ let best=0; for(const c in ov) if(ov[c]>best){ best=ov[c]; cat=c; } }
    out.push({cat:cat||'off',a,
      ign:rings.some(r=>r.outcome==='ignored'&&r.start>=a&&r.start<b),
      sc:calls.some(c=>!c.open&&!c.partialStart&&c.secs<shortSec&&c.start>=a&&c.start<b)});
  }
  return out;
}
function CxTimeline({slots,big,startH,endH}){
  return(<>
    <div className={`cx-tl${big?' cx-tlbig':''}`}>
      {slots.map((s,i)=><span key={i} className={`cx-dot${s.ign?' ign':''}${s.sc?' sc':''}`} style={{background:CXC[s.cat]}}
        title={`${wallHM(s.a)} · ${CX_LABEL[s.cat]}${s.ign?' · ignored a call':''}${s.sc?' · short call':''}`}/>)}
    </div>
    {big&&<div className="cx-tlx"><span>{String(startH).padStart(2,'0')}:00</span><span>{String(endH).padStart(2,'0')}:00</span></div>}
  </>);
}
const CxLegend=()=>(
  <div className="cx-leg">
    {['call','admin','brk','avail'].map(c=><span key={c}><i style={{background:CXC[c]}}/>{CX_LABEL[c]}</span>)}
    <span><i style={{background:'transparent',boxShadow:'inset 0 0 0 2px #ff6b81'}}/>Ignored call</span>
    <span><i style={{background:CXC.call,boxShadow:'0 0 0 2px rgba(255,184,107,.95)'}}/>Short call</span>
  </div>
);

function A3cx({go}){
  const [text,setText]=useState('');
  const [fileName,setFileName]=useState('');
  const [fileMod,setFileMod]=useState(0);
  const [day,setDay]=useState(todayISO());
  const [users,setUsers]=useState([]);
  const [err,setErr]=useState('');
  const [sel,setSel]=useState(null);
  const fileRef=useRef(null);
  const tz=clockOff();
  const isSample=fileName==='sample data';

  useEffect(()=>{      // the app's agents: only agents who exist in the app are shown
    Promise.all([
      run(SB.from('bt_clocklogs').select('user_id,agent_name').order('clock_in',{ascending:false}).limit(2000)),
      run(SB.from('bt_logs').select('user_id,agent_name').order('start_time',{ascending:false}).limit(2000)),
    ]).then(([a,b])=>{
      const m=new Map();
      [...(a.data||[]),...(b.data||[])].forEach(r=>{ if(r.user_id&&r.agent_name&&!m.has(r.user_id)) m.set(r.user_id,{id:r.user_id,name:r.agent_name}); });
      setUsers([...m.values()]);
    });
  },[]);

  const load=(t,name,mod)=>{
    const rows=CX.parseCsv(t);
    if(!rows.length){ setErr('That file has no rows yet. Let the logger run for a while and try again.'); return; }
    setErr(''); setText(t); setFileName(name); setFileMod(mod||0); setSel(null);
    setDay(String(rows[rows.length-1].timestamp||'').slice(0,10)||todayISO());
  };
  const pick=e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>load(String(r.result),f.name,f.lastModified); r.readAsText(f); e.target.value=''; };

  const match=isSample?CX_SAMPLE_USERS:users;
  const logTz=_cxCfg.logTz;
  const R=React.useMemo(()=>{
    if(!text) return null;
    // timestamps in the log are on the logger PC's clock; "which day" and the times shown use the app's company clock
    try{ return CX.analyze(CX.parseCsv(text),{day,now:appNow(),..._cxCfg,tzOffsetHours:logTz,dayOffsetHours:tz}); }
    catch(e){ return {error:e.message}; }
  },[text,day,tz,logTz]);
  /* Warn if the file itself says the logger PC is on a different clock than Settings: the file's last save time
     is (almost) the time of its last row, so the gap between the two is the logger PC's offset from UTC. */
  const clockHint=React.useMemo(()=>{
    if(!fileMod||!text||isSample) return null;
    const last=CX.parseCsv(text).slice(-1)[0]; if(!last) return null;
    const m=/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(last.timestamp||''); if(!m) return null;
    const diffH=(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])-fileMod)/3600000;
    const off=Math.round(diffH);
    if(Math.abs(diffH-off)>0.1) return null;            // not saved at about the time of its last row (copied or edited later): can't tell
    return off!==logTz?off:null;
  },[fileMod,text,isSample,logTz]);

  /* everything below is limited to agents that match an app agent */
  const ok=R&&!R.error;
  const byKey=new Map(match.map(u=>[CX.nameKey(u.name),u]));
  const all=ok?Object.values(R.agents):[];
  const agents=all.filter(a=>byKey.has(CX.nameKey(a.agent))&&Object.keys(a.statusSecs).length>0).map(a=>({...a,app:byKey.get(CX.nameKey(a.agent)).name})).sort((a,b)=>a.app.localeCompare(b.app));
  const shown=new Set(agents.map(a=>a.ext));
  const hidden=all.filter(a=>!byKey.has(CX.nameKey(a.agent))).length;
  const alerts=ok?R.alerts.filter(a=>shown.has(a.ext)).map(a=>({...a,agent:(byKey.get(CX.nameKey(a.agent))||{}).name||a.agent})):[];
  const [from,to]=CX.dayRange(day,tz);
  const inDay=t=>t>=from&&t<to;
  const tot=agents.reduce((t,a)=>({calls:t.calls+a.calls,talk:t.talk+a.callSecs,ans:t.ans+a.answered,ign:t.ign+a.ignored,short:t.short+a.shortCalls,admin:t.admin+a.adminSecs}),{calls:0,talk:0,ans:0,ign:0,short:0,admin:0});
  const rate=tot.ans+tot.ign?Math.round(tot.ans/(tot.ans+tot.ign)*100)+'%':'–';
  const breakRows=ok?CX.toBreakLogs(R.intervals,match,{tzOffsetHours:logTz}).logs.filter(l=>inDay(Date.parse(l.start_time))):[];

  // day strip: the days that appear in the log (company clock), newest 14
  const days=ok?[...new Set([day,...R.intervals.map(iv=>{ const w=wall(iv.start); return `${w.getUTCFullYear()}-${pad(w.getUTCMonth()+1)}-${pad(w.getUTCDate())}`; })])].sort().slice(-14):[];

  // working-day range for the timeline and chart
  let startH=8,endH=18,capEnd=appNow();
  const mine=ok?R.intervals.filter(iv=>shown.has(iv.ext)):[];
  if(ok&&mine.length){
    const logEnd=Math.max(...mine.map(iv=>iv.end??iv.start));
    capEnd=Math.min(appNow(),Math.max(logEnd,from));
    const act=mine.filter(iv=>['call','ring','admin','brk'].includes(cxCat(iv.status))&&iv.start>=from&&iv.start<to);   // real activity that started this day (idle "Available" and last night's carry-over don't set the range)
    if(act.length){
      const mn=Math.min(...act.map(iv=>iv.start)), mx=Math.max(...act.map(iv=>Math.min(iv.end??capEnd,to)));
      startH=Math.max(0,Math.floor((mn-from)/3600000)); endH=Math.min(24,Math.ceil((mx-from)/3600000)+1);
      if(endH-startH<6) endH=Math.min(24,startH+6);
    }
  }
  const hours=[...Array(Math.max(0,endH-startH)).keys()].map(i=>startH+i);
  const perHour=pred=>hours.map(h=>pred(h));
  const callsAt=agents.length&&ok?R.calls.filter(c=>shown.has(c.ext)&&inDay(c.start)):[];
  const look=ok?[...R.rings.filter(r=>shown.has(r.ext)&&r.outcome==='ignored'&&inDay(r.start)).map(r=>r.start),
                 ...callsAt.filter(c=>!c.open&&!c.partialStart&&c.secs<_cxCfg.shortCallSec).map(c=>c.start)]:[];
  const bucket=(list)=>perHour(h=>list.filter(t=>Math.floor((t-from)/3600000)===h).length);
  const chartCalls=bucket(callsAt.map(c=>c.start)), chartLook=bucket(look);

  const latest={};
  if(ok) for(const iv of R.intervals) if(iv.start<to&&(!latest[iv.ext]||iv.start>=latest[iv.ext].start)) latest[iv.ext]=iv;
  const statusOf=ext=>latest[ext]?latest[ext].status:'';
  const isToday=day===todayISO();
  const nowCount=cat=>agents.filter(a=>cxCat(statusOf(a.ext))===cat).length;

  const slotsFor=ext=>cxSlots(R.intervals.filter(iv=>iv.ext===ext),R.rings.filter(r=>r.ext===ext),R.calls.filter(c=>c.ext===ext),from,startH,endH,capEnd,_cxCfg.shortCallSec);
  const previewAlerts=()=>alerts.slice(0,5).forEach((a,i)=>setTimeout(()=>fireNotification({title:a.type==='short_call'?'Possible dropped call':a.type==='repeated_ignore'?'Repeated ignored calls':'Ignored call',body:a.message,type:'custom',duration:8000}),i*900));
  const dayLabel=new Date(day+'T00:00:00Z').toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
  const kind=a=>a.type==='short_call'?{t:'Short call',cls:'b-bath',ic:'bth',d:`Lasted ${a.secs}s`}:a.type==='repeated_ignore'?{t:'Repeated',cls:'',ic:'brk',d:`${a.count} ignored calls within ${_cxCfg.repeatIgnoreWindowMin} min`,red:true}:{t:'Ignored',cls:'b-brk',ic:'brk',d:`Rang ${a.secs}s, not answered`};
  const redBadge={background:'rgba(220,38,38,.18)',color:'#fca5a5'};

  const header=(
    <>
      <div className="acts">
        <button className="bp" onClick={()=>fileRef.current&&fileRef.current.click()}><Ic n="download" size={17}/> Load log</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={pick} style={{display:'none'}}/>
        <button className="bs" onClick={()=>load(CX_SAMPLE,'sample data')}><Ic n="play" size={16}/> Use sample data</button>
        {alerts.length>0&&<button className="bs" onClick={previewAlerts}><Ic n="bell" size={16}/> Preview alerts</button>}
        <div className="acts-r">{fileName&&<span style={{color:'var(--mut)',fontSize:15}}>{fileName}</span>}</div>
      </div>
      {err&&<div className="ebox"><Ic n="alert" size={15}/>{err}</div>}
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
    const myStretches=R.intervals.filter(iv=>iv.ext===a.ext&&(cxCat(iv.status)==='admin'||cxCat(iv.status)==='brk')&&inDay(iv.start));
    const myAlerts=alerts.filter(x=>x.ext===a.ext);
    const ringLabel={answered:'Answered',ignored:'Not answered',taken_by_other:'Answered by a colleague',short_ring:'Caller hung up first'};
    const longest=myCalls.reduce((m,c)=>Math.max(m,c.secs),0);
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
            <div className="card-t" style={{fontSize:16,marginBottom:6}}>Day at a glance</div>
            <CxTimeline slots={slotsFor(a.ext)} big startH={startH} endH={endH}/>
          </div>
          <CxLegend/>
        </div>
        <div className="cx-two2">
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Calls <span className="cx-list-sub">{myCalls.length}</span></div></div>
            {myCalls.length===0?<div className="onb-empty"><div>No calls this day</div></div>:myCalls.map((c,i)=>row(i,`${wallHM(c.start)} – ${c.open?'now':wallHM(c.end)}`,'Call',CX.fmtDur(c.secs),
              !c.open&&!c.partialStart&&c.secs<_cxCfg.shortCallSec?<span className="badge b-bath">Short</span>:c.partialStart?<span className="badge">Started before logging</span>:null))}
          </div>
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Rings <span className="cx-list-sub">{myRings.length}</span></div></div>
            {myRings.length===0?<div className="onb-empty"><div>No rings this day</div></div>:myRings.map((r,i)=>row(i,wallHM(r.start),ringLabel[r.outcome]||r.outcome,`${Math.round(r.secs)}s`,
              r.outcome==='ignored'?<span className="badge" style={redBadge}>Ignored</span>:null))}
          </div>
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Admin and breaks <span className="cx-list-sub">{myStretches.length}</span></div></div>
            {myStretches.length===0?<div className="onb-empty"><div>None this day</div></div>:myStretches.map((iv,i)=>row(i,`${wallHM(iv.start)} – ${iv.end?wallHM(iv.end):'now'}`,iv.status,CX.fmtDur((iv.end??capEnd)-iv.start>0?((iv.end??capEnd)-iv.start)/1000:0),
              iv.partialStart?<span className="badge">Started before logging</span>:null))}
          </div>
          <div className="card acc">
            <div className="card-hd"><div className="card-t">Alerts <span className="cx-list-sub">{myAlerts.length}</span></div></div>
            {myAlerts.length===0?<div className="onb-empty"><div>No alerts for {a.app.split(' ')[0]} this day</div></div>:myAlerts.map((x,i)=>{ const k=kind(x); return row(i,wallHM(x.at),k.d,'',<span className={`badge ${k.cls}`} style={k.red?redBadge:null}>{k.t}</span>); })}
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────── the team page ─────────────── */
  return(
    <div className="page">
      <h1 className="hello">3CX calls</h1>
      <p className="hello-s">{ok?`${dayLabel} · ${tot.calls} calls · ${alerts.length} alert${alerts.length===1?'':'s'}`:'Test page · reads a status log from this PC · nothing is saved or sent anywhere'}</p>
      {header}

      {!R&&(
        <div className="card acc"><div className="onb-empty">
          <div className="es-ic"><Ic n="phone" size={24}/></div>
          <div>Load a 3CX status log to see calls, ignored rings and possible dropped calls</div>
          <span>Pick the status_log.csv your 3CX logger writes, or try the sample data. The file stays on this computer.</span>
        </div></div>
      )}

      {ok&&agents.length===0&&(
        <div className="card acc"><div className="onb-empty">
          <div className="es-ic"><Ic n="users" size={24}/></div>
          <div>No agents in this log match agents in the app</div>
          <span>3CX names must match the agent's name in the app, in either order (for example "Sghir, Abdulkarim" and "Abdulkarim Sghir"). {all.length} 3CX extension{all.length===1?'':'s'} hidden.</span>
        </div></div>
      )}

      {ok&&agents.length>0&&<>
        <div className="cx-days" role="tablist" aria-label="Day">
          {days.map(d=>{ const dt=new Date(d+'T00:00:00Z'); return(
            <button key={d} role="tab" aria-selected={d===day} className={`cx-day${d===day?' on':''}`} onClick={()=>setDay(d)}>
              <b>{String(dt.getUTCDate()).padStart(2,'0')}</b><span>{dt.toLocaleDateString([],{weekday:'short',timeZone:'UTC'})}</span>
            </button>); })}
        </div>

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

          <div className="card acc onb">
            <div className="card-hd">
              <div>
                <div className="card-t">Alerts</div>
                <div className="big pv" style={{marginTop:6}}><Amt main={<TNum value={alerts.length}/>} sup=" today"/></div>
              </div>
              <div className="card-ctl"><button className="icb sm" onClick={()=>go&&go('settings')} title="3CX alert settings"><Ic n="settings" size={16}/></button></div>
            </div>
            {alerts.length===0?(
              <div className="onb-empty">
                <div className="es-ic"><Ic n="check" size={24}/></div>
                <div>No alerts for this day</div>
                <span>Ignored after {_cxCfg.ignoreRingSec}s · short call under {_cxCfg.shortCallSec}s</span>
              </div>
            ):alerts.slice(0,6).map((a,i)=>{ const k=kind(a); return(
              <div key={i} className="acc-row onb-row link" onClick={()=>setSel(a.ext)} title="Open profile">
                <div className={`acc-ic ${k.ic}`}>{ini(a.agent)}</div>
                <div className="onb-mid">
                  <div className="acc-n pv">{a.agent} <span className={`badge ${k.cls}`} style={k.red?redBadge:null}>{k.t}</span></div>
                  <small style={{color:'var(--mut)',fontSize:14}}>{k.d}</small>
                </div>
                <div className="onb-r"><div className="acc-v pv">{wallHM(a.at)}</div></div>
              </div>
            );})}
            {alerts.length>6&&<div className="acc-row"><div className="acc-ic more">+{alerts.length-6}</div><div className="acc-n" style={{color:'var(--mut)'}}>more alerts</div></div>}
          </div>
        </div>

        <div className="cx-sec">Agents <small>{agents.length} in the app{hidden>0?` · ${hidden} other 3CX extension${hidden===1?'':'s'} ${hidden===1?'isn\'t':'aren\'t'} in the app and ${hidden===1?'is':'are'} hidden`:''}</small></div>
        {isToday&&<div className="cx-chips">
          <span className="cx-chip"><b>{nowCount('call')}</b> on a call</span>
          <span className="cx-chip"><b>{nowCount('brk')}</b> on break</span>
          <span className="cx-chip"><b>{nowCount('admin')}</b> on admin</span>
          <span className="cx-chip"><b>{nowCount('avail')}</b> available</span>
        </div>}
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
              <CxTimeline slots={slotsFor(a.ext)}/>
            </button>
          );})}
        </div>
        <CxLegend/>

        <div className="cx-sec" style={{marginTop:34}}>Breaks from 3CX <small>what would be added to the break log · nothing is added now</small></div>
        <div className="card acc">
          {breakRows.length===0?(
            <div className="onb-empty"><div className="es-ic"><Ic n="coffee" size={24}/></div><div>No breaks in 3CX for this day</div></div>
          ):breakRows.map((l,i)=>{ const cls=l.break_type==='Lunch Break'?'lun':l.break_type==='Bathroom Break'?'bth':'brk'; return(
            <div key={i} className="acc-row onb-row">
              <div className={`acc-ic ${cls}`}>{ini(l.agent_name)}</div>
              <div className="onb-mid">
                <div className="acc-n pv">{l.agent_name} <span className={`badge ${BCLS[l.break_type]||'b-brk'}`}>{l.break_type==='Bathroom Break'?'Bathroom':l.break_type==='Lunch Break'?'Lunch':'Break'}</span></div>
                <small style={{color:'var(--mut)',fontSize:14}}>{wallHM(l.start_time)} – {l.end_time?wallHM(l.end_time):'still on break'}{l.partial_start?' · started before logging':''}</small>
              </div>
              <div className="onb-r"><div className="acc-v pv">{l.duration_secs==null?'–':CX.fmtDur(l.duration_secs)}</div></div>
            </div>
          );})}
        </div>
      </>}
    </div>
  );
}
