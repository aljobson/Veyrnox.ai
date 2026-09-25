import { contentHandler } from '../../../../../lib/cinema/contentApi.js';
export const dynamic = 'force-dynamic';
export const GET = contentHandler();
export const POST = contentHandler({ action: 'create' });
export const PATCH = contentHandler({ action: 'edit' });
