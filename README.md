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

## Architecture

```
┌──────────── Electron desktop app (Windows installer) ────────────┐
│ React UI ── KPI engine (pure TypeScript, unit-tested)            │
│     │                                                            │
│ SQLite (sql.js / WebAssembly) ── typed table per log, audit table│
│     │   rows have UUID ids, updated_at, soft-delete → sync-ready │
│ main process: atomic file writes + daily backups (30 kept)       │
└──────────────────────────────────────────────────────────────────┘
```

* Data file: `%APPDATA%\BenchMark\data\benchmark.sqlite` (backups in `backups\`). It is a standard SQLite file, so Power BI or Excel can read it through an SQLite ODBC driver.
* The renderer runs sandboxed with no Node access. Files are only reached through a small preload API.
* `src/engine` has no UI or storage dependencies: the same code will run on the sync server in Phase 2.

```
src/engine   dates, schema (logs, fields, computed columns), kpis, analysis (health, alerts, snapshot), validate
src/data     store (SQLite), persistence (desktop file / browser IndexedDB preview), sample.json
src/io       Excel import / export
src/i18n     en, fr
src/ui       App, pages, components (charts are hand-built SVG)
electron     main.cjs, preload.cjs
tests        engine.test.ts (unit + Excel golden test), e2e.cjs, e2e-io.cjs (UI)
```

## Development

```bash
npm install --legacy-peer-deps
npm run dev          # browser preview at http://localhost:5173 (data kept in IndexedDB)
npm test             # engine + Excel round-trip tests
npm start            # build and run the desktop app
npm run dist:win     # Windows installer → release/BenchMark-Setup-<version>.exe
```

Building the Windows installer on Linux needs `wine64` and `wine32:i386`. The GitHub Actions workflow (`.github/workflows/build.yml`) builds it natively on Windows instead.

`npm run make:sample -- <workbook.xlsx>` regenerates the bundled sample data from a workbook.

## Roadmap

* **Phase 2 – multi-PM sync:** central Postgres (Supabase) with row-level security (a PM edits only their projects, management reads everything), offline-first sync of the local SQLite, user accounts and roles, a portfolio roll-up across sites.
* **Phase 3 – contractor module:** approval-gate lag (alert above 48 h), variation register, drill metres / blast blocks vs plan, re-blast rate, explosives reconciliation, safety KPIs (TRIFR/LTIFR, PPV/airblast exceedances), rotation handover report, PDF monthly report, Power BI dataset.
