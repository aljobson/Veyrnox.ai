import { FilmError, filmErrorText } from '../src/lib/filmError';
import { t } from '../src/lib/i18n';

test('shows the message of a FilmError, which is already a translated sentence', () => {
    expect(filmErrorText(new FilmError('Every test needs an output.'))).toBe('Every test needs an output.');
});

test.each([
    ['a code', new Error('not_authenticated')],
    ['a library error', new TypeError("Cannot read properties of null (reading 'x')")],
    ['a non-error value', 'boom'],
])('hides %s behind the fallback sentence', (_name, err) => {
    expect(filmErrorText(err)).toBe(t('common.error'));
});

test('uses the caller fallback key when given', () => {
    expect(filmErrorText(new Error('x'), 'filmWorkspace.saveFailed')).toBe(t('filmWorkspace.saveFailed'));
});
