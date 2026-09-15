import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../authz/schemas/user.schema';
import type { AppRequest } from '../../common/types';

/**
 * Gate for the cross-tenant platform endpoints.
 *
 * Everything else in this API is scoped to one clinic. These routes are not,
 * so access hangs off `User.isPlatformAdmin` — a flag that cannot be set
 * through the API at all (see `pnpm platform:grant`). A clinic's own Super
 * Admin holds every Permission in the enum, so expressing this as a
 * permission would have handed cross-tenant reads to every customer.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const actorUserId = req.context?.actorUserId;
    if (!actorUserId) throw new ForbiddenException('Missing authentication context');

    const user = await this.userModel
      .findById(actorUserId)
      .select({ isPlatformAdmin: 1, status: 1 })
      .lean();

    if (!user?.isPlatformAdmin || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Platform administrator access required');
    }
    return true;
  }
}
