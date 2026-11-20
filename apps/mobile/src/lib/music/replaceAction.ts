import { sectionAction } from './sectionAction';
export const replaceAction = (songId: string) => sectionAction('replace_section', songId);
