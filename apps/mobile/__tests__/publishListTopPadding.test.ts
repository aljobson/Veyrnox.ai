import { readFileSync } from 'fs';
import { join } from 'path';

// QA 12.6/12.7: the intro line sat flush under the header line on these list screens.
const SCREENS = ['queues', 'activity', 'autolists', 'contacts'];

describe('Publish list screens keep a gap under the header', () => {
    test.each(SCREENS)('%s has top padding on its screen style', (name) => {
        const source = readFileSync(join(__dirname, `../src/app/(app)/publish/${name}.tsx`), 'utf8');
        const screen = source.match(/^\s*screen: \{[^}]*\}/m)?.[0] ?? '';
        expect(screen).toMatch(/paddingTop: (1[0-9]|[2-9][0-9])/);
    });
});
