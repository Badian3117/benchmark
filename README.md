# BenchMark

**Project KPI control for mining contractors** – the successor of the *PM KPI Tracker* Excel workbook, built for CORICA Mining Services project managers.

BenchMark keeps the workbook's monthly control loop – *set targets → capture data → automatic KPIs → RAG → corrective action → verified improvement* – and makes it reliable enough for 10+ PMs across several sites.

## What it does

| Area | Details |
|---|---|
| **18 KPIs** | The workbook's 16 KPIs plus cumulative SPI and CPI (YTD). Every value shows its sample size (n). |
| **Dashboard** | RAG tiles, KPI table (target, actual, previous, change, direction-aware trend, status, actions), watch list, RAG history, portfolio snapshot. |
| **Project health** | Per project: cumulative CPI/SPI, BAC vs EAC, forecast finish vs baseline, overdue milestones, open issues, high risks, pending CRs. |
| **Watch list** | Contractor escalation rules (CPI < 0.95 escalate, < 0.90 cost-recovery review; SPI < 0.90 two periods running → re-baseline and notify the client), overdue milestones/actions, aged issues, high risks, stuck CRs, **red KPIs without a corrective action**, small samples. |
| **13 logs** | Projects, cost & schedule (EVM), change requests, risks, issues, surveys, resources, milestones, quality, benefits, CI, corrective actions, target revisions. |
| **Data quality** | Every record is checked on save (required fields, impossible dates, unknown projects, duplicates, activity after project closure, future "actual" dates …); a Data quality page lists all findings. |
| **Governance** | Target changes require a reason, proposer and approver, and are logged. Period lock freezes reported months. Full audit trail of every change. |
| **Filters** | Site / PM / project on every page. |
| **Languages** | English and French, switchable per user. Light / dark theme. |
| **Excel** | Imports the original workbook layout; exports a workbook that re-imports without loss. |

### Changes from the Excel tracker (deliberate)

1. **Budget Utilization** and **Resource Utilization** use a *target band*, not "higher/lower is better". 50 % budget spend was GREEN in the workbook; it is now RED (under-spend usually means slippage). Sustained utilisation > 95 % is no longer GREEN.
2. **Project Success Rate** now also requires *deliverables accepted*. P08 was counted as successful in the workbook despite "Deliverables accepted? = No".
3. Overdue milestones, overdue actions and open issues are judged at the **reporting date**, not `TODAY()`, so a closed month never changes afterwards.
4. Milestone Completion Rate for a running month only counts milestones already due.
5. In the Benefits log, the same benefit ID repeats once per measurement (as in the workbook). Two measurements on the same date are flagged as an error.

The engine is checked against the workbook: `tests/engine.test.ts` reproduces **all 160 KPI values** (16 KPIs × Jan–Oct) that Excel calculated. The only differences are the two Success Rate months changed by fix 2 above.

## Central server and roles (v0.2)

All laptops sync with one central database (Supabase / PostgreSQL). **Setup guide: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).**

| Role | Who | Can see | Can change |
|---|---|---|---|
| Administrator | Project Controls | every site | everything: users, sites, KPI targets, period lock |
| Executive | MD, CEO, COO, group managers | every site | nothing (read-only) |
| Project manager | PMs | the sites they are assigned to | only their own projects (projects where *Project manager* = their name) and those projects' records; site records (resources, CI, project-less actions) of their sites |
| Waiting for approval | anyone who signs in for the first time | nothing | nothing |

* **Sign-in:** email + password, or Microsoft 365 (Entra ID, single tenant).
* **Enforced by the database:** row-level security, period lock and audit trail live in PostgreSQL. The app only mirrors them so that it doesn't offer edits that would be refused.
* **Offline-first:** each user has their own local SQLite database on the laptop. Changes sync when there is a connection (on start, every minute, a few seconds after each edit, and on demand).
* **No silent overwrites:** every record carries a server revision. If someone else changed a record first, the second laptop gets a *conflict* showing both versions, and the user decides (*Keep mine* / *Use server version*). Changes the server refuses (permissions, locked month, missing site) are listed with the reason.
* **Sites overview:** a portfolio roll-up per site (KPI RAG counts, project health, CPI/SPI, critical alerts) for executives.
* **Standalone mode** still works with no server configured (single laptop, Phase 1 behaviour).

## Architecture

```
┌──────────── Electron desktop app (each PM laptop) ───────────────┐        ┌──────── Supabase ────────┐
│ React UI ── KPI engine (pure TypeScript, unit-tested)            │        │ Auth: email, Microsoft   │
│     │                                                            │  HTTPS │ PostgreSQL               │
│ SQLite per user (sql.js) ── sync engine (push / pull / audit) ───┼───────►│  row-level security      │
│     │   rows: UUID, revision, dirty flag, soft delete            │        │  bm_push(): optimistic   │
│ main process: atomic writes, daily backups, benchmark:// links   │        │  concurrency, lock, audit│
└──────────────────────────────────────────────────────────────────┘        └──────────────────────────┘
```

* Data files: `%APPDATA%\BenchMark\data\` – `benchmark.sqlite` in standalone mode, `user-<id>.sqlite` per signed-in user (backups in `backups\`). It is a standard SQLite file, so Power BI or Excel can read it through an SQLite ODBC driver.
* The renderer runs sandboxed with no Node access. Files are only reached through a small preload API.
* `src/engine` has no UI or storage dependencies, so the same KPI code can also run server-side (e.g. scheduled reports).

```
src/engine   dates, schema (logs, fields, computed columns), kpis, analysis (health, alerts, snapshot), validate, permissions
src/sync     transport (Supabase REST), engine (two-way sync), session (sign-in, profile), admin (users & sites)
supabase     migrations/… – the server schema, GENERATED from src/engine/schema.ts (npm run gen:sql)
src/data     store (SQLite), persistence (desktop file / browser IndexedDB preview), sample.json
src/io       Excel import / export
src/i18n     en, fr
src/ui       App, pages, components (charts are hand-built SVG)
electron     main.cjs, preload.cjs
tests        engine.test.ts (unit + Excel golden test), e2e*.cjs (UI), server/ (permissions + sync on real PostgreSQL)
```

## Development

```bash
npm install --legacy-peer-deps
npm run dev          # browser preview at http://localhost:5173 (data kept in IndexedDB)
npm test             # engine + Excel round-trip tests
eval "$(scripts/test-db.sh start)"   # throw-away PostgreSQL 16 (Linux)
npm run test:server  # row-level security + sync engine against the real schema
npm run test:e2e:connected   # UI as admin / executive / PMs against a local Supabase stand-in
npm start            # build and run the desktop app
npm run dist:win     # Windows installer → release/BenchMark-Setup-<version>.exe
```

Building the Windows installer on Linux needs `wine64` and `wine32:i386`. The GitHub Actions workflow (`.github/workflows/build.yml`) builds it natively on Windows instead.

`npm run make:sample -- <workbook.xlsx>` regenerates the bundled sample data from a workbook.

## Roadmap

* ~~Phase 2 – multi-PM sync~~ (v0.2).
* **Phase 3 – contractor module:** approval-gate lag (alert above 48 h), variation register, drill metres / blast blocks vs plan, re-blast rate, explosives reconciliation, safety KPIs (TRIFR/LTIFR, PPV/airblast exceedances), rotation handover report, PDF monthly report, Power BI dataset.
