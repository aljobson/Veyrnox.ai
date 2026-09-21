"use client";

/**
 * Cloudflare Turnstile widget for the auth form (ADR-0026).
 *
 * Renders nothing while NEXT_PUBLIC_TURNSTILE_SITE_KEY is empty, so the site
 * key is the on/off switch. The script loads on first mount, which means
 * only when AuthGate's modal opens, not on every page view.
 */

import { useEffect, useRef } from "react";

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
 * @param {{ onToken: (token: string|null) => void, onError: () => void, resetKey: number }} props
 *   onToken  receives a fresh token, or null when it expires or errors
 *   onError  the script could not load (blocked by an extension, offline)
 *   resetKey bump after every submit: tokens are single-use
 */
export function Turnstile({ onToken, onError, resetKey }) {
    const box = useRef(null);
    const widgetId = useRef(null);

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) return undefined;
        let cancelled = false;
        loadScript()
            .then((ts) => {
                if (cancelled || !box.current) return;
                widgetId.current = ts.render(box.current, {
                    sitekey: TURNSTILE_SITE_KEY,
                    callback: (token) => onToken(token),
                    "expired-callback": () => onToken(null),
                    "error-callback": () => onToken(null),
                });
            })
            .catch(() => {
                if (!cancelled) onError();
            });
        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
            widgetId.current = null;
        };
        // onToken/onError are state setters from AuthGate and never change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!resetKey || !widgetId.current || !window.turnstile) return;
        window.turnstile.reset(widgetId.current);
        onToken(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    if (!TURNSTILE_SITE_KEY) return null;
    return <div ref={box} className="min-h-[65px]" />;
}
