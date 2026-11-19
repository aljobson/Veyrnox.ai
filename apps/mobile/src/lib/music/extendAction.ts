import { generationAction } from './generationAction';
export const extendAction = (songId: string) => generationAction('extend', songId);
