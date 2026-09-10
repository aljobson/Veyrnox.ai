"use client";

/**
 * Shared error/toast helpers for studio components.
 *
 * All studios funnel errors through here so that:
 * 1. The user sees a non-blocking toast, never window.alert().
 * 2. Raw upstream/technical strings are mapped to friendly messages
 *    grouped by HTTP status and known error codes.
 * 3. Log detail stays in the console for debugging while the toast
 *    stays short and actionable.
 *
 * Requires <Toaster/> to be mounted somewhere in the tree — the root
 * layout mounts a global one via components/ToasterMount.jsx so every
 * studio can call these helpers.
 */

import toast from "react-hot-toast";

const DEFAULT_MESSAGE = "Something went wrong. Please try again.";

/**
 * Map HTTP status codes to friendly messages.
 * Falls back to DEFAULT_MESSAGE for unknown statuses.
 */
function statusToFriendly(status) {
  if (status === 400) return "That request was invalid. Check your inputs and try again.";
  if (status === 401 || status === 403) return "Your session expired. Please sign in again.";
  if (status === 402) return "You’re out of credits. Top up to keep generating.";
  if (status === 404) return "That item is no longer available.";
  if (status === 409) return "That change conflicts with an existing item.";
  if (status === 413) return "That file is too large. Try a smaller one.";
  if (status === 415) return "That file type isn’t supported here.";
  if (status === 422) return "The provider rejected the request. Try adjusting the prompt or parameters.";
  if (status === 429) return "Slow down a moment — you’re being rate-limited.";
  if (status >= 500 && status < 600) return "The provider is having trouble. Please try again in a minute.";
  return null;
}

/**
 * Map known error codes/keywords to friendly messages.
 * Ordered by specificity; first match wins.
 */
function codeToFriendly(code, message) {
  const s = `${code || ""} ${message || ""}`.toLowerCase();
  if (s.includes("content_policy") || s.includes("safety") || s.includes("moderation") || s.includes("nsfw")) {
    return "That prompt or image was blocked by the content policy. Try a different one.";
  }
  if (s.includes("network") || s.includes("failed to fetch") || s.includes("networkerror") || s.includes("timeout")) {
    return "Network trouble. Check your connection and try again.";
  }
  if (s.includes("aborted")) return null; // Caller cancelled — don't toast.
  if (s.includes("invalid api key") || s.includes("unauthorized")) {
    return "Your session expired. Please sign in again.";
  }
  return null;
}

/**
 * Turn an error into a user-friendly string.
 * Accepts:
 *   - Response-like ({status, statusText, body?})
 *   - Error object (message, name, code)
 *   - Plain string
 *   - Anything else (falls back to DEFAULT_MESSAGE)
 */
export function friendlyMessage(err, fallback) {
  if (!err) return fallback || DEFAULT_MESSAGE;
  if (typeof err === "string") return codeToFriendly(null, err) || err;

  const status = err.status ?? err.response?.status;
  const code = err.code ?? err.body?.code ?? err.response?.data?.code;
  const rawMsg =
    err.body?.error ??
    err.response?.data?.error ??
    err.response?.data?.message ??
    err.message ??
    "";

  const byCode = codeToFriendly(code, rawMsg);
  if (byCode !== null && byCode !== undefined) return byCode;

  const byStatus = status ? statusToFriendly(status) : null;
  if (byStatus) return byStatus;

  return fallback || DEFAULT_MESSAGE;
}

/**
 * Show a friendly error toast for an error object.
 * Always logs the original error to console for debugging.
 */
export function showError(err, fallback) {
  // Callers that pass a cancellation reason ("aborted") get a silent
  // return so we don't spam a toast for their own cleanup path.
  if (err && (err.name === "AbortError" || /aborted/i.test(err?.message || ""))) {
    return;
  }
  const msg = friendlyMessage(err, fallback);
  // eslint-disable-next-line no-console
  console.error("[studio] error:", err);
  toast.error(msg);
}

/**
 * Show a validation toast — used for "please upload X first" style
 * checks where there is no upstream error, just a missing input.
 */
export function showValidation(msg) {
  toast.error(msg, { icon: "⚠️" });
}

/**
 * Confirmation / info toast — used for "URL copied" style feedback.
 */
export function showSuccess(msg) {
  toast.success(msg);
}

/**
 * Neutral info toast.
 */
export function showInfo(msg) {
  toast(msg);
}
