import { useMemo } from 'react';
import { alerts as buildAlerts, projectHealth } from '../../engine/analysis.ts';
import { computeTracking, KPIS } from '../../engine/kpis.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';

/** One row per site: the portfolio roll-up executives read first. */
export function SitesOverview() {
  const { ds, month, period, today, setFilter, go } = useApp();
  const i = useI18n();
  const d = i.d.sites;
  const rows = useMemo(() => {
    const sites = [...ds.settings.lists.sites];
    if (ds.logs.projects.some((p) => !p.site)) sites.push('');
    return sites.map((site) => {
      const codes = new Set(ds.logs.projects.filter((p) => (p.site ?? '') === site).map((p) => String(p.code)));
      const tr = computeTracking(ds, month, codes, today);
      const idx = tr.reportIdx;
      const count = (r: string) => KPIS.filter((k) => k.projectScoped && tr.rows[k.key][idx]?.rag === r).length;
      const health = projectHealth(ds, period, codes);
      const al = buildAlerts(ds, tr, period, codes);
      return {
        site, projects: codes.size, active: ds.logs.projects.filter((p) => codes.has(String(p.code)) && p.status === 'Active').length,
        g: count('GREEN'), a: count('AMBER'), r: count('RED'),
        hg: health.filter((h) => h.health === 'GREEN').length, ha: health.filter((h) => h.health === 'AMBER').length, hr: health.filter((h) => h.health === 'RED').length,
        cpi: tr.rows.cumCpi[idx]?.value ?? null, spi: tr.rows.cumSpi[idx]?.value ?? null,
        crit: al.filter((x) => x.severity === 'critical').length, ser: al.filter((x) => x.severity === 'serious').length,
      };
    });
  }, [ds, month, period, today]);
  const ratio = (v: number | null, key: 'cumCpi' | 'cumSpi') => {
    if (v === null) return <span className="faint">—</span>;
    const t = ds.targets[key];
    return <b style={{ color: v < t.amber ? 'var(--critical-ink)' : v < t.target ? 'var(--warning-ink)' : undefined }}>{i.num(v, 2)}</b>;
  };
  const triple = (g: number, a: number, r: number) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="chip GREEN" style={{ padding: '1px 7px' }}>{g}</span>{' '}
      <span className="chip AMBER" style={{ padding: '1px 7px' }}>{a}</span>{' '}
      <span className="chip RED" style={{ padding: '1px 7px' }}>{r}</span>
    </span>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{d.title} – {i.monthLabel(month, true)}</h1>
          <p className="muted">{d.intro}</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{d.site}</th><th className="num">{d.projects}</th><th className="num">{d.active}</th><th>{d.kpis}</th><th>{d.health}</th>
              <th className="num">{d.cpi}</th><th className="num">{d.spi}</th><th className="num">{d.alerts}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.site} className="clickable" onClick={() => { setFilter({ site: r.site || undefined }); go('dashboard'); }}>
                <td><b>{r.site || d.noSite}</b></td>
                <td className="num">{r.projects}</td>
                <td className="num">{r.active}</td>
                <td>{triple(r.g, r.a, r.r)}</td>
                <td>{triple(r.hg, r.ha, r.hr)}</td>
                <td className="num">{ratio(r.cpi, 'cumCpi')}</td>
                <td className="num">{ratio(r.spi, 'cumSpi')}</td>
                <td className="num">{r.crit} / {r.ser}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
