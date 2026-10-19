import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PatientIdentitiesService,
  type VisibleLink,
} from '../../patient-identities/patient-identities.service';
import type { PatientAccountDocument } from '../../patient-identities/schemas/patient-account.schema';
import { FamilyService } from '../../family/family.service';
import type { FamilyCapability } from '../../family/schemas/family-grant.schema';
import type { PortalCtx } from '../portal.context';

export type Subject = {
  account: PatientAccountDocument;
  /** How the caller relates to this person. */
  relation: 'self' | 'dependant' | 'family';
};

export type SubjectLink = VisibleLink & { subject: Subject };

/**
 * Who the caller may act for, and which clinic records that reaches.
 *
 *  - themselves: everything;
 *  - a dependant (child) they manage: everything;
 *  - another adult: only the capabilities that adult has granted them,
 *    and only while the family connection is active.
 *
 * Every portal read or write resolves its target through here. Unknown or
 * unauthorised ids are answered with 404, never 403, so the API cannot be
 * used to discover other people's records.
 */
@Injectable()
export class PortalScopeService {
  constructor(
    private readonly identities: PatientIdentitiesService,
    private readonly family: FamilyService,
  ) {}

  async subjects(
    ctx: PortalCtx,
    capability: FamilyCapability,
  ): Promise<Subject[]> {
    const [dependants, grantorIds] = await Promise.all([
      this.identities.listDependants(ctx.accountId),
      this.family.grantorsFor(ctx.accountId, capability),
    ]);
    const grantors = (await this.identities.findByIds(grantorIds)).filter(
      (a) => a.status === 'ACTIVE' && !!a.phone,
    );
    return [
      { account: ctx.account, relation: 'self' },
      ...dependants.map((account) => ({
        account,
        relation: 'dependant' as const,
      })),
      ...grantors.map((account) => ({ account, relation: 'family' as const })),
    ];
  }

  /** One person the caller may act for with `capability`, or 404. */
  async subject(
    ctx: PortalCtx,
    subjectId: string | undefined,
    capability: FamilyCapability,
  ): Promise<Subject> {
    if (!subjectId || subjectId === ctx.accountId.toHexString()) {
      return { account: ctx.account, relation: 'self' };
    }
    if (!Types.ObjectId.isValid(subjectId))
      throw new NotFoundException('Person not found');
    const found = (await this.subjects(ctx, capability)).find(
      (s) => s.account._id.toHexString() === subjectId,
    );
    if (!found) throw new NotFoundException('Person not found');
    return found;
  }

  /** Visible clinic records of every person the caller may act for with `capability`. */
  async links(
    ctx: PortalCtx,
    capability: FamilyCapability,
    subjects?: Subject[],
  ): Promise<SubjectLink[]> {
    const list = subjects ?? (await this.subjects(ctx, capability));
    const out: SubjectLink[] = [];
    for (const subject of list) {
      const links = await this.identities.visibleLinks(subject.account._id);
      for (const l of links) out.push({ ...l, subject });
    }
    return out;
  }

  /**
   * The link that owns (clinicId, patientId), if the caller may use
   * `capability` on it. This is the ownership check for any record id the
   * client sends.
   */
  async linkFor(
    ctx: PortalCtx,
    clinicId: Types.ObjectId,
    patientId: Types.ObjectId,
    capability: FamilyCapability,
  ): Promise<SubjectLink | null> {
    const links = await this.links(ctx, capability);
    return (
      links.find(
        (l) => l.clinicId.equals(clinicId) && l.patientId.equals(patientId),
      ) ?? null
    );
  }
}
