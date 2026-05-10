import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Document, DocumentSchema } from './schemas/document.schema';
import {
  DocumentShare,
  DocumentShareSchema,
} from './schemas/document-share.schema';
import {
  DocumentAccessLog,
  DocumentAccessLogSchema,
} from './schemas/document-access-log.schema';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentShare.name, schema: DocumentShareSchema },
      { name: DocumentAccessLog.name, schema: DocumentAccessLogSchema },
    ]),
    StorageModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
