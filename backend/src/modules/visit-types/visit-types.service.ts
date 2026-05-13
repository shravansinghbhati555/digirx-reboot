import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permissions';
import { VisitType } from './schemas/visit-type.schema';
import { CreateVisitTypeDto } from './dto/create-visit-type.dto';
import { UpdateVisitTypeDto } from './dto/update-visit-type.dto';

@Injectable()
export class VisitTypesService {
  constructor(
    @InjectModel(VisitType.name) private readonly model: Model<VisitType>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    private readonly authz: AuthzService,
  ) {}

  /**
   * Doctors can edit their own catalog. Anyone with ClinicWrite can edit
   * any doctor's catalog. Same authorization shape as availability rules
   * so the UX is consistent.
   */
  private async assertCanWriteFor(input: {
    clinicId: Types.ObjectId;
    actorUserId?: Types.ObjectId;
    doctorUserId: Types.ObjectId;
  }) {
    if (!input.actorUserId) {
      throw new ForbiddenException('Missing actor identity');
    }
    if (input.actorUserId.equals(input.doctorUserId)) return;
    const actor = await this.authz.getActor({
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
    });
    if (!actor.permissions.includes(Permission.ClinicWrite)) {
      throw new ForbiddenException(
        "You can only edit your own visit-type catalog",
      );
    }
  }

  async list(clinicId: Types.ObjectId, doctorUserId?: string, includeInactive = false) {
    const filter: Record<string, unknown> = { clinicId };
    if (doctorUserId) {
      if (!Types.ObjectId.isValid(doctorUserId)) {
        throw new BadRequestException('Invalid doctorUserId');
      }
      filter.doctorUserId = new Types.ObjectId(doctorUserId);
    }
    if (!includeInactive) filter.active = true;
    return await this.model.find(filter).sort({ name: 1 });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Visit type not found');
    }
    const row = await this.model.findOne({ _id: id, clinicId });
    if (!row) throw new NotFoundException('Visit type not found');
    return row;
  }

  async create(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    dto: CreateVisitTypeDto,
  ) {
    const doctorUserId = new Types.ObjectId(dto.doctorUserId);
    await this.assertCanWriteFor({ clinicId, actorUserId, doctorUserId });

    const currency = await this.resolveCurrency(clinicId, dto.currency);

    try {
      return await this.model.create({
        clinicId,
        doctorUserId,
        name: dto.name.trim(),
        price: dto.price,
        currency,
        active: true,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `A visit type named "${dto.name.trim()}" already exists for this doctor`,
        );
      }
      throw err;
    }
  }

  async update(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    id: string,
    dto: UpdateVisitTypeDto,
  ) {
    const row = await this.getById(clinicId, id);
    await this.assertCanWriteFor({
      clinicId,
      actorUserId,
      doctorUserId: row.doctorUserId,
    });

    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.price !== undefined) row.price = dto.price;
    if (dto.currency !== undefined) {
      row.currency = await this.resolveCurrency(clinicId, dto.currency);
    }
    if (dto.active !== undefined) row.active = dto.active;

    try {
      await row.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `A visit type named "${row.name}" already exists for this doctor`,
        );
      }
      throw err;
    }
    return row;
  }

  /**
   * Soft-delete by flipping `active=false`. Hard delete would orphan any
   * appointment / bill row that references this visit type — soft delete
   * preserves historical accuracy.
   */
  async deactivate(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    id: string,
  ) {
    const row = await this.getById(clinicId, id);
    await this.assertCanWriteFor({
      clinicId,
      actorUserId,
      doctorUserId: row.doctorUserId,
    });
    row.active = false;
    await row.save();
    return row;
  }

  private async resolveCurrency(
    clinicId: Types.ObjectId,
    explicit?: string,
  ): Promise<string> {
    if (explicit) return explicit.toUpperCase();
    const clinic = await this.clinicModel.findById(clinicId);
    return clinic?.currency || 'INR';
  }
}
