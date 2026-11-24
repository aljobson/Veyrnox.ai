import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript-legacy';
import { act, createElement } from 'react';
import { createRoot } from 'test-renderer';
import { creativeFeature } from '../src/lib/creativeFeatures';
import { MENU_SECTIONS } from '../src/lib/menu';
import { rawText } from '../src/lib/i18n/translate';
import { MENU_ICONS } from '../src/lib/menuIcons';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import type { MusicSongDetail } from '../src/lib/music/types';

import { AUDIO_ICONS, AUDIO_PERFORMANCES, AUDIO_STUDIOS, audioTarget, fromCredits } from '../src/lib/audioHub';
import type { CatalogModel } from '../src/lib/media';
import { plural, t } from '../src/lib/i18n';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../src/components/ui', () => ({ Button: 'Button' }));

const model = (id: string, name: string, credits: number, modality = 'text-to-audio'): CatalogModel =>
    ({ id, name, modality, credits, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } }) as unknown as CatalogModel;

describe('audio hub targets', () => {
    test('falls back to Create before the catalog loads or when nothing fits', () => {
        expect(audioTarget('music', null)).toEqual({ pathname: '/create' });
        expect(audioTarget('speech', [])).toEqual({ pathname: '/create' });
        expect(audioTarget('dialogue', [model('x', 'Other', 1)])).toEqual({ pathname: '/create' });
    });
    test('lip sync always opens the lip-sync feature', () => {
        expect(audioTarget('dub', null)).toEqual({ pathname: '/features/[slug]', params: { slug: 'lip-sync' } });
    });
    test('music picks the cheapest music model, including one named music/SFX', () => {
        const models = [model('veyrnox-music', 'Veyrnox Music', 9), model('ace-step', 'ACE-Step (music/SFX)', 2), model('tts', 'Text to speech voice', 1)];
        expect(audioTarget('music', models)).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'ace-step' } });
        expect(audioTarget('speech', models)).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'tts' } });
    });
    test('dialogue picks a dialogue model', () => {
        expect(audioTarget('dialogue', [model('market:elevenlabs/text-to-dialogue-v3', 'Dialogue v3', 4)])).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'market:elevenlabs/text-to-dialogue-v3' } });
    });
});

test('Your music opens the library regardless of generation catalog', () => {
    expect(audioTarget('yourMusic', null)).toEqual({ pathname: '/music' });
    expect(audioTarget('yourMusic', [])).toEqual({ pathname: '/music' });
});

test('available music opens native create; unavailable retains generic target', () => {
    expect(audioTarget('music', null, true)).toEqual({ pathname: '/music/create' });
    expect(audioTarget('music', null, false)).toEqual({ pathname: '/create' });
});

const performances = [
    ['lipSync', 'lip-sync'], ['dubbing', 'video-dubbing'],
    ['talkingPhoto', 'ai-talking-photo-generator'], ['singingPhoto', 'singing-photo'],
] as const;

test.each(performances)('%s opens the existing %s workflow with or without a catalog', (id, slug) => {
    expect(creativeFeature(slug)).not.toBeNull();
    for (const models of [null, []]) {
        expect(audioTarget(id, models)).toEqual({ pathname: '/features/[slug]', params: { slug } });
    }
});

test('the eight visible hub rows have distinct semantic icons; dub remains only an alias', () => {
    expect(AUDIO_ICONS).toEqual({
        yourMusic: 'vinylRecord', music: 'audio', speech: 'microphone', dialogue: 'chatsCircle',
        lipSync: 'waveform', dubbing: 'monitorPlay', talkingPhoto: 'userSound', singingPhoto: 'pianoKeys',
    });
    expect(Object.keys(AUDIO_ICONS)).toEqual(['yourMusic', ...AUDIO_STUDIOS, ...AUDIO_PERFORMANCES]);
    expect(new Set(Object.values(AUDIO_ICONS)).size).toBe(8);
    for (const icon of Object.values(AUDIO_ICONS)) expect(MENU_ICONS[icon]).toBeDefined();
});

