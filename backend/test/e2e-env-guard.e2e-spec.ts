import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';

/**
 * Regression guard: e2e runs once wrote to the shared dev database because
 * backend/.env (loaded by ConfigModule as AppModule is imported) supplied
 * the real MONGODB_URI. test/e2e-env.ts must keep winning over .env.
 */
describe('e2e environment guard', () => {
  it('keeps .env from pointing tests at a real database, bucket or providers', () => {
    // Load .env exactly as AppModule does.
    ConfigModule.forRoot({ isGlobal: true });

    expect(process.env.MONGODB_URI).toBe(
      'mongodb://127.0.0.1:1/e2e-not-configured',
    );
    expect(process.env.NOTIFICATION_PROVIDER).toBe('console');
    expect(process.env.SMTP_HOST).toBe('');
    expect(process.env.RAZORPAY_KEY_SECRET).toBe('');
    expect(process.env.REDIS_URL).toBe('');
    expect(process.env.S3_ENDPOINT).toBe('http://127.0.0.1:1');
    expect(process.env.S3_BUCKET).toBe('e2e-not-configured');
  });
});
