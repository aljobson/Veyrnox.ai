/* eslint-disable @typescript-eslint/no-require-imports */
declare const __dirname: string;
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
test('real software Skia compiles and renders the complete mobile stack', () => {
    const output = execFileSync('node', [resolve(__dirname, '../scripts/proof-live-edit-skia.mjs')], { encoding: 'utf8', timeout: 60000 });
    expect(output).toContain('combined PNG/preview equality (0-byte tolerance)');
}, 65000);
