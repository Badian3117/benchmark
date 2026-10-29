import { useEffect, useState } from 'react';
import { todayISO } from '../../engine/dates.ts';
import { DEFAULT_TARGETS, type Dataset } from '../../engine/kpis.ts';
import { LOGS, defaultSettings, type LogKey, type Row } from '../../engine/schema.ts';
import { desktop, pickFile, saveBytes } from '../../data/persistence.ts';
import { Store } from '../../data/store.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';

async function loadExcelJS() {
  const mod = await import('exceljs');
  return (mod as unknown as { default?: typeof import('exceljs') }).default ?? (mod as unknown as typeof import('exceljs'));
}

export function DataPage() {
  const { store, ds, tracking, period, filter, today } = useApp();
  const i = useI18n();
  const d = i.d;
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState('');
  useEffect(() => { desktop?.dataLocation().then(setLocation); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg([]);
    try { await fn(); } catch (e) { setMsg([{ kind: 'err', text: i.t(d.data.failed, { s: String((e as Error)?.message ?? e) }) }]); }
    setBusy(false);
  };

  const importXlsx = (mode: 'replace' | 'merge') => run(async () => {
    const f = await pickFile(['xlsx', 'xlsm'], 'Excel');
    if (!f) return;
    const ExcelJS = await loadExcelJS();
    const { importWorkbook } = await import('../../io/importXlsx.ts');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer);
    const rep = importWorkbook(wb, todayISO());
    const summary = Object.entries(rep.counts).map(([k, n]) => `${d.logs[k as LogKey].title} ${n}`).join(', ');
    if (mode === 'replace') {
      if (!confirm(d.data.replaceConfirm)) return;
      // keep the local user name across a replace
      rep.dataset.settings.userName = ds.settings.userName;
      store.replaceAll(rep.dataset, `import ${f.name}`);
    } else {
      // merge: rows whose human id (code) already exists keep their existing record id, so they are updated, not duplicated
      const merged: Partial<Record<LogKey, Row[]>> = {};
      for (const def of LOGS) {
        merged[def.key] = rep.dataset.logs[def.key].map((r) => {
          const ex = def.codeField && !def.repeatCode ? ds.logs[def.key].find((x) => x[def.codeField!] === r[def.codeField!]) : undefined;
          return ex ? { ...r, id: ex.id } : r;
        });
      }
      store.mergeRows(merged, `merge ${f.name}`);
    }
    const out: typeof msg = [{ kind: 'ok', text: i.t(d.data.imported, { s: summary }) }];
    if (rep.missingSheets.length) out.push({ kind: 'warn', text: i.t(d.data.missing, { s: rep.missingSheets.join(', ') }) });
    if (rep.unknownColumns.length) out.push({ kind: 'warn', text: i.t(d.data.unknown, { s: rep.unknownColumns.join(', ') }) });
    setMsg(out);
  });

  const exportXlsx = () => run(async () => {
    const ExcelJS = await loadExcelJS();
    const { buildWorkbook } = await import('../../io/exportXlsx.ts');
    const scopeLabel = [filter.site, filter.pm, filter.project].filter(Boolean).join(' · ') || d.common.portfolio;
    const wb = buildWorkbook(ExcelJS, { ds, tracking, i18n: i, scopeLabel, asOf: period.asOf });
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const p = await saveBytes(`BenchMark_${period.month.slice(0, 7)}.xlsx`, buf, 'xlsx', 'Excel');
    if (p) setMsg([{ kind: 'ok', text: p }]);
  });

  const backup = () => run(async () => {
    await store.flush();
    const p = await saveBytes(`BenchMark_backup_${today}.sqlite`, store.exportBytes(), 'sqlite', 'BenchMark database');
    if (p) setMsg([{ kind: 'ok', text: p }]);
  });

  const restore = () => run(async () => {
    const f = await pickFile(['sqlite', 'db'], 'BenchMark database');
    if (!f || !confirm(d.data.restoreConfirm)) return;
    const restored = await Store.fromBytes(f.bytes);
    store.replaceAll(restored, `restore ${f.name}`);
    setMsg([{ kind: 'ok', text: f.name }]);
  });

  const sample = () => run(async () => {
    if (!confirm(d.data.sampleConfirm)) return;
    const data = (await import('../../data/sample.json')).default as unknown as Dataset;
    store.replaceAll({ ...structuredClone(data), settings: { ...structuredClone(data.settings), userName: ds.settings.userName } }, 'sample data');
  });

  const reset = () => run(async () => {
    if (!confirm(d.data.resetConfirm)) return;
    const logs = Object.fromEntries(LOGS.map((l) => [l.key, []])) as unknown as Dataset['logs'];
    store.replaceAll({ settings: { ...defaultSettings(today), userName: ds.settings.userName }, targets: structuredClone(DEFAULT_TARGETS), logs }, 'reset');
  });

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>{d.data.title}</h1>
      {msg.map((m, k) => <div key={k} className={`notice ${m.kind}`} style={{ marginTop: 12 }}>{m.text}</div>)}
      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>{d.data.importXlsx}</h2>
          <p className="muted">{d.data.importHint}</p>
          <div className="toolbar">
            <button className="btn primary" disabled={busy} onClick={() => importXlsx('replace')}>{d.data.replace}</button>
            <button className="btn" disabled={busy} onClick={() => importXlsx('merge')}>{d.data.merge}</button>
          </div>
        </div>
        <div className="card">
          <h2>{d.data.exportXlsx}</h2>
          <p className="muted">{d.data.exportHint}</p>
          <button className="btn primary" disabled={busy} onClick={exportXlsx}>{d.data.exportXlsx}</button>
        </div>
        <div className="card">
          <h2>{d.data.backup}</h2>
          <p className="muted">{d.data.backupHint}</p>
          <div className="toolbar">
            <button className="btn primary" disabled={busy} onClick={backup}>{d.data.backup}</button>
            <button className="btn" disabled={busy} onClick={restore}>{d.data.restore}</button>
            {desktop && <button className="btn" onClick={() => desktop!.showDataFolder()}>{d.data.showFolder}</button>}
          </div>
          {location && <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>{d.data.location}: {location}</p>}
        </div>
        <div className="card">
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn" disabled={busy} onClick={sample}>{d.data.sample}</button>
            <button className="btn danger" disabled={busy} onClick={reset}>{d.data.reset}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
