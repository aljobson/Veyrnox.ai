// English-only wording for /mcp and the OAuth consent screen while PUBLISH_AUTOMATION_ENABLED is on (ADR-0112).
// Kept out of the language catalogs, which must match English key for key: translate these when the switch is turned on.
export const MCP_PUBLISH_COPY = {
  'mcp.pub.lead': 'Give an MCP-compatible assistant access to Veyrnox models, exact credit estimates, generation jobs and your finished Library assets, plus small image generations at a confirmed price and, with a Publish Plan, scheduling of posts to your connected accounts.',
  'mcp.pub.s3.body': 'Ask about models, costs, recent generations, finished assets, your scheduled posts and analytics. For a small image, the assistant shows the price first. Everything else starts in the Veyrnox app.',
  'mcp.pub.what.title': 'One connector. Thirteen tools.',
  'mcp.pub.what.p': 'Five tools only read your Veyrnox account. One starts a small text-to-image generation at a confirmed price: at most 2 credits each and 40 credits a day per account. Four read your Publish accounts, posts and analytics. Three change scheduled posts: schedule, reschedule and cancel. Scheduling never spends credits.',
  'mcp.tool.publish_list_brands': 'List the Publish brands you can act on.',
  'mcp.tool.publish_list_accounts': 'See your connected social accounts and which networks are open.',
  'mcp.tool.publish_list_posts': 'List scheduled, published, failed or canceled posts in a window of up to 43 days.',
  'mcp.tool.publish_get_analytics': 'Summarize analytics for one connected account (Publish Plan).',
  'mcp.tool.publish_schedule_post': 'Schedule a post at least 10 minutes ahead, using your own media (Publish Plan).',
  'mcp.tool.publish_reschedule_post': 'Move a scheduled post that has not started publishing (Publish Plan).',
  'mcp.tool.publish_cancel_post': 'Cancel a scheduled post that has not started publishing (Publish Plan).',
  'mcp.pub.safe.kicker': 'Limits that stay on',
  'mcp.pub.safe.title': 'The price comes first, and posts wait.',
  'mcp.pub.safe.p1': 'The assistant must estimate a generation and send that exact price back with the request. If the price has changed, Veyrnox refuses the request and charges nothing. A post can only be scheduled at least 10 minutes ahead; the assistant cannot publish immediately.',
  'mcp.pub.safe.p2': 'Each image costs at most 2 credits, and the connector will not spend more than 40 credits a day on an account. Scheduling and analytics need a Publish Plan, and posts use only media from your own generations and uploads.',
  'mcp.pub.safe.p3': 'OAuth tokens are confined to this connector endpoint and cannot be reused against the rest of the Veyrnox API. You can review and revoke every assistant connection from Account & security; revoking stops it scheduling or canceling posts.',
};
