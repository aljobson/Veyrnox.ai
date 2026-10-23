declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('the native Create workspace mirrors the website contract', () => {
    const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(app)', 'create', '[modelId].tsx'), 'utf8');

    test('leads with the Studio, stage, prompt, references and settings hierarchy', () => {
        expect(screen).toContain("t('create.workspace.eyebrow')");
        expect(screen).toContain("t('create.workspace.stageHelp')");
        expect(screen).toContain("t('create.workspace.references')");
        expect(screen).toContain("t('create.workspace.prompt')");
        expect(screen).toContain("t('create.workspace.settings')");
    });

    test('keeps price, balance, refund and the paid action together', () => {
        expect(screen).toContain("t('create.workspace.total')");
        expect(screen).toContain("t('create.workspace.balance'");
        expect(screen).toContain("t('create.workspace.generate'");
        expect(screen).toContain("t('create.workspace.refund')");
        expect(screen).toContain('confirmedCredits: unit');
    });

    test('keeps references, drafts, model options, character and cinema controls', () => {
        expect(screen).toContain('<SourcePicker');
        expect(screen).toContain('<CreateOptions');
        expect(screen).toContain('<CharacterPanel');
        expect(screen).toContain('<CameraPanel');
        expect(screen).toContain('saveDraft(draft)');
        expect(screen).toContain('minHeight: MIN_TARGET');
    });
});
