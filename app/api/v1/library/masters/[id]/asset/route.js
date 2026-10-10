import { filmLibraryHandlers } from '../../../../../../../lib/filmLibraryApi.js';
export async function GET(req, { params }) { const { id } = await params; return filmLibraryHandlers().asset(req, id); }
