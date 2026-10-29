
/* ═══ 3CX settings (shown in Settings → "3CX call alerts") ═══
   The values are kept in this browser (localStorage), not in the database. */
const CX_CFG_KEY='bt_cx_cfg';
// logTz: UTC offset of the PC that runs the 3CX logger (its clock wrote the log's timestamps)
// Where the 3CX logger uploads to. The logger can use a different Supabase project from the app, so the 3CX page has its own
// connection (a public anon key). Left empty it reads from the app's own project. A build can pre-fill it with window.BT_CX_DB.
const CX_DB_PRESET=(typeof window!=='undefined'&&window.BT_CX_DB)||{};
const CX_CFG_DEFAULT={logTz:0,ignoreRingSec:10,shortCallSec:60,repeatIgnoreCount:3,repeatIgnoreWindowMin:60,breakToleranceMin:3,breakCheckLeadMin:10,timelineStart:7,timelineEnd:18,
  dbUrl:CX_DB_PRESET.url||'',dbKey:CX_DB_PRESET.key||'',dbTable:CX_DB_PRESET.table||'status_log'};
let _cxCfg=(()=>{ try{ return {...CX_CFG_DEFAULT,...JSON.parse(localStorage.getItem(CX_CFG_KEY)||'{}')}; }catch(e){ return {...CX_CFG_DEFAULT}; } })();
const CX_SAMPLE_USERS=['Jane Doe','Rick Roe','Pat Poe','Max Moe','Lou Lee','Kay Kim','Finn Fox','Gail Gray'].map((n,i)=>({id:'sample-'+i,name:n}));

function A3cxSettings(){
  const [v,setV]=useState({..._cxCfg});
  const [ok,setOk]=useState(false);
  const set=k=>e=>setV(p=>({...p,[k]:e.target.value}));
  const tzOk=v.logTz!==''&&Number.isFinite(Number(v.logTz))&&Number(v.logTz)>=-12&&Number(v.logTz)<=14;
  const NUM=['ignoreRingSec','shortCallSec','repeatIgnoreCount','repeatIgnoreWindowMin','breakToleranceMin','breakCheckLeadMin'];
  const winOk=Number.isInteger(Number(v.timelineStart))&&Number.isInteger(Number(v.timelineEnd))&&Number(v.timelineStart)>=0&&Number(v.timelineEnd)<=24&&Number(v.timelineEnd)>Number(v.timelineStart);
  const dbOk=((v.dbUrl||'').trim()===''&&(v.dbKey||'').trim()==='')||(/^https?:\/\/\S+$/.test((v.dbUrl||'').trim())&&(v.dbKey||'').trim().length>20&&/^[a-z_][a-z0-9_]*$/i.test((v.dbTable||'').trim()||'status_log'));
  const valid=tzOk&&dbOk&&winOk&&NUM.every(k=>Number(v[k])>=1);
  const save=()=>{
    const c={logTz:Number(v.logTz),dbUrl:(v.dbUrl||'').trim().replace(/\/+$/,''),dbKey:(v.dbKey||'').trim(),dbTable:(v.dbTable||'').trim()||'status_log'};
    for(const k of NUM) c[k]=Math.max(1,Math.round(Number(v[k])));
    c.timelineStart=Number(v.timelineStart); c.timelineEnd=Number(v.timelineEnd);
    _cxCfg=c; try{ localStorage.setItem(CX_CFG_KEY,JSON.stringify(c)); }catch(e){}
    setV(c); setOk(true); setTimeout(()=>setOk(false),3000);
  };
  const row=(label,k,unit)=>(
    <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:14}}>
      <span style={{minWidth:300,fontSize:15}}>{label}</span>
      <input className="fi" type="number" min={k==='logTz'?-12:1} max={k==='logTz'?14:undefined} step={k==='logTz'?0.5:1} value={v[k]} onChange={set(k)} style={{width:100}}/>
      <span style={{fontSize:15,color:'var(--mut)'}}>{unit}</span>
    </div>
  );
  return(
    <div className="sblk">
      <h2 className="sh">3CX call alerts</h2>
      <p className="sd">When the 3CX page raises an alert, and which time zone the logger's timestamps are in (the clock of the PC that runs the 3CX logger). These are saved in this browser only.</p>
      {row('3CX logger PC clock: UTC offset','logTz','hours (UTC+0 = 0, UTC+1 = 1)')}
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
      <h3 style={{fontSize:16,fontWeight:400,margin:'26px 0 6px'}}>Where the 3CX logger uploads</h3>
      <p className="sd" style={{marginBottom:12}}>The Supabase project the logger writes to, if it is not the one this app uses. Leave both empty to read from this app's own project. Use the project's public (anon) key, never a secret one.</p>
      <div style={{display:'flex',flexDirection:'column',gap:10,maxWidth:640}}>
        <input className="fi" type="text" spellCheck="false" placeholder="https://your-project.supabase.co" value={v.dbUrl||''} onChange={set('dbUrl')} aria-label="3CX data Supabase URL"/>
        <input className="fi" type="text" spellCheck="false" placeholder="public anon key" value={v.dbKey||''} onChange={set('dbKey')} aria-label="3CX data public key"/>
        <input className="fi" type="text" spellCheck="false" placeholder="table (status_log)" value={v.dbTable||''} onChange={set('dbTable')} style={{maxWidth:240}} aria-label="3CX data table"/>
      </div>
      <div style={{marginTop:20,display:'flex',alignItems:'center',gap:12}}>
        <button className="bp" onClick={save} disabled={!valid}>Save</button>
        {ok&&<span style={{color:'var(--green)',fontSize:14,display:'flex',alignItems:'center',gap:6}}><Ic n="check" size={15}/> Saved</span>}
      </div>
    </div>
  );
}

