import { speechAnalysisHandlers } from '../../../../../../lib/speechAnalysis.js';
export async function GET(req) { return speechAnalysisHandlers().quote(req); }
