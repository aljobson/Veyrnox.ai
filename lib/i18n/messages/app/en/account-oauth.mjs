// Signed-in app copy (ADR-0107 phase B).
const messages = {
  "app.account.oauth.assistant": "Connected assistant",
  "app.account.oauth.loadFailed": "Connected assistants could not be loaded. Try again.",
  "app.account.oauth.revoked": "{name} no longer has access.",
  "app.account.oauth.failed": "That connection could not be revoked. Try again.",
  "app.account.oauth.title": "Connected assistants",
  "app.account.oauth.help": "Review and revoke apps connected through Veyrnox OAuth. Revoking also ends that client’s active sessions.",
  "app.account.oauth.loading": "Loading connections…",
  "app.account.oauth.empty": "No assistants are connected.",
  "app.account.oauth.access": "Access: {scopes}",
  "app.account.oauth.defaultAccess": "Veyrnox access: read, small image generations, and video generations and edits",
  "app.account.oauth.date": " · Connected {date}",
  "app.account.oauth.revoke": "Revoke access",
  "app.account.oauth.confirm": "Revoke {name}?",
  "app.account.oauth.body": "The assistant will be signed out and must ask for approval again before it can read your Veyrnox data."
};
export default messages;