/* What the agents themselves entered on the sample day, so the break check has something to compare the sample 3CX log with. */
const CX_SAMPLE_APP=(()=>{
  const id=n=>(CX_SAMPLE_USERS.find(u=>u.name===n)||{}).id;
  const row=(n,a,b)=>({id:'sa-'+n+a,user_id:id(n),agent_name:n,start_time:`2026-10-27T${a}:00.000Z`,end_time:b?`2026-10-27T${b}:00.000Z`:null,break_type:'Break'});
  return [row('Kay Kim','11:00','11:15'),row('Kay Kim','11:30','12:20'),row('Jane Doe','10:00','10:10')];
})();

/* Shown only if Supabase refuses to let the admin read what the logger uploads. It only ADDS a read rule for admins; it does not turn on
   row security, so it cannot stop the logger from writing. */
const CX_READ_SQL=`-- Let signed-in admins read what the 3CX logger uploads (run once in the Supabase SQL Editor). Safe to run again.
-- The logger's own insert-only rule is not touched.
do $$ begin
  create policy "admins read status_log" on public.status_log for select to authenticated
    using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
exception when duplicate_object then null;
end $$;
grant select on public.status_log to authenticated;
-- Live updates: let Supabase push new rows to the page the moment they arrive.
do $$ begin
  alter publication supabase_realtime add table public.status_log;
exception when duplicate_object then null; when undefined_object then null;
end $$;
notify pgrst, 'reload schema';`;

/* For the logger's own project: the page reads with the public key (it is not signed in there). This lets that key read the rows, nothing else. */
const CX_READ_SQL_ANON=`-- Let the 3CX page read what the logger uploads (run once in the SQL Editor of the project the logger writes to).
-- Note: this lets anyone with that project's public key read the status rows (agent names and statuses).
do $$ begin
  create policy "read status_log" on public.status_log for select to anon, authenticated using (true);
exception when duplicate_object then null;
end $$;`;

/* One-time setup for the table the logger uploads to (the text comes from tools/3cx/status_log.sql when the page is built). */
const CX_SETUP_SQL=`__CX_SETUP_SQL__`;
