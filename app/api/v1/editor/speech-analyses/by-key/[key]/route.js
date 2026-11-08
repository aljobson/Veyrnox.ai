import { speechAnalysisHandlers } from '../../../../../../../lib/speechAnalysis.js';
export async function GET(req, { params }) { return speechAnalysisHandlers().byKey(req, (await params).key); }
