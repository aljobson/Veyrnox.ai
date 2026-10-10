import { commentsHandler } from '../../../../../lib/cinema/commentsApi.js';
export const dynamic='force-dynamic';
export const GET=commentsHandler();
export const POST=commentsHandler({action:'mutate'});
