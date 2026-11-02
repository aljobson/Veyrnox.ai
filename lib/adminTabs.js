// Navigation uses the server's permission projection; SQL remains authoritative.
export const ADMIN_TABS = Object.freeze([
  { id: 'users', label: 'Users', permission: 'users.read', built: true },
  { id: 'payments', label: 'Payments and analytics', permission: 'payments', built: true },
  { id: 'changes', label: 'Changes', permission: 'changes.read', built: true },
  { id: 'affiliates', label: 'Affiliates', permission: 'affiliates', built: true },
  { id: 'endpoints', label: 'Endpoints', permission: 'endpoints', built: true },
  { id: 'roles', label: 'Roles', permission: 'roles.write', built: true },
  { id: 'switches', label: 'On/off switches', permission: 'switches.write', built: true },
  { id: 'plans', label: 'Plans and features', permission: 'plans.read', built: true },
  { id: 'traffic', label: 'Traffic', permission: 'traffic', built: true },
  { id: 'support', label: 'Support', permission: 'support', built: true },
]);
const EXISTING = ['violations', 'appeals', 'reports', 'webhooks', 'security', 'cinema'];
export function visibleAdminTabs({ isAdmin = false, permissions = [] } = {}) {
  if (!isAdmin) return [];
  return [
    ...ADMIN_TABS.filter(tab => tab.built && permissions.includes(tab.permission)),
    // Hiding a link does not retrofit authorization onto these existing routes.
    ...EXISTING.filter(id => permissions.includes(id)).map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
  ];
}
