declare const require: (id: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const migratedScreens = [
    '../src/app/preview.tsx',
    '../src/components/editor/EditorLoadState.tsx',
    '../src/components/cinema/DiscoveryList.tsx',
    '../src/components/cinema/CinemaProfile.tsx',
    '../src/app/(app)/publish/drafts.tsx',
];

test.each(migratedScreens)('%s uses shared semantic Text instead of react-native Text', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    expect(source).toMatch(/import\s*\{[^}]*\bText\b[^}]*\}\s*from ['"][^'"]*\/ui(?:\/Text)?['"]/s);
    expect(source).not.toMatch(/import\s*\{[^}]*\bText\b[^}]*\}\s*from ['"]react-native['"]/s);
    expect(source).toContain('<Text');
});

test('Cinema profile actions keep stable accessible names while their visible labels become spinners', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/components/cinema/CinemaProfile.tsx'), 'utf8');
    expect(source).toContain("accessibilityLabel={t('cinemaCreator.createProfile')}");
    expect(source).toContain("accessibilityLabel={t('cinemaCreator.apply')}");
    expect(source.match(/accessibilityState=\{\{ busy,/g)).toHaveLength(2);
});
