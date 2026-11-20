import { generationAction } from './generationAction';
export const coverAction = (songId: string) => generationAction('cover', songId);
