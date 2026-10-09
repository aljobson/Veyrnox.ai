"use client";

/**
 * Cloudflare Turnstile widget for the auth form (ADR-0026).
 *
 * Renders nothing while NEXT_PUBLIC_TURNSTILE_SITE_KEY is empty, so the site
 * key is the on/off switch. The script loads on first mount, which means
 * only when AuthGate's modal opens, not on every page view.
 */

import { useEffect, useRef } from "react";
import { turnstileErrorCode } from "../app/lib/turnstileFailure.js";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise = null;
function loadScript() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!scriptPromise) {
        scriptPromise = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = SCRIPT_SRC;
            s.async = true;
            s.onload = () => resolve(window.turnstile);
            s.onerror = () => {
                // Let a later mount retry instead of caching the failure.
                scriptPromise = null;
                reject(new Error("turnstile_load_failed"));
            };
            document.head.appendChild(s);
        });
    }
    return scriptPromise;
}

/**
 * @param {{ onToken: (token: string|null) => void, onError: () => void, onFailure: (code: string) => void, resetKey: number }} props
 *   onToken   receives a fresh token, or null when it expires or errors
 *   onError   the script could not load (blocked by an extension, offline)
 *   onFailure the check ran and failed; receives Turnstile's error code
 *   resetKey  bump after every submit: tokens are single-use
 */
export function Turnstile({ onToken, onError, onFailure, resetKey }) {
    const box = useRef(null);
    const widgetId = useRef(null);
    const lastFailure = useRef(null);

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) return undefined;
        let cancelled = false;
        loadScript()
            .then((ts) => {
                if (cancelled || !box.current) return;
                widgetId.current = ts.render(box.current, {
                    sitekey: TURNSTILE_SITE_KEY,
                    callback: (token) => {
                        lastFailure.current = null;
                        onToken(token);
                    },
                    "expired-callback": () => onToken(null),
                    "error-callback": (raw) => {
                        onToken(null);
                        const code = turnstileErrorCode(raw);
                        // A failed check never reaches Supabase, so this line
                        // is its only trace. Turnstile retries by itself and
                        // calls back each time: log a failure once, not every
                        // retry. Only the code; nothing typed, and no token.
                        if (lastFailure.current !== code) {
                            lastFailure.current = code;
                            console.error("[auth] turnstile check failed:", code);
                        }
                        onFailure(code);
                        // Non-falsy means handled. Otherwise Turnstile adds a
                        // console warning of its own for every retry.
                        return true;
                    },
                });
            })
            .catch(() => {
                if (!cancelled) onError();
            });
        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
            widgetId.current = null;
            // The token belongs to the widget being destroyed. AuthGate keeps
            // its state while the modal is closed, so without this a reopened
            // modal could submit a token from a widget that no longer exists —
            // expired, spent, or both — and Supabase answers captcha_failed.
            // Seen in production 2026-09-21 10:20:01 UTC.
            onToken(null);
        };
        // The callbacks only call AuthGate's state setters, so the ones from
        // the first render stay right.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!resetKey || !widgetId.current || !window.turnstile) return;
        lastFailure.current = null;
        window.turnstile.reset(widgetId.current);
        onToken(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    if (!TURNSTILE_SITE_KEY) return null;
    return <div ref={box} className="min-h-[65px]" />;
}
