// English-only wording for /mcp and the OAuth consent screen while PUBLISH_AUTOMATION_ENABLED is on (ADR-0112).
// Kept out of the language catalogs, which must match English key for key: translate these when the switch is turned on.
export const MCP_PUBLISH_COPY = {
  'mcp.pub.lead': 'Give an MCP-compatible assistant access to Veyrnox models, exact credit estimates, generation jobs and your finished Library assets, and, with a Publish Plan, let it schedule posts to your connected accounts.',
  'mcp.pub.s3.body': 'Ask about models, costs, recent generations, finished assets, your scheduled posts and analytics. Start anything new in the Veyrnox app.',
  'mcp.pub.what.title': 'One connector. Twelve tools.',
  'mcp.pub.what.p': 'Five tools read your Veyrnox account and never spend credits. Four read your Publish accounts, posts and analytics. Three change scheduled posts: schedule, reschedule and cancel.',
  'mcp.tool.publish_list_brands': 'List the Publish brands you can act on.',
  'mcp.tool.publish_list_accounts': 'See your connected social accounts and which networks are open.',
  'mcp.tool.publish_list_posts': 'List scheduled, published, failed or canceled posts in a window of up to 43 days.',
  'mcp.tool.publish_get_analytics': 'Summarize analytics for one connected account (Publish Plan).',
  'mcp.tool.publish_schedule_post': 'Schedule a post at least 10 minutes ahead, using your own media (Publish Plan).',
  'mcp.tool.publish_reschedule_post': 'Move a scheduled post that has not started publishing (Publish Plan).',
  'mcp.tool.publish_cancel_post': 'Cancel a scheduled post that has not started publishing (Publish Plan).',
  'mcp.pub.safe.kicker': 'Limits that stay on',
  'mcp.pub.safe.title': 'It cannot charge you or post on the spot.',
  'mcp.pub.safe.p1': 'The assistant can calculate a live maximum price, but only the signed-in Veyrnox app can start a generation. It can schedule a post at least 10 minutes ahead, move it or cancel it; it cannot publish immediately.',
  'mcp.pub.safe.p2': 'Scheduling and analytics need a Publish Plan, posts use only media from your own generations and uploads, and OAuth tokens are confined to this connector endpoint.',
  'mcp.pub.safe.p3': 'You can review and revoke every assistant connection from Account & security. Revoking stops it scheduling or canceling posts.',
};
