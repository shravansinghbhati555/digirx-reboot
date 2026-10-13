import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';
import { RequirePermissions } from './require-permissions.decorator';
import { UsersService } from './users.service';
import { UserFaceService } from '../user-face/user-face.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';

const MAX_FACE_IMAGE_BYTES = 5 * 1024 * 1024;

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly userFace: UserFaceService,
  ) {}

  @Get()
  @RequirePermissions(Permission.UserRead)
  async list(@Req() req: AppRequest, @Query('query') query?: string) {
    return await this.users.list(req.context!.clinicId, query);
  }

  // Doctor picker for booking. Gated on appointment:read (not user:read) so
  // doctors and other booking roles can load it without seeing all staff.
  @Get('doctors')
  @RequirePermissions(Permission.AppointmentRead)
  async listDoctors(@Req() req: AppRequest) {
    return await this.users.listDoctors(req.context!.clinicId);
  }

  @Post()
  @RequirePermissions(Permission.UserWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateUserDto) {
    return await this.users.create(req.context!.clinicId, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.UserWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return await this.users.update(req.context!.clinicId, id, dto);
  }

  @Patch(':id/roles')
  @RequirePermissions(Permission.UserWrite)
  async updateRoles(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateUserRolesDto,
  ) {
    return await this.users.updateRoles(
      req.context!.clinicId,
      id,
      dto.roleIds,
    );
  }

  @Post(':id/password-reset')
  @RequirePermissions(Permission.UserWrite)
  async resetPassword(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return await this.users.resetPassword(
      req.context!.clinicId,
      id,
      dto.newPassword,
    );
  }

  // Enroll / re-enroll a staff member's face for face login. Gated on
  // user:write so only super admin / manager (or whoever holds the
  // permission) can do it. Multipart field name: `image`.
  @Post(':id/face')
  @RequirePermissions(Permission.UserWrite)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_FACE_IMAGE_BYTES } }),
  )
  async enrollFace(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('pre_detected') preDetected?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('image file is required (multipart field "image")');
    }
    return await this.userFace.enroll({
      clinicId: req.context!.clinicId,
      userId: id,
      actorUserId: req.context!.actorUserId,
      image: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname || 'capture.jpg',
      },
      preDetected: preDetected === 'true',
    });
  }

  @Delete(':id/face')
  @RequirePermissions(Permission.UserWrite)
  async removeFace(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.userFace.remove(req.context!.clinicId, id);
  }
}
