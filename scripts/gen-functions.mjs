// Copies the shared engine / i18n / notify sources into supabase/functions/_shared so the
// Edge Function deploys self-contained. Run after changing src/engine, src/notify or the
// dictionaries: npm run gen:functions (CI fails if the copy is out of date).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'supabase/functions/_shared/benchmark';
rmSync(OUT, { recursive: true, force: true });
const copy = (dir, files) => {
  mkdirSync(join(OUT, dir), { recursive: true });
  for (const f of files) {
    const src = readFileSync(join('src', dir, f), 'utf8');
    writeFileSync(join(OUT, dir, f), `// GENERATED from src/${dir}/${f} by scripts/gen-functions.mjs – do not edit.\n` + src);
  }
};
copy('engine', readdirSync('src/engine').filter((f) => f.endsWith('.ts')));
copy('notify', readdirSync('src/notify').filter((f) => f.endsWith('.ts')));
copy('i18n', ['en.ts', 'fr.ts']);
console.log('copied to', OUT);
