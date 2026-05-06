import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { ScreenshotService } from './screenshot.service';

@Module({
  providers: [PdfService, ScreenshotService],
  exports: [PdfService, ScreenshotService],
})
export class PdfModule {}
