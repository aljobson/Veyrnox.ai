"use client";

import { useState, useEffect } from 'react';
import { CreativeCanvas } from 'design-agent';

import { getUserBalance } from '../muapi';

export default function DesignAgentStudio({ apiKey, isHeaderVisible, onToggleHeader }) {
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    sessionStorage.setItem("fromDesignAgent", "true");
    // Purge any legacy raw MuAPI key that older builds wrote to localStorage.
    // Auth now flows via the __Host-muapi_key HttpOnly cookie through the
    // /api/v1/creative-agent proxy (server attaches x-api-key upstream).
    try { localStorage.removeItem("token"); } catch {}
    if (!apiKey) return;

    const fetchUser = async () => {
      try {
        const data = await getUserBalance(apiKey);
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
  }, [apiKey]);

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
