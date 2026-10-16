'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleHelp, Database, FileCheck2, FileText, Flame, Moon, RotateCw, Search, ShieldCheck, Siren, Sun, X } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
type Row = Record<string, any>;
type View = 'MAP' | 'COMPLAINTS' | 'EMERGENCY' | 'LEDGER' | 'DATA & MODEL';
const VIEWS: View[] = ['MAP','COMPLAINTS','EMERGENCY','LEDGER','DATA & MODEL'];
const SEVERITIES: Record<string,string> = { Critical:'#ff5d6c', High:'#ffb547', Medium:'#4da3ff', Low:'#3de0c0' };
const REVIEW_STATES = ['NEEDS REVIEW','CORROBORATED','VERIFIED BY REVIEWER','REJECTED BY REVIEWER','POSSIBLE DUPLICATE','INCOMPLETE INFORMATION'];

async function get(path:string) { const r=await fetch(`${API}${path}`,{cache:'no-store'}); if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }
async function post(path:string,body:Row={}) { const r=await fetch(`${API}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d=await r.json(); if(!r.ok) throw new Error(d.detail||r.statusText); return d; }
function count(n:number|undefined) { return n == null ? '—' : n.toLocaleString(); }
function csv(rows:Row[]) { if(!rows.length)return ''; const cols=Object.keys(rows[0]); const cell=(v:any)=>`"${String(v??'').replaceAll('"','""')}"`; return [cols.map(cell).join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\n'); }

