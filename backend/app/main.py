from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("CITYPULSE_DATA_DIR", ROOT / "data" / "raw"))
DB_PATH = Path(os.getenv("CITYPULSE_DB", ROOT / "data" / "citypulse.sqlite3"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="CITYPULSE AI API", version="1.0.0", description="Civic evidence to verified action. Emergency workflow is simulation only.")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","), allow_methods=["*"], allow_headers=["*"])

@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

def init_db() -> None:
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS reviews (complaint_id TEXT PRIMARY KEY, state TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS emergencies (case_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS dataset_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, rows INTEGER NOT NULL, columns INTEGER NOT NULL, imported_at TEXT NOT NULL, quality TEXT NOT NULL);
        """)

def load_data() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    names = ["incidents.csv", "public_complaints.csv", "locations.csv"]
    files = [DATA_DIR / n for n in names]
    if not all(p.exists() for p in files):
        raise HTTPException(503, "Dataset files are not installed. Add incidents.csv, public_complaints.csv, and locations.csv to data/raw.")
    try:
        inc, comp, loc = (pd.read_csv(p) for p in files)
    except Exception as e:
        raise HTTPException(422, f"Could not read input CSV: {e}")
    if not {"incident_id","location_id","timestamp","incident_type","severity","resolved"}.issubset(inc.columns): raise HTTPException(422,"incidents.csv is missing required columns")
    if not {"complaint_id","location_id","created_at","category","status"}.issubset(comp.columns): raise HTTPException(422,"public_complaints.csv is missing required columns")
    if not {"location_id","latitude","longitude"}.issubset(loc.columns): raise HTTPException(422,"locations.csv is missing required columns")
    return inc, comp, loc

def clean(v: Any) -> Any:
    if pd.isna(v): return None
    if hasattr(v,"item"): v=v.item()
    return v

def quality_report(frames: list[tuple[str,pd.DataFrame]]) -> list[dict[str,Any]]:
    out=[]
    for name, frame in frames:
        out.append({"name":name,"rows":len(frame),"columns":len(frame.columns),"fields":[{"name":str(col),"dtype":str(frame[col].dtype),"missing":int(frame[col].isna().sum()),"distinct":int(frame[col].nunique(dropna=True))} for col in frame.columns],"duplicate_rows":int(frame.duplicated().sum()),"missing_cells":int(frame.isna().sum().sum())})
    return out

init_db()

@app.get("/api/v1/health")
def health():
    try:
        inc, comp, loc = load_data()
        return {"status":"ok","dataset_loaded":True,"counts":{"incidents":len(inc),"complaints":len(comp),"locations":len(loc)},"mode":"uploaded dataset; emergency actions simulated"}
    except HTTPException as e:
        return {"status":"degraded","dataset_loaded":False,"detail":e.detail}

@app.get("/api/v1/datasets")
def datasets():
    inc, comp, loc=load_data()
    files=[("incidents.csv",inc),("public_complaints.csv",comp),("locations.csv",loc)]
    return {"active_source":"uploaded CSV files","imported_at":datetime.fromtimestamp(min((DATA_DIR/n).stat().st_mtime for n,_ in files),timezone.utc).isoformat(),"reports":quality_report(files),"join_coverage":{"incidents":int(inc.location_id.isin(set(loc.location_id)).sum()),"complaints":int(comp.location_id.isin(set(loc.location_id)).sum())},"coordinate_issues":int((~loc.latitude.between(-90,90)|~loc.longitude.between(-180,180)).sum()),"versions":1}

@app.get("/api/v1/dashboard/summary")
def summary():
    inc, comp, loc=load_data()
    unresolved=int((~inc.resolved.astype(str).isin(["1","True","true"])).sum())
    with db() as c:
        emergency_count=c.execute("SELECT COUNT(*) FROM emergencies WHERE state NOT IN ('RESOLVED')").fetchone()[0]
    category=inc.incident_type.value_counts().to_dict()
    severity=inc.severity.value_counts().to_dict()
    month=pd.to_datetime(inc.timestamp,errors="coerce").dt.to_period("M").astype(str).value_counts().sort_index().to_dict()
    return {"source":"uploaded CSV","incidents":len(inc),"complaints":len(comp),"locations":len(loc),"open_incidents":unresolved,"active_demo_emergencies":emergency_count,"verified_complaints":0,"category_counts":category,"severity_counts":severity,"monthly_incidents":month,"coordinates_valid":int(loc.latitude.between(-90,90).mul(loc.longitude.between(-180,180)).sum()),"last_updated":now()}

@app.get("/api/v1/incidents")
def incidents(limit:int=Query(500,ge=1,le=5000),offset:int=Query(0,ge=0),category:str|None=None,severity:str|None=None,search:str|None=None):
    inc,_,loc=load_data()
    d=inc.merge(loc,on="location_id",how="left",validate="many_to_one")
    if category: d=d[d.incident_type==category]
    if severity: d=d[d.severity==severity]
    if search: d=d[d.astype(str).apply(lambda col:col.str.contains(search,case=False,regex=False)).any(axis=1)]
    total=len(d); rows=[]
    for _,r in d.iloc[offset:offset+limit].iterrows(): rows.append({k:clean(v) for k,v in r.to_dict().items()})
    return {"items":rows,"total":total,"limit":limit,"offset":offset,"source":"uploaded CSV"}

@app.get("/api/v1/complaints")
def complaints(limit:int=Query(200,ge=1,le=2000),offset:int=Query(0,ge=0),state:str|None=None):
    _,comp,loc=load_data()
    with db() as c: reviews={r["complaint_id"]:dict(r) for r in c.execute("SELECT * FROM reviews")}
    comp=comp.merge(loc[["location_id","zone","latitude","longitude"]],on="location_id",how="left",validate="many_to_one")
    items=[]
    for _,r in comp.iloc[offset:offset+limit].iterrows():
        x={k:clean(v) for k,v in r.to_dict().items()}; review=reviews.get(str(x["complaint_id"])); x["review_state"]=review["state"] if review else "NEW";x["review_note"]=review["note"] if review else "";items.append(x)
    if state: items=[x for x in items if x["review_state"]==state]
    return {"items":items,"total":len(items),"source":"uploaded CSV"}

class Review(BaseModel):
    state:str=Field(pattern="^(NEEDS REVIEW|CORROBORATED|VERIFIED BY REVIEWER|REJECTED BY REVIEWER|POSSIBLE DUPLICATE|INCOMPLETE INFORMATION)$")
    note:str=Field(default="",max_length=2000)
    actor:str=Field(default="Demo reviewer",max_length=100)

@app.post("/api/v1/complaints/{complaint_id}/review")
def review_complaint(complaint_id:str, body:Review):
    _,comp,_=load_data()
    if complaint_id not in set(comp.complaint_id.astype(str)): raise HTTPException(404,"Complaint not found")
    with db() as c:
        c.execute("INSERT INTO reviews VALUES(?,?,?,?,?) ON CONFLICT(complaint_id) DO UPDATE SET state=excluded.state,note=excluded.note,actor=excluded.actor,updated_at=excluded.updated_at",(complaint_id,body.state,body.note,body.actor,now()))
        c.execute("INSERT INTO audit(entity,entity_id,action,actor,at,detail) VALUES(?,?,?,?,?,?)",("complaint",complaint_id,"review updated",body.actor,now(),json.dumps(body.model_dump())))
    return {"complaint_id":complaint_id,"state":body.state,"updated":True}

def priorities_data(limit: int = 100):
    inc,_,loc=load_data()
    group=inc.groupby("location_id").agg(incident_count=("incident_id","count"),critical=("severity",lambda s:int(s.astype(str).str.lower().eq("critical").sum())),high=("severity",lambda s:int(s.astype(str).str.lower().eq("high").sum())),unresolved=("resolved",lambda s:int((~s.astype(str).isin(["1","True","true"])).sum()))).reset_index()
    group=group.merge(loc,on="location_id",how="left",validate="one_to_one")
    # A transparent, normalized triage heuristic, not a prediction or equity claim.
    for c in ["incident_count","critical","high","unresolved"]:
        mx=max(1,int(group[c].max())); group[c+"_n"]=group[c]/mx
    group["score"]=(100*(.35*group.critical_n+.30*group.high_n+.20*group.unresolved_n+.15*group.incident_count_n)).round(1)
    group=group.sort_values(["score","incident_count"],ascending=False)
    return [{**{k:clean(v) for k,v in r.to_dict().items()},"explanation":"Ranked using recorded critical and high severity counts, unresolved incidents, and total incidents. This is a heuristic for human review."} for _,r in group.head(limit).iterrows()]

@app.get("/api/v1/priorities")
def priorities(limit:int=Query(100,ge=1,le=1000)): return {"items":priorities_data(limit),"method":"transparent normalized triage heuristic","source":"uploaded CSV","approval_required":True}

@app.get("/api/v1/analytics/summary")
def analytics():
    inc,comp,loc=load_data()
    p=priorities_data()
    return {"incident_types":inc.incident_type.value_counts().to_dict(),"complaint_categories":comp.category.value_counts().to_dict(),"top_zones":inc.merge(loc[["location_id","zone"]],on="location_id").zone.value_counts().head(10).to_dict(),"priority_method":"transparent heuristic; not a trained model","model_status":"NOT TRAINED — a zone-month count target is derivable, but only 12 monthly periods are present; this is too little temporal coverage for a credible predictive evaluation"}

@app.get("/api/v1/models/status")
def model_status(): return {"status":"INSUFFICIENT TIME COVERAGE","trained":False,"message":"A zone-month incident-count target can be derived from the uploaded data, but it spans only 12 monthly periods (2025). That is too little temporal coverage for a credible prospective evaluation. CITYPULSE provides descriptive analytics and a separate transparent triage heuristic instead.","target_candidate":"incident count per zone-month","observed_months":12,"training_available":False}

class EmergencyCreate(BaseModel):
    incident_id:str
    actor:str="Demo operator"

class Action(BaseModel):
    actor:str="Demo operator"
    reason:str=""

def audit(c,case_id,action,actor,detail):
    c.execute("INSERT INTO audit(case_id,entity,entity_id,action,actor,at,detail) VALUES(?,?,?,?,?,?,?)",(case_id,"emergency",case_id,action,actor,now(),json.dumps(detail)))

@app.post("/api/v1/emergencies")
def create_emergency(body:EmergencyCreate):
    inc,_,_=load_data()
    if body.incident_id not in set(inc.incident_id.astype(str)): raise HTTPException(404,"Incident not found")
    case="CP-"+uuid.uuid4().hex[:8].upper(); t=now()
    with db() as c:
        c.execute("INSERT INTO emergencies(case_id,incident_id,state,created_at,updated_at) VALUES(?,?,?,?,?)",(case,body.incident_id,"AWAITING ACKNOWLEDGMENT",t,t))
        audit(c,case,"SIMULATED alert submitted; no message sent",body.actor,{"state":"AWAITING ACKNOWLEDGMENT"})
    return {"case_id":case,"incident_id":body.incident_id,"state":"AWAITING ACKNOWLEDGMENT","simulated":True,"message":"SIMULATED — not sent."}

@app.get("/api/v1/emergencies")
def emergency_list():
    with db() as c: rows=c.execute("SELECT * FROM emergencies ORDER BY created_at DESC").fetchall()
    return {"items":[dict(r) for r in rows],"simulated":True}

@app.post("/api/v1/emergencies/{case_id}/{action}")
def emergency_action(case_id:str,action:str,body:Action):
    transitions={"mark-unacknowledged":("UNACKNOWLEDGED","Demo acknowledgment window advanced; no acknowledgment recorded"),"acknowledge":("ACKNOWLEDGED","Alert acknowledged"),"escalate":("ESCALATED","Simulated escalation to configured demo backup"),"dispatch":("DISPATCH CONFIRMED","Simulated dispatch confirmation"),"resolve":("RESOLVED","Case resolved"),"reopen":("REOPENED","Case reopened")}
    if action not in transitions: raise HTTPException(404,"Unsupported action")
    state,label=transitions[action]
    with db() as c:
        row=c.execute("SELECT * FROM emergencies WHERE case_id=?",(case_id,)).fetchone()
        if not row: raise HTTPException(404,"Case not found")
        allowed={"mark-unacknowledged":{"AWAITING ACKNOWLEDGMENT"},"acknowledge":{"AWAITING ACKNOWLEDGMENT","ESCALATED"},"escalate":{"UNACKNOWLEDGED"},"dispatch":{"ACKNOWLEDGED"},"resolve":{"DISPATCH CONFIRMED"},"reopen":{"RESOLVED"}}
        if row["state"] not in allowed[action]: raise HTTPException(409,f"Cannot {action} a case in state {row['state']}")
        c.execute("UPDATE emergencies SET state=?,updated_at=? WHERE case_id=?",(state,now(),case_id))
        audit(c,case_id,label,body.actor,{"prior_state":row["state"],"new_state":state,"reason":body.reason,"simulated":True})
    return {"case_id":case_id,"state":state,"simulated":True}

@app.get("/api/v1/ledger")
def ledger(limit:int=Query(500,ge=1,le=2000)):
    with db() as c: rows=c.execute("SELECT * FROM audit ORDER BY at DESC LIMIT ?",(limit,)).fetchall()
    return {"items":[dict(r) for r in rows]}

