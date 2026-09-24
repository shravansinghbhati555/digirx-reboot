import { RequestContext } from './request-context';
import { Request } from 'express';

export type AppRequest = Request & {
  context?: RequestContext;
  // Lowercased role names of the authenticated actor, populated by
  // PermissionsGuard. Lets handlers do role-based checks (e.g. only
  // Manager / Super Admin may rename the clinic) without re-querying.
  actorRoleNames?: Set<string>;
  /**
   * The actor's flattened permission set, populated by PermissionsGuard.
   * For handlers whose required permission depends on the request body,
   * which the guard's static metadata cannot express.
   */
  actorPermissions?: Set<string>;
};
