import en from '../src/lib/i18n/messages/en';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const { visibleStrings } = require('../scripts/visible-strings.cjs');
const root = path.join(__dirname, '..', 'src');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry: any) => entry.isDirectory() ? files(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
// Dev-only WebView probe reports browser/native diagnostic strings, never production navigation.
const exceptions = new Set([
    'components/dev/EditorSpikeHarness.tsx',
    'lib/cinemaEditorialData.ts', // Imported film/episode names are creator content, not app copy.
]);
// Generated legal documents have their own translation/parity guard and must remain verbatim.
const included = (file: string) => !exceptions.has(file) && !file.startsWith('lib/legal/generated/');
// These tables carry catalog keys to their renderers, not display strings. Only real English keys qualify.
const keyTables = new Set(['app/(app)/(tabs)/publish.tsx', 'app/(app)/publish/workflows.tsx', 'lib/helpGuidesData.ts']);
test.each([...files(path.join(root, 'app')), ...files(path.join(root, 'components')), ...files(path.join(root, 'lib'))].map(f => path.relative(root, f)).filter(included))('%s has no hard-coded visible English', (file) => {
    expect(visibleStrings(fs.readFileSync(path.join(root, file), 'utf8'), file, { objectKeys: keyTables.has(file) ? Object.keys(en) : [] })).toEqual([]);
});
test.each([
    'Alert.alert("Error", "Try again", [{ text: "Cancel" }])', 'const x = { title: "Title", text: "Body", message: "Message" };',
    '<Text>Hello there</Text>', '<Button label="Continue" />', '<TextInput placeholder="Your name" />',
    '<Button accessibilityLabel={busy ? "Please wait" : "Continue"} />',
    '<View accessibilityHint={`Open ${name}`} />', '<Text>{"Found " + count}</Text>',
])('rejects new visible wording: %s', source => expect(visibleStrings(source).length).toBeGreaterThan(0));
test('accepts translated expressions, brands, identifiers and punctuation', () => {
    expect(visibleStrings('<Text>{t("home.title")}</Text><Text>Veyrnox.ai</Text><Button label={name} /><Text>…</Text>')).toEqual([]);
});
