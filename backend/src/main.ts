import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { validateEnv } from './common/config';

async function bootstrap() {
  dotenv.config({ override: true });
  validateEnv();

  // bufferLogs so pino can drain queued startup messages once it's wired.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(cookieParser());

  // Security headers. The defaults from helmet cover X-Content-Type-Options,
  // X-Frame-Options (= DENY), Strict-Transport-Security in HTTPS contexts,
  // Referrer-Policy, and X-DNS-Prefetch-Control. CSP is disabled because
  // this is an API server returning JSON — no inline scripts to allow,
  // and CSP for a public-share document URL would block the browser
  // following our presigned-GET redirect to MinIO/S3.
  //
  // `crossOriginResourcePolicy` is loosened to `cross-origin` so the FE
  // (different origin than the API in dev) can read JSON responses.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
          : false,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const allowedOrigins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://digirx.coderly.in',
    'https://digirx.coderly.in',
    'https://testingdigirx.netlify.app'
  ]);
  if (process.env.FRONTEND_ORIGIN) allowedOrigins.add(process.env.FRONTEND_ORIGIN);
  if (process.env.CORS_ORIGINS) {
    for (const o of process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) {
      allowedOrigins.add(o);
    }
  }

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      // Refuse by withholding the header rather than throwing. Throwing here
      // surfaces as a 500 with a stack trace in the logs, which reads like a
      // server fault when it is really a configuration gap — add the origin
      // to CORS_ORIGINS. The browser blocks the response either way.
      // eslint-disable-next-line no-console
      console.warn(
        `[cors] blocked origin: ${origin} — add it to CORS_ORIGINS if this is one of ours`,
      );
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'x-clinic-id',
      'x-branch-id',
      'x-user-id',
    ],
  });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
