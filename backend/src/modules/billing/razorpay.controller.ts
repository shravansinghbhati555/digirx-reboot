import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpaySignatureDto } from './dto/verify-razorpay-signature.dto';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';

@Controller('payments/razorpay')
export class RazorpayController {
  private getRazorpayClient(): Razorpay {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new BadRequestException('Razorpay credentials are not configured on the server');
    }

    return new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  @Post('create-order')
  @RequirePermissions(Permission.AppointmentWrite)
  async createOrder(@Body() dto: CreateRazorpayOrderDto) {
    const rzp = this.getRazorpayClient();
    try {
      const options = {
        amount: dto.amount, // in paise
        currency: dto.currency || 'INR',
        receipt: dto.receipt || `rcpt_${Date.now()}`,
      };
      const order = await rzp.orders.create(options);
      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    } catch (error: any) {
      console.error('Razorpay Order Creation Failed:', error);
      throw new BadRequestException(error.description || error.message || 'Failed to create Razorpay order');
    }
  }

  @Post('verify-signature')
  @RequirePermissions(Permission.AppointmentWrite)
  async verifySignature(@Body() dto: VerifyRazorpaySignatureDto) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new BadRequestException('Razorpay credentials are not configured on the server');
    }

    // signature format: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');

    // Secure timing-safe string comparison using timingSafeEqual
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    const receivedBuffer = Buffer.from(dto.razorpay_signature, 'utf-8');

    let isValid = false;
    if (expectedBuffer.length === receivedBuffer.length) {
      isValid = crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    }

    if (!isValid) {
      throw new BadRequestException('Invalid payment signature verification failed');
    }

    return { success: true };
  }
}
