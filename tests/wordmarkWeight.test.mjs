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

test('stand-alone brand labels print as bold VEYRNOX.ai, running text is untouched', () => {
  const web = read('app/veyrnox/_components/BrandName.js');
  assert.match(web, /font-black[^`]*`[^>]*>VEYRNOX\.ai</);
  for (const p of ['app/veyrnox/app/publish/page.js', 'app/veyrnox/app/publish/inbox/page.js', 'app/veyrnox/_components/music/MusicPreviewShell.jsx']) {
    assert.match(read(p), /<BrandName>Veyrnox\.ai<\/BrandName>/, p);
    assert.doesNotMatch(read(p), />Veyrnox\.ai (Publish|Music)</, p);
  }
  assert.match(read('app/veyrnox/_components/music/MusicPublicPrompt.jsx'), /withBrandName\(t\('music\.brand'\)\)/);
  assert.match(read('apps/mobile/src/components/BrandText.tsx'), /displayBlack[^]*VEYRNOX\.ai/);
  assert.match(read('apps/mobile/src/app/(app)/developers.tsx'), /brandText\(t\('developers\.kicker'\)\)/);
  assert.match(read('apps/mobile/src/app/(app)/mcp.tsx'), /brandText\(t\('mcp\.kicker'\)\)/);
});
