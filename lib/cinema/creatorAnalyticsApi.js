import { rpc, envConfig } from "../../packages/db/supabase-client.js";
import { cinemaFeatures } from "./features.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const metrics = ["viewers", "completions", "voters", "sharers", "commenters"];
export function creatorAnalyticsHandler({ rpcCall = rpc } = {}) {
  return async (req) => {
    const auth = req.headers.get("x-veyrnox-auth-id"),
      requestId = crypto.randomUUID();
    const reply = (body, status = 200) => {
      (status === 401 || status === 403 ? console.error : console.info)(
        JSON.stringify({
          event: "cinema.creator_analytics",
          request_id: requestId,
          status,
          code: body.error || "ok",
        }),
      );
      return Response.json(
        { ...body, request_id: requestId },
        {
          status,
          headers: {
            "Cache-Control": "no-store",
            "x-request-id": requestId,
            ...(status === 429 ? { "Retry-After": "60" } : {}),
          },
        },
      );
    };
    if (!UUID.test(auth || ""))
      return reply({ error: "not_authenticated" }, 401);
    if (!cinemaFeatures(process.env).creatorAnalytics)
      return reply({ error: "analytics_not_open" }, 503);
    const query = new URL(req.url).searchParams,
      id = query.get("content_id");
    if (query.size !== 1 || !UUID.test(id || ""))
      return reply({ error: "invalid_query" }, 400);
    try {
      const cfg = envConfig(),
        rate = await rpcCall(
          "consume_account_read_request",
          { p_auth_id: auth },
          cfg,
        );
      if (rate?.code === "RATE_LIMITED")
        return reply({ error: "rate_limited" }, 429);
      if (rate?.ok !== true)
        return reply({ error: "temporarily_unavailable" }, 503);
      const data = await rpcCall(
        "read_cinema_creator_analytics",
        { p_auth_id: auth, p_content_id: id.toLowerCase() },
        cfg,
      );
      if (data?.error === "creator_required")
        return reply({ error: data.error }, 403);
      if (data?.error === "content_not_found")
        return reply({ error: data.error }, 404);
      const start = Date.parse(data?.period_start),
        end = Date.parse(data?.period_end);
      if (
        data?.content_id !== id.toLowerCase() ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end - start !== 28 * 86400000 ||
        end > Date.now() ||
        data.minimum_viewers !== 5 ||
        typeof data.suppressed !== "boolean" ||
        (data.suppressed
          ? data.metrics !== null
          : !data.metrics ||
            metrics.some(
              (k) =>
                !Number.isSafeInteger(data.metrics[k]) || data.metrics[k] < 0,
            ) ||
            data.metrics.viewers < 5 ||
            metrics
              .slice(1)
              .some((k) => data.metrics[k] > data.metrics.viewers))
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      return reply({
        content_id: data.content_id,
        period_start: new Date(start).toISOString(),
        period_end: new Date(end).toISOString(),
        minimum_viewers: 5,
        suppressed: data.suppressed,
        metrics: data.suppressed
          ? null
          : Object.fromEntries(metrics.map((k) => [k, data.metrics[k]])),
      });
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
