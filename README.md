# CITYPULSE AI

**From Civic Evidence to Verified Action.** A local civic operations demo built from the supplied incidents, complaints, and locations CSVs. The interface labels uploaded records and simulated actions; the emergency demo never sends messages or contacts responders.

## Run locally

Requirements: Python 3.11+, `uv`, Node.js 20+, and npm. The initial datasets are in `data/raw/`; keep that directory populated when moving the project.

Terminal 1, from the project root:

```powershell
uv run uvicorn backend.app.main:app --reload
```

Terminal 2, from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). API docs: [http://localhost:8000/docs](http://localhost:8000/docs). `uv run` installs the backend dependencies declared in `pyproject.toml` on first use. For backend overrides, copy `.env.example` to `.env` and append `--env-file .env` to the backend command; copy `frontend/.env.local.example` to `frontend/.env.local` for the frontend API URL.

Health check:

```powershell
Invoke-RestMethod http://localhost:8000/api/v1/health
```

## Data and analytics

The backend reads CSV files from `data/raw` without modifying them and reports columns, inferred types, missing cells, duplicate rows, coordinate validity, and `location_id` join coverage. The current dataset has 10,000 incidents, 8,000 complaints, and 1,000 locations. Database-backed reviewer decisions, simulated emergency cases, and audit events persist in `data/citypulse.sqlite3`.

The dashboard defaults to dark theme and opens on a data-backed overview with incident and complaint totals, priority locations, incident categories, severity distribution, and incident records. The priority ranking is a transparent normalized heuristic over recorded severity, unresolved counts, and incident counts. It is a human-review aid, not a model, neglect claim, or automatic decision. A zone-month count target is derivable, but the records span only 12 months (2025), too little temporal coverage for credible prospective evaluation. A predictive model is therefore **not trained**; the app reports descriptive counts and has no model training command or endpoint.

## Demo flow

1. Review the overview and dataset quality.
2. Change a complaint's reviewer status; the original CSV stays unchanged and the action is added to the ledger.
3. Create a simulated emergency case from a high/critical incident.
4. Acknowledge, escalate, confirm dispatch, resolve, or reopen it. Every action is labeled simulated and written to the audit ledger.

This demo does not have a real delivery provider, configured recipients, automatic deadline scheduler, authentication, or agency authorization. The emergency controls are for demonstration only and are not an emergency response channel.

## API overview

- `GET /api/v1/health`, `/datasets`, `/dashboard/summary`, `/incidents`, `/complaints`, `/priorities`, `/analytics/summary`, `/models/status`, `/emergencies`, `/ledger`
- `POST /api/v1/complaints/{complaint_id}/review`
- `POST /api/v1/emergencies` and `POST /api/v1/emergencies/{case_id}/{mark-unacknowledged|acknowledge|escalate|dispatch|resolve|reopen}`

Full request and response schemas are in FastAPI OpenAPI at `/docs`.

## Checks

```powershell
uv run --extra test python -m unittest discover -s tests
cd frontend
npm run build
npm audit
```

## Current implementation notes

Implemented: the dark civic-operations dashboard connected to API health, dashboard summary, full incident and complaint lists, 1,000 ranked locations, analytics, model status, dataset quality reports, emergency actions, reviewer decisions, and the audit ledger. The overview metrics and priority queue use backend data; the archive's hardcoded sample counts and generated map points were not carried over.

Not implemented: CSV upload/version activation UI, login/authorization, geocoding, live external integrations, automatic deadline scheduler, database migrations, and predictive training. The CSV files are read-only inputs. Do not expose this demo publicly with sensitive records.
