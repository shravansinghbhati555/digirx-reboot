import nodemailer from 'nodemailer';
import { SmtpNotificationProvider } from './smtp.provider';
import { ConsoleNotificationProvider } from './console.provider';
import { NotificationChannel } from '../schemas/notification-template.schema';

/**
 * SMTP delivery for email, with a deliberate fallback for the channels SMTP
 * cannot carry. The transport is mocked; these tests pin behaviour, not
 * nodemailer itself.
 */
describe('SmtpNotificationProvider', () => {
  const sendMail = jest.fn().mockResolvedValue({
    messageId: '<abc@digirx>',
    accepted: ['sales@digirx.online'],
    rejected: [],
    response: '250 OK',
  });

  const build = () => {
    jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail, verify: jest.fn() } as never);
    const consoleProvider = new ConsoleNotificationProvider();
    jest.spyOn(consoleProvider, 'send');
    return {
      provider: new SmtpNotificationProvider(consoleProvider),
      consoleProvider,
    };
  };

  const email = {
    channel: NotificationChannel.Email,
    to: 'sales@digirx.online',
    body: 'New enquiry from the DigiRx website\n\nName: Dr Jane Miller',
  };

  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.SMTP_USER = 'ops@digirx.online';
    process.env.SMTP_PASS = 'app-password';
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    sendMail.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('sends the email with a subject taken from the first line', async () => {
    const { provider } = build();

    const out = await provider.send(email);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sales@digirx.online',
        subject: 'New enquiry from the DigiRx website',
        text: email.body,
      }),
    );
    expect(out.providerMessageId).toBe('<abc@digirx>');
  });

  it('falls back to the SMTP user when no EMAIL_FROM is configured', async () => {
    const { provider } = build();

    await provider.send(email);

    expect(sendMail.mock.calls[0][0].from).toBe('ops@digirx.online');
  });

  it('uses a display name when one is set', async () => {
    process.env.EMAIL_FROM = 'noreply@digirx.online';
    process.env.EMAIL_FROM_NAME = 'DigiRx';
    const { provider } = build();

    await provider.send(email);

    expect(sendMail.mock.calls[0][0].from).toBe('"DigiRx" <noreply@digirx.online>');
  });

  it('defaults to implicit TLS on port 465 and STARTTLS otherwise', async () => {
    process.env.SMTP_PORT = '465';
    const { provider } = build();
    await provider.send(email);
    expect((nodemailer.createTransport as jest.Mock).mock.calls[0][0]).toMatchObject({
      port: 465,
      secure: true,
    });

    jest.restoreAllMocks();
    process.env.SMTP_PORT = '587';
    const second = build();
    await second.provider.send(email);
    expect((nodemailer.createTransport as jest.Mock).mock.calls[0][0]).toMatchObject({
      port: 587,
      secure: false,
    });
  });

  it('logs SMS to the console instead of failing, since SMTP cannot send it', async () => {
    const { provider, consoleProvider } = build();

    await provider.send({
      channel: NotificationChannel.Sms,
      to: '+14155550142',
      body: 'Appointment reminder',
    });

    expect(consoleProvider.send).toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('explains which credential is missing rather than failing obscurely', async () => {
    delete process.env.SMTP_PASS;
    const { provider } = build();

    await expect(provider.send(email)).rejects.toThrow(/SMTP_HOST \/ SMTP_USER \/ SMTP_PASS/);
  });
});
