import { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { ClinicStatus } from '../tenancy/schemas/clinic.schema';

/**
 * Signup must park the clinic in the approval queue.
 *
 * The schema default is ACTIVE so clinics created before the queue existed
 * keep working, which means signup has to set PENDING explicitly. Without
 * this test that omission is invisible: everything else about the flow looks
 * correct while every new clinic quietly auto-approves itself.
 */
describe('AuthService.signup', () => {
  const clinicId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const roleId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const build = () => {
    const clinicCreate = jest.fn().mockResolvedValue({ _id: clinicId, name: 'Westside Clinic' });
    const clinicUpdateOne = jest.fn().mockResolvedValue({});
    const sessionCreate = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const userModel = {
      create: jest.fn().mockResolvedValue({
        _id: userId,
        name: 'Dr. Laura Bennett',
        clinicId,
      }),
    } as never;

    const roleModel = {
      insertMany: jest.fn().mockResolvedValue([{ _id: roleId, name: 'Super Admin' }]),
    } as never;

    const clinicModel = { create: clinicCreate, updateOne: clinicUpdateOne } as never;
    const branchModel = { create: jest.fn().mockResolvedValue({ _id: branchId, name: 'Main' }) } as never;
    const sessionModel = { create: sessionCreate } as never;
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') } as never;
    const sendRegistrationEmails = jest
      .fn()
      .mockResolvedValue({ applicantNotified: true, teamNotified: true });

    const service = new AuthService(
      userModel,
      roleModel,
      clinicModel,
      branchModel,
      sessionModel,
      jwt,
      { sendRegistrationEmails } as never,
    );
    return { service, clinicCreate, clinicUpdateOne, sessionCreate, sendRegistrationEmails };
  };

  const input = {
    clinicName: 'Westside Clinic',
    adminName: 'Dr. Laura Bennett',
    adminEmail: 'Laura@Westside.example',
    password: 'correct-horse',
    timezone: 'America/New_York',
  };

  beforeEach(() => {
    jest.spyOn(bcrypt, 'hash').mockImplementation(async () => 'hashed');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates the clinic in PENDING rather than relying on the schema default', async () => {
    const { service, clinicCreate } = build();

    await service.signup(input);

    expect(clinicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: ClinicStatus.Pending }),
    );
  });

  it('issues no session, so the new admin cannot enter the app yet', async () => {
    const { service, sessionCreate } = build();

    const out = await service.signup(input);

    expect(sessionCreate).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty('accessToken');
    expect(out.status).toBe(ClinicStatus.Pending);
  });

  it('records who asked for the clinic, with the email normalised', async () => {
    const { service, clinicUpdateOne } = build();

    await service.signup(input);

    expect(clinicUpdateOne).toHaveBeenCalledWith(
      { _id: clinicId },
      {
        $set: expect.objectContaining({
          requestedByUserId: userId,
          requestedByEmail: 'laura@westside.example',
        }),
      },
    );
  });

  it('emails the applicant and the platform inbox about the new registration', async () => {
    const { service, sendRegistrationEmails } = build();

    await service.signup(input);

    expect(sendRegistrationEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: clinicId.toHexString(),
        clinicName: 'Westside Clinic',
        adminName: 'Dr. Laura Bennett',
        adminEmail: 'laura@westside.example',
      }),
    );
  });
});
