import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { ScreenshotService } from './screenshot.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [PdfService, ScreenshotService],
  exports: [PdfService, ScreenshotService],
})
export class PdfModule {}
