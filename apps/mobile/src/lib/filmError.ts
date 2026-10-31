import { t } from './i18n';

// An error whose message is already a translated sentence meant for the person. Only these reach the screen.
export class FilmError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FilmError';
    }
}

// Anything else (a storage error, a library error, a code like not_authenticated) becomes the fallback sentence.
export function filmErrorText(err: unknown, fallbackKey = 'common.error'): string {
    return err instanceof FilmError ? err.message : t(fallbackKey);
}
