declare const require: (id: string) => any;
declare const __dirname: string;
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('the handoff contract contains no builder report or review process metadata', () => {
    expect(existsSync(resolve(__dirname, '../HANDOFF-FIXES-REPORT.md'))).toBe(false);
    const adr = readFileSync(resolve(__dirname, '../../../docs/adr/0304-mobile-handoff-fixes.md'), 'utf8');
    expect(adr).toMatch(/^Status: Accepted\./m);
    expect(adr).not.toMatch(/HANDOFF-FIXES-REPORT|advisory review|plan SHA|1a5586ad|as requested|the plan/i);
});
