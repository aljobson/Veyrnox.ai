declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

describe('the native LLM chat mirrors the website workspace', () => {
    const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...parts), 'utf8');
    const conversation = read('app', '(app)', 'chat', '[id].tsx');
    const workspaceEntry = read('app', '(app)', 'chat', 'index.tsx');
    const library = read('components', 'chat', 'ChatLibraryScreen.tsx');
    const deck = read('components', 'chat', 'ChatComposerDeck.tsx');
    const attachments = read('components', 'chat', 'AttachStrip.tsx');

    test('uses the website hierarchy instead of the old mobile control stack', () => {
        expect(conversation).toContain('<ChatComposerDeck');
        expect(conversation).toContain("t('chat.workspace.title')");
        expect(conversation).toContain('SKILL_GROUPS.filter');
        expect(conversation).toContain('showManage');
        expect(conversation).not.toContain('<ReplyOptionsBar');
        expect(conversation).not.toContain('<AttachStrip');
    });

    test('opens the working conversation before the management library', () => {
        expect(workspaceEntry).toContain("router.replace({ pathname: '/chat/[id]'");
        expect(workspaceEntry).toContain("router.replace('/chat/new')");
        expect(workspaceEntry).not.toContain('Search chats');
        expect(conversation).toContain("router.push('/chat/library')");
        expect(library).toContain('Your workspace');
        expect(library).toContain('New chat');
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
        expect(attachments).toContain('MENU_ICONS.image');
        expect(attachments).toContain("accessibilityLabel={t('chat.attach.libraryLabel')}");
        expect(attachments).toContain('MENU_ICONS.paperclip');
        expect(attachments).toContain("accessibilityLabel={t('chat.attach.photosLabel')}");
    });

    test('opens the matching Create mode from each media tab', () => {
        const panel = read('components', 'chat', 'MakePanel.tsx');
        expect(panel).toContain('initialKind?: Kind');
        expect(panel).toContain('setKind(initialKind)');
    });
});
