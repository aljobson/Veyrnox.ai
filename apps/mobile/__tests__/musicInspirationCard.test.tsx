import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as DocumentPicker from 'expo-document-picker';
import { MusicInspirationCard } from '../src/components/music/MusicInspirationCard';
import { analyzeMusicInspiration } from '../src/lib/music';
import { uploadSource } from '../src/lib/uploads';
import { t } from '../src/lib/i18n';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'upload error' }));
jest.mock('../src/lib/music', () => ({ analyzeMusicInspiration: jest.fn() }));
let mockOwner = 'user-a'; let mockOwnerListener: (() => void) | undefined;
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner,
  subscribeCacheUser: (listener: () => void) => { mockOwnerListener = listener; return () => { mockOwnerListener = undefined; }; } }));

const pick = DocumentPicker.getDocumentAsync as jest.Mock;
const upload = uploadSource as jest.Mock;
const analyze = analyzeMusicInspiration as jest.Mock;
const api = { request: jest.fn() } as never;
let root: Root; const applied = jest.fn();
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label
  && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
const click = async (label: string) => { const target = control(label); expect(target).toBeDefined();
  await act(async () => (target.props.onClick ?? target.props.onPress)({ nativeEvent: {}, currentTarget: 1, target: 1 })); };

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockOwner = 'user-a'; applied.mockReset(); pick.mockReset(); upload.mockReset(); analyze.mockReset();
  root = createRoot();
  await act(async () => root.render(<MusicInspirationCard api={api} onApply={applied} />));
});
afterEach(async () => { await act(async () => root.unmount()); });

test('shows a reviewed brief and changes the form only after Apply', async () => {
  pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///song.mp3', size: 1000, mimeType: 'audio/mpeg' }] });
  upload.mockResolvedValue('uploads/user/song.mp3');
  analyze.mockResolvedValue({ analysis_id: 'id', brief: 'Warm original pulse', tags: ['warm'], receipt: 'a.b',
    expires_at: '2026-11-24T12:00:00Z', idempotent: false });
  await click(t('music.create.inspiration.rights')); await click(t('music.create.inspiration.choose'));
  expect(applied).not.toHaveBeenCalled(); expect(button(t('music.create.inspiration.apply'))).toBeDefined();
  await click(t('music.create.inspiration.apply')); expect(applied).toHaveBeenCalledWith('Warm original pulse');
});

test('account change clears a result before it can be applied', async () => {
  pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///song.wav', size: 1000, mimeType: 'audio/wav' }] });
  upload.mockResolvedValue('uploads/user/song.wav');
  analyze.mockResolvedValue({ analysis_id: 'id', brief: 'Private brief', tags: [], receipt: 'a.b',
    expires_at: '2026-11-24T12:00:00Z', idempotent: false });
  await click(t('music.create.inspiration.rights')); await click(t('music.create.inspiration.choose'));
  mockOwner = 'user-b'; await act(async () => mockOwnerListener?.());
  expect(button(t('music.create.inspiration.apply'))).toBeUndefined(); expect(applied).not.toHaveBeenCalled();
});