export default function Home() {
  const [view,setView]=useState<View>('MAP');
  const [dark,setDark]=useState(true);
  const [health,setHealth]=useState<Row|null>(null),[summary,setSummary]=useState<Row|null>(null),[dataset,setDataset]=useState<Row|null>(null);
  const [incidents,setIncidents]=useState<Row[]>([]),[complaints,setComplaints]=useState<Row[]>([]),[priorities,setPriorities]=useState<Row[]>([]),[analytics,setAnalytics]=useState<Row|null>(null),[model,setModel]=useState<Row|null>(null),[emergencies,setEmergencies]=useState<Row[]>([]),[ledger,setLedger]=useState<Row[]>([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[reviewFilter,setReviewFilter]=useState('All states');

  const refresh=useCallback(async()=>{
    try {
      const paths=[get('/health'),get('/dashboard/summary'),get('/datasets'),get('/priorities?limit=1000'),get('/analytics/summary'),get('/models/status'),get('/emergencies'),get('/ledger?limit=1000'),get('/incidents?limit=5000&offset=0'),get('/incidents?limit=5000&offset=5000'),get('/complaints?limit=2000&offset=0'),get('/complaints?limit=2000&offset=2000'),get('/complaints?limit=2000&offset=4000'),get('/complaints?limit=2000&offset=6000')];
      const [h,s,d,p,a,m,e,l,i1,i2,c1,c2,c3,c4]=await Promise.all(paths);
      setHealth(h);setSummary(s);setDataset(d);setPriorities(p.items);setAnalytics(a);setModel(m);setEmergencies(e.items);setLedger(l.items);setIncidents([...i1.items,...i2.items]);setComplaints([...c1.items,...c2.items,...c3.items,...c4.items]);setError('');
    } catch(e:any) { setError(`Backend connection failed: ${e.message}. Start the FastAPI service and refresh.`);setHealth(null); }
  },[]);
  useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(),60000);return()=>clearInterval(t)},[refresh]);
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light'},[dark]);
  const sorted=useMemo(()=>[...priorities].sort((a,b)=>b.score-a.score),[priorities]);
  const filteredComplaints=useMemo(()=>complaints.filter(c=>(reviewFilter==='All states'||c.review_state===reviewFilter)&&(!query||`${c.complaint_id} ${c.category} ${c.zone} ${c.status}`.toLowerCase().includes(query.toLowerCase()))),[complaints,query,reviewFilter]);
  const act=async(fn:()=>Promise<any>,message:string)=>{setBusy(true);setNotice('');try{await fn();await refresh();setNotice(message)}catch(e:any){setNotice(`Action failed: ${e.message}`)}finally{setBusy(false)}};

  return <div className="app-shell">
    <header className="top glass">
      <div className="brand-mark"><Activity size={21}/></div><div className="brand-title"><h1>CityPulse <span>AI</span></h1><small>FROM CIVIC EVIDENCE TO VERIFIED ACTION</small></div>
      <nav className="main-nav" aria-label="Application views">{VIEWS.map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{v==='MAP'?<Activity size={14}/>:v==='COMPLAINTS'?<FileCheck2 size={14}/>:v==='EMERGENCY'?<Siren size={14}/>:v==='LEDGER'?<FileText size={14}/>:<Database size={14}/>}<span>{v}</span>{v==='EMERGENCY'&&emergencies.some(e=>e.state!=='RESOLVED')&&<i className="nav-alert"/>}</button>)}</nav>
      <div className="top-status"><span className={`status-dot ${health?.status==='ok'?'':'off'}`}/><span>{health?.status==='ok'?'API CONNECTED':'API OFFLINE'}</span><b>UPLOADED CSV</b><button className="icon-btn" onClick={()=>void act(refresh,'Data refreshed')} aria-label="Refresh data"><RotateCw size={15}/></button><button className="icon-btn" onClick={()=>setDark(!dark)} aria-label="Toggle theme">{dark?<Sun size={15}/>:<Moon size={15}/>}</button></div>
    </header>
    {error&&<div className="toast error-toast"><AlertTriangle size={16}/>{error}<button onClick={()=>void refresh()}>Retry</button></div>}
    {notice&&<div className="toast success-toast"><Check size={15}/>{notice}<button aria-label="Dismiss" onClick={()=>setNotice('')}><X size={14}/></button></div>}

    {view==='MAP'&&<main className="map-dashboard">
      <MapScene locations={sorted} />
      <aside className="map-left">
        <div className="map-kpis">
          <Kpi value={count(summary?.incidents)} label="INCIDENT RECORDS" icon={<Activity size={15}/>} />
          <Kpi value={count(summary?.open_incidents)} label="MARKED UNRESOLVED" icon={<AlertTriangle size={15}/>} color="amber" />
          <Kpi value={count(summary?.complaints)} label="PUBLIC COMPLAINTS" icon={<FileText size={15}/>} />
        </div>
        <section className="glass map-mix"><div className="panel-eyebrow">UPLOADED RECORDS</div><h3>Incident mix</h3><Bars values={summary?.category_counts||{}}/></section>
        <div className="source-note"><i className="status-dot"/> SOURCE: PROVIDED CSV FILES</div>
      </aside>
      <aside className="glass map-right"><div className="panel-eyebrow">HUMAN REVIEW QUEUE</div><h2>Priority locations</h2><p className="panel-sub">Transparent heuristic from reported severity, unresolved, and total incident counts.</p><div className="rank-list">{sorted.slice(0,100).map((p,i)=><button className="rank-row" key={p.location_id} onClick={()=>{setQuery(p.zone||'');document.dispatchEvent(new CustomEvent('citypulse:focus-location',{detail:p.location_id}))}}><span className="rank-num">{String(i+1).padStart(2,'0')}</span><span className="rank-name"><b>{p.zone}</b><small>{p.location_id} · {p.incident_count} incidents · {p.critical} critical</small></span><strong className="rank-score" style={{color:scoreColor(p.score)}}>{Number(p.score).toFixed(1)}</strong></button>)}</div><div className="queue-foot"><ShieldCheck size={14}/> Review aid only · humans decide next action</div></aside>
      <div className="glass map-hint"><span><i className="legend incident"/> Uploaded locations</span><span><i className="legend tower"/> Priority score</span><span className="muted">Drag to rotate · scroll to zoom · select a column</span></div>
      <div className="map-caption">{sorted.length.toLocaleString()} REPORTED LOCATIONS · {count(summary?.incidents)} INCIDENTS</div>
      <button className="small-button map-quality" onClick={()=>setView('DATA & MODEL')}>Data quality <ChevronRight size={14}/></button>
    </main>}

    {view==='COMPLAINTS'&&<Panel title="Complaint review" eyebrow="CIVICTRUST · HUMAN REVIEW" onBack={()=>setView('MAP')}><div className="banner"><ShieldCheck size={17}/> Similarity, missing fields, and location signals are review aids only. A reviewer decides; the source row is preserved.</div><div className="toolbar"><label className="search"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search ID, category, zone"/></label><select value={reviewFilter} onChange={e=>setReviewFilter(e.target.value)}><option>All states</option>{['NEW',...REVIEW_STATES].map(s=><option key={s}>{s}</option>)}</select><span className="result-count">{filteredComplaints.length.toLocaleString()} of {complaints.length.toLocaleString()} records</span></div><div className="table-wrap"><table><thead><tr><th>COMPLAINT</th><th>CATEGORY</th><th>ZONE</th><th>REPORTED</th><th>REVIEW STATE</th><th>REVIEW ACTION</th></tr></thead><tbody>{filteredComplaints.slice(0,150).map(c=><tr key={c.complaint_id}><td><b>{c.complaint_id}</b></td><td>{c.category}</td><td>{c.zone||c.location_id}</td><td>{String(c.created_at).slice(0,16)}</td><td><span className="state-pill">{c.review_state}</span></td><td><select disabled={busy} value="" onChange={e=>e.target.value&&void act(()=>post(`/complaints/${encodeURIComponent(c.complaint_id)}/review`,{state:e.target.value,note:'Reviewed in CITYPULSE',actor:'Demo operator'}),`${c.complaint_id} review saved`)}><option value="">Set state…</option>{REVIEW_STATES.map(s=><option key={s}>{s}</option>)}</select></td></tr>)}</tbody></table>{filteredComplaints.length>150&&<div className="table-note">Showing the first 150 filtered records. Use search to narrow the queue.</div>}</div></Panel>}

    {view==='EMERGENCY'&&<Panel title="Emergency command" eyebrow="SIMULATION MODE · NO REAL ALERTS" onBack={()=>setView('MAP')}><div className="banner warn"><AlertTriangle size={17}/> Demo controls do not contact emergency services, send messages, confirm delivery, or dispatch responders. Follow existing emergency procedures.</div><EmergencyPanel incidents={incidents} emergencies={emergencies} busy={busy} act={act}/></Panel>}

    {view==='LEDGER'&&<Panel title="Outcome ledger" eyebrow="APPEND-ONLY AUDIT EVENTS" onBack={()=>setView('MAP')} actions={<button className="small-button" onClick={()=>download('citypulse-ledger.csv',csv(ledger))}><ArrowDownToLine size={14}/> Export CSV</button>}><div className="table-wrap"><table><thead><tr><th>TIME</th><th>ENTITY</th><th>RECORD</th><th>ACTION</th><th>ACTOR</th><th>DETAIL</th></tr></thead><tbody>{ledger.map(e=><tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td>{e.entity}</td><td><b>{e.entity_id}</b></td><td>{e.action}</td><td>{e.actor}</td><td className="detail-cell">{e.detail}</td></tr>)}</tbody></table>{!ledger.length&&<Empty icon={<FileText/>} title="No audit events yet" text="Reviewer decisions and demo emergency actions appear here."/>}</div></Panel>}

    {view==='DATA & MODEL'&&<Panel title="Data & analytics" eyebrow="SOURCE QUALITY · DESCRIPTIVE ANALYTICS" onBack={()=>setView('MAP')} actions={<button className="small-button" onClick={()=>download('citypulse-data-quality.json',JSON.stringify(dataset,null,2))}><ArrowDownToLine size={14}/> Export quality report</button>}><div className="banner">{model?.message||'Model status unavailable.'}</div><div className="data-summary"><div className="glass sub-card"><div className="panel-eyebrow">ACTIVE SOURCE</div><h3>Uploaded CSV files</h3><p>Source files remain unchanged in <code>data/raw</code>. Imported at {dataset?.imported_at?new Date(dataset.imported_at).toLocaleString():'—'}.</p><div className="detail-stats"><span><b>{dataset?.join_coverage?.incidents??0}</b> incident joins</span><span><b>{dataset?.join_coverage?.complaints??0}</b> complaint joins</span><span><b>{dataset?.coordinate_issues??0}</b> invalid coordinates</span></div></div><div className="glass sub-card"><div className="panel-eyebrow">MODEL STATUS</div><h3>{model?.status||'Loading'}</h3><p>Candidate target: {model?.target_candidate||'—'} · observed months: {model?.observed_months||'—'}. No prediction or accuracy claim is shown.</p><div className="model-status">NOT TRAINED <span>Predictive training disabled for insufficient time coverage.</span></div></div></div><div className="dataset-grid">{(dataset?.reports||[]).map((d:Row)=><section className="glass dataset-card" key={d.name}><div className="dataset-title"><Database size={16}/><b>{d.name}</b></div><strong>{count(d.rows)} <small>ROWS</small></strong><span>{d.columns} columns · {d.missing_cells} missing cells · {d.duplicate_rows} duplicate rows</span><details><summary>Show fields and types</summary><div className="fields">{d.fields.map((f:Row)=><span key={f.name}><b>{f.name}</b><small>{f.dtype} · null {f.missing}</small></span>)}</div></details></section>)}</div><div className="analytics-grid"><section className="glass sub-card"><div className="panel-eyebrow">INCIDENT DISTRIBUTION</div><h3>Severity</h3><Bars values={summary?.severity_counts||{}}/></section><section className="glass sub-card"><div className="panel-eyebrow">COMPLAINT DISTRIBUTION</div><h3>Categories</h3><Bars values={analytics?.complaint_categories||{}}/></section></div></Panel>}
  </div>;
}

