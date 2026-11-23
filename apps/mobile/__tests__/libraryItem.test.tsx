import { canReuse } from '../src/lib/libraryView';
import { lipSyncSourceHref } from '../src/lib/creativeReuse';
import type { ComponentProps } from 'react';
import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { LibraryItem } from '../src/components/LibraryItem';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';
import { getAppearance, tokensForScheme } from '../src/theme';
import { formatLocale, t } from '../src/lib/i18n';
import type { Job } from '../src/lib/media';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/components/library/LibraryMedia', () => ({ LibraryMedia: () => null }));
void [RN.View, RN.Text, RN.StyleSheet, RN.Pressable];
const NOW = Date.parse('2026-10-29T12:00:00Z');
const job: Job = { job_id: 'a', state: 'succeeded', credits: 3, model_id: 'm', created_at: '2026-10-01', has_asset: true };
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
async function render(over: Partial<Job> = {}, retentionKnown = true) {
    await act(async () => root.render(
        <AppearanceContext.Provider value={{ ...getAppearance(), theme: 'light' }}>
            <LibraryItem job={{ ...job, ...over }} retentionKnown={retentionKnown} now={NOW} name="Model" kind="image" grid starred={false}
                canSchedule={false} canReuse={false} onOpen={() => {}} onStar={() => {}} onSchedule={() => {}} onReuse={() => {}} />
        </AppearanceContext.Provider>,
    ));
}
test.each([
    [{ has_asset: false }, 'library.fileUnavailable'],
    [{ asset_expires_at: null }, 'library.keptDefault'],
] as const)('finished file %p has a notice in its accessible card label', async (over, key) => {
    await render(over);
    const notice = t(key);
    expect(text(notice)).toHaveLength(1);
    expect(RN.StyleSheet.flatten(text(notice)[0].props.style).color).toBe(tokensForScheme('light').textTertiary);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel?.includes(notice))).toHaveLength(1);
});
test.each([[-1, 'library.retentionEnded'], [86_400_000, 'library.expires']] as const)('ended or urgent expiry uses danger: %i', async (offset, key) => {
    const date = new Date(NOW + offset);
    await render({ asset_expires_at: date.toISOString() });
    const notice = t(key, { date: date.toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) });
    expect(text(notice)).toHaveLength(1);
    expect(RN.StyleSheet.flatten(text(notice)[0].props.style).color).toBe(tokensForScheme('light').danger);
});
test('held output has the status chip without an extra retention line', async () => {
    await render({ held: true, has_asset: false });
    expect(text(t('library.status.held'))).toHaveLength(1);
    expect(text(t('library.fileUnavailable'))).toHaveLength(0);
    expect(text(t('library.keptDefault'))).toHaveLength(0);
});
test('a polling promotion with unknown retention hides the absent file notice', async () => {
    await render({ has_asset: false }, false);
    expect(text(t('library.fileUnavailable'))).toHaveLength(0);
});

const kinds = new Map([['m', 'audio' as const]]);
const lipSync = jest.fn();
const seek = jest.fn();
async function renderAudio(props: Partial<ComponentProps<typeof LibraryItem>> = {}, over: Partial<Job> = {}) {
    const item = { ...job, ...over };
    await act(async () => root.render(<LibraryItem job={item} retentionKnown now={NOW} name="Recording" kind="audio" grid={false} starred={false}
        canSchedule={false} canReuse={canReuse(item, kinds, NOW)} onOpen={() => {}} onStar={() => {}} onSchedule={() => {}} onReuse={() => {}}
        onLipSync={() => lipSync(lipSyncSourceHref(item.job_id))} {...props} />));
}
test.each([false, true])('loaded audio shows seeking while playing=%s', async playing => {
    await renderAudio({ audioSeek: { position: 30, duration: 90, onSeek: seek }, media: { audio: { playing, toggle() {} } } });
    const rail = root.container.queryAll(n => n.props.testID === 'library-audio-position')[0];
    expect(rail.props.accessibilityValue.text).toContain('0:30');
    await act(async () => rail.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(seek).toHaveBeenLastCalledWith(40);
});
test('inactive rows, grid tiles and non-audio rows hide the rail', async () => {
    for (const props of [{}, { grid: true, audioSeek: { position: 0, duration: 90, onSeek: seek } }, { kind: 'image' as const, audioSeek: { position: 0, duration: 90, onSeek: seek } }]) {
        await renderAudio(props);
        expect(root.container.queryAll(n => n.props.testID === 'library-audio-position')).toHaveLength(0);
    }
});
test('eligible audio has the direct lip-sync action and retains generic reuse', async () => {
    await renderAudio();
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('library.useForLipSyncLabel', { name: 'Recording' }))[0];
    await act(async () => button.props.onClick({ nativeEvent: {} }));
    expect(lipSync).toHaveBeenCalledWith({ pathname: '/features/[slug]', params: { slug: 'lip-sync', sourceJobId: 'a', sourceKind: 'audio' } });
    expect(text(t('library.reuse'))).toHaveLength(1);
});
test.each([{ held: true }, { state: 'failed' as const }, { has_asset: false }, { asset_expires_at: new Date(NOW - 1).toISOString() }])('ineligible audio hides lip sync: %p', async over => {
    await renderAudio({}, over); expect(text(t('library.useForLipSync'))).toHaveLength(0);
});
test.each([{ grid: true }, { kind: 'image' as const }, { kind: 'video' as const }])('tile/non-audio hides lip sync: %p', async props => {
    await renderAudio(props); expect(text(t('library.useForLipSync'))).toHaveLength(0);
});
