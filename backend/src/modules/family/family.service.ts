import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FamilyConnection,
  FamilyConnectionDocument,
  FamilyConnectionStatus,
} from './schemas/family-connection.schema';
import {
  FAMILY_CAPABILITIES,
  FamilyCapability,
  FamilyGrant,
} from './schemas/family-grant.schema';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from '../notifications/providers/notification-provider';
import { NotificationChannel } from '../notifications/schemas/notification-template.schema';

export type Grants = Record<FamilyCapability, boolean>;
export const NO_GRANTS: Grants = {
  book: false,
  rx: false,
  reports: false,
  bills: false,
};

/** An account as far as family logic needs it. */
export type FamilyActor = {
  _id: Types.ObjectId;
  phone?: string;
  dialCode?: string;
  fullName?: string;
};

const MAX_INVITES_PER_DAY = 10;

function toGrants(g?: Partial<Grants> | null): Grants {
  return {
    book: !!g?.book,
    rx: !!g?.rx,
    reports: !!g?.reports,
    bills: !!g?.bills,
  };
}

@Injectable()
export class FamilyService {
  private readonly logger = new Logger(FamilyService.name);

  constructor(
    @InjectModel(FamilyConnection.name)
    private readonly connModel: Model<FamilyConnection>,
    @InjectModel(FamilyGrant.name)
    private readonly grantModel: Model<FamilyGrant>,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly sender: NotificationProvider,
  ) {}

