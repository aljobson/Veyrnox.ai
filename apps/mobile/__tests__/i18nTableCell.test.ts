// The localization list is a markdown table written by scripts/sync-web-i18n.mjs. A cell must escape the backslash
// before the pipe, or a value ending in a backslash would swallow the escape for the next character.
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const { join } = require('path') as { join: (...p: string[]) => string };

const source = readFileSync(join(__dirname, '..', 'scripts', 'escape-cell.mjs'), 'utf8');
const escapeCell = new Function(source.replace(/^export const escapeCell =/m, 'return'))() as (v: unknown) => string;

describe('escapeCell', () => {
    test('leaves ordinary text alone and writes numbers as text', () => {
        expect(escapeCell('Sign in to create')).toBe('Sign in to create');
        expect(escapeCell(5)).toBe('5');
    });
    test('escapes a pipe so it cannot end the cell', () => {
        expect(escapeCell('a | b')).toBe('a \\| b');
    });
    test('escapes a backslash first, so the pipe escape cannot be cancelled by one', () => {
        expect(escapeCell('a\\b')).toBe('a\\\\b');
        expect(escapeCell('a\\|b')).toBe('a\\\\\\|b');
        expect(escapeCell('ends with \\')).toBe('ends with \\\\');
    });
});
