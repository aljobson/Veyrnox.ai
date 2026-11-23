import { editorMedia } from './index';

// Production editor tools only need the bounded artifact lifecycle surface. Keeping this seam separate from
// the development probe prevents feature components from gaining access to the probe harness by accident.
export const editorMediaArtifacts: Pick<typeof editorMedia, 'setOwner' | 'mixAudio' | 'release'> = editorMedia;
