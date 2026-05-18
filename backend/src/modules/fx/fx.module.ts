import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [AuthzModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
