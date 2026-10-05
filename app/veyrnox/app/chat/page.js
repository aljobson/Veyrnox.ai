'use client';
import { AppNav } from '../../_components/NavBar';
import { ChatWorkspace } from '../../_components/chat/ChatWorkspace';
import { useChatPreview } from '../../_lib/useChatPreview';

// Delivery gate (ADR-0067): this browser must opt in with localStorage.veyrnox_chat = '1'. The server flag
// CHAT_ENABLED and the API's own checks stay authoritative; the preview switch never grants a capability.
export default function ChatPage() {
  const preview = useChatPreview(); // null until read
  return (
    <div className="min-h-screen bg-vx-base text-vx-fg">
      <AppNav active="chat" />
      {preview !== null && (preview
        ? <ChatWorkspace />
        : <div className="mx-auto max-w-[640px] px-4 py-16"><h1 className="vx-display text-[32px]">Chat is not open yet</h1><p className="mt-3 text-vx-fg-body">We will open it here when it is ready.</p></div>)}
    </div>
  );
}
