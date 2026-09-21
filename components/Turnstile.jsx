"use client";

/**
 * Cloudflare Turnstile widget for Supabase Attack Protection (ADR-0026).
 *
 * Renders nothing unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so a build
 * without a key behaves exactly as the form did before this existed.
 *
 * Tokens are single-use: a failed sign-in spends the token as surely as a
 * successful one. The parent remounts this component (a new `key`) after every
 * attempt to get a fresh widget rather than tracking reset state here.
 */

import { useEffect, useRef } from "react";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

// Explicit render: the script must not scan the page and render into every
// `.cf-turnstile` it finds, because React owns this DOM.
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise = null;

function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!scriptPromise) {
        scriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = SCRIPT_SRC;
            script.async = true;
            script.onload = () => resolve(window.turnstile);
            script.onerror = () => {
                // Let the next mount try again rather than caching a failure.
                scriptPromise = null;
                reject(new Error("turnstile_load_failed"));
            };
            document.head.appendChild(script);
        });
    }
    return scriptPromise;
}

/**
 * @param {{ onToken: (token: string|null) => void, onError?: () => void }} props
 */
export default function Turnstile({ onToken, onError }) {
    const container = useRef(null);
    // Latest callbacks without re-rendering the widget when the parent re-renders.
    const callbacks = useRef({ onToken, onError });
    callbacks.current = { onToken, onError };

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) return undefined;
        let widgetId = null;
        let cancelled = false;

        loadTurnstile()
            .then((turnstile) => {
                if (cancelled || !container.current) return;
                widgetId = turnstile.render(container.current, {
                    sitekey: TURNSTILE_SITE_KEY,
                    theme: "auto",
                    callback: (token) => callbacks.current.onToken(token),
                    "expired-callback": () => callbacks.current.onToken(null),
                    "error-callback": () => {
                        callbacks.current.onToken(null);
                        callbacks.current.onError?.();
                    },
                });
            })
            .catch(() => {
                if (!cancelled) callbacks.current.onError?.();
            });

        return () => {
            cancelled = true;
            if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
        };
    }, []);

    if (!TURNSTILE_SITE_KEY) return null;
    return <div ref={container} className="min-h-[65px]" />;
}
