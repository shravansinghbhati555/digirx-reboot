import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { validateEnv } from './common/config';

async function bootstrap() {
  dotenv.config();
  validateEnv();

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  if (process.env.FRONTEND_ORIGIN)
    allowedOrigins.add(process.env.FRONTEND_ORIGIN);
  if (process.env.CORS_ORIGINS) {
    for (const o of process.env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      allowedOrigins.add(o);
    }
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
