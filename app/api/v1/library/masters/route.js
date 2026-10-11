import { filmLibraryHandlers } from '../../../../../lib/filmLibraryApi.js';
import { filmMasterSaveHandlers } from '../../../../../lib/filmMasterSaveApi.js';
export async function GET(req) { return filmLibraryHandlers().list(req); }
export async function POST(req) { return filmMasterSaveHandlers().finish(req); }
