import {
  clinicActivatedEmail,
  clinicRegistrationInternalEmail,
  clinicRegistrationReceivedEmail,
} from './clinic-lifecycle.emails';

/**
 * These mails go to strangers who typed their own clinic name at signup, so
 * the escaping test is the one that matters: a clinic called
 * `<script>…</script>` must not reach the markup intact.
 *
 * The rest pins the promises the copy makes — that both MIME parts carry the
 * same facts, and that the applicant is told sign-in is not open yet.
 */
describe('clinic lifecycle emails', () => {
  const signup = {
    clinicId: '65f1c2d3e4f5a6b7c8d9e0f1',
    clinicName: 'Westside Clinic',
    adminName: 'Dr. Laura Bennett',
    adminEmail: 'laura@westside.example',
    countryCode: 'US',
    timezone: 'America/New_York',
    currency: 'USD',
    requestedAt: new Date('2026-03-14T09:30:00Z'),
  };

  describe('clinicRegistrationReceivedEmail', () => {
    it('names the clinic in the subject and greets by first name', () => {
      const mail = clinicRegistrationReceivedEmail(signup);

      expect(mail.subject).toContain('Westside Clinic');
      // "Dr. Laura", not "Dr." and not the full "Dr. Laura Bennett".
      expect(mail.html).toContain('Thanks, Dr. Laura —');
    });

    it('warns that sign-in is refused until approval', () => {
      const mail = clinicRegistrationReceivedEmail(signup);

      expect(mail.text.toLowerCase()).toContain('sign-in is not open yet');
      expect(mail.html).toContain('Awaiting approval');
    });

    it('renders the submitted time in the clinic timezone', () => {
      const mail = clinicRegistrationReceivedEmail(signup);

      // 09:30 UTC is 05:30 in New York.
      expect(mail.text).toContain('05:30');
    });

    it('falls back to UTC when the timezone is nonsense', () => {
      const mail = clinicRegistrationReceivedEmail({
        ...signup,
        timezone: 'Mars/Olympus_Mons',
      });

      expect(mail.text).toContain('09:30');
    });

    it('escapes a clinic name that contains markup', () => {
      const mail = clinicRegistrationReceivedEmail({
        ...signup,
        clinicName: '<script>alert(1)</script>',
      });

      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&lt;script&gt;');
    });
  });

  describe('clinicRegistrationInternalEmail', () => {
    it('leads with the clinic awaiting approval and lists the details', () => {
      const mail = clinicRegistrationInternalEmail({
        ...signup,
        consoleUrl: 'https://app.digirx.online',
      });

      expect(mail.subject).toBe(
        'New clinic awaiting approval: Westside Clinic',
      );
      for (const fact of [
        'laura@westside.example',
        'America/New_York',
        signup.clinicId,
      ]) {
        expect(mail.text).toContain(fact);
      }
      expect(mail.html).toContain('https://app.digirx.online');
    });

    it('drops the button when no console URL is configured', () => {
      const mail = clinicRegistrationInternalEmail(signup);

      expect(mail.html).not.toContain('Open the approval queue');
      expect(mail.text).not.toContain('Open the approval queue');
    });
  });

  describe('clinicActivatedEmail', () => {
    it('says the clinic is live and links to sign-in', () => {
      const mail = clinicActivatedEmail({
        clinicName: 'Westside Clinic',
        adminName: 'Dr. Laura Bennett',
        adminEmail: 'laura@westside.example',
        loginUrl: 'https://app.digirx.online',
      });

      expect(mail.subject).toBe('Westside Clinic is live on DigiRx');
      expect(mail.html).toContain('Sign in to DigiRx');
      expect(mail.html).toContain('https://app.digirx.online');
      expect(mail.text).toContain('Westside Clinic has been approved');
    });

    it('still reads correctly with no administrator name on file', () => {
      const mail = clinicActivatedEmail({ clinicName: 'Westside Clinic' });

      expect(mail.text).toContain("You're live");
      // The HTML part carries the same line with the apostrophe escaped.
      expect(mail.html).toContain('You&#39;re live');
      expect(mail.html).not.toContain('undefined');
    });
  });
});
