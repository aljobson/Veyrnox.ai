import { readFileSync } from 'fs';
import { join } from 'path';
import { photoHintAround, phonePhotoHints, PHOTO_HINT_MAX } from '../src/lib/templatePhotoHintText';

// QA 12.1: the line above "Photo 1" ended mid-word ("body proportio") with no ellipsis.
const long = '@Image1 — exact face, hairstyle, body proportions AND exact clothing from reference photo, keep every detail identical and photorealistic';
describe('photo slot reference line', () => {
    it('keeps the whole sentence the token sits in', () => {
        const source = `A plane lands. ${long}. The sea is calm.`;
        expect(photoHintAround(source, source.indexOf('@Image1'), 7)).toBe(`${long}.`);
    });
    it('shortens a very long sentence at word boundaries with ellipses, never mid-word', () => {
        const filler = 'word '.repeat(80);
        const source = `${filler}@Image1 is the pilot ${filler}end.`;
        const hint = photoHintAround(source, source.indexOf('@Image1'), 7);
        expect(hint).toContain('@Image1');
        expect(hint.startsWith('…')).toBe(true);
        expect(hint.endsWith('…')).toBe(true);
        expect(hint.length).toBeLessThanOrEqual(PHOTO_HINT_MAX + 2);
        for (const part of hint.replace(/…/g, '').trim().split(' ')) expect(['word', '@Image1', 'is', 'the', 'pilot']).toContain(part);
    });
    it('returns one line per slot and nothing for an unbound contract', () => {
        const source = 'Face @image2 here. Hat @image1 there.';
        const map = [{ token: '@image2', slot: 1, offset: 5 }, { token: '@image1', slot: 2, offset: 23 }];
        expect(phonePhotoHints({ class: 'bound', slotCount: 2, sourcePrompt: source, tokenMap: map })).toEqual(['Face @image2 here.', 'Hat @image1 there.']);
        expect(phonePhotoHints({ class: 'free', slotCount: 1, sourcePrompt: '', tokenMap: [] })).toEqual([]);
    });
    it('both template screens use it and the slot text is not line-clipped', () => {
        for (const file of ['../src/app/(app)/templates/[id].tsx', '../src/app/(app)/create/[modelId].tsx']) {
            const source = readFileSync(join(__dirname, file), 'utf8');
            expect(source).toContain('hints={phonePhotoHints(contract)}');
        }
        const slots = readFileSync(join(__dirname, '../src/components/TemplatePhotoSlots.tsx'), 'utf8');
        expect(slots).toMatch(/hints\[index\] \? <Text>\{hints\[index\]\}<\/Text>/);
        expect(slots).not.toMatch(/numberOfLines/);
    });
});
