// What the chat page shows once its first load has ended. A closed flag, a signed-out reader and a failed load all
// leave the model list empty, so each is told apart before the page says there are no models.
// No imports: the tests load this file directly.

/**
 * What a failed chat request means for the page. The gateway throws a 401 both when there is no token and when the
 * server refused the one it sent.
 * @param {{status?: number, code?: string} | undefined} error
 * @returns {'closed' | 'signed_out' | 'failed'}
 */
export function loadFailure(error) {
  if (error?.code === 'chat_not_open') return 'closed';
  if (error?.status === 401) return 'signed_out';
  return 'failed';
}

/**
 * Closed first: with CHAT_ENABLED off nobody has chat, signed in or not. Signed out comes before the model count
 * because a session can end while the models are still in memory.
 * @returns {'closed' | 'signed_out' | 'failed' | 'no_models' | 'ready'}
 */
export function chatScreen({ closed, signedOut, loadFailed, modelCount }) {
  if (closed) return 'closed';
  if (signedOut) return 'signed_out';
  if (loadFailed) return 'failed';
  return modelCount > 0 ? 'ready' : 'no_models';
}

/** Title and body for every screen that is not the workspace. A failed load shows its own reason when it has one. */
export const CHAT_SCREEN_COPY = {
  closed: { title: 'LLM Chat is not open yet', body: 'We will open it here when it is ready.' },
  no_models: { title: 'LLM Chat is not open yet', body: 'There are no chat models available right now.' },
  signed_out: { title: 'Sign in to use LLM Chat', body: 'Your chats are kept with your account.' },
  failed: { title: 'LLM Chat did not load', body: "That didn't work. Try again." },
};
