import { Body, Controller, Post } from '@nestjs/common';
import { CreateRazorpayOrderDto } from './dto/create-razorpay-order.dto';
import { VerifyRazorpaySignatureDto } from './dto/verify-razorpay-signature.dto';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { RazorpayService } from './razorpay.service';

@Controller('payments/razorpay')
export class RazorpayController {
  constructor(private readonly razorpay: RazorpayService) {}

  @Post('create-order')
  @RequirePermissions(Permission.AppointmentWrite)
  async createOrder(@Body() dto: CreateRazorpayOrderDto) {
    return await this.razorpay.createOrder({
      amount: dto.amount, // in paise
      currency: dto.currency,
      receipt: dto.receipt,
    });
  }

  @Post('verify-signature')
  @RequirePermissions(Permission.AppointmentWrite)
  verifySignature(@Body() dto: VerifyRazorpaySignatureDto) {
    return this.razorpay.verifySignature({
      razorpay_order_id: dto.razorpay_order_id,
      razorpay_payment_id: dto.razorpay_payment_id,
      razorpay_signature: dto.razorpay_signature,
    });
  }
}
