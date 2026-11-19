import { readFileSync } from 'fs';
import { join } from 'path';

// QA: "That model is no longer available" ran edge to edge, with no side margins.
describe('Create: model unavailable state', () => {
    const source = readFileSync(join(__dirname, '../src/components/create/ModelUnavailable.tsx'), 'utf8');
    test('the failure text and buttons sit in a padded wrapper', () => {
        expect(source).toMatch(/failed: \{ padding: 16, gap: 12 \}/);
        expect(source).toMatch(/failed \? <View style=\{layout\.failed\}>/);
    });
});
