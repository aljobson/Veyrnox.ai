import { watchProgressHandler } from "../../../../../lib/cinema/watchProgressApi.js";
export const dynamic = "force-dynamic";
export const GET = watchProgressHandler({ method: "GET" });
export const PUT = watchProgressHandler({ method: "PUT" });
export const DELETE = watchProgressHandler({ method: "DELETE" });