describe('destination-aware catalog prices', () => {
    test('unloaded, missing and unconfirmed catalogs never advertise prices', () => {
        for (const id of [...Object.keys(AUDIO_ICONS), 'dub'] as Parameters<typeof audioTarget>[0][]) {
            expect(fromCredits(null, id, false, true)).toBeNull();
            expect(fromCredits([], id, false, true)).toBeNull();
            expect(fromCredits([model('tts', 'Speech', 1)], id)).toBeNull();
        }
    });
    test.each(['music', 'speech', 'dialogue'] as const)('%s prices the cheapest eligible destination', id => {
        const models = [model('costly', id, 8), model('cheap', id, 2),
            { ...model('gated', id, 1), gated: true },
            { ...model('upload', id, 0), capabilities: { inputs: { prompt: {} }, media: { audio: { required: true } } } } as unknown as CatalogModel,
            model('invalid', id, NaN), model('negative', id, -1)];
        expect(audioTarget(id, models)).toEqual({ pathname: '/create/[modelId]', params: { modelId: 'cheap' } });
        expect(fromCredits(models, id, false, true)).toBe(2);
        expect(fromCredits(models, id, false, false)).toBeNull();
        expect(fromCredits([model('free', id, 0)], id, false, true)).toBe(0);
    });
    test.each([{ durations: [10, 5], expected: 12 }, { durations: [10], expected: 24 }])('video feature prices match the handoff for $durations', ({ durations, expected }) => {
        const video = { ...model('latentsync', 'Lip sync', 12, 'video'), durations };
        expect(fromCredits([video], 'lipSync', false, true)).toBe(expected);
        expect(fromCredits([video], 'dubbing', false, true)).toBe(expected);
    });
    test('catalog display estimates round fractional credits up before duration scaling', () => {
        expect(fromCredits([model('tts', 'Speech', 1.2)], 'speech', false, true)).toBe(2);
        const video = { ...model('latentsync', 'Lip sync', 1.2, 'video'), durations: [10] };
        expect(fromCredits([video], 'lipSync', false, true)).toBe(4);
    });
    test('native music and Your music never show the single-generation catalog quote', () => {
        const models = [model('suno', 'Music', 9)];
        expect(fromCredits(models, 'music', true, true)).toBeNull();
        expect(fromCredits(models, 'music', false, true)).toBe(9);
        for (const available of [true, false]) expect(fromCredits(models, 'yourMusic', available, true)).toBeNull();
    });
    test.each(performances)('%s prices the feature model rather than an unrelated cheaper model', (id, slug) => {
        const modelId = creativeFeature(slug)!.model;
        const models = [model('other', 'Video', 1, 'video'), model(modelId, 'Feature', 12, 'video')];
        expect(fromCredits(models, id, false, true)).toBe(12);
        expect(fromCredits(models, id, true, true)).toBe(12);
        expect(fromCredits(models, id, false, false)).toBeNull();
        expect(fromCredits(models.slice(0, 1), id, false, true)).toBeNull();
        expect(audioTarget(id, models)).toEqual({ pathname: '/features/[slug]', params: { slug } });
        for (const credits of [NaN, Infinity, -1]) {
            expect(fromCredits([model(modelId, 'Feature', credits)], id, false, true)).toBeNull();
        }
    });
});

const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

test('Audio exposes the native Beat maker as a first-class studio', () => {
    const audio = source('src/app/(app)/audio.tsx');
    expect(audio).toContain("['yourMusic', 'beats', ...AUDIO_STUDIOS]");
    expect(audio).toContain("const beats = mobileFeature('beats')");
    expect(audio).toContain('icon={beats.icon}');
    expect(audio).toContain("subtitle={t('beat.home.emptyBody')}");
    expect(audio).toContain('router.push(beats.href as never)');
});

// Evaluate only the selected prop expression, without mounting a native screen or starting playback.
function propExpression(file: string, tag: string, prop: string, contains?: string): string {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression: string | undefined;
    const visit = (node: ts.Node) => {
        if (expression !== undefined) return;
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(tree) === tag) {
            const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === prop);
            if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
                const candidate = attribute.initializer.expression?.getText(tree);
                if (candidate && (!contains || candidate.includes(contains))) expression = candidate;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(tree);
    if (!expression) throw new Error(`Missing ${tag}.${prop} in ${file}`);
    return expression;
}

