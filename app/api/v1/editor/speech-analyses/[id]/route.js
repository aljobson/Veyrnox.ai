import { speechAnalysisHandlers } from '../../../../../../lib/speechAnalysis.js';
export async function GET(req, { params }) { return speechAnalysisHandlers().get(req, (await params).id); }
