import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EncountersModule } from '../encounters/encounters.module';
import { DocumentsModule } from '../documents/documents.module';
import { PdfModule } from '../pdf/pdf.module';
import { StorageModule } from '../storage/storage.module';
import { PrescriptionsController } from './prescriptions.controller';
import { PrescriptionsService } from './prescriptions.service';
import { Prescription, PrescriptionSchema } from './schemas/prescription.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Prescription.name, schema: PrescriptionSchema }]),
    EncountersModule,
    PdfModule,
    StorageModule,
    DocumentsModule,
  ],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
})
export class PrescriptionsModule {}

