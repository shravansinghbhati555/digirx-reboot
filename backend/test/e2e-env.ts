/**
 * Loaded by jest-e2e.json BEFORE any test file (setupFiles).
 *
 * Why: `@nestjs/config` loads backend/.env into process.env when AppModule
 * is imported, and MongooseModule.forRoot() reads MONGODB_URI at that same
 * moment. With a real .env that pointed every e2e run at the shared dev
 * database and the real S3 bucket (and could have sent real SMS/email or
 * Razorpay calls).
 *
 * dotenv never overwrites a variable that already exists, so setting these
 * here wins over .env. The database points at a closed local port: a suite
 * only works after it sets MONGODB_URI to the in-memory server from
 * ./setup.ts and imports AppModule afterwards.
 */
const SAFE: Record<string, string> = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:1/e2e-not-configured',
  // No real side effects from tests.
  NOTIFICATION_PROVIDER: 'console',
  NOTIFICATIONS_QUEUE_ENABLED: 'false',
  REDIS_URL: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
  SENDGRID_API_KEY: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  RAZORPAY_KEY_ID: '',
  RAZORPAY_KEY_SECRET: '',
  FACE_SVC_URL: '',
  // Object storage: a closed local port with dummy keys. Issuing a bill
  // renders and uploads an invoice PDF; with the real .env that went to the
  // real bucket.
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_FORCE_PATH_STYLE: 'true',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'e2e-not-configured',
  S3_ACCESS_KEY_ID: 'e2e',
  S3_SECRET_ACCESS_KEY: 'e2e',
  LEADS_NOTIFY_EMAIL: '',
};

for (const [k, v] of Object.entries(SAFE)) process.env[k] = v;