test('hub subtitles and accessibility labels use singular/plural prices only when known', () => {
    const file = 'src/app/(app)/audio.tsx';
    const upperFirstSource = source(file).match(/^const upperFirst = (.+);$/m)![1];
    const formatter = ts.transpileModule(`const upperFirst = ${upperFirstSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const upperFirst = new Function(`${formatter}\nreturn upperFirst;`)();
    const subtitle = new Function('credits', 'text', 'id', 'plural', 'upperFirst', `return ${propExpression(file, 'ListRow', 'subtitle', 'credits')}`);
    const label = new Function('credits', 'text', 'id', 'plural', 'rawText', `return ${propExpression(file, 'ListRow', 'accessibilityLabel', 'credits')}`);
    const text = { speech: { title: 'Speech', blurb: 'Read a script.' } };
    for (const [credits, price, priceLine] of [[null, null, null], [1, 'from 1 credit', 'From 1 credit'], [2, 'from 2 credits', 'From 2 credits']] as const) {
        expect(subtitle(credits, text, 'speech', plural, upperFirst)).toBe(priceLine === null ? 'Read a script.' : `Read a script.\n${priceLine}`);
        expect(label(credits, text, 'speech', plural, rawText)).toBe(price === null ? 'Speech' : `Speech, ${price}`);
    }
    expect(label(1, text, 'speech', () => '\u2068from 1 credit\u2069', rawText)).toBe('Speech, from 1 credit');
});

test('every registered icon resolves to a real PNG, including the new 96px assets', () => {
    const matches = [...source('src/lib/menuIcons.ts').matchAll(/(\w+): require\('([^']+)'\)/g)];
    expect(matches.map(([, key]) => key)).toEqual(Object.keys(MENU_ICONS));
    for (const [, key, path] of matches) {
        expect(MENU_ICONS[key as keyof typeof MENU_ICONS]).toBeDefined();
        const png = readFileSync(resolve(__dirname, '../src/lib', path));
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    }
    for (const key of ['vinylRecord', 'microphone', 'headphones', 'chatsCircle', 'swap', 'crosshair', 'scissors', 'arrowsHorizontal', 'pauseCircle', 'seekBack', 'seekForward']) {
        const entry = matches.find(([, name]) => name === key)!;
        const png = readFileSync(resolve(__dirname, '../src/lib', entry[2]));
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 96]);
    }
});

test('literal icon props and badge assignments in the affected screens all exist', () => {
    const files = ['src/app/(app)/audio.tsx', ...['index', 'create', 'library'].map(name => `src/app/(app)/(tabs)/${name}.tsx`),
        'src/components/music/MusicSongActions.tsx', 'src/components/music/MusicPlayer.tsx'];
    const keys = new Set<string>();
    const collect = (node: ts.Node) => {
        if (ts.isStringLiteral(node)) keys.add(node.text);
        else if (ts.isJsxExpression(node) && node.expression) collect(node.expression);
        else if (ts.isConditionalExpression(node)) { collect(node.whenTrue); collect(node.whenFalse); }
    };
    for (const file of files) {
        const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node) => {
            if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'icon' && node.initializer) collect(node.initializer);
            if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'icon') collect(node.initializer);
            ts.forEachChild(node, visit);
        };
        visit(tree);
    }
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) expect(Object.hasOwn(MENU_ICONS, key)).toBe(true);
    expect(MENU_SECTIONS.flatMap(section => section.items).find(item => item.key === 'audio')).toMatchObject({ href: '/audio', icon: 'headphones' });
    const file = 'src/components/music/MusicPlayer.tsx';
    const icon = new Function('state', `return ${propExpression(file, 'Button', 'icon')}`);
    const label = new Function('state', 't', `return ${propExpression(file, 'Button', 'label')}`);
    for (const [state, key, expectedIcon] of [
        ['playing', 'music.pause', 'pauseCircle'], ['error', 'music.retry', undefined], ['held', 'music.retry', undefined],
        ['idle', 'music.play', 'play'], ['paused', 'music.play', 'play'], ['loading', 'music.play', 'play'],
    ] as const) {
        expect([label({ state }, t), icon({ state })]).toEqual([t(key), expectedIcon]);
    }
});

test('song-action buttons pin the eight semantic icons without changing their labels', async () => {
    const actions = ['download_mp3', 'add_section', 'replace_section', 'stems', 'crop', 'target_stem', 'extend', 'cover'];
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try {
        await act(async () => root.render(createElement(MusicSongActions, {
            song: { id: 'song', lifecycle_status: 'active', actions } as unknown as MusicSongDetail,
        })));
        const buttons = root.container.queryAll(node => typeof node.props.label === 'string');
        expect(buttons.map(button => [button.props.label, button.props.icon])).toEqual([
            ['musicExport.title', 'arrowDown'], ['musicSectionActions.add_section.title', 'plus'], ['musicSectionActions.replace_section.title', 'swap'],
            ['musicActions.stems.title', 'faders'], ['musicActions.crop.title', 'scissors'],
            ['musicTargetStems.title', 'crosshair'], ['musicGenerationActions.extend.title', 'arrowsHorizontal'],
            ['musicGenerationActions.cover.title', 'magicWand'],
        ].map(([key, icon]) => [t(key), icon]));
    } finally {
        await act(async () => root.unmount());
        environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
});

test('speech studio takes priority and prices its actual catalog model; missing or gated keeps generic fallback', () => {
    const studio = model('minimax-speech-2.6-hd', 'MiniMax Speech 2.6 HD', 6);
    const cheaper = model('other-speech', 'Speech', 2);
    expect(audioTarget('speech', [cheaper, studio])).toEqual({ pathname: '/speech' });
    expect(fromCredits([cheaper, studio], 'speech', false, true)).toBe(6);
    expect(fromCredits([cheaper, studio], 'speech', false, false)).toBeNull();
    for (const models of [[cheaper], [cheaper, { ...studio, gated: true }]]) {
        expect(audioTarget('speech', models)).toEqual({ pathname: '/create/[modelId]', params: { modelId: cheaper.id } });
        expect(fromCredits(models, 'speech', false, true)).toBe(2);
    }
});


test('native dialogue takes priority and prices its exact model; unavailable retains fallback', () => {
    const studio = model('elevenlabs-dialogue', 'Dialogue', 6);
    const fallback = model('other-dialogue', 'Dialogue', 2);
    expect(audioTarget('dialogue', [fallback, studio])).toEqual({ pathname: '/dialogue' });
    expect(fromCredits([fallback, studio], 'dialogue', false, true)).toBe(6);
    expect(fromCredits([studio], 'dialogue', false, false)).toBeNull();
    expect(audioTarget('dialogue', [fallback, { ...studio, gated: true }])).toEqual({ pathname: '/create/[modelId]', params: { modelId: fallback.id } });
});
