# Setting up the BenchMark server (Supabase)

BenchMark laptops work offline and sync with one central database. This guide sets it up once; it takes about an hour. You need: a Supabase account, and for Microsoft sign-in, an administrator of CORICA's Microsoft Entra ID (Azure AD).

## 1. Create the project

1. Go to https://supabase.com → **New project**.
2. Organisation: CORICA. Name: `benchmark`. Region: **West EU (Paris)** – the closest to Guinea and Mali.
3. Choose a strong database password and store it in your password manager.
4. Plan: use **Pro** for production. The Free plan pauses a project after a week without activity and has no daily backups.

## 2. Create the database

1. In the project: **SQL Editor → New query**.
2. Paste the whole content of `supabase/migrations/20261029000000_benchmark.sql` and press **Run**. It is idempotent: running it again is harmless. **After every BenchMark upgrade, run the new version of this file again** – it adds the new tables and columns without touching your data.
   (With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.)
3. **Database → Tables**: you should see `projects`, `costSchedule`, … `sites`, `profiles`, and a shield icon (row-level security enabled) on every table.

## 3. Sign-in

### Email + password
**Authentication → Sign In / Providers → Email**: enabled. Users are created by the admin (step 5), so they don't need email confirmation.

### Microsoft 365
In the Microsoft Entra admin center (your IT administrator):
1. **App registrations → New registration**. Name: `BenchMark`. Supported account types: **this organisation only** (single tenant).
2. Redirect URI, type **Web**: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. **Certificates & secrets → New client secret**. Copy the value.
4. Note the **Application (client) ID** and **Directory (tenant) ID**.

In Supabase, **Authentication → Sign In / Providers → Azure**: enable it, then paste the client ID and the secret. Set **Azure Tenant URL** to `https://login.microsoftonline.com/<tenant-id>`, which restricts sign-in to CORICA accounts.

### Redirect for the desktop app
**Authentication → URL Configuration → Redirect URLs → Add URL**: `benchmark://auth/callback`.

> Anyone who signs in for the first time gets the role **"waiting for approval"**: they can see no data until an admin approves them. So leaving sign-up open is safe.

## 4. The first administrator

1. **Authentication → Users → Add user → Create new user**: your email and a password. Tick *Auto confirm*.
2. **SQL Editor**:
   ```sql
   update profiles set role = 'admin', owner_name = 'Project Controls' where email = 'you@corica.com';
   ```
From now on, everything else is done in BenchMark under **Users & sites**.

## 5. Sites and users

In BenchMark (signed in as admin) → **Users & sites**:

* **Sites**: the CORICA sites are pre-written in `supabase/seed/sites.sql` – paste it in the SQL Editor and run it once (or add sites one by one here). The site name is what appears in the data and the filters (e.g. `KGM – Kouroussa`). Never delete a site: untick *Active* instead, so its history stays.
* **Users**: create each person in Supabase (step 4.1), or let them sign in with Microsoft. Then in BenchMark set:
  * **Role**: *Administrator* (Project Controls), *Executive* (MD, CEO, COO, group managers: read every site), or *Project manager*.
  * **Name in the logs**: exactly the name used as *Project manager* on their projects (e.g. `A. Camara`). This is what lets a PM edit their own projects.
  * **Sites** (PMs only): the sites they work on. They read everything on those sites and edit only their own projects.

A user's role and sites are read when they sign in; after a change they sign out and in again.

## 6. Point the laptops at the server

The anon key is public by design: the database only answers what the signed-in user's role allows.

**Option A – pre-configured installer (recommended for 10+ PMs).** On GitHub: repository **Settings → Secrets and variables → Actions → Variables**. Add:
* `BM_SUPABASE_URL` = `https://<project-ref>.supabase.co`
* `BM_SUPABASE_ANON_KEY` = the **anon public** key (Supabase **Project Settings → API**)

The next build produces an installer that opens straight on the sign-in screen.

**Option B – per laptop.** In BenchMark: **Settings → Server connection**. Paste the URL and the anon key, then **Save and connect**.

## 7. Load the existing data

For each site's Excel tracker: sign in as admin → **Import / export**. Choose the **Site** the workbook belongs to, then click **Add to existing data**. The app checks every record and syncs it. Anything the server refuses is listed under **Sync**.

## 8. Month-end

* **Settings → Lock periods through** (admin): from the next sync, nobody but an admin can change records in the locked months. The database enforces this, not just the app.
* **Backups**: Supabase Pro keeps daily backups (Point-in-time recovery is an add-on). Every laptop also keeps 30 days of local backups in its data folder.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Waiting for approval" after sign-in | The admin has not set a role yet (step 5). |
| A PM sees the site but cannot edit their project | Their *Name in the logs* does not exactly match the project's *Project manager*. |
| Sync shows "Refused by the server – record has no site" | Resources, CI initiatives and actions without a project need a site. |
| Sync shows "period locked" | The record is in a locked month; ask an admin. |
| Microsoft sign-in opens the browser but the app does not continue | `benchmark://auth/callback` is missing from the Redirect URLs (step 3). |
