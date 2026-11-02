// Mirrored once in admin_role_permissions (0428); agreement is tested.
export const ADMIN_PERMISSIONS = Object.freeze({
  owner: ['users.read','payments','changes.read','affiliates','endpoints','plans.read','plans.write','traffic','support','support.write','roles.write','switches.write','violations','appeals','reports','cinema','webhooks','security'],
  finance: ['payments','affiliates','plans.read'],
  support: ['users.read','support','support.write','changes.read'],
  moderator: ['violations','appeals','reports','cinema'],
  viewer: ['users.read','payments','changes.read','affiliates','endpoints','plans.read','traffic'],
});
export const ADMIN_ROLES = Object.freeze(Object.keys(ADMIN_PERMISSIONS));
export function adminCan(role, permission, isAdmin = false) {
  return isAdmin && Object.hasOwn(ADMIN_PERMISSIONS,role) && ADMIN_PERMISSIONS[role].includes(permission);
}
