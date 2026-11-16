import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
const root = join(__dirname, '..', 'src', 'app', '(app)', 'chat');
test('the conversation header Chats button opens a real static library route', () => {
    const thread = readFileSync(join(root, '[id].tsx'), 'utf8');
    const target = /accessibilityLabel=\{t\('chat\.openchats'\)\}[^\n]*onPress=\{\(\) => router\.push\('(\/chat\/[a-z]+)'\)\}/.exec(thread);
    expect(target).not.toBeNull();
    const name = target![1].split('/')[2];
    expect(name).not.toBe('[id]');
    expect(existsSync(join(root, `${name}.tsx`))).toBe(true);
});
