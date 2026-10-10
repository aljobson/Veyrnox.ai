'use client';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { ChatWorkspace } from '../../_components/chat/ChatWorkspace';

// Open to every signed-in user (ADR-0067 amendment 4). CHAT_ENABLED is the one control: with it off the API answers
// chat_not_open and the workspace shows "LLM Chat is not open yet", so there is nothing per-browser left to opt into.
export default function ChatPage() {
  return (
    <div className="min-h-screen bg-vx-base text-vx-fg">
      <AppNav active="chat" />
      <Main><ChatWorkspace /></Main>
    </div>
  );
}
