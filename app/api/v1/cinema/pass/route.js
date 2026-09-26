import { passHandler } from '../../../../../lib/cinema/passApi.js';
export const dynamic = 'force-dynamic';
export const GET = passHandler({ action: 'read' });
export const POST = passHandler({ action: 'start' });
