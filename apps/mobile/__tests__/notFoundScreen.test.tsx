import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import NotFound from '../src/app/+not-found';
import { t } from '../src/lib/i18n';

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({ Redirect: (props: unknown) => { mockRedirect(props); return null; } }));
const mockEmpty = jest.fn();
jest.mock('../src/components/EmptyState', () => ({ EmptyState: (props: unknown) => { mockEmpty(props); return null; } }));

describe('a link with no screen (QA 2.11)', () => {
    let root: Root;
    beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockRedirect.mockClear(); mockEmpty.mockClear(); root = createRoot(); });
    afterEach(async () => { await act(async () => root.unmount()); });

    test('says the link could not be opened, with one way back to the start; never a silent redirect', async () => {
        await act(async () => root.render(<NotFound />));
        expect(mockRedirect).not.toHaveBeenCalled();
        expect(mockEmpty).toHaveBeenCalledWith({
            title: t('notFound.title'),
            body: t('notFound.body'),
            actionLabel: t('notFound.action'),
            href: '/',
        });
        expect(t('notFound.title')).not.toBe('notFound.title');
    });

    test.each(['ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh'])('%s has all three strings', (locale) => {
        const messages = require(`../src/lib/i18n/messages/app/${locale}`).default;
        for (const key of ['notFound.title', 'notFound.body', 'notFound.action']) expect(typeof messages[key]).toBe('string');
    });
});
