import { categoryLabel } from '../src/lib/presetCategoryLabel';
import { t } from '../src/lib/i18n';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const source = (file: string): string => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// QA: the Cinematic audio templates showed the key `audioTemplates.cat.CINEMATIC` on their chip and cards,
// because both places built the key themselves and only Music, Voice-over and Sound effects have one.
test.each(['MUSIC', 'VOICE-OVER', 'SOUND FX', 'CINEMATIC'])('audio category %s reads as copy, never as a key', category => {
    const label = categoryLabel(category);
    expect(label).toBeTruthy();
    expect(label).not.toContain('audioTemplates.cat.');
    expect(label).not.toContain('presets.cat.');
});

test('Cinematic audio templates reuse the translated Cinematic label', () => {
    expect(categoryLabel('CINEMATIC')).toBe(t('presets.cat.CINEMATIC'));
    expect(categoryLabel('MUSIC')).toBe(t('audioTemplates.cat.MUSIC'));
});

test.each([
    'src/components/templates/AudioTemplateCard.tsx',
    'src/app/(app)/create/presets.tsx',
])('%s labels audio categories through categoryLabel, not a hand-built key', file => {
    const text = source(file);
    expect(text).toContain('categoryLabel(');
    expect(text).not.toMatch(/t\(`audioTemplates\.cat\./);
});
