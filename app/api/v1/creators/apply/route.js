import { creatorHandler } from '../../../../../lib/cinema/creatorApi.js';
export const GET = creatorHandler();
export const POST = creatorHandler({ create: true });
