import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Document,
  DocumentAccess,
  DocumentOwnerType,
} from './schemas/document.schema';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(Document.name) private readonly docModel: Model<Document>,
  ) {}

  async createForOwner(input: {
    clinicId: Types.ObjectId;
    ownerType: DocumentOwnerType;
    ownerId: Types.ObjectId;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    storageKey: string;
    access?: DocumentAccess;
    createdBy?: Types.ObjectId;
  }) {
    return await this.docModel.create({
      ...input,
      access: input.access ?? DocumentAccess.InternalOnly,
    });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.docModel.findOne({ _id: id, clinicId });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}
