import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { FaceService } from './face.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function assertImageUpload(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
  if (!file) throw new BadRequestException('image file is required (multipart field name: "image")');
  if (!ACCEPTED_TYPES.has(file.mimetype)) {
    throw new BadRequestException(`Unsupported image type ${file.mimetype}; use JPEG/PNG/WebP`);
  }
  if (!file.buffer || file.buffer.length === 0) {
    throw new BadRequestException('Empty image upload');
  }
}

@Controller()
export class FaceController {
  constructor(private readonly faces: FaceService) {}

  // Enroll a patient. Multipart field name: `image`. Service refuses
  // when faceConsent isn't set on the patient. Optional `pre_detected`
  // form field tells face-svc to skip its detector (the FE already
  // cropped to the face).
  @Post('patients/:id/face')
  @RequirePermissions(Permission.FaceEnroll)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async enroll(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('pre_detected') preDetected?: string,
  ) {
    console.log(`\n>>> [FaceController] POST /patients/${id}/face called <<<\n`);
    assertImageUpload(file);
    return await this.faces.enroll({
      clinicId: req.context!.clinicId,
      patientId: id,
      actorUserId: req.context!.actorUserId,
      image: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname || 'capture.jpg',
      },
      preDetected: preDetected === 'true',
    });
  }

  @Delete('patients/:id/face')
  @RequirePermissions(Permission.FaceEnroll)
  async unenroll(@Req() req: AppRequest, @Param('id') id: string) {
    console.log(`\n>>> [FaceController] DELETE /patients/${id}/face called <<<\n`);
    return await this.faces.unenroll(req.context!.clinicId, id);
  }

  // Recognition: front desk POSTs a webcam frame; we return the top
  // matches with cosine scores. The FE decides UX based on the
  // confidence band — high → auto-pick, low → confirm list.
  @Post('face/recognize')
  @RequirePermissions(Permission.FaceRecognize)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  async recognize(
    @Req() req: AppRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body('topK') topK?: string,
    @Body('pre_detected') preDetected?: string,
  ) {
    console.log(`\n>>> [FaceController] POST /face/recognize called <<<\n`);
    assertImageUpload(file);
    return await this.faces.recognize({
      clinicId: req.context!.clinicId,
      image: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname || 'capture.jpg',
      },
      topK: topK ? Number(topK) : undefined,
      preDetected: preDetected === 'true',
    });
  }
}
