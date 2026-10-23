declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('the native LLM chat mirrors the website workspace', () => {
    const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf8');
    const conversation = read('app', '(app)', 'chat', '[id].tsx');
    const deck = read('components', 'chat', 'ChatComposerDeck.tsx');

    test('uses the website hierarchy instead of the old mobile control stack', () => {
        expect(conversation).toContain('<ChatComposerDeck');
        expect(conversation).toContain("t('chat.workspace.title')");
        expect(conversation).toContain('SKILL_GROUPS.filter');
        expect(conversation).toContain('showManage');
        expect(conversation).not.toContain('<ReplyOptionsBar');
        expect(conversation).not.toContain('<AttachStrip');
    });

    test('keeps creation modes, reply setup, attachments and price in one command deck', () => {
        expect(deck).toContain("{ id: 'chat'");
        expect(deck).toContain("{ id: 'image'");
        expect(deck).toContain("{ id: 'video'");
        expect(deck).toContain("{ id: 'audio'");
        expect(deck).toContain('props.onMake(item.id)');
        expect(deck).toContain('<AttachStrip');
        expect(deck).toContain('embedded');
        expect(deck).toContain("plural('chat.sendPriceShort', props.price)");
        expect(deck).toContain('minHeight: MIN_TARGET');
    });

    test('opens the matching Create mode from each media tab', () => {
        const panel = read('components', 'chat', 'MakePanel.tsx');
        expect(panel).toContain('initialKind?: Kind');
        expect(panel).toContain('setKind(initialKind)');
    });
});
