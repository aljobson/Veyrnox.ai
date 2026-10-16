const activityLabels = {
  connected: 'Connected an account', disconnected: 'Disconnected an account', created_post: 'Created a post',
  rescheduled_post: 'Rescheduled a post', post_rescheduled: 'Rescheduled a post', approved_draft: 'Approved drafts',
  approve_drafts: 'Approved drafts', discarded_draft: 'Discarded drafts', discard_drafts: 'Discarded drafts',
  save_content_preset: 'Saved a content preset', delete_content_preset: 'Deleted a content preset',
  save_publish_queue: 'Saved a posting queue', delete_publish_queue: 'Deleted a posting queue', queue_social_post: 'Queued a post',
  save_smartlink: 'Saved the SmartLink', read: 'Marked a conversation read', unread: 'Marked a conversation unread',
  resolve: 'Resolved a conversation', reopen: 'Reopened a conversation', reply_created: 'Sent an inbox reply',
  invited: 'Invited a team member', accepted: 'Joined the team', role_changed: 'Changed a team role', removed: 'Removed a team member',
  invite_revoked: 'Revoked a team invitation', requested: 'Requested approval', approved: 'Approved a post',
  rejected: 'Rejected a post', canceled: 'Canceled an approval', canceled_post: 'Canceled a post', restored_post: 'Restored a post',
  save_report_template: 'Saved a report template', delete_report_template: 'Deleted a report template',
  create_api_key: 'Created an API key', revoke_api_key: 'Revoked an API key',
  create_webhook: 'Created a webhook', revoke_webhook: 'Revoked a webhook',
  save_publish_autolist: 'Saved an RSS Autolist', delete_autolist: 'Deleted an RSS Autolist', autolist_schedule: 'Scheduled an RSS feed item',
  contact_update: 'Updated a contact', contact_import: 'Imported contacts', internal_note: 'Added an internal note',
  assign: 'Assigned a conversation', unassign: 'Unassigned a conversation', labels: 'Updated conversation labels',
  priority: 'Changed conversation priority', tags: 'Updated conversation tags',
  save_workflow: 'Saved an inbox workflow', create_workflow: 'Created an inbox workflow', update_workflow: 'Updated an inbox workflow', delete_workflow: 'Deleted an inbox workflow',
  use_suggestion: 'Used a suggested inbox reply', dismiss_suggestion: 'Dismissed a suggested inbox reply',
  save_ad_campaign: 'Saved an ad campaign', delete_ad_campaign: 'Deleted an ad campaign',
  save_product: 'Saved a product', archive_product: 'Archived a product',
};

export const canEditPublishing = (role) => ['owner', 'manager', 'editor'].includes(role);

export function activityLabel(action) {
  if (!action || typeof action !== 'string') return 'Updated publishing settings';
  if (activityLabels[action]) return activityLabels[action];
  const words = action.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function activityLoadError(error, older = false) {
  if (error?.status === 402) return {
    message: 'The Publish Plan is required to view brand activity.', planHref: '/app/publish/plan',
  };
  if (error?.status === 403) return { message: 'Your role cannot view the brand activity log.', planHref: null };
  return { message: older ? 'Could not load older activity. Try again.' : 'Could not load brand activity. Try again.', planHref: null };
}

export function reportDeliverySummary(template) {
  if (!['weekly', 'monthly'].includes(template.delivery_cadence)) return 'Run and download this report manually.';
  const count = template.delivery_recipients?.length || 0;
  return `Delivers ${template.delivery_format?.toUpperCase() || 'PDF'} to ${count} recipient${count === 1 ? '' : 's'}`;
}
