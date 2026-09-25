import { uploadHandler } from '../../../../../lib/cinema/uploadApi.js';
export const dynamic='force-dynamic';
export const GET=uploadHandler();
export const POST=uploadHandler({action:'start'});
