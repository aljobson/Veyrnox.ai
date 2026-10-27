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
// Function styles also lose their layout through Slot. Pass one static object (or StyleSheet.flatten).
const files = (dir: string): string[] =>
    fs.readdirSync(dir).flatMap((name: string) => {
        const path = join(dir, name);
        return fs.statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [];
    });
const invalidChildren = (source: string): string[] =>
    [...source.matchAll(/<Link\b[^>]*\basChild\b[^>]*>\s*<(\w+)((?:[^>]|=>)*?)>/gs)]
        .filter((match) => /\bstyle=\{\s*[\[(]/.test(match[2]))
        .map((match) => `<${match[1]}>`);

describe('<Link asChild> children', () => {
    test('detects both rejected forms and accepts flattened styles', () => {
        expect(invalidChildren('<Link href="/create" asChild><Pressable style={[styles.row, styles.border]} /></Link>')).toEqual(['<Pressable>']);
        expect(invalidChildren('<Link href="/create" asChild><Pressable style={({ pressed }) => [styles.row, pressed && styles.down]} /></Link>')).toEqual(['<Pressable>']);
        expect(invalidChildren('<Link href="/create" asChild><Pressable style={StyleSheet.flatten([styles.row, styles.border])} /></Link>')).toEqual([]);
    });
    test('never take an array or function style', () => {
        const offenders: string[] = [];
        for (const file of files(join(__dirname, '..', 'src'))) {
            const source = fs.readFileSync(file, 'utf8');
            offenders.push(...invalidChildren(source).map((child) => `${file.split('/src/')[1]}: ${child}`));
        }
        expect(offenders).toEqual([]);
    });
});
