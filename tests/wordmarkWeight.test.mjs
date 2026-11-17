import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Veyrnox.ai wordmark prints at weight 900 (Archivo Black) on the site and in the mobile app.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('web Logo wordmark is font-black', () => {
  const src = read('app/veyrnox/_components/Logo.js');
  assert.match(src, /font-black[^"]*"[^>]*>\s*<span>VEYRNOX<\/span>/);
});

test('web error screen wordmark is weight 900', () => {
  assert.match(read('components/ErrorRecovery.jsx'), /fontWeight: 900\s*\}\}>Veyrnox\.ai</);
});

test('mobile Logo uses the Archivo 900 face, and it is loaded', () => {
  assert.match(read('apps/mobile/src/components/Logo.tsx'), /fonts\.displayBlack/);
  assert.match(read('apps/mobile/src/theme.ts'), /displayBlack: 'Archivo_900Black'/);
  assert.match(read('apps/mobile/src/components/ui/FontCatalog.ts'), /Archivo_900Black/);
});

test('mobile intro lockup letters are weight 900', () => {
  assert.match(read('apps/mobile/src/components/MascotWordmark.tsx'), /word: \{[^}]*fontWeight: '900'/);
});