  /**
   * Invite another adult by mobile number. The response is the same whether
   * or not that number has an account, so invites cannot be used to find out
   * who uses DigiRx. Nothing is shared until they accept AND turn on grants.
   */
  async invite(
    actor: FamilyActor,
    input: {
      phone: string;
      label?: string;
      relation?: string;
      /** Account already registered on `phone`, if any (looked up by the caller). */
      targetAccountId?: Types.ObjectId;
    },
  ): Promise<FamilyConnectionDocument> {
    if (actor.phone && input.phone === actor.phone) {
      throw new BadRequestException('You cannot invite yourself');
    }
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.connModel.countDocuments({
      requesterId: actor._id,
      createdAt: { $gte: dayAgo },
    });
    if (recent >= MAX_INVITES_PER_DAY) {
      throw new BadRequestException(
        'Too many invites today. Try again tomorrow.',
      );
    }
    const open = await this.connModel.findOne({
      $or: [
        { requesterId: actor._id, targetPhone: input.phone },
        // They already invited (or are connected to) the actor.
        ...(input.targetAccountId
          ? [
              { requesterId: input.targetAccountId, targetId: actor._id },
              ...(actor.phone
                ? [
                    {
                      requesterId: input.targetAccountId,
                      targetPhone: actor.phone,
                    },
                  ]
                : []),
            ]
          : []),
      ],
      status: {
        $in: [FamilyConnectionStatus.Pending, FamilyConnectionStatus.Active],
      },
    });
    if (open)
      throw new ConflictException(
        'You already have an invite or connection with this number',
      );

    let conn: FamilyConnectionDocument;
    try {
      conn = await this.connModel.create({
        requesterId: actor._id,
        targetPhone: input.phone,
        targetLabel: input.label?.trim(),
        relation: input.relation?.trim(),
        status: FamilyConnectionStatus.Pending,
      });
    } catch (e: any) {
      if (e?.code === 11000)
        throw new ConflictException(
          'You already have an invite or connection with this number',
        );
      throw e;
    }

    const who =
      (actor.fullName ?? '').trim().split(/\s+/)[0] || 'A family member';
    try {
      await this.sender.send({
        channel: NotificationChannel.Sms,
        to: `+${actor.dialCode ?? '91'}${input.phone}`,
        body: `${who} invited you to connect as family on DigiRx. Nothing is shared unless you choose. Sign in with this number to respond.`,
      });
    } catch (e) {
      this.logger.warn(
        `Family invite SMS failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return conn;
  }

  /** Every pending/active connection the account is part of. */
  async listConnections(
    actor: FamilyActor,
  ): Promise<FamilyConnectionDocument[]> {
    const or: Record<string, unknown>[] = [
      { requesterId: actor._id },
      { targetId: actor._id },
    ];
    if (actor.phone) or.push({ targetPhone: actor.phone, targetId: null });
    return this.connModel
      .find({
        $or: or,
        status: {
          $in: [FamilyConnectionStatus.Pending, FamilyConnectionStatus.Active],
        },
      })
      .sort({ createdAt: 1 });
  }

  private async findForActor(
    actor: FamilyActor,
    id: string,
  ): Promise<FamilyConnectionDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Invite not found');
    const conn = await this.connModel.findById(id);
    if (!conn || !this.involves(conn, actor))
      throw new NotFoundException('Invite not found');
    return conn;
  }

  private isTarget(conn: FamilyConnection, actor: FamilyActor): boolean {
    if (conn.targetId) return conn.targetId.equals(actor._id);
    return !!actor.phone && conn.targetPhone === actor.phone;
  }

  private involves(conn: FamilyConnection, actor: FamilyActor): boolean {
    return conn.requesterId.equals(actor._id) || this.isTarget(conn, actor);
  }

  /** The other side of a connection, if they have an account. */
  otherParty(
    conn: FamilyConnection,
    actor: FamilyActor,
  ): Types.ObjectId | undefined {
    return conn.requesterId.equals(actor._id)
      ? conn.targetId
      : conn.requesterId;
  }

  async respond(
    actor: FamilyActor,
    id: string,
    accept: boolean,
  ): Promise<FamilyConnectionDocument> {
    const conn = await this.findForActor(actor, id);
    if (!this.isTarget(conn, actor))
      throw new NotFoundException('Invite not found');
    if (conn.status !== FamilyConnectionStatus.Pending) {
      throw new BadRequestException('This invite has already been answered');
    }
    conn.targetId = actor._id;
    conn.status = accept
      ? FamilyConnectionStatus.Active
      : FamilyConnectionStatus.Declined;
    conn.respondedAt = new Date();
    await conn.save();
    return conn;
  }

  /**
   * Cancel an outgoing invite or end a connection. Grants in BOTH
   * directions are deleted, so access stops at once.
   */
  async remove(actor: FamilyActor, id: string): Promise<void> {
    const conn = await this.findForActor(actor, id);
    const other = this.otherParty(conn, actor);
    conn.status =
      conn.status === FamilyConnectionStatus.Pending
        ? conn.requesterId.equals(actor._id)
          ? FamilyConnectionStatus.Cancelled
          : FamilyConnectionStatus.Declined
        : FamilyConnectionStatus.Removed;
    conn.respondedAt = new Date();
    await conn.save();
    if (other) {
      await this.grantModel.deleteMany({
        $or: [
          { granterId: actor._id, granteeId: other },
          { granterId: other, granteeId: actor._id },
        ],
      });
    }
  }

  /** Set what the actor lets the other person do. Requires an active connection. */
  async setGrants(
    actor: FamilyActor,
    connectionId: string,
    patch: Partial<Grants>,
  ): Promise<Grants> {
    const conn = await this.findForActor(actor, connectionId);
    const other = this.otherParty(conn, actor);
    if (conn.status !== FamilyConnectionStatus.Active || !other) {
      throw new BadRequestException(
        'Permissions can be set once the invite is accepted',
      );
    }
    const set: Partial<Grants> = {};
    for (const k of FAMILY_CAPABILITIES)
      if (typeof patch[k] === 'boolean') set[k] = patch[k];
    const doc = await this.grantModel.findOneAndUpdate(
      { granterId: actor._id, granteeId: other },
      { $set: set },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return toGrants(doc);
  }

  /** Grants between the actor and each other account: what they allow / what the actor allows. */
  async grantsWith(actorId: Types.ObjectId, others: Types.ObjectId[]) {
    if (!others.length)
      return new Map<
        string,
        { theyAllow: Grants; youAllow: Grants; changedAt?: Date }
      >();
    const rows = await this.grantModel
      .find({
        $or: [
          { granterId: actorId, granteeId: { $in: others } },
          { granteeId: actorId, granterId: { $in: others } },
        ],
      })
      .lean();
    const out = new Map<
      string,
      { theyAllow: Grants; youAllow: Grants; changedAt?: Date }
    >();
    for (const o of others)
      out.set(String(o), {
        theyAllow: { ...NO_GRANTS },
        youAllow: { ...NO_GRANTS },
      });
    for (const r of rows) {
      if (r.granterId.equals(actorId)) {
        const e = out.get(String(r.granteeId))!;
        e.youAllow = toGrants(r);
        if (r.updatedAt && (!e.changedAt || r.updatedAt > e.changedAt))
          e.changedAt = r.updatedAt;
      } else {
        out.get(String(r.granterId))!.theyAllow = toGrants(r);
      }
    }
    return out;
  }

  /** Accounts that let `actorId` use `capability` on their behalf, with an active connection. */
  async grantorsFor(
    actorId: Types.ObjectId,
    capability: FamilyCapability,
  ): Promise<Types.ObjectId[]> {
    const grants = await this.grantModel
      .find({ granteeId: actorId, [capability]: true })
      .lean();
    if (!grants.length) return [];
    const ids = grants.map((g) => g.granterId);
    const active = await this.connModel
      .find({
        status: FamilyConnectionStatus.Active,
        $or: [
          { requesterId: actorId, targetId: { $in: ids } },
          { targetId: actorId, requesterId: { $in: ids } },
        ],
      })
      .lean();
    const connected = new Set(
      active.map((c) =>
        String(c.requesterId.equals(actorId) ? c.targetId : c.requesterId),
      ),
    );
    return ids.filter((id) => connected.has(String(id)));
  }

  /** True when `subjectId` lets `actorId` use `capability` and they are still connected. */
  async can(
    actorId: Types.ObjectId,
    subjectId: Types.ObjectId,
    capability: FamilyCapability,
  ): Promise<boolean> {
    const grantors = await this.grantorsFor(actorId, capability);
    return grantors.some((g) => g.equals(subjectId));
  }
}
