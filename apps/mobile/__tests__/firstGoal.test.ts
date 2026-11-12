declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

import { FIRST_GOALS, FIRST_GOAL_SLOT, firstGoalTarget, parseFirstGoal, serializeFirstGoal } from '../src/lib/firstGoal';

describe('the first-goal question', () => {
    test('covers every creation area plus "not sure"', () => {
        expect([...FIRST_GOALS]).toEqual(['image', 'video', 'audio', 'edit', 'publish', 'unsure']);
    });

    test('lists the same goals, in the same order, as the web card', () => {
        const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'veyrnox', '_lib', 'firstGoal.js'), 'utf8');
        const ids = [...web.matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
        expect(ids).toEqual([...FIRST_GOALS]);
        expect(web).toContain(`veyrnox.firstGoal.v`);
        expect(FIRST_GOAL_SLOT).toBe('veyrnox.firstGoal.v1');
    });

    test('creation goals open the starter form, Edit and Publish go to their tabs, "not sure" stays', () => {
        expect(firstGoalTarget('image')).toEqual({ kind: 'create', goal: 'image' });
        expect(firstGoalTarget('video')).toEqual({ kind: 'create', goal: 'video' });
        expect(firstGoalTarget('audio')).toEqual({ kind: 'create', goal: 'audio' });
        expect(firstGoalTarget('edit')).toEqual({ kind: 'tab', href: '/editor' });
        expect(firstGoalTarget('publish')).toEqual({ kind: 'tab', href: '/publish' });
        expect(firstGoalTarget('unsure')).toEqual({ kind: 'stay' });
        expect(firstGoalTarget('nonsense')).toEqual({ kind: 'stay' });
    });

    test('the stored choice is versioned and anything unreadable reads as "never chose"', () => {
        expect(parseFirstGoal(serializeFirstGoal('audio'))).toBe('audio');
        expect(parseFirstGoal(serializeFirstGoal('skipped'))).toBe('skipped');
        for (const bad of [null, undefined, '', '{', '[]', '{"version":2,"goal":"audio"}', '{"version":1,"goal":"rm -rf"}', '{"version":1}']) {
            expect(parseFirstGoal(bad)).toBeNull();
        }
    });

    test('the storage name uses only the characters the file cache allows', () => {
        expect(FIRST_GOAL_SLOT).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    test('an unknown goal is refused instead of stored', () => {
        expect(() => serializeFirstGoal('rm -rf' as never)).toThrow('unknown first goal');
    });
});
