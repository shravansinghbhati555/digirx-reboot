import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';

export type RazorpayRefundResult = {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  paymentId: string;
};

/**
 * Thin wrapper around the Razorpay Node SDK. Centralises client creation and
 * the "are credentials configured?" guard so the controller (checkout) and
 * the credit-note refund flow share one code path instead of each newing up
 * their own client.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private client: Razorpay | null = null;

  isConfigured(): boolean {
    return Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
    );
  }

  private getClient(): Razorpay {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new BadRequestException(
        'Razorpay credentials are not configured on the server',
      );
    }
    // Cache the client; credentials don't change at runtime.
    if (!this.client) {
      this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return this.client;
  }

  async createOrder(input: {
    amount: number; // paise
    currency?: string;
    receipt?: string;
  }) {
    const rzp = this.getClient();
    try {
      const order = await rzp.orders.create({
        amount: input.amount,
        currency: input.currency || 'INR',
        receipt: input.receipt || `rcpt_${Date.now()}`,
      });
      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    } catch (error: any) {
      this.logger.error(
        `Order creation failed: ${error?.description || error?.message || error}`,
      );
      throw new BadRequestException(
        error?.description || error?.message || 'Failed to create Razorpay order',
      );
    }
  }

  /**
   * HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET), timing-safe compared
   * against the signature Razorpay returns to the checkout. Throws on mismatch.
   */
  verifySignature(input: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }): { success: true } {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new BadRequestException(
        'Razorpay credentials are not configured on the server',
      );
    }
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${input.razorpay_order_id}|${input.razorpay_payment_id}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected, 'utf-8');
    const receivedBuffer = Buffer.from(input.razorpay_signature, 'utf-8');

    const isValid =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

    if (!isValid) {
      throw new BadRequestException(
        'Invalid payment signature verification failed',
      );
    }
    return { success: true };
  }

  /**
   * Issue a real refund against a captured payment. `amountPaise` may be the
   * full or a partial amount; omit it to refund the whole payment. Returns the
   * Razorpay refund id (`rfnd_...`) so the caller can persist it as proof.
   *
   * A `BadRequestException` is thrown with Razorpay's own error description on
   * failure (already-refunded, amount exceeds captured, payment not captured,
   * etc.) so the credit-note flow can surface it and NOT mark the note as
   * refunded.
   */
  async refundPayment(
    paymentId: string,
    opts: { amountPaise?: number; notes?: Record<string, string> } = {},
  ): Promise<RazorpayRefundResult> {
    const rzp = this.getClient();
    try {
      const params: Record<string, unknown> = {};
      if (typeof opts.amountPaise === 'number' && opts.amountPaise > 0) {
        params.amount = Math.round(opts.amountPaise);
      }
      if (opts.notes) params.notes = opts.notes;

      const refund = await (rzp.payments as any).refund(paymentId, params);
      this.logger.log(
        `Refund ${refund?.id} created for payment ${paymentId} (amount=${refund?.amount} status=${refund?.status})`,
      );
      return {
        id: refund.id,
        status: refund.status,
        amount: refund.amount,
        currency: refund.currency,
        paymentId,
      };
    } catch (error: any) {
      const reason =
        error?.error?.description ||
        error?.description ||
        error?.message ||
        'Razorpay refund failed';
      this.logger.error(`Refund failed for payment ${paymentId}: ${reason}`);
      throw new BadRequestException(`Razorpay refund failed: ${reason}`);
    }
  }
}
