"use client";

import { AiAgent } from "ai-agent";
import "ai-agent/dist/tailwind.css";
import { useCallback, useEffect } from "react";

/**
 * AgentChatClient — mirrors muapiapp's AgentClient.js.
 * Renders the AiAgent library component with server-fetched agent details
 * and optional initial history.
 *
 * Auth: the browser attaches the `__Host-muapi_key` cookie automatically
 * on same-origin fetches to `/api/*`. Nothing to inject client-side.
 */
export default function AgentChatClient({ agentDetails, initialHistory, userData }) {
  // One-time purge of the legacy localStorage key so no residue is left
  // for XSS to exfiltrate. Safe no-op if already absent.
  useEffect(() => {
    if (typeof window !== "undefined") {
      try { localStorage.removeItem("muapi_key"); } catch {}
    }
  }, []);

  const useUser = useCallback(
    () => ({
      user: {
        username: userData?.email?.split("@")[0] || "Studio User",
        name: userData?.email?.split("@")[0] || "Studio User",
        email: userData?.email || null,
        profile_photo: null,
        balance: userData?.balance || 0,
      },
      isAuthorized: !!userData,
    }),
    [userData]
  );

  return (
    <div className="h-screen w-full bg-black">
      <AiAgent
        initialAgentDetails={agentDetails}
        initialHistory={initialHistory}
        useUser={useUser}
        usedIn="muapiapp"
      />
    </div>
  );
}
