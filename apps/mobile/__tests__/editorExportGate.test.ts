import { editorExportGate } from '../src/lib/editorExportGate';
import en from '../src/lib/i18n/messages/en/editorSimple';

describe('editor export gate (QA build 50, F09)', () => {
    it('says up front that export is not in the app when the build switch is off', () => {
        const gate = editorExportGate(false);
        expect(gate.available).toBe(false);
        expect(en[gate.hintKey]).toBe('Not in the app yet. Use veyrnox.ai');
        expect(en[gate.messageKey]).toMatch(/^Export isn't in the app yet\. Your edit is saved/);
    });

    it('keeps the render hint when the build switch is on', () => {
        const gate = editorExportGate(true);
        expect(gate.available).toBe(true);
        expect(en[gate.hintKey]).toBe('Render and save your video');
    });

    it('is off in this build unless the env switch is exactly "true"', () => {
        jest.isolateModules(() => {
            const previous = process.env.EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED;
            delete process.env.EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { EDITOR_EXPORT_GATE } = require('../src/lib/editorExportGate');
            expect(EDITOR_EXPORT_GATE.available).toBe(false);
            if (previous !== undefined) process.env.EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED = previous;
        });
    });
});

describe('editor export banner is never cut off', () => {
    it('does not cap the problem banner height in the editor', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const source: string = require('fs').readFileSync(require('path').join(__dirname, '../src/components/editor/FullEditorScreen.tsx'), 'utf8');
        const banner = source.split('\n').find(line => line.includes('styles.problem}'));
        expect(banner).toBeDefined();
        expect(banner).not.toMatch(/numberOfLines/);
    });
});

describe('production builds ship the export switch (QA 8.14)', () => {
    it('sets EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED in production and does not override it in production-simulator', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const eas = require('../eas.json').build;
        expect(eas.production.env.EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED).toBe('true');
        expect(eas['production-simulator'].extends).toBe('production');
        expect(eas['production-simulator'].env.EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED).toBeUndefined();
    });
});
