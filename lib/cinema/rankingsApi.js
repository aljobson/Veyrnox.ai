import { rpc, envConfig } from "../../packages/db/supabase-client.js";
import { cinemaFeatures } from "./features.js";
import { verifyAccessLogin } from "../accessJwt.js";
import { limitRequestBody } from "../requestBodyLimit.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors = {
  not_authorized: 403,
  invalid_action: 400,
  competition_not_found: 404,
  snapshot_not_found: 404,
  content_not_found: 409,
  competition_not_closed: 409,
  votes_need_review: 409,
  insufficient_audience: 409,
  ranking_capacity: 409,
  snapshot_exists: 409,
  snapshot_stale: 409,
  already_decided: 409,
  self_review_forbidden: 403,
  idempotency_conflict: 409,
};
const title = (t) =>
  UUID.test(t?.id || "") &&
  UUID.test(t?.root_id || "") &&
  typeof t.title === "string" &&
  t.title.length <= 160 &&
  ["FILM", "SHORT", "TRAILER", "EPISODE", "SERIES"].includes(t.content_type) &&
  Number.isInteger(t.rank) &&
  t.rank >= 1 &&
  Number.isFinite(t.score) &&
  t.score >= 0 &&
  t.score <= 100;
export function winnersHandler({ rpcCall = rpc } = {}) {
  return async (req) => {
    const reply = (b, status = 200) =>
      Response.json(b, { status, headers: { "Cache-Control": "no-store" } });
    if (!cinemaFeatures(process.env).rankings)
      return reply({ error: "rankings_not_open" }, 503);
    if (new URL(req.url).searchParams.size)
      return reply({ error: "invalid_query" }, 400);
    try {
      const rows = await rpcCall("list_cinema_winners", {}, envConfig());
      if (
        !Array.isArray(rows) ||
        rows.length > 12 ||
        rows.some(
          (r) =>
            !UUID.test(r.id || "") ||
            typeof r.name !== "string" ||
            r.name.length > 80 ||
            r.model_version !== "weighted-v1" ||
            !Number.isFinite(Date.parse(r.ends_at)) ||
            !Number.isFinite(Date.parse(r.published_at)) ||
            !Array.isArray(r.titles) ||
            r.titles.length > 500 ||
            r.titles.some((t) => !title(t)),
        )
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      return reply({
        weeks: rows.map((r) => ({
          id: r.id,
          name: r.name,
          ends_at: r.ends_at,
          published_at: r.published_at,
          model_version: r.model_version,
          titles: r.titles.map((t) => ({
            id: t.id,
            root_id: t.root_id,
            title: t.title,
            content_type: t.content_type,
            rank: t.rank,
            score: t.score,
          })),
        })),
      });
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
export function rankingsHandler({
  rpcCall = rpc,
  accessVerifier = verifyAccessLogin,
  now = () => Date.now(),
} = {}) {
  return async (req) => {
    const requestId = crypto.randomUUID();
    const reply = (b, status = 200) =>
      Response.json(
        { ...b, request_id: requestId },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    const auth = req.headers.get("x-veyrnox-auth-id");
    if (!UUID.test(auth || ""))
      return reply({ error: "not_authenticated" }, 401);
    if (!cinemaFeatures(process.env).rankings)
      return reply({ error: "rankings_not_open" }, 503);
    const raw = req.headers.get("x-veyrnox-auth-mfa-at"),
      at = raw && /^\d+$/.test(raw) ? Number(raw) : NaN,
      current = Math.floor(now() / 1000);
    if (
      req.headers.get("x-veyrnox-auth-aal") !== "aal2" ||
      !Number.isSafeInteger(at) ||
      at < current - 300 ||
      at > current + 5
    )
      return reply({ error: "recent_mfa_required" }, 403);
    if (!process.env.ACCESS_TEAM_DOMAIN || !process.env.ACCESS_AUD)
      return reply({ error: "temporarily_unavailable" }, 503);
    try {
      const assertion = req.headers.get("cf-access-jwt-assertion");
      if (!assertion) {
        console.error(
          "[access] refused: no assertion on a Cinema administrator request",
        );
        return reply({ error: "access_required" }, 403);
      }
      try {
        await accessVerifier(assertion, {
          teamDomain: process.env.ACCESS_TEAM_DOMAIN,
          aud: process.env.ACCESS_AUD,
        });
      } catch (err) {
        console.error("[access] refused:", err?.reason || "invalid");
        return reply({ error: "access_required" }, 403);
      }
      if (new URL(req.url).searchParams.size)
        return reply({ error: "invalid_request" }, 400);
      const cfg = envConfig(),
        gate = { p_auth_id: auth, p_aal: "aal2", p_mfa_at: at };
      let payload, key;
      if (req.method === "POST") {
        key = req.headers.get("idempotency-key");
        if (!UUID.test(key || ""))
          return reply({ error: "invalid_idempotency_key" }, 400);
        if (
          req.headers.get("content-type")?.split(";")[0].trim() !==
          "application/json"
        )
          return reply({ error: "invalid_content_type" }, 415);
        const limited = await limitRequestBody(req);
        if (limited.response)
          return reply({ error: "invalid_body" }, limited.response.status);
        try {
          payload = await limited.request.json();
        } catch {
          return reply({ error: "invalid_body" }, 400);
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          Array.isArray(payload) ||
          Object.keys(payload).some(
            (k) => !["action", "id", "reason"].includes(k),
          ) ||
          !["prepare", "publish", "reject"].includes(payload.action) ||
          !UUID.test(payload.id || "") ||
          typeof payload.reason !== "string" ||
          [...payload.reason.trim()].length < 3 ||
          [...payload.reason.trim()].length > 500
        )
          return reply({ error: "invalid_action" }, 400);
        payload = {
          action: payload.action,
          id: payload.id.toLowerCase(),
          reason: payload.reason.trim(),
        };
      }
      const rate = await rpcCall(
        "consume_account_read_request",
        { p_auth_id: auth },
        cfg,
      );
      if (rate?.code === "RATE_LIMITED")
        return reply({ error: "rate_limited" }, 429);
      if (rate?.ok !== true)
        return reply({ error: "temporarily_unavailable" }, 503);
      const r = await rpcCall(
        req.method === "POST"
          ? "manage_cinema_rankings"
          : "list_cinema_ranking_review",
        req.method === "POST"
          ? {
              ...gate,
              p_idempotency_key: key.toLowerCase(),
              p_payload: payload,
              p_request_id: requestId,
            }
          : gate,
        cfg,
      );
      if (r?.error)
        return reply(
          {
            error: Object.hasOwn(errors, r.error)
              ? r.error
              : "temporarily_unavailable",
          },
          errors[r.error] || 503,
        );
      if (req.method === "POST") {
        if (
          !UUID.test(r?.id || "") ||
          !["provisional", "published", "rejected"].includes(r?.status) ||
          typeof r.idempotent !== "boolean"
        )
          return reply({ error: "temporarily_unavailable" }, 503);
        return reply({ id: r.id, status: r.status, idempotent: r.idempotent });
      }
      if (
        !Array.isArray(r?.competitions) ||
        r.competitions.length > 50 ||
        !Array.isArray(r.snapshots) ||
        r.snapshots.length > 50
      )
        return reply({ error: "temporarily_unavailable" }, 503);
      return reply({
        competitions: r.competitions.map((c) => ({
          id: c.id,
          name: c.name,
          ends_at: c.ends_at,
        })),
        snapshots: r.snapshots.map((s) => ({
          id: s.id,
          name: s.name,
          model_version: s.model_version,
          rows: s.rows,
          status: s.status,
          own: s.own,
        })),
      });
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503);
    }
  };
}
