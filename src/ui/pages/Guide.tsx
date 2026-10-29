import { LOGS } from '../../engine/schema.ts';
import { useI18n } from '../../i18n/index.ts';
import { useApp } from '../context.ts';

export function Guide() {
  const { go } = useApp();
  const { d } = useI18n();
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>{d.guide.title}</h1>
      <ol className="steps" style={{ padding: 0, marginTop: 16 }}>
        {d.guide.steps.map(([h, t]) => (
          <li key={h}><div><b>{h}</b><div className="muted">{t}</div></div></li>
        ))}
      </ol>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>{d.guide.changes}</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          {d.guide.changeList.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </div>
      <div className="card" style={{ marginTop: 20 }}>
        <h2>{d.nav.capture}</h2>
        <table>
          <tbody>
            {LOGS.map((l) => (
              <tr key={l.key} className="clickable" onClick={() => go('log', l.key)}>
                <td><b>{d.logs[l.key].title}</b></td>
                <td className="muted">{d.logs[l.key].desc}</td>
                <td className="faint" style={{ whiteSpace: 'nowrap' }}>{l.feeds.map((n) => '#' + n).join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
