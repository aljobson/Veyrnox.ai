declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as {
    readdirSync: (p: string) => string[];
    readFileSync: (p: string, e: 'utf8') => string;
    statSync: (p: string) => { isDirectory: () => boolean };
};
const { join } = require('path') as { join: (...p: string[]) => string };

// expo-router's <Link asChild> throws in development when its child's style is an array ("pass an array of styles to a
// child of <Slot>"). The Library's empty state did exactly that and the whole screen went blank for any new account.
// Wrap such a style in StyleSheet.flatten, as the sign-in screen does.
const files = (dir: string): string[] =>
    fs.readdirSync(dir).flatMap((name: string) => {
        const path = join(dir, name);
        return fs.statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [];
    });

describe('<Link asChild> children', () => {
    test('never take an array style', () => {
        const offenders: string[] = [];
        for (const file of files(join(__dirname, '..', 'src'))) {
            const source = fs.readFileSync(file, 'utf8');
            for (const match of source.matchAll(/<Link\b[^>]*\basChild\b[^>]*>\s*<(\w+)((?:[^>]|=>)*?)>/gs)) {
                if (/\bstyle=\{\s*\[/.test(match[2])) offenders.push(`${file.split('/src/')[1]}: <${match[1]}>`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
