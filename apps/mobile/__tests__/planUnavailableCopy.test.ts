import { t } from '../src/lib/i18n';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('Publish plan unavailable copy', () => {
    test('has an English string', () => {
        expect(t('plan.unavailable')).toBe('The Publish Plan is not available right now.');
    });

    test('the Publish tab reads it from the translation table, not a literal', () => {
        const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/(tabs)/publish.tsx'), 'utf8');
        expect(source).toContain("t('plan.unavailable')");
        expect(source).not.toContain('The Publish Plan is not available right now.');
    });
});
