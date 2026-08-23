"use client";

import { useState, useEffect } from 'react';
import { CreativeCanvas } from 'design-agent';

import { getUserBalance } from '../muapi';

// SECURITY: this component intentionally does NOT accept an `apiKey` prop.
// The raw MuAPI key must never live in React state. Auth flows via the
// __Host-muapi_key HttpOnly cookie set by /api/session/muapi and attached
// automatically by the browser on same-origin fetches to /api/*.
export default function DesignAgentStudio({ isHeaderVisible, onToggleHeader }) {
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    sessionStorage.setItem("fromDesignAgent", "true");
    // Purge legacy raw-key storage from older builds.
    try { sessionStorage.removeItem("token"); } catch {}
    try { localStorage.removeItem("token"); } catch {}
    try { localStorage.removeItem("muapi_key"); } catch {}

    const fetchUser = async () => {
      try {
        const data = await getUserBalance();
        setUserData({
          username: data.email?.split('@')[0] || 'Studio User',
          email: data.email,
          balance: data.balance || 0
        });
      } catch (err) {
        console.error('Failed to fetch user data for Design Agent:', err);
      }
    };

    fetchUser();
  }, []);

  return (
    <div className="h-full w-full bg-black overflow-hidden design-agent-studio">
      <CreativeCanvas
        user={userData}
        isAuthorized={!!userData}
        creditConversionRate={200}
        theme="dark"
        onToggleHeader={onToggleHeader}
        isHeaderVisible={isHeaderVisible}
      />
    </div>
  );
}
