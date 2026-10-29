# BenchMark in Power BI

There are two ways to get BenchMark data into Power BI.

## A. Monthly export (no database access needed)

In BenchMark: **Import / export → Export for Power BI**. The workbook contains Excel tables:

| Table | Content |
|---|---|
| `Dim_Projects` | one row per project: site, PM, status, dates, BAC / EAC |
| `Dim_KPI` | the 29 KPIs: number, group (safety / ops / pm), name, unit, basis, direction, target, amber limit / band, owner |
| `Fact_KPI_Monthly` | **long format**: `ScopeType` (Portfolio / Site / Project) × `Scope` × `Month` × `KPI` → `Value`, `SampleSize`, `Status` (GREEN / AMBER / RED). The same engine as the app: the numbers are identical. |
| `Log_<name>` | every log (projects, cost & schedule, gates, variations, production, explosives, safety, …) with a `Site` column and the calculated columns |

In Power BI Desktop: **Get data → Excel workbook** → tick the tables. Relationships: `Fact_KPI_Monthly[KPI]` → `Dim_KPI[KPI]`; `Log_*[project]` → `Dim_Projects[Project]`. Next month, export again to the same path and press **Refresh**.

Tip: filter `Fact_KPI_Monthly` on `ScopeType = "Site"` for a site comparison, and `ScopeType = "Project"` for drill-down. Portfolio-level KPIs (resources, CI) only exist on the Portfolio rows.

## B. Live connection to the central database (connected mode)

The database has a read-only role, `bm_reporting`. Its members can read every row of every table and cannot change anything. An administrator creates a login for Power BI once, in the Supabase **SQL Editor**:

```sql
create role powerbi login password '<a long random password>' in role bm_reporting;
```

In Power BI: **Get data → PostgreSQL database**.
* Server: the **Session pooler** host and port from Supabase **Project Settings → Database → Connection string** (e.g. `aws-0-eu-west-3.pooler.supabase.com:5432`)
* Database: `postgres`
* User: `powerbi.<project-ref>` (pooler user names carry the project reference); password: as above.

Tables are named after the logs (`projects`, `costSchedule`, `gates`, `variations`, `production`, `explosives`, `safety`, …). Filter out `deleted = true` rows. KPI values are not stored in the database – compute them in Power BI from the logs, or use the export (A) for the official numbers.

Keep the password in a password manager. To revoke access: `drop role powerbi;`.
