declare const __dirname: string;
import { CATEGORIES, groupById, swatchOf } from '../src/lib/oddlingsBuilder';
import { controlKind, pictureTileUrl, SLIDER_SCALES, sliderPosition, sliderValue, swatchBands } from '../src/lib/oddlingsCatalog';
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const { existsSync } = require('fs');
const repo = resolve(__dirname, '../../..');
const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { controlKind, sliderPosition, sliderValue, SLIDER_SCALES, SWATCHES } from './app/veyrnox/_lib/oddlingCatalog.js';
import { pictureTileSrc } from './app/veyrnox/_lib/oddlingPictureTiles.js';
import { CHARACTER_GROUPS } from './app/veyrnox/_lib/character.js';
console.log(JSON.stringify(CHARACTER_GROUPS.map(g=>({id:g.id,kind:controlKind(g.id),tiles:g.options.map(([o])=>[o,pictureTileSrc(g.id,o)]),steps:[0,1,2.6,(SLIDER_SCALES[g.id]?.length||0)+1].map(n=>sliderValue(g.id,n)),positions:['unknown',...(SLIDER_SCALES[g.id]||[])].map(v=>sliderPosition(g.id,{[g.id]:v}))}))));
`], { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
const ref = JSON.parse(run.stdout);
test('every phone group and tile matches the web and an existing image', () => {
    expect(run.status).toBe(0);
    for (const id of new Set(CATEGORIES.flatMap(c => c.groupIds))) {
        const web = ref.find((g: any) => g.id === id);
        expect(controlKind(id)).toBe(web.kind);
        if (web.kind === 'tiles') for (const [value] of groupById(id)!.options) {
            const path = web.tiles.find(([o]: string[]) => o === value)[1];
            expect(path).toBeTruthy(); expect(pictureTileUrl(id, value)).toBe(`https://veyrnox.ai${path}`);
            expect(existsSync(resolve(repo, `public${path}`))).toBe(true);
        }
    }
    expect(pictureTileUrl('hair', 'unknown')).toBeNull();
});
test('steps clamp and unknown picks map to Any exactly as on the web', () => {
    for (const [id, scale] of Object.entries(SLIDER_SCALES)) {
        const web = ref.find((g: any) => g.id === id);
        expect([0, 1, 2.6, scale.length + 1].map(n => sliderValue(id, n))).toEqual(web.steps);
        expect(['unknown', ...scale].map(value => sliderPosition(id, { [id]: value }))).toEqual(web.positions);
    }
});
test('flat and gradient swatches preserve each hex stop in order', () => {
    expect(swatchBands('#abc')).toEqual(['#abc']);
    let count = 0;
    for (const id of ['skin_tone', 'hair_color', 'eye_color']) for (const [value] of groupById(id)!.options) {
        const swatch = swatchOf(id, value)!;
        if (swatch.includes('gradient')) { expect(swatchBands(swatch)).toEqual(swatch.match(/#[a-fA-F0-9]+/g)); count++; }
    }
    expect(count).toBeGreaterThanOrEqual(3);
});
