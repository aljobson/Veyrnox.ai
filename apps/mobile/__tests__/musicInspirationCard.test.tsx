import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { MusicInspirationCard } from '../src/components/music/MusicInspirationCard';
import { analyzeMusicInspiration } from '../src/lib/music';
import { prepareMusicInspirationImage } from '../src/lib/music/inspirationImage';
import { uploadSource } from '../src/lib/uploads';
import { t } from '../src/lib/i18n';
import { ApiError } from '../src/lib/api';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'upload error' }));
jest.mock('../src/lib/music', () => ({ analyzeMusicInspiration: jest.fn() }));
jest.mock('../src/lib/music/inspirationImage', () => ({ prepareMusicInspirationImage: jest.fn() }));
jest.mock('../src/lib/cacheFiles', () => ({ discardCacheCopy: jest.fn() }));
let mockOwner = 'user-a'; let mockOwnerListener: (() => void) | undefined;
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner,
  subscribeCacheUser: (listener: () => void) => { mockOwnerListener = listener; return () => { mockOwnerListener = undefined; }; } }));

const pick = DocumentPicker.getDocumentAsync as jest.Mock;
const pickImage = ImagePicker.launchImageLibraryAsync as jest.Mock;
const prepareImage = prepareMusicInspirationImage as jest.Mock;
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
  mockOwner = 'user-a'; applied.mockReset(); pick.mockReset(); pickImage.mockReset(); prepareImage.mockReset(); upload.mockReset(); analyze.mockReset();
  root = createRoot();
  await act(async () => root.render(<MusicInspirationCard api={api} sources={['audio', 'image']} onApply={applied} />));
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

test('uploads only the freshly rendered JPEG and posts the image kind', async () => {
  pickImage.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/original-with-exif.jpg', mimeType: 'image/jpeg', fileSize: 3000, width: 4000, height: 3000 }] });
  prepareImage.mockResolvedValue({ uri: 'file:///cache/rendered-no-exif.jpg', size: 1200, mimeType: 'image/jpeg' });
  upload.mockResolvedValue('uploads/user/rendered.jpg');
  analyze.mockResolvedValue({ analysis_id: 'id', brief: 'Blue geometric rhythm', tags: ['blue'], receipt: 'a.b',
    expires_at: '2026-11-24T12:00:00Z', idempotent: false });
  await click(t('music.create.inspiration.rights')); await click(t('music.create.inspiration.chooseImage'));
  expect(upload).toHaveBeenCalledWith(api, { uri: 'file:///cache/rendered-no-exif.jpg', size: 1200 }, 'image/jpeg', expect.any(Function), expect.any(AbortSignal));
  expect(upload.mock.calls[0][1].uri).not.toContain('original-with-exif');
  expect(analyze).toHaveBeenCalledWith(api, 'image', 'uploads/user/rendered.jpg', expect.stringMatching(/^music-inspire-/), expect.any(AbortSignal));
  expect(applied).not.toHaveBeenCalled();
});

test('guards image selection synchronously so rapid taps start only one flow', async () => {
  let finishPick!: (value: { canceled: true }) => void;
  pickImage.mockReturnValue(new Promise(resolve => { finishPick = resolve; }));
  await click(t('music.create.inspiration.rights'));
  const target = control(t('music.create.inspiration.chooseImage'));
  await act(async () => {
    (target.props.onClick ?? target.props.onPress)({ nativeEvent: {}, currentTarget: 1, target: 1 });
    (target.props.onClick ?? target.props.onPress)({ nativeEvent: {}, currentTarget: 1, target: 1 });
    await Promise.resolve();
  });
  expect(pickImage).toHaveBeenCalledTimes(1);
  await act(async () => { finishPick({ canceled: true }); await Promise.resolve(); });
});

test.each([
  ['source_too_large', 'music.create.inspiration.imageLimit'],
  ['upload_unreadable', 'music.create.inspiration.imageType'],
] as const)('shows image-specific validation for %s', async (code, key) => {
  pickImage.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/original.jpg', width: 100, height: 100 }] });
  prepareImage.mockResolvedValue({ uri: 'file:///cache/rendered.jpg', size: 1200, mimeType: 'image/jpeg' });
  upload.mockResolvedValue('uploads/user/rendered.jpg'); analyze.mockRejectedValue(new ApiError(400, code));
  await click(t('music.create.inspiration.rights')); await click(t('music.create.inspiration.chooseImage')); await act(async () => {});
  expect(root.container.queryAll(n => n.children.includes(t(key)))).not.toHaveLength(0);
  expect(root.container.queryAll(n => n.children.includes(t('music.create.inspiration.limit')))).toHaveLength(0);
});

test('cancel keeps the immutable upload key available for a safe retry', async () => {
  pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///song.mp3', size: 1000, mimeType: 'audio/mpeg' }] });
  upload.mockResolvedValue('uploads/user/song.mp3');
  analyze.mockImplementation((_api, _kind, _key, _idempotencyKey, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await click(t('music.create.inspiration.rights')); await click(t('music.create.inspiration.choose'));
  expect(button(t('music.create.inspiration.cancel'))).toBeDefined();
  await click(t('music.create.inspiration.cancel')); await act(async () => {});
  expect(button(t('music.create.inspiration.retry'))).toBeDefined();
});
