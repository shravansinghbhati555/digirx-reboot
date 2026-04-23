import { Injectable } from '@nestjs/common';
import {
  NotificationProvider,
  SendNotificationInput,
  SendNotificationResult,
} from './notification-provider';

@Injectable()
export class ConsoleNotificationProvider implements NotificationProvider {
  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    // Replace with real SMS/WhatsApp provider integration later.

    console.log('[notify]', input.channel, input.to, input.body);
    return {
      providerMessageId: `console_${Date.now()}`,
      providerResponse: { ok: true },
    };
  }
}
