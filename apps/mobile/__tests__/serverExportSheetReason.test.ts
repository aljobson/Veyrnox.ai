import { readFileSync } from 'fs';
import { join } from 'path';

// QA 6.2: a clip longer than its file was reported as "only on another device".
describe('server export sheet blocked-clip header', () => {
    const source = readFileSync(join(__dirname, '../src/components/editor/ServerExportSheet.tsx'), 'utf8');
    test('the "only on another device" line shows only when a clip is notOnPhone', () => {
        expect(source).toMatch(/state\.blocked\.some\(item => item\.reason === 'notOnPhone'\) \? <Text style=\{styles\.text\}>\{t\('editorServerExport\.notOnPhone'\)\}<\/Text> : null/);
    });
    test('every blocked clip still prints its own reason', () => {
        expect(source).toMatch(/state\.blocked\.map\(/);
        expect(source).toMatch(/t\(`editorServerExport\.\$\{item\.reason\}`/);
    });
});
