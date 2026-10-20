import { APERTURES, CAMERAS, DEFAULT_CINEMA, FOCAL_LENGTHS, LENSES, PROMPT_MAX, buildCinemaPrompt, cinemaSuffix, sanitizeCinema } from '../src/lib/cinemaCamera';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

// The web file is plain ESM with object literals; read the table of each export out of its text.
const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'cinema.js'), 'utf8');
function table(name: string): Record<string, string> {
    const body = web.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? '';
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/^\s*'?([^':\n]+?)'?:\s*'([^']*)',?$/gm)) out[m[1] as string] = m[2] as string;
    return out;
}

describe('the Cinema camera matches the web', () => {
    test.each([['CAMERAS', CAMERAS], ['LENSES', LENSES], ['APERTURES', APERTURES]] as const)('%s', (name, mine) => {
        const theirs = table(name);
        expect(Object.keys(theirs).length).toBeGreaterThan(2);
        expect(mine).toEqual(theirs);
    });
    test('FOCAL_LENGTHS', () => {
        const theirs = Object.fromEntries(Object.entries(table('FOCAL_LENGTHS')));
        expect(Object.fromEntries(Object.entries(FOCAL_LENGTHS).map(([k, v]) => [k, v]))).toEqual(theirs);
    });
    test('the default and the limit', () => {
        expect(web).toContain("camera: 'Studio Digital S35'");
        expect(web).toContain("lens: 'Premium Modern Prime'");
        expect(web).toContain('focal: 35');
        expect(web).toContain("aperture: 'f/1.4'");
        expect(web).toContain(`PROMPT_MAX = ${PROMPT_MAX}`);
    });
});

describe('camera prompt', () => {
    test('appends the camera description', () => {
        expect(buildCinemaPrompt('a fox', DEFAULT_CINEMA)).toBe('a fox, shot on a Super 35 studio digital camera, using a premium modern prime lens at 35mm (natural cinematic perspective), aperture f/1.4, shallow depth of field, creamy bokeh, cinematic lighting, natural color science, high dynamic range');
    });
    test('an empty prompt stays empty', () => expect(buildCinemaPrompt('  ', DEFAULT_CINEMA)).toBe(''));
    test('the words are cut, never the camera, so it fits the limit', () => {
        const out = buildCinemaPrompt('x'.repeat(5000), DEFAULT_CINEMA);
        expect(out.length).toBeLessThanOrEqual(PROMPT_MAX);
        expect(out.endsWith(cinemaSuffix(DEFAULT_CINEMA))).toBe(true);
    });
    test('unknown values are dropped', () => {
        expect(cinemaSuffix({ camera: 'x', lens: 'y', focal: 1, aperture: 'z' })).toBe('cinematic lighting, natural color science, high dynamic range');
    });
    test('a restored setting is kept only when it is a known choice', () => {
        expect(sanitizeCinema({ camera: 'Classic 16mm Film', lens: 'nope', focal: 85, aperture: 'f/11' })).toEqual({ camera: 'Classic 16mm Film', lens: DEFAULT_CINEMA.lens, focal: 85, aperture: 'f/11' });
        expect(sanitizeCinema(null)).toEqual(DEFAULT_CINEMA);
    });
});
