import { actionSong, croppedSong, NEXT_VERSION_ID } from './musicActions';
import type { RenderResult } from '../../src/lib/music/validateRender';
export const renderSong = { ...actionSong, actions: ['render', 'reverse'] };
export const renderedSong = { ...croppedSong, actions: ['render', 'reverse'],
    current_version: { ...croppedSong.current_version, operation: 'fade' } };
export const renderCreated: RenderResult = { version_id: NEXT_VERSION_ID, version_number: 2, operation: 'fade',
    render_state: 'canonical', format: 'wav', duration_seconds: 12, idempotent: false };
export const renderCommitReplay: RenderResult = { ...renderCreated, idempotent: true };
export const renderEarlyReplay: RenderResult = { version_id: NEXT_VERSION_ID, version_number: 2, operation: 'fade', render_state: 'canonical', idempotent: true };
