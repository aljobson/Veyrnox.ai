"use client";

import { EditAgentPage } from "ai-agent";
import "ai-agent/dist/tailwind.css";
import { useCallback, useEffect } from "react";

export default function AgentEditClient({ userData }) {
  // Purge legacy localStorage key. Same-origin cookie is used for auth.
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
    <EditAgentPage
      useUser={useUser}
      usedIn="studio"
    />
  );
}
