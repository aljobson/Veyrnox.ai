'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getUserBalance } from 'studio';
import axios from 'axios';
import ApiKeyModal from './ApiKeyModal';

// Studios are large; load each one on demand to keep initial bundle small.
const studioLoader = (name) => dynamic(
  () => import('studio').then((mod) => mod[name]),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-black flex items-center justify-center text-white/20">
        Loading…
      </div>
    ),
  }
);

const ImageStudio = studioLoader('ImageStudio');
const VideoStudio = studioLoader('VideoStudio');
const ClippingStudio = studioLoader('ClippingStudio');
const VibeMotionStudio = studioLoader('VibeMotionStudio');
const LipSyncStudio = studioLoader('LipSyncStudio');
const RecastStudio = studioLoader('RecastStudio');
const CinemaStudio = studioLoader('CinemaStudio');
const AudioStudio = studioLoader('AudioStudio');
const MarketingStudio = studioLoader('MarketingStudio');
const WorkflowStudio = studioLoader('WorkflowStudio');
const AgentStudio = studioLoader('AgentStudio');
const AppsStudio = studioLoader('AppsStudio');
const DesignAgentStudio = studioLoader('DesignAgentStudio');

const TABS = [
  { id: 'image',   label: 'Image Studio' },
  { id: 'video',   label: 'Video Studio' },
  { id: 'audio',   label: 'Audio Studio' },
  { id: 'clipping', label: 'AI Clipping' },
  { id: 'vibe-motion', label: 'Vibe Motion' },
  { id: 'lipsync', label: 'Lip Sync' },
  { id: 'body-swap', label: 'Body Swap' },
  { id: 'cinema',  label: 'Cinema Studio' },
  { id: 'marketing', label: 'Marketing Studio' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'agents', label: 'Agents' },
  { id: 'design-agent', label: 'Design Agent' },
  { id: 'apps', label: 'Explore Apps' },
];

const SESSION_ENDPOINT = '/api/session/muapi';

