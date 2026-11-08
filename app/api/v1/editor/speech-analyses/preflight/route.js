import { speechAnalysisHandlers } from '../../../../../../lib/speechAnalysis.js';
export async function POST(req) { return speechAnalysisHandlers().preflight(req); }
