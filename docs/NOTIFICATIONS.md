# Notifications

## Desktop (every laptop, no setup)

When a sync or an edit brings a **new** alert, BenchMark shows a Windows notification. Clicking it opens the record.

* **Settings → Notifications:** *critical only* (default), *critical and serious*, or *off*. The choice is per laptop.
* An alert is notified once. The same situation getting worse (serious → critical) notifies again.
* The first start after installing records the existing alerts silently, so nothing floods.
* Critical alerts are lost-time injuries, unaccounted detonators / boosters / connectors, a client authorisation waiting more than 96 h, and cumulative CPI below 0.90 or SPI below 0.90 two periods running.

## E-mail (server, for managers who do not open the app every day)

The `bm-notify` Supabase Edge Function runs the app's own alert engine on the central data. It e-mails each person what their role allows: executives and admins get every site, PMs get their sites.

| Run | Schedule | Content |
|---|---|---|
| `?mode=critical` | every hour | only **new** critical alerts (what was sent is remembered in `notifications_sent`) |
| `?mode=digest` | every morning | all critical and serious alerts, grouped by site |

Each user chooses in **Settings → Notifications**: the hourly e-mail, the daily digest, and English or French.

### Setup (once, ~20 minutes)

1. **Resend** (e-mail sending): create an account at https://resend.com and verify your domain (e.g. `corica.com`). Then create an API key.
2. **Deploy the function** with the Supabase CLI, from the repository:
   ```bash
   supabase link --project-ref <project-ref>
   ```
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx BM_MAIL_FROM="BenchMark <alerts@corica.com>" BM_CRON_SECRET=<a long random string>
   ```
   ```bash
   supabase functions deploy bm-notify --no-verify-jwt
   ```
   (`--no-verify-jwt` is safe: the function refuses any call without the `x-bm-secret` header.)
3. **Try it without sending.** Set `BM_DRY_RUN=1` as a secret, call the function once, and check the preview. Then unset `BM_DRY_RUN`:
   ```bash
   curl -X POST "https://<project-ref>.supabase.co/functions/v1/bm-notify?mode=digest" -H "x-bm-secret: <secret>"
   ```
4. **Schedule it** in the Supabase **SQL Editor**. Enable the `pg_cron` and `pg_net` extensions first: Database → Extensions.
   ```sql
   select cron.schedule('bm-notify-critical', '5 * * * *', $$
     select net.http_post(url := 'https://<project-ref>.supabase.co/functions/v1/bm-notify?mode=critical',
                          headers := jsonb_build_object('x-bm-secret', '<secret>'))
   $$);
   select cron.schedule('bm-notify-digest', '0 6 * * *', $$
     select net.http_post(url := 'https://<project-ref>.supabase.co/functions/v1/bm-notify?mode=digest',
                          headers := jsonb_build_object('x-bm-secret', '<secret>'))
   $$);
   ```
   Times are UTC, which is local time in Guinea, Mali, Senegal, Côte d'Ivoire and Burkina Faso.

The function's shared code (`supabase/functions/_shared/benchmark`) is a copy of `src/engine`, `src/notify` and the dictionaries. After changing those, run `npm run gen:functions` and redeploy. CI fails if the copy is out of date.
