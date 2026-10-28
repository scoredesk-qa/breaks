
/* ═══ 3CX test page: settings (shown in Settings → "3CX call alerts") ═══
   Test copy only: the values are kept in this browser (localStorage), not in the database. */
const CX_CFG_KEY='bt_cx_cfg';
// logTz: UTC offset of the PC that runs the 3CX logger (its clock wrote the log's timestamps)
const CX_CFG_DEFAULT={logTz:0,ignoreRingSec:10,shortCallSec:60,repeatIgnoreCount:3,repeatIgnoreWindowMin:60};
let _cxCfg=(()=>{ try{ return {...CX_CFG_DEFAULT,...JSON.parse(localStorage.getItem(CX_CFG_KEY)||'{}')}; }catch(e){ return {...CX_CFG_DEFAULT}; } })();
const CX_SAMPLE_USERS=['Jane Doe','Rick Roe','Pat Poe','Max Moe','Lou Lee','Kay Kim','Finn Fox','Gail Gray'].map((n,i)=>({id:'sample-'+i,name:n}));

function A3cxSettings(){
  const [v,setV]=useState({..._cxCfg});
  const [ok,setOk]=useState(false);
  const set=k=>e=>setV(p=>({...p,[k]:e.target.value}));
  const tzOk=v.logTz!==''&&Number.isFinite(Number(v.logTz))&&Number(v.logTz)>=-12&&Number(v.logTz)<=14;
  const valid=tzOk&&Object.keys(CX_CFG_DEFAULT).filter(k=>k!=='logTz').every(k=>Number(v[k])>=1);
  const save=()=>{
    const c={logTz:Number(v.logTz)}; for(const k of Object.keys(CX_CFG_DEFAULT)) if(k!=='logTz') c[k]=Math.max(1,Math.round(Number(v[k])));
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
      <p className="sd">When the 3CX page raises an alert, and which time zone the logger's timestamps are in (the clock of the PC that runs the 3CX logger). Test copy: these are saved in this browser only.</p>
      {row('3CX logger PC clock: UTC offset','logTz','hours (UTC+0 = 0, UTC+1 = 1)')}
      {row('Ignored call: a call rings at least','ignoreRingSec','seconds without being answered')}
      {row('Possible dropped call: a call shorter than','shortCallSec','seconds')}
      {row('Repeated ignores: this many ignored calls','repeatIgnoreCount','calls')}
      {row('...within','repeatIgnoreWindowMin','minutes')}
      <div style={{marginTop:20,display:'flex',alignItems:'center',gap:12}}>
        <button className="bp" onClick={save} disabled={!valid}>Save</button>
        {ok&&<span style={{color:'var(--green)',fontSize:14,display:'flex',alignItems:'center',gap:6}}><Ic n="check" size={15}/> Saved</span>}
      </div>
    </div>
  );
}
