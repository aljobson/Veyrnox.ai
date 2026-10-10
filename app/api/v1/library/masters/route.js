import { filmLibraryHandlers } from '../../../../../lib/filmLibraryApi.js';
export async function GET(req) { return filmLibraryHandlers().list(req); }
