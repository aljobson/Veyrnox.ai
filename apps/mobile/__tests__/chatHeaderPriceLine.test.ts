import { readFileSync } from 'fs';
import { join } from 'path';

// QA: the model name and price wrapped mid-phrase ("... 2 credits per / reply") in the narrow chat header.
describe('chat header model and price', () => {
    const source = readFileSync(join(__dirname, '../src/app/(app)/chat/[id].tsx'), 'utf8');
    test('the model name and the price each take one line of their own', () => {
        expect(source).toMatch(/numberOfLines=\{1\} style=\{styles\.modelMeta\}>\{model\.name\}</);
        expect(source).toMatch(/tone="warning" numberOfLines=\{1\}>\{plural\('chat\.perReply', model\.credits_per_reply\)\}</);
        expect(source).not.toMatch(/model\.name\} · <Text/);
    });
});
