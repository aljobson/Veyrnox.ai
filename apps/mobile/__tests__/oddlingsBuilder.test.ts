import { PROMPT_MAX, MOTIONS, SCENES, buildStudioPrompt, buildCharacterPrompt, changePick, groupById, GROUPS, oddlingIdentity, optionLabel, randomizeAll, randomizeStyle, sanitizePicks, type Picks } from '../src/lib/oddlingsBuilder';
import { ODDLINGS } from '../src/lib/oddlings';

declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process') as { spawnSync: (cmd: string, args: string[], opts: object) => { status: number | null; stdout: string; stderr: string } };
const { join } = require('path') as { join: (...p: string[]) => string };

// The same generator as scripts/oddlings-web-reference.mjs.
const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Ref { cases: { id: string; sanitized: Picks; portrait: string; motion: string; edited: Picks; editedPrompt: string; style: Picks[]; all: Picks[] }[]; messy: Picks[]; empty: string }

describe('drift: the app builder matches the web builder', () => {
    const run = spawnSync(process.execPath, [join(__dirname, '..', 'scripts', 'oddlings-web-reference.mjs')], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' }, maxBuffer: 64 * 1024 * 1024 });
    const ref = (run.status === 0 ? JSON.parse(run.stdout) : null) as Ref | null;

    test('the web reference ran', () => {
        expect(run.stderr).toBe('');
        expect(ref?.cases).toHaveLength(ODDLINGS.length);
    });

    test('every character: sanitised picks and both prompts are identical', () => {
        ref!.cases.forEach((c, i) => {
            const picks = ODDLINGS[i].picks as Picks;
            expect(ODDLINGS[i].id).toBe(c.id);
            expect(sanitizePicks(picks)).toEqual(c.sanitized);
            expect(buildStudioPrompt({ picks })).toBe(c.portrait);
            expect(buildStudioPrompt({ picks, mode: 'motion', motionId: MOTIONS[i % MOTIONS.length].id, scene: SCENES[i % SCENES.length] })).toBe(c.motion);
        });
    });

    test('hand edits settle conflicts and trim the canon the same way', () => {
        ref!.cases.forEach((c, i) => {
            let edited: Picks = { ...(ODDLINGS[i].picks as Picks) };
            for (let k = 0; k < 6; k += 1) {
                const g = GROUPS[(i * 7 + k * 13) % GROUPS.length];
                edited = changePick(edited, g.id, g.options[(i + k) % g.options.length][0]);
            }
            expect(edited).toEqual(c.edited);
            expect(buildStudioPrompt({ picks: edited })).toBe(c.editedPrompt);
        });
    });

    test('Randomize styling and Surprise me give the same picks for the same dice', () => {
        ref!.cases.forEach((c, i) => {
            const picks = ODDLINGS[i].picks as Picks;
            [1, 2, 3].forEach((s, n) => {
                expect(randomizeStyle(picks, seeded(i * 10 + s))).toEqual(c.style[n]);
                expect(randomizeAll(picks, seeded(i * 10 + s))).toEqual(c.all[n]);
            });
        });
    });

    test('messy input is cleaned the same way', () => {
        const messy: unknown[] = [null, 'x', [], {}, { character_type: 'Nope', oddling_name: '  Ada\n\tLovelace  ', oddling_obsession: 'x'.repeat(300), oddling_voice: 'Dry oracle', oddling_show: 'Bad' },
            { brows: 'Thick', face_features: 'Tiny Brows', everyday_accessories: 'Glasses', accessories: 'Tiny Monocle' }];
        messy.forEach((m, n) => expect(sanitizePicks(m)).toEqual(ref!.messy[n]));
        expect(buildStudioPrompt({ picks: {} })).toBe(ref!.empty);
    });
});

describe('the builder', () => {
    test('every prompt starts with the original-adult base and fits the limit', () => {
        for (const o of ODDLINGS) {
            const p = buildStudioPrompt({ picks: o.picks as Picks });
            expect(p.startsWith('Portrait of an original adult character, not a real person')).toBe(true);
            expect(p.length).toBeLessThanOrEqual(PROMPT_MAX);
        }
        expect(buildCharacterPrompt('y'.repeat(5000), {})).toHaveLength(PROMPT_MAX);
    });

    test('the character is never cut to fit the creator text', () => {
        const picks = { character_type: 'Human', oddling_name: 'Ada' } as Picks;
        expect(buildCharacterPrompt('hello', picks)).toContain('fictional creator named Ada');
    });

    test('a pick that contradicts an everyday pick is dropped', () => {
        const next = changePick({ face_features: 'Tiny Brows' }, 'brows', 'Thick');
        expect(next).toEqual({ brows: 'Thick' });
    });

    test('Surprise me leaves limb and skin-condition picks as they were', () => {
        const kept = { left_arm: 'Cute Prosthetic', skin_conditions: 'Burns' } as Picks;
        for (let s = 1; s <= 5; s += 1) {
            const out = randomizeAll(kept, seeded(s));
            expect(out.left_arm).toBe('Cute Prosthetic');
            expect(out.skin_conditions).toBe('Burns');
        }
    });

    test('display labels come from the web wording', () => {
        expect(optionLabel('body_type', 'Fat')).toBe('Full-bodied');
        expect(groupById('hair')?.options.length).toBeGreaterThan(10);
        expect(oddlingIdentity({ oddling_name: 'Ada' })).toEqual(['fictional creator named Ada']);
    });
});

// Deliberate phone-only exception: lone surrogates are repaired until web parity.
// All 72 reference cases and every non-surrogate messy case above remain unchanged.
test('phone repairs lone-surrogate input instead of preserving the web code unit', () => {
    expect(sanitizePicks({ oddling_name: 'Pip\uD800' }).oddling_name).toBe('Pip\uFFFD');
});
