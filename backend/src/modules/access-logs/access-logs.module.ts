import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessLogMiddleware } from './access-log.middleware';
import { AccessLogsController } from './access-logs.controller';
import { AccessLogsService } from './access-logs.service';
import { AccessLog, AccessLogSchema } from './schemas/access-log.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: AccessLog.name, schema: AccessLogSchema }])],
  controllers: [AccessLogsController],
  providers: [AccessLogsService],
  exports: [AccessLogsService],
})
export class AccessLogsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AccessLogMiddleware).exclude('health').forRoutes('*');
  }
}

