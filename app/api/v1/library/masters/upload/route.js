import { filmMasterSaveHandlers } from '../../../../../../lib/filmMasterSaveApi.js';
export async function POST(request) { return filmMasterSaveHandlers().begin(request); }
