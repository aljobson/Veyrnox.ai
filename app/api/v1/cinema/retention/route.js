import { retentionHandler } from "../../../../../lib/cinema/retentionApi.js";
export const dynamic = "force-dynamic";
export const GET = retentionHandler();
export const POST = retentionHandler({ write: true });
