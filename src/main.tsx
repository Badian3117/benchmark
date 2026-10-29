import { createRoot } from 'react-dom/client';
import { Store } from './data/store.ts';
import { App } from './ui/App.tsx';
import type { Dataset } from './engine/kpis.ts';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

Store.open()
  .then(async (store) => {
    // first start: offer the sample portfolio so the dashboard is not empty
    const empty = Object.values(store.ds.logs).every((rows) => rows.length === 0);
    if (empty && new URLSearchParams(location.search).get('empty') === null) {
      const data = (await import('./data/sample.json')).default as unknown as Dataset;
      store.replaceAll(structuredClone(data), 'sample data (first start)');
    }
    // make sure the last edits reach the disk when the window closes
    window.benchmarkFlush = () => store.flush();
    root.render(<App store={store} />);
  })
  .catch((e) => {
    root.render(<pre style={{ padding: 24, color: '#a32626' }}>BenchMark could not open its database:{'\n'}{String(e?.stack ?? e)}</pre>);
  });

declare global {
  interface Window {
    benchmarkFlush?: () => Promise<void>;
  }
}
