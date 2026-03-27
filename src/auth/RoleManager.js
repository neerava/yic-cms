/**
 * RoleManager
 *
 * RBAC (Role-Based Access Control) engine for YIC CMS.
 * Roles compose permissions; users may have multiple roles.
 * Permissions are expressed as resource:action pairs with optional
 * path-pattern constraints (e.g. 'content:publish:/en/*').
 */

class Permission {
  constructor(spec) {
    // spec format: 'resource:action[:path-pattern]'
    const parts = spec.split(':');
    this.resource = parts[0];
    this.action = parts[1] ?? '*';
    this.pathPattern = parts[2] ? new RegExp('^' + parts[2].replace(/\*/g, '.*') + '$') : null;
  }

  matches(resource, action, path = null) {
    if (this.resource !== '*' && this.resource !== resource) return false;
    if (this.action !== '*' && this.action !== action) return false;
    if (this.pathPattern && path && !this.pathPattern.test(path)) return false;
    return true;
  }
}

class Role {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.description = def.description ?? '';
    this.permissions = (def.permissions ?? []).map(p => new Permission(p));
    this.inherits = def.inherits ?? [];  // role IDs this role extends
    this.isSystem = def.isSystem ?? false;
  }
}

class RoleManager {
  constructor() {
    this._roles = new Map();
    this._userRoles = new Map();  // userId → Set<roleId>

    // Seed system roles
    this._seedBuiltins();
  }

  _seedBuiltins() {
    this.defineRole({
      id: 'super-admin',
      name: 'Super Admin',
      permissions: ['*:*'],
      isSystem: true,
    });

    this.defineRole({
      id: 'author',
      name: 'Content Author',
      permissions: ['content:read:*', 'content:create', 'content:update', 'asset:read', 'asset:upload'],
      isSystem: true,
    });

    this.defineRole({
      id: 'editor',
      name: 'Content Editor',
      inherits: ['author'],
      permissions: ['content:review', 'content:approve', 'workflow:advance'],
      isSystem: true,
    });

    this.defineRole({
      id: 'publisher',
      name: 'Publisher',
      inherits: ['editor'],
      permissions: ['content:publish:*', 'content:unpublish:*', 'content:schedule'],
      isSystem: true,
    });

    this.defineRole({
      id: 'viewer',
      name: 'Viewer',
      permissions: ['content:read:*', 'asset:read'],
      isSystem: true,
    });

    this.defineRole({
      id: 'api-consumer',
      name: 'API Consumer',
      permissions: ['content:read:*', 'asset:read'],
      isSystem: true,
    });
  }

  defineRole(def) {
    const role = new Role(def);
    this._roles.set(role.id, role);
    return this;
  }

  getRole(id) { return this._roles.get(id) ?? null; }
  listRoles() { return [...this._roles.values()]; }

  // ── User ↔ Role mapping ────────────────────────────────────────────────────────

  assignRole(userId, roleId) {
    if (!this._roles.has(roleId)) throw new Error(`Role not found: ${roleId}`);
    if (!this._userRoles.has(userId)) this._userRoles.set(userId, new Set());
    this._userRoles.get(userId).add(roleId);
    return this;
  }

  revokeRole(userId, roleId) {
    this._userRoles.get(userId)?.delete(roleId);
    return this;
  }

  getRolesForUser(userId) {
    return [...(this._userRoles.get(userId) ?? [])];
  }

  // ── Permission evaluation ─────────────────────────────────────────────────────

  /**
   * Expand a role ID to all inherited permissions (recursive).
   * @param {string} roleId
   * @param {Set<string>} [visited]
   * @returns {Permission[]}
   */
  _expandPermissions(roleId, visited = new Set()) {
    if (visited.has(roleId)) return [];
    visited.add(roleId);

    const role = this._roles.get(roleId);
    if (!role) return [];

    const inherited = role.inherits.flatMap(id => this._expandPermissions(id, visited));
    return [...inherited, ...role.permissions];
  }

  /**
   * Check whether a user is allowed to perform an action.
   * @param {string} userId
   * @param {string} resource   e.g. 'content'
   * @param {string} action     e.g. 'publish'
   * @param {string} [path]     e.g. '/en/homepage'
   * @returns {boolean}
   */
  can(userId, resource, action, path = null) {
    const roleIds = this.getRolesForUser(userId);

    for (const roleId of roleIds) {
      const permissions = this._expandPermissions(roleId);
      if (permissions.some(p => p.matches(resource, action, path))) return true;
    }

    return false;
  }

  /** Assert permission; throws 403 if denied. */
  assert(userId, resource, action, path = null) {
    if (!this.can(userId, resource, action, path)) {
      throw Object.assign(
        new Error(`Forbidden: ${userId} cannot ${action} on ${resource}${path ? ':' + path : ''}`),
        { status: 403 }
      );
    }
  }
}

module.exports = new RoleManager();
