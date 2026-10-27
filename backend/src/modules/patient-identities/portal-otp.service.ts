import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { PortalOtp } from './schemas/portal-otp.schema';
import { portalJwtSecret } from './portal-config';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from '../notifications/providers/notification-provider';
import { NotificationChannel } from '../notifications/schemas/notification-template.schema';

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_PER_PHONE_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 20;

const INVALID_CODE = 'That code is incorrect or has expired';

@Injectable()
export class PortalOtpService {
  private readonly logger = new Logger(PortalOtpService.name);

  constructor(
    @InjectModel(PortalOtp.name) private readonly otpModel: Model<PortalOtp>,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly sender: NotificationProvider,
  ) {}

  private hash(phone: string, code: string): string {
    return crypto
      .createHmac('sha256', `${portalJwtSecret()}:portal-otp`)
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  /**
   * Issue and send a code. The response never says whether the number has
   * an account, so it cannot be used to probe who is a DigiRx patient.
   */
  async request(input: {
    phone: string;
    dialCode: string;
    ip?: string;
  }): Promise<{ ttlSeconds: number; otp?: string }> {
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60 * 1000);

    const latest = await this.otpModel
      .findOne({ phone: input.phone })
      .sort({ createdAt: -1 })
      .select({ createdAt: 1 })
      .lean();
    const latestAt = latest?.createdAt
      ? new Date(latest.createdAt).getTime()
      : 0;
    if (latestAt && now - latestAt < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new HttpException(
        {
          message: 'Please wait a minute before asking for another code',
          retryAfterSeconds: Math.ceil(
            (OTP_RESEND_COOLDOWN_SECONDS * 1000 - (now - latestAt)) / 1000,
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const [perPhone, perIp] = await Promise.all([
      this.otpModel.countDocuments({
        phone: input.phone,
        createdAt: { $gte: hourAgo },
      }),
      input.ip
        ? this.otpModel.countDocuments({
            ip: input.ip,
            createdAt: { $gte: hourAgo },
          })
        : Promise.resolve(0),
    ]);
    if (
      perPhone >= OTP_MAX_PER_PHONE_PER_HOUR ||
      perIp >= OTP_MAX_PER_IP_PER_HOUR
    ) {
      throw new HttpException(
        { message: 'Too many codes requested. Try again in an hour.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Only the newest code is valid.
    await this.otpModel.updateMany(
      { phone: input.phone, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    );

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.otpModel.create({
      phone: input.phone,
      codeHash: this.hash(input.phone, code),
      expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
      ip: input.ip,
    });

    try {
      await this.sender.send({
        channel: NotificationChannel.Sms,
        to: `+${input.dialCode}${input.phone}`,
        body: `${code} is your DigiRx login code. It expires in 5 minutes. Never share it with anyone.`,
      });
    } catch (e) {
      // Log without the code or the number; the caller still gets the same
      // response so delivery failures don't reveal anything either.
      this.logger.error(
        `OTP delivery failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      return {
        ttlSeconds: OTP_TTL_SECONDS,
        otp: code,
      };
    }
    return { ttlSeconds: OTP_TTL_SECONDS };
  }

  /** Consume a code. Throws 401 for wrong, expired, used or locked codes. */
  async verify(phone: string, code: string): Promise<void> {
    const otp = await this.otpModel
      .findOne({ phone, consumedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .select('+codeHash');
    if (!otp) throw new UnauthorizedException(INVALID_CODE);

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await this.otpModel.updateOne(
        { _id: otp._id },
        { $set: { consumedAt: new Date() } },
      );
      throw new UnauthorizedException(INVALID_CODE);
    }

    const expected = Buffer.from(otp.codeHash, 'hex');
    const got = Buffer.from(this.hash(phone, String(code)), 'hex');
    const ok =
      expected.length === got.length && crypto.timingSafeEqual(expected, got);
    if (!ok) {
      const after = await this.otpModel.findOneAndUpdate(
        { _id: otp._id },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
      if (after && after.attempts >= OTP_MAX_ATTEMPTS) {
        await this.otpModel.updateOne(
          { _id: otp._id },
          { $set: { consumedAt: new Date() } },
        );
      }
      throw new UnauthorizedException(INVALID_CODE);
    }

    // Single use, even under concurrent verifies of the same code.
    const claimed = await this.otpModel.findOneAndUpdate(
      { _id: otp._id, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    );
    if (!claimed) throw new UnauthorizedException(INVALID_CODE);
  }
}