function MapScene({locations}:{locations:Row[]}) {
  const host=useRef<HTMLDivElement>(null),[picked,setPicked]=useState<Row|null>(null);
  useEffect(()=>{
    const el=host.current;if(!el)return;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#07101d');scene.fog=new THREE.Fog('#07101d',24,62);
    const camera=new THREE.PerspectiveCamera(42,el.clientWidth/Math.max(1,el.clientHeight),.1,150);camera.position.set(13,17,22);
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setSize(el.clientWidth,el.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;el.replaceChildren(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=5;controls.maxDistance=48;controls.maxPolarAngle=Math.PI*.47;controls.target.set(0,.1,0);
    scene.add(new THREE.HemisphereLight(0x8bb6dc,0x101b2b,2.1));const key=new THREE.DirectionalLight(0x9ccfff,2.7);key.position.set(7,18,8);scene.add(key);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(42,42),new THREE.MeshStandardMaterial({color:0x0b1727,roughness:.9,metalness:.05}));ground.rotation.x=-Math.PI/2;ground.position.y=-.08;scene.add(ground);
    const grid=new THREE.GridHelper(42,42,0x23405a,0x1a3048);grid.position.y=-.055;scene.add(grid);
    // Latitude/longitude from the imported Vijayawada-area records anchor the plotted points.
    const valid=locations.filter(p=>Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude)));
    const centerLat=valid.reduce((s,p)=>s+Number(p.latitude),0)/Math.max(1,valid.length),centerLon=valid.reduce((s,p)=>s+Number(p.longitude),0)/Math.max(1,valid.length);
    const group=new THREE.Group();const hits:THREE.Object3D[]=[];const pointFor=new Map<string,THREE.Vector3>();
    valid.slice(0,450).forEach((p)=>{
      const x=(Number(p.longitude)-centerLon)*42,z=(centerLat-Number(p.latitude))*42;
      const score=Number(p.score)||0,h=.6+score/15,color=score>=60?0xff5d6c:score>=42?0xffb547:0x34d6c1;
      const mat=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.34,roughness:.35,metalness:.18});
      const bar=new THREE.Mesh(new THREE.CylinderGeometry(.11,.14,h,8),mat);bar.position.set(x,h/2,z);bar.userData.record=p;group.add(bar);hits.push(bar);pointFor.set(String(p.location_id),new THREE.Vector3(x,.5,z));
      const ring=new THREE.Mesh(new THREE.RingGeometry(.19,.22,20),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.48,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(x,.025,z);group.add(ring);
    });scene.add(group);
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();let frame=0;
    const choose=(event:PointerEvent)=>{const rect=renderer.domElement.getBoundingClientRect();mouse.set((event.clientX-rect.left)/rect.width*2-1,-((event.clientY-rect.top)/rect.height)*2+1);ray.setFromCamera(mouse,camera);const first=ray.intersectObjects(hits)[0]?.object;const p=first?.userData.record as Row|undefined;if(p)setPicked(p)};
    renderer.domElement.addEventListener('click',choose);
    const focus=(event:Event)=>{const id=(event as CustomEvent<string>).detail;const point=pointFor.get(id);if(point){controls.target.set(point.x,.3,point.z);controls.update();const rec=locations.find(p=>p.location_id===id);if(rec)setPicked(rec)}};
    document.addEventListener('citypulse:focus-location',focus);
    const resize=()=>{if(!el.clientWidth||!el.clientHeight)return;camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight)};
    const observer=new ResizeObserver(resize);observer.observe(el);
    const draw=()=>{controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(draw)};draw();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('citypulse:focus-location',focus);renderer.domElement.removeEventListener('click',choose);controls.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose())}});renderer.dispose();el.replaceChildren()};
  },[locations,onSelect]);
  return <div className="map-scene" ref={host} aria-label="Interactive three dimensional incident priority map">{picked&&<div className="glass map-selected"><small>SELECTED PRIORITY LOCATION</small><strong>{picked.zone} <span>· {picked.location_id}</span></strong><b style={{color:scoreColor(picked.score)}}>{Number(picked.score).toFixed(1)}</b><span>{picked.incident_count} reports · {picked.critical} critical · {picked.road_type}</span></div>}<button className="map-reset" onClick={()=>setPicked(null)} aria-label="Clear selected location">Reset view</button></div>;
}

