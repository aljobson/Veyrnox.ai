// ADR-0344: Film Studio is hidden from every entry point. The code and the saved data stay.
import { FILM_STUDIO_ENABLED, isFilmStudioLink } from '../src/lib/filmStudioSwitch';
import { phoneStarts } from '../src/lib/firstProfile';
import { SCREENS, screenEntries } from '../src/lib/siteSearch';
import { redirectSystemPath } from '../src/app/+native-intent';

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const source = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

jest.mock('expo-secure-store', () => ({ AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1, getItem: () => null, setItem: () => undefined, deleteItemAsync: async () => undefined }));
jest.mock('../src/lib/media', () => ({ fetchCatalog: jest.fn(async () => []) }));
jest.mock('../src/lib/presets', () => ({ fetchPresets: jest.fn(async () => []), presetHref: jest.fn() }));

describe('Film Studio is hidden', () => {
    test('the switch is off', () => expect(FILM_STUDIO_ENABLED).toBe(false));

    test('the Explore home never lists it, whatever the first-run answers', () => {
        for (const role of ['creator', 'business', 'pro', 'hobbyist', 'beginner', null]) {
            for (const goal of ['video', 'edit', null]) expect(phoneStarts(role, goal)).not.toContain('film');
        }
    });

    test('search does not offer it', () => {
        expect(screenEntries((k) => k).map((e) => e.href)).not.toContain('/film');
        expect(SCREENS.some((s) => s.id === 'film')).toBe(true); // the data stays for a restore
    });

    test('links to it open Home, never a hidden screen', () => {
        for (const link of ['ai.veyrnox.app://film', 'ai.veyrnox.app://film-studio', 'ai.veyrnox.app:///film/workspace', '/film', '/film/shot/abc', 'https://veyrnox.ai/app/film-studio?castMember=x']) {
            expect(isFilmStudioLink(link)).toBe(true);
            expect(redirectSystemPath({ path: link, initial: true })).toBe('/');
        }
        for (const link of ['/filmography', '/create', 'ai.veyrnox.app://cinema', 'https://veyrnox.ai/app/create']) expect(isFilmStudioLink(link)).toBe(false);
    });

    test('no screen shows an Open Film Studio link, and the Library keeps the masters list', () => {
        for (const file of [['app', '(app)', 'chat', 'skills.tsx'], ['components', 'chat', 'ConversationEmpty.tsx'], ['app', '(app)', 'library', 'files.tsx']]) {
            const text = source(...file);
            expect(text).toContain('FILM_STUDIO_ENABLED');
        }
        const files = source('app', '(app)', 'library', 'files.tsx');
        expect(files).toContain("kind: 'masters'");
        expect(files).toContain("kind === 'masters' && FILM_STUDIO_ENABLED");
    });
});
