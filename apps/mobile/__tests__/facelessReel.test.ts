import { FACELESS_REEL_FORMATS, FACELESS_REEL_PACING, FACELESS_REEL_PLATFORMS, FACELESS_REEL_PROMPT_MAX, FACELESS_SOUND_PROMPT, briefRoom, buildFacelessReelPrompt, facelessReelLaunch, facelessReelValidation, type FacelessReelValues } from '../src/lib/facelessReel';
declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const cases: FacelessReelValues[] = [];
for (const format of FACELESS_REEL_FORMATS) for (const pacing of FACELESS_REEL_PACING) for (const platform of FACELESS_REEL_PLATFORMS) for (const duration of [5, 10]) for (const hook of ['', 'Watch the sunrise!']) for (const sound of [false, true]) cases.push({ format, pacing, platform: platform.id, duration, hook, sound, topic: 'Original light moving across a mountain', originality: true, faceless: true });
const invalid = [
    { topic: 'short' }, { topic: 'x'.repeat(801) }, { hook: 'x'.repeat(161) }, { duration: 8 }, { duration: 10, sound: true }, { originality: false },
];
const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
import { facelessReelLaunch, facelessReelValidation } from './app/veyrnox/_lib/facelessReel.js';
import { OTHERS } from './lib/additionalModelCapabilities.js';
import messages from './lib/i18n/messages/app/en/faceless-reel.mjs';
const cases = ${JSON.stringify(cases)};
const t = Object.assign(key => key, { messages: Object.fromEntries(Object.keys(messages).map(k => [k,k])) });
console.log(JSON.stringify({max: OTHERS['market:wan/2-5-text-to-video'].inputs.prompt.max, sound: messages['app.facelessReel.soundPrompt'], launches: cases.map(v => facelessReelLaunch(v)), invalid: ${JSON.stringify(invalid)}.map(v => facelessReelValidation({...cases[0],...v},t))}));
`], { cwd: resolve(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' }, maxBuffer: 4 * 1024 * 1024 });
const ref = run.status === 0 ? JSON.parse(run.stdout) : null;
test('loads the real web contract and the sound prompt', () => {
    expect(run.stderr).toBe(''); expect(run.status).toBe(0);
    expect(ref.max).toBe(FACELESS_REEL_PROMPT_MAX); expect(ref.max).toBe(800); expect(FACELESS_SOUND_PROMPT).toBe(ref.sound);
});
test.each(cases.map((v, i) => [i, v] as const))('combination %s preserves launch, ordering and the live cap', (i, v) => {
    const fixed = buildFacelessReelPrompt({ ...v, topic: '', hook: '' });
    expect(fixed.length).toBeLessThanOrEqual(600);
    const launch = facelessReelLaunch(v);
    const web = ref.launches[i];
    expect({ ...launch, prompt: undefined }).toEqual({ modelId: web.model, aspect: web.aspect, durationSeconds: web.durationSeconds, ...(web.followup ? { followup: web.followup } : {}), prompt: undefined });
    const prompt = launch.prompt;
    const sections = ['Original ', v.hook ? 'Hook for later captions:' : 'Open on', 'Structure:', 'Pacing:', 'Delivery:', 'No identifiable face', 'Stable continuity', 'Silent visual master.'];
    const positions = sections.map(s => prompt.indexOf(s));
    expect(positions.every(p => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a,b) => a-b));
    expect(prompt).not.toContain('sunrise!.');
    const room = briefRoom(v, ref.max);
    const exact = { ...v, topic: 'b'.repeat(room), promptMax: ref.max };
    expect(room).toBeGreaterThan(0);
    expect(buildFacelessReelPrompt(exact)).toContain(exact.topic);
    const validSound = v.sound && v.duration === 10 ? 'soundDuration' : null;
    expect(facelessReelValidation(exact)).toBe(validSound);
    // Sound at 10s is an earlier validation error; turn it off to isolate the cap.
    expect(facelessReelValidation({ ...exact, sound: false, topic: exact.topic + 'b' })).toBe('promptLong');
});
test('validation retains web order; cap is checked last', () => {
    const expected = ['topicShort','topicLong','hookLong','duration','soundDuration','review'];
    invalid.forEach((v,i) => {
        expect(facelessReelValidation({ ...cases[0], ...v })).toBe(expected[i]);
        expect(ref.invalid[i]).toBe(`app.facelessReel.error.${expected[i]}`);
    });
    expect(facelessReelValidation({ ...cases[0], topic: 'b'.repeat(700), originality: false })).toBe('review');
});
test('unknown picks use the web first-option fallback and punctuation is stripped', () => {
    const v = { ...cases[0], format: 'unknown', pacing: 'unknown', platform: 'unknown', duration: 42, topic: 'A genuinely original scene!?', hook: 'Surprise!' };
    expect(facelessReelLaunch(v)).toMatchObject({ aspect: '9:16', durationSeconds: 5 });
    expect(buildFacelessReelPrompt(v)).toContain('Pacing: Measured.');
    expect(buildFacelessReelPrompt(v)).toContain('scene. Hook for later captions: Surprise.');
});