export default function StandaloneShell() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.slug || [];
  const idFromParams = params?.id;
  const tabFromParams = params?.tab;

  const getWorkflowInfo = useCallback(() => {
    if (idFromParams) {
        return { id: idFromParams, tab: tabFromParams || null };
    }
    const wfIndex = slug.findIndex(s => s === 'workflows' || s === 'workflow');
    if (wfIndex === -1) return { id: null, tab: null };
    return {
      id: slug[wfIndex + 1] || null,
      tab: slug[wfIndex + 2] || null
    };
  }, [slug, idFromParams, tabFromParams]);

  const { id: urlWorkflowId } = getWorkflowInfo();

  const getInitialTab = () => {
    if (idFromParams || slug.includes('workflow')) return 'workflows';
    if (slug.includes('agents')) return 'agents';
    if (slug.includes('design-agent')) return 'design-agent';
    if (slug.includes('apps')) return 'apps';
    const firstSegment = slug[0];
    if (firstSegment && TABS.find(t => t.id === firstSegment)) return firstSegment;
    return 'image';
  };

  // Auth flows entirely via the __Host-muapi_key HttpOnly cookie set by
  // /api/session/muapi. The raw key MUST NOT live in React state — an XSS
  // gadget or React DevTools reader would leak it. We only track a boolean
  // "is the user connected?" flag here.
  const [hasApiKey, setHasApiKey] = useState(false);
  const [activeTab, setActiveTab] = useState(getInitialTab());

  const [balance, setBalance] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [hasMounted, setHasMounted] = useState(false);
  const [showVadooBanner, setShowVadooBanner] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('vadoo_banner_dismissed') !== '1';
    return true;
  });

  const [isDragging, setIsDragging] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);

  useEffect(() => {
    const info = getWorkflowInfo();
    if (info.id) {
        setActiveTab('workflows');
    } else if (slug.includes('agents')) {
        setActiveTab('agents');
    } else if (slug.includes('design-agent')) {
        setActiveTab('design-agent');
    } else if (slug.includes('apps')) {
        setActiveTab('apps');
    } else {
        const firstSegment = slug[0];
        if (firstSegment && TABS.find(t => t.id === firstSegment)) {
          setActiveTab(firstSegment);
        }
    }
  }, [slug, getWorkflowInfo]);

  const handleTabChange = (tabId) => {
    router.push(`/studio/${tabId}`);
  };

  useEffect(() => {
    const isEditingWorkflow = (activeTab === 'workflows' || !!idFromParams) && urlWorkflowId;
    const isDesignAgent = activeTab === 'design-agent';

    if (isEditingWorkflow || isDesignAgent) {
      setIsHeaderVisible(false);
    } else {
      setIsHeaderVisible(true);
    }
  }, [activeTab, urlWorkflowId, idFromParams]);

  useEffect(() => {
    const fromBuilder = sessionStorage.getItem("fromWorkflowBuilder");
    const fromDesignAgent = sessionStorage.getItem("fromDesignAgent");

    if ((fromBuilder && activeTab !== 'workflows') || (fromDesignAgent && activeTab !== 'design-agent')) {
      sessionStorage.removeItem("fromWorkflowBuilder");
      sessionStorage.removeItem("fromDesignAgent");
      window.location.reload();
    }
  }, [activeTab]);

  const fetchBalance = useCallback(async () => {
    try {
      // No arg — the muapi_key cookie is attached automatically by the
      // browser on same-origin fetches to /api/*, and the proxy re-attaches
      // it as x-api-key upstream.
      const data = await getUserBalance();
      setBalance(data.balance);
    } catch (err) {
      console.error('Balance fetch failed:', err);
    }
  }, []);

  useEffect(() => {
    setHasMounted(true);
    // Purge any legacy raw-key storage from earlier builds. The current
    // build never writes these — this only migrates old sessions.
    try { sessionStorage.removeItem('token'); } catch {}
    try { localStorage.removeItem('token'); } catch {}
    try { localStorage.removeItem('muapi_key'); } catch {}
    // Also ensure no stale axios default header lingers from an old bundle.
    try { delete axios.defaults.headers.common['x-api-key']; } catch {}
    // Hydrate connection state from the server (never returns the key).
    axios.get(SESSION_ENDPOINT).then(({ data }) => {
      if (data?.hasKey) {
        setHasApiKey(true);
        fetchBalance();
      }
    }).catch(() => {});
  }, [fetchBalance]);

  const handleKeySave = useCallback(async (key) => {
    try {
      await axios.post(SESSION_ENDPOINT, { key });
    } catch (err) {
      console.error('Failed to persist key server-side:', err);
      return;
    }
    // Do NOT retain the raw key. Cookie is now set; downstream fetches use it.
    setHasApiKey(true);
    fetchBalance();
  }, [fetchBalance]);

  const handleKeyChange = useCallback(async () => {
    try {
      await axios.delete(SESSION_ENDPOINT);
    } catch (err) {
      console.error('Failed to clear key server-side:', err);
    }
    setHasApiKey(false);
    setBalance(null);
  }, []);

  useEffect(() => {
    if (!hasApiKey) return;
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [hasApiKey, fetchBalance]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
    }
  }, []);

  const handleFilesHandled = useCallback(() => {
    setDroppedFiles(null);
  }, []);

  if (!hasMounted) return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center">
      <div className="animate-spin text-[#22d3ee] text-3xl">◌</div>
    </div>
  );

  // ponytail: veyrnox_gateway flag routes through /api/v1/* which uses
  // Supabase auth (AuthGate handles sign-in). Skip the legacy Muapi gate.
  const gatewayOn = typeof window !== 'undefined' && window.localStorage.getItem('veyrnox_gateway') === 'on';
  if (!hasApiKey && !gatewayOn) {
    return <ApiKeyModal onSave={handleKeySave} />;
  }

  return (
    <div
      className="h-screen bg-[#030303] flex flex-col overflow-hidden text-white relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-[#22d3ee]/10 backdrop-blur-md border-4 border-dashed border-[#22d3ee]/50 flex items-center justify-center pointer-events-none transition-all duration-300">
          <div className="bg-[#0a0a0a] p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center gap-4 scale-110 animate-pulse">
            <div className="w-20 h-20 bg-[#22d3ee] rounded-2xl flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-white">Drop your media here</span>
              <span className="text-sm text-white/40">Images, videos, or audio files</span>
            </div>
          </div>
        </div>
      )}

      {showVadooBanner && (
        <div className="flex-shrink-0 w-full bg-indigo-600 flex items-center justify-center px-4 py-2 gap-3 relative z-50">
          <a
            href="https://vadoo.tv"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-bold text-white hover:opacity-80 transition-opacity text-center"
          >
            Unrestricted AI Images &amp; Videos → Auto-Publish as YouTube Shorts &amp; TikToks, Earn ↗
          </a>
          <button
            onClick={() => {
              setShowVadooBanner(false);
              localStorage.setItem('vadoo_banner_dismissed', '1');
            }}
            className="absolute right-3 text-white/60 hover:text-white transition-colors text-lg leading-none"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {isHeaderVisible && (
        <header className="flex-shrink-0 h-14 border-b border-white/[0.03] flex items-center justify-between px-6 bg-black/20 backdrop-blur-md z-40 gap-4">
          <div className="flex-shrink-0 flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="text-sm font-bold tracking-tight hidden sm:block">OpenGenerativeAI</span>
          </div>

          <div className="flex-1 min-w-0 mx-4 sm:mx-6 relative overflow-hidden h-full flex items-center justify-start lg:justify-center">
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#030303] to-transparent pointer-events-none z-10 block lg:hidden" />

            <nav className="flex items-center gap-4 overflow-x-auto scrollbar-none w-full lg:w-auto h-full px-4 lg:px-0">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`relative text-[13px] font-medium transition-all duration-300 whitespace-nowrap px-1 flex-shrink-0 flex items-center h-full ${
                    activeTab === tab.id
                      ? 'text-[#22d3ee]'
                      : 'text-white/50 hover:text-white'
                  }`}
                >
                  <span className="relative z-10">{tab.label}</span>
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#22d3ee] to-[#a855f7] rounded-full shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
                  )}
                </button>
              ))}
            </nav>

            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#030303] to-transparent pointer-events-none z-10 block lg:hidden" />
          </div>

          <div className="flex-shrink-0 flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-full border border-white/5 transition-colors">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white/90">
                  ${balance !== null ? `${balance}` : '---'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(true)}
              title="Settings — API key, local models, preferences"
              className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-[13px] font-bold text-white/80 hover:text-white hover:bg-white/10 hover:border-white/20 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </header>
      )}

      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* No apiKey prop — auth flows via the __Host-muapi_key cookie on
            every same-origin fetch to /api/*. Studios must not receive the
            raw key. */}
        {activeTab === 'image'   && <ImageStudio   droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'video'   && <VideoStudio   droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'clipping' && <ClippingStudio droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'vibe-motion' && <VibeMotionStudio />}
        {activeTab === 'lipsync' && <LipSyncStudio droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'body-swap' && <RecastStudio droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'cinema'  && <CinemaStudio  />}
        {activeTab === 'audio'   && <AudioStudio   droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'marketing' && <MarketingStudio droppedFiles={droppedFiles} onFilesHandled={handleFilesHandled} />}
        {activeTab === 'workflows' && <WorkflowStudio isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        {activeTab === 'agents' && <AgentStudio isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        {activeTab === 'design-agent' && <DesignAgentStudio isHeaderVisible={isHeaderVisible} onToggleHeader={setIsHeaderVisible} />}
        {activeTab === 'apps' && <AppsStudio />}
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in-up">
          <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-8 w-full max-w-sm shadow-2xl">
            <h2 className="text-white font-bold text-lg mb-2">Settings</h2>
            <p className="text-white/40 text-[13px] mb-8">
              Manage your AI studio preferences and authentication.
            </p>

            <div className="space-y-4 mb-8">
              <div className="bg-white/5 border border-white/[0.03] rounded-md p-4">
                <label className="block text-xs font-bold text-white/30 mb-2">
                   Session
                </label>
                <div className="text-[13px] font-mono text-white/80 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Connected via secure cookie
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleKeyChange}
                className="flex-1 h-10 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-all"
              >
                Change Key
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="flex-1 h-10 rounded-md bg-white/5 text-white/80 hover:bg-white/10 text-xs font-semibold transition-all border border-white/5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
