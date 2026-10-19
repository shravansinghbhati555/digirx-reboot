import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  FamilyService,
  NO_GRANTS,
  type Grants,
} from '../../family/family.service';
import { FamilyConnectionStatus } from '../../family/schemas/family-connection.schema';
import { PatientIdentitiesService } from '../../patient-identities/patient-identities.service';
import { PatientAccountGender } from '../../patient-identities/schemas/patient-account.schema';
import {
  ageOn,
  maskPhone,
  normalizePortalPhone,
} from '../../patient-identities/identity.utils';
import type { PortalCtx } from '../portal.context';
import type { PortalFamilyMemberView } from '../views/portal-view.types';
import { colorFor, firstNameOf, initialsOf } from '../views/portal.mappers';
import {
  composedFamilyRole,
  displayRelation,
  familyRole,
  inverseFamilyRole,
  type FamilyRole,
} from './family-relations';
import type { PatientAccountDocument } from '../../patient-identities/schemas/patient-account.schema';

const ALL: Grants = { book: true, rx: true, reports: true, bills: true };

function since(d?: Date): string | undefined {
  return d ? DateTime.fromJSDate(new Date(d)).toFormat('LLL yyyy') : undefined;
}

function ago(d?: Date): string {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

@Injectable()
export class PortalFamilyService {
  constructor(
    private readonly family: FamilyService,
    private readonly identities: PatientIdentitiesService,
  ) {}

  async list(ctx: PortalCtx): Promise<PortalFamilyMemberView[]> {
    const me = ctx.account;
    const [dependants, conns] = await Promise.all([
      this.identities.listDependants(me._id),
      this.family.listConnections({ _id: me._id, phone: me.phone }),
    ]);

    const views: PortalFamilyMemberView[] = dependants.map((d) => {
      const name = d.fullName ?? 'Family member';
      return {
        id: d._id.toHexString(),
        name,
        firstName: firstNameOf(name),
        initials: initialsOf(name),
        color: colorFor(d._id.toHexString()),
        relation: d.relation || 'Child',
        kind: 'dependant',
        note: 'Dependant under 18',
        age: d.dob ? (ageOn(d.dob) ?? undefined) : undefined,
        // You manage everything for a dependant; they grant nothing back.
        theyAllow: { ...ALL },
        youAllow: { ...NO_GRANTS },
      };
    });

    const otherIds = conns
      .map((c) => this.family.otherParty(c, me))
      .filter((x): x is Types.ObjectId => !!x);
    const [others, grants] = await Promise.all([
      this.identities.findByIds(otherIds),
      this.family.grantsWith(me._id, otherIds),
    ]);
    const otherBy = new Map(others.map((o) => [o._id.toHexString(), o]));

    for (const c of conns) {
      const outgoing = c.requesterId.equals(me._id);
      const otherId = this.family.otherParty(c, me);
      const other = otherId ? otherBy.get(otherId.toHexString()) : undefined;
      const connectionId = c._id.toHexString();

      if (c.status === FamilyConnectionStatus.Active && other) {
        const name = other.fullName ?? 'Family member';
        const g = grants.get(other._id.toHexString());
        const role = outgoing
          ? familyRole(c.relation)
          : inverseFamilyRole(familyRole(c.relation));
        views.push({
          id: other._id.toHexString(),
          connectionId,
          name,
          firstName: firstNameOf(name),
          initials: initialsOf(name),
          color: colorFor(other._id.toHexString()),
          relation: displayRelation(
            role,
            outgoing ? c.relation : undefined,
            other.gender,
          ),
          kind: 'linked',
          note: 'Own DigiRx account',
          age: other.dob ? (ageOn(other.dob) ?? undefined) : undefined,
          linkedSince: since(c.respondedAt),
          theyAllow: g?.theyAllow ?? { ...NO_GRANTS },
          youAllow: g?.youAllow ?? { ...NO_GRANTS },
          grantsChangedOn: g?.changedAt ? ago(g.changedAt) : undefined,
        });
        continue;
      }
      if (c.status !== FamilyConnectionStatus.Pending) continue;
      // Pending: show only what the viewer already knows — the name they
      // typed (outgoing) or the requester's first name (incoming).
      const label = outgoing
        ? c.targetLabel || maskPhone(c.targetPhone)
        : `${firstNameOf(other?.fullName ?? '') || 'Someone'} (${maskPhone(other?.phone ?? '')})`;
      views.push({
        id: connectionId,
        connectionId,
        incoming: !outgoing,
        name: label,
        firstName: firstNameOf(label) || label,
        initials: initialsOf(label),
        color: '#FDFCFB',
        relation: (outgoing ? c.relation : undefined) || 'Family',
        kind: 'pending',
        note: outgoing
          ? `Invite sent ${ago(c.createdAt)}`
          : 'Wants to connect with you',
        theyAllow: { ...NO_GRANTS },
        youAllow: { ...NO_GRANTS },
      });
    }

    // Someone who just joined should see the tree the inviter already had,
    // not only the single person who invited them.
    const seen = new Set<string>([
      me._id.toHexString(),
      ...views.map((v) => v.id),
    ]);
    const linked = views.filter((v) => v.kind === 'linked');
    for (const link of linked) {
      const howISee = familyRole(link.relation);
      const relatives = await this.relativesOf(link.id);
      for (const rel of relatives) {
        if (seen.has(rel.id)) continue;
        const role = composedFamilyRole(howISee, rel.role);
        if (!role) continue;
        seen.add(rel.id);
        const name = rel.account.fullName ?? 'Family member';
        views.push({
          id: rel.id,
          name,
          firstName: firstNameOf(name),
          initials: initialsOf(name),
          color: colorFor(rel.id),
          relation: displayRelation(role, rel.original, rel.account.gender),
          kind: 'linked',
          shared: true,
          note: `In ${link.firstName}'s family`,
          age: rel.account.dob ? (ageOn(rel.account.dob) ?? undefined) : undefined,
          theyAllow: { ...NO_GRANTS },
          youAllow: { ...NO_GRANTS },
        });
      }
    }
    return views;
  }

  /**
   * People on this account's own tree, labelled the way this account sees
   * them. Used to mirror that tree onto someone they are connected to.
   */
  private async relativesOf(
    accountId: string,
  ): Promise<
    Array<{
      id: string;
      role: FamilyRole;
      original?: string;
      account: PatientAccountDocument;
    }>
  > {
    if (!Types.ObjectId.isValid(accountId)) return [];
    const account = await this.identities.getById(new Types.ObjectId(accountId));
    if (!account) return [];
    const actor = { _id: account._id, phone: account.phone };
    const [dependants, conns] = await Promise.all([
      this.identities.listDependants(account._id),
      this.family.listConnections(actor),
    ]);
    const out: Array<{
      id: string;
      role: FamilyRole;
      original?: string;
      account: PatientAccountDocument;
    }> = dependants.map((d) => ({
      id: d._id.toHexString(),
      role: familyRole(d.relation),
      original: d.relation,
      account: d,
    }));
    const linkedIds: Types.ObjectId[] = [];
    const linkedMeta: Array<{
      id: string;
      role: FamilyRole;
      original?: string;
    }> = [];
    for (const c of conns) {
      if (c.status !== FamilyConnectionStatus.Active) continue;
      const otherId = this.family.otherParty(c, actor);
      if (!otherId) continue;
      const outgoing = c.requesterId.equals(account._id);
      linkedIds.push(otherId);
      linkedMeta.push({
        id: otherId.toHexString(),
        role: outgoing
          ? familyRole(c.relation)
          : inverseFamilyRole(familyRole(c.relation)),
        original: outgoing ? c.relation : undefined,
      });
    }
    const accounts = await this.identities.findByIds(linkedIds);
    const byId = new Map(accounts.map((a) => [a._id.toHexString(), a]));
    for (const meta of linkedMeta) {
      const person = byId.get(meta.id);
      if (!person) continue;
      out.push({ ...meta, account: person });
    }
    return out;
  }

  async addDependant(
    ctx: PortalCtx,
    input: {
      fullName: string;
      dob: string;
      gender?: PatientAccountGender;
      relation?: string;
    },
  ) {
    const dep = await this.identities.createDependant(ctx.account, input);
    // Link the child's existing clinic records (guardian's mobile + child's DOB).
    await this.identities.syncLinks(dep);
    return dep;
  }

  async invite(
    ctx: PortalCtx,
    input: { phone: string; name?: string; relation?: string },
  ) {
    const phone = normalizePortalPhone(input.phone, ctx.account.dialCode);
    if (!phone) throw new BadRequestException('Enter a valid mobile number');
    const target = await this.identities.findLoginAccountByPhone(phone);
    await this.family.invite(
      {
        _id: ctx.accountId,
        phone: ctx.account.phone,
        dialCode: ctx.account.dialCode,
        fullName: ctx.account.fullName,
      },
      {
        phone,
        label: input.name,
        relation: input.relation,
        targetAccountId: target?._id,
      },
    );
    // Same answer whether or not the number has an account.
    return { sent: true };
  }

  respond(ctx: PortalCtx, connectionId: string, accept: boolean) {
    return this.family.respond(
      { _id: ctx.accountId, phone: ctx.account.phone },
      connectionId,
      accept,
    );
  }

  /** Remove a dependant (by id) or end/cancel a connection (by connection id). */
  async remove(ctx: PortalCtx, id: string) {
    const deps = await this.identities.listDependants(ctx.accountId);
    if (deps.some((d) => d._id.toHexString() === id)) {
      await this.identities.removeDependant(ctx.accountId, id);
      return;
    }
    await this.family.remove(
      { _id: ctx.accountId, phone: ctx.account.phone },
      id,
    );
  }

  setGrants(ctx: PortalCtx, connectionId: string, patch: Partial<Grants>) {
    return this.family.setGrants(
      { _id: ctx.accountId, phone: ctx.account.phone },
      connectionId,
      patch,
    );
  }
}
