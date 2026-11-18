import { readFileSync } from 'fs';
import { resolve } from 'path';

import { resolutionVariants } from '../src/lib/modelVariants';
import type { CatalogModel } from '../src/lib/media';

const row = (id: string, credits: number) => ({ id, credits } as unknown as CatalogModel);
const both = [row('kling-3.0-i2v', 32), row('kling-3.0-standard-i2v', 24), row('wan-2.5-kie', 17)];

describe('resolution variants', () => {
    test('either Kling 3.0 image-to-video model offers 720p then 1080p, each from its own catalog row', () => {
        for (const id of ['kling-3.0-i2v', 'kling-3.0-standard-i2v']) {
            const variants = resolutionVariants(id, both);
            expect(variants.map((v) => v.label)).toEqual(['720p', '1080p']);
            expect(variants.map((v) => v.model.credits)).toEqual([24, 32]);
        }
    });
    test('a switched-off variant is not offered and an unrelated model shows no choice', () => {
        expect(resolutionVariants('kling-3.0-i2v', [row('kling-3.0-i2v', 32)])).toEqual([]);
        expect(resolutionVariants('wan-2.5-kie', both)).toEqual([]);
        expect(resolutionVariants(undefined, both)).toEqual([]);
    });
    test('the groups match the web Create page', () => {
        const web = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/modelVariants.js'), 'utf8');
        const mobile = readFileSync(resolve(__dirname, '../src/lib/modelVariants.ts'), 'utf8');
        const pairs = (text: string) => [...text.matchAll(/label: '([^']+)', id: '([^']+)'/g)].map((m) => `${m[1]}=${m[2]}`);
        expect(pairs(mobile)).toEqual(pairs(web));
        expect(pairs(web).length).toBe(2);
    });
});
