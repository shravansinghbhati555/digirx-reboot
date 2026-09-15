import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { ClinicStatus } from '../tenancy/schemas/clinic.schema';
import { UserStatus } from '../authz/schemas/user.schema';

/**
 * The approval gate: a clinic that has not been approved cannot get a
 * session, and one created before the status field existed still can.
 */
describe('AuthService clinic approval gate', () => {
  const clinicId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const buildService = (clinicStatus: ClinicStatus | undefined) => {
    const sessionCreate = jest.fn().mockResolvedValue({ _id: new Types.ObjectId() });

    const userModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: userId,
          clinicId,
          status: UserStatus.Active,
          passwordHash: 'hashed',
          defaultBranchId: new Types.ObjectId(),
          roleIds: [],
        }),
      }),
    } as never;

    const roleModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    } as never;

    const clinicModel = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: clinicId,
            name: 'Westside Clinic',
            // `undefined` models a clinic row written before the queue existed.
            ...(clinicStatus === undefined ? {} : { status: clinicStatus }),
          }),
        }),
      }),
    } as never;

    const branchModel = {} as never;
    const sessionModel = { create: sessionCreate } as never;
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') } as never;

    const service = new AuthService(
      userModel,
      roleModel,
      clinicModel,
      branchModel,
      sessionModel,
      jwt,
    );
    return { service, sessionCreate };
  };

  const credentials = {
    clinicId: clinicId.toHexString(),
    email: 'admin@westside.example',
    password: 'correct-horse',
  };

  beforeEach(() => {
    jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refuses a pending clinic and says why', async () => {
    const { service, sessionCreate } = buildService(ClinicStatus.Pending);

    await expect(service.login(credentials)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLINIC_PENDING_APPROVAL' }),
    });
    await expect(service.login(credentials)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('refuses a rejected clinic', async () => {
    const { service } = buildService(ClinicStatus.Rejected);

    await expect(service.login(credentials)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLINIC_REJECTED' }),
    });
  });

  it('refuses a suspended clinic', async () => {
    const { service } = buildService(ClinicStatus.Suspended);

    await expect(service.login(credentials)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CLINIC_SUSPENDED' }),
    });
  });

  it('lets an approved clinic in', async () => {
    const { service, sessionCreate } = buildService(ClinicStatus.Active);

    const out = await service.login(credentials);

    expect(out.accessToken).toBe('access-token');
    expect(sessionCreate).toHaveBeenCalled();
  });

  it('lets a clinic created before the status field existed in', async () => {
    const { service } = buildService(undefined);

    await expect(service.login(credentials)).resolves.toMatchObject({
      accessToken: 'access-token',
    });
  });

  it('checks the password before revealing the clinic status', async () => {
    jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);
    const { service } = buildService(ClinicStatus.Pending);

    // Wrong password on a pending clinic is a plain 401, so the endpoint
    // cannot be used to discover which clinics are awaiting approval.
    await expect(service.login(credentials)).rejects.toMatchObject({ status: 401 });
  });
});
