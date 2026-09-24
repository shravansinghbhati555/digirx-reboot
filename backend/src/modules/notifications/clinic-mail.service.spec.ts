import { ClinicMailService } from './clinic-mail.service';
import { NotificationChannel } from './schemas/notification-template.schema';
import type {
  SendNotificationInput,
  SendNotificationResult,
} from './providers/notification-provider';

/** Typed stand-in for the provider, so assertions on the sent mail stay typed. */
type SendMock = jest.Mock<
  Promise<SendNotificationResult>,
  [SendNotificationInput]
>;

/**
 * The service's whole job is "send these two mails, and never let the mailer
 * break the thing that actually mattered". So the tests here are about
 * routing and failure containment, not copy — that lives in the template
 * spec next door.
 */
describe('ClinicMailService', () => {
  const signup = {
    clinicId: '65f1c2d3e4f5a6b7c8d9e0f1',
    clinicName: 'Westside Clinic',
    adminName: 'Dr. Laura Bennett',
    adminEmail: 'laura@westside.example',
    timezone: 'America/New_York',
  };

  const build = (
    send: SendMock = jest.fn().mockResolvedValue({}) as SendMock,
  ) => ({
    service: new ClinicMailService({ send }),
    send,
  });

  beforeEach(() => {
    process.env.LEADS_NOTIFY_EMAIL = 'info@digirx.online';
    process.env.FRONTEND_URL = 'https://app.digirx.online/';
    delete process.env.EMAIL_LOGO_URL;
  });

  afterEach(() => {
    delete process.env.LEADS_NOTIFY_EMAIL;
    delete process.env.FRONTEND_URL;
    jest.restoreAllMocks();
  });

  it('sends the applicant receipt and the team alert to different inboxes', async () => {
    const { service, send } = build();

    const out = await service.sendRegistrationEmails(signup);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([
      'laura@westside.example',
      'info@digirx.online',
    ]);
    expect(out).toEqual({ applicantNotified: true, teamNotified: true });
  });

  it('alerts every address in a comma-separated LEADS_NOTIFY_EMAIL', async () => {
    process.env.LEADS_NOTIFY_EMAIL = 'info@digirx.online, raj.baptla@vidhema.com';
    const { service, send } = build();

    const out = await service.sendRegistrationEmails(signup);

    expect(send.mock.calls.map((c) => c[0].to)).toEqual([
      'laura@westside.example',
      'info@digirx.online',
      'raj.baptla@vidhema.com',
    ]);
    expect(out.teamNotified).toBe(true);
  });

  it('still counts the team as notified when one of two addresses fails', async () => {
    process.env.LEADS_NOTIFY_EMAIL = 'broken@digirx.online,raj.baptla@vidhema.com';
    const send = jest.fn().mockImplementation((input: SendNotificationInput) => {
      if (input.to === 'broken@digirx.online') {
        return Promise.reject(new Error('550 no such mailbox'));
      }
      return Promise.resolve({});
    }) as SendMock;
    const { service } = build(send);

    const out = await service.sendRegistrationEmails(signup);

    expect(send).toHaveBeenCalledTimes(3);
    expect(out.teamNotified).toBe(true);
  });

  it('sends email with an explicit subject and HTML part', async () => {
    const { service, send } = build();

    await service.sendRegistrationEmails(signup);

    const [first] = send.mock.calls[0];
    expect(first.channel).toBe(NotificationChannel.Email);
    expect(first.subject).toContain('Westside Clinic');
    expect(first.html).toContain('<!doctype html>');
    // The plain-text twin is the body, so console/SMS-shaped logging stays readable.
    expect(first.body).not.toContain('<table');
  });

  it('still emails the applicant when the platform inbox is not configured', async () => {
    delete process.env.LEADS_NOTIFY_EMAIL;
    const { service, send } = build();

    const out = await service.sendRegistrationEmails(signup);

    expect(send).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ applicantNotified: true, teamNotified: false });
  });

  it('swallows a provider failure so signup is never blocked by the mailer', async () => {
    const { service } = build(
      jest.fn().mockRejectedValue(new Error('SMTP down')) as SendMock,
    );

    await expect(service.sendRegistrationEmails(signup)).resolves.toEqual({
      applicantNotified: false,
      teamNotified: false,
    });
  });

  it('trims the trailing slash off the configured app URL', async () => {
    const { service, send } = build();

    await service.sendClinicActivatedEmail(signup);

    expect(send.mock.calls[0][0].html).toContain('"https://app.digirx.online"');
  });

  it('skips the activation mail when no administrator address is on file', async () => {
    const { service, send } = build();

    const sent = await service.sendClinicActivatedEmail({
      clinicId: signup.clinicId,
      clinicName: signup.clinicName,
    });

    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
