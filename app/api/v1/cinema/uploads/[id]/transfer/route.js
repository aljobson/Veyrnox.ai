import { transferHandler } from '../../../../../../../lib/cinema/transferApi.js';
export const dynamic='force-dynamic';
const handle=transferHandler();
export async function GET(req,{params}) { return handle(req,(await params).id); }
export async function PATCH(req,{params}) { return handle(req,(await params).id); }