function scoreColor(score:number){return score>=60?'#ff5d6c':score>=42?'#ffb547':'#3de0c0'}
function download(name:string,content:string){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
function Kpi({value,label,icon,color}:{value:string,label:string,icon:React.ReactNode,color?:string}){return <section className="glass kpi"><div className="kpi-label">{icon}<span>{label}</span></div><b className={color||''}>{value}</b></section>}
function Bars({values}:{values:Row}){const entries=Object.entries(values).sort((a,b)=>Number(b[1])-Number(a[1]));const max=Math.max(1,...entries.map(([,v])=>Number(v)));const palette=['#4da3ff','#3de0c0','#ffb547','#a78bfa','#ff5d6c','#5fd4f4'];return <div className="bars">{entries.map(([name,v],i)=><div className="bar-row" key={name}><span title={name}>{name}</span><div className="bar-track"><i style={{width:`${Number(v)/max*100}%`,background:palette[i%palette.length]}}/></div><b>{Number(v).toLocaleString()}</b></div>)}</div>}
function Panel({title,eyebrow,children,onBack,actions}:{title:string,eyebrow:string,children:React.ReactNode,onBack:()=>void,actions?:React.ReactNode}){return <section className="glass screen-panel"><div className="screen-head"><button className="back-button" onClick={onBack}><ArrowLeft size={15}/> Map</button><div className="screen-title"><div className="panel-eyebrow">{eyebrow}</div><h2>{title}</h2></div>{actions}</div><div className="screen-content">{children}</div></section>}
function Empty({icon,title,text}:{icon:React.ReactNode,title:string,text:string}){return <div className="empty"><span>{icon}</span><b>{title}</b><small>{text}</small></div>}

function EmergencyPanel({incidents,emergencies,busy,act}:{incidents:Row[],emergencies:Row[],busy:boolean,act:(fn:()=>Promise<any>,message:string)=>void}){
  const candidates=incidents.filter(i=>['Critical','High'].includes(i.severity)).slice(0,80);
  return <><div className="emergency-grid"><section className="glass sub-card"><div className="panel-eyebrow">CREATE DEMONSTRATION CASE</div><h3>From a recorded incident</h3><p>Choose an actual uploaded incident to start a persisted simulated workflow.</p><div className="incident-picks">{candidates.slice(0,8).map(i=><div className="incident-pick" key={i.incident_id}><i style={{background:SEVERITIES[i.severity]}}/><span><b>{i.incident_type}</b><small>{i.incident_id} · {i.zone||i.location_id} · {i.severity}</small></span><button className="small-button danger" disabled={busy} onClick={()=>void act(()=>post('/emergencies',{incident_id:i.incident_id,actor:'Demo operator'}),'Simulated case created; nothing was sent.')}>Create case</button></div>)}</div></section><section className="glass sub-card"><div className="panel-eyebrow">STATE SEPARATION</div><h3>Alert is simulated</h3><div className="state-explain">{[['SENT','app submission only'],['DELIVERED','provider confirmation absent'],['ACKNOWLEDGED','operator action'],['DISPATCH','operator confirmation'],['RESOLVED','operator records outcome']].map(([a,b])=><div key={a}><b>{a}</b><span>{b}</span></div>)}</div><p className="muted">The acknowledgment window is advanced manually for the demo. No scheduler, provider, agency recipient, or dispatch integration is configured.</p></section></div><section className="glass sub-card emergency-table"><div className="panel-eyebrow">CASE HISTORY · {emergencies.length} CASES</div>{emergencies.length?<div className="table-wrap"><table><thead><tr><th>CASE</th><th>INCIDENT</th><th>STATUS</th><th>UPDATED</th><th>SIMULATED OPERATOR ACTIONS</th></tr></thead><tbody>{emergencies.map(e=><tr key={e.case_id}><td><b>{e.case_id}</b></td><td>{e.incident_id}</td><td><span className="state-pill">{e.state}</span></td><td>{new Date(e.updated_at).toLocaleString()}</td><td><EmergencyActions item={e} busy={busy} act={act}/></td></tr>)}</tbody></table></div>:<Empty icon={<Siren/>} title="No demo cases yet" text="Create a case from one of the uploaded high severity incidents."/>}</section></>;
}
function EmergencyActions({item,busy,act}:{item:Row,busy:boolean,act:(fn:()=>Promise<any>,message:string)=>void}){const actions:Record<string,[string,string][] >={'AWAITING ACKNOWLEDGMENT':[['Mark unacknowledged','mark-unacknowledged'],['Acknowledge','acknowledge']],UNACKNOWLEDGED:[['Escalate to demo backup','escalate']],ESCALATED:[['Acknowledge backup','acknowledge']],ACKNOWLEDGED:[['Confirm dispatch','dispatch']], 'DISPATCH CONFIRMED':[['Resolve','resolve']],RESOLVED:[['Reopen','reopen']]};return <div className="action-group">{(actions[item.state]||[]).map(([label,action])=><button className="text-action" key={action} disabled={busy} onClick={()=>void act(()=>post(`/emergencies/${item.case_id}/${action}`,{actor:'Demo operator',reason:'Operator action in local demonstration'}),`${item.case_id} → ${action}`)}>{label}</button>)}</div>}

