import { titlesHandler } from '../../../../../../lib/cinema/titlesApi.js';
export const dynamic = 'force-dynamic';
export const GET = titlesHandler({ action: 'title', authed: true });
