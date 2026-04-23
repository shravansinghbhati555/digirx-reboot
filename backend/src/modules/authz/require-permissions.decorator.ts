import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const PERMISSIONS_KEY = 'permissions_required';

export function RequirePermissions(...permissions: Permission[]) {
  return SetMetadata(PERMISSIONS_KEY, permissions);
}
