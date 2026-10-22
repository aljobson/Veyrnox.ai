import { CLOUD_FILMS_PATH, CLOUD_FILM_LIMIT, CLOUD_FILM_UUID, parseCloudFilms } from '../src/lib/filmCloud';
import { MAX_FILM_BYTES } from '../src/lib/filmStudio';
declare const __dirname: string;
const { readFileSync } = require('fs');
const { resolve } = require('path');
const read = (path: string): string => readFileSync(resolve(__dirname, '../../..', path), 'utf8');
const list = read('app/api/v1/film-studio/route.js');
const single = read('app/api/v1/film-studio/[id]/route.js');
const sql = read('packages/db/schema/supabase/0360_film_studio_cloud.sql');
test('list metadata, response keys, route and cap match the phone', () => {
    expect(list.match(/select=([^&']+)/)![1].split(',')).toEqual(['id', 'name', 'shot_count', 'revision', 'created_at', 'updated_at']);
    expect(list).toContain('Response.json({ projects })');
    expect(Number(list.match(/&limit=(\d+)/)![1])).toBe(CLOUD_FILM_LIMIT);
    expect(parseCloudFilms({ projects: Array.from({ length: 25 }, () => ({ id: '11111111-1111-4111-8111-111111111111', revision: 1 })) })).toHaveLength(CLOUD_FILM_LIMIT);
    expect(CLOUD_FILMS_PATH).toBe('/api/v1/film-studio');
    expect(single).toContain('const { film_json, ...project } = rows[0]');
    expect(single).toContain('Response.json({ project, studio_json: film_json })');
});
test('both server reads retain their flag and authenticated route gates', () => {
    for (const source of [list, single]) {
        const get = source.slice(source.indexOf('export async function GET'), source.indexOf('\n}', source.indexOf('export async function GET')));
        expect(get).toContain('protectedRoute(request');
        expect(get).toContain("process.env.FILM_STUDIO_CLOUD_ENABLED !== 'true'");
        expect(get).toContain("new ApiError(404, 'NOT_FOUND'");
    }
});
test('SQL limits and UUID expression still match the parser', () => {
    expect(sql).toContain('char_length(btrim(name)) BETWEEN 1 AND 120');
    expect(sql).toContain(`octet_length(film_json) <= ${MAX_FILM_BYTES}`);
    expect(sql).toContain('shot_count BETWEEN 0 AND 200');
    const match = read('packages/security/input.js').match(/UUID_RE = \/(.+)\/([a-z]*);/)!;
    expect(match[1]).toBe(CLOUD_FILM_UUID.source); expect(match[2]).toBe(CLOUD_FILM_UUID.flags);
});
