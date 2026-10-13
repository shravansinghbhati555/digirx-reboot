import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BillingService } from './billing.service';
import { Permission } from '../authz/permissions';

/**
 * Who may take and see consultation fees. billing:write / billing:read as
 * before; appointment:write roles (doctors) too when the clinic setting
 * `appointments.doctorsCanCollectPayment` is on — limited to bills tied to an
 * appointment. A doctor working offline alone has to take the fee and later
 * see it is paid; this is what lets that payment sync instead of 403ing.
 */
describe('BillingService fee access', () => {
  const clinicId = new Types.ObjectId();
  const actorUserId = new Types.ObjectId();

  function make(perms: Permission[], doctorsCanCollectPayment: boolean | undefined, bill?: any) {
    const svc = Object.create(BillingService.prototype) as any;
    svc.authz = { getActor: jest.fn().mockResolvedValue({ permissions: perms }) };
    svc.clinicModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          settings:
            doctorsCanCollectPayment === undefined
              ? {}
              : { appointments: { doctorsCanCollectPayment } },
        }),
      }),
    };
    svc.billModel = { findOne: jest.fn().mockResolvedValue(bill ?? null) };
    return svc as BillingService;
  }

  describe('assertCanCollectPayment', () => {
    it('allows billing:write regardless of the setting', async () => {
      await expect(
        make([Permission.BillingWrite], false).assertCanCollectPayment(clinicId, actorUserId),
      ).resolves.toBeUndefined();
    });

    it('allows a doctor when the setting is on', async () => {
      await expect(
        make([Permission.AppointmentWrite], true).assertCanCollectPayment(clinicId, actorUserId),
      ).resolves.toBeUndefined();
    });

    it('defaults to allowing a doctor when the setting was never saved', async () => {
      await expect(
        make([Permission.AppointmentWrite], undefined).assertCanCollectPayment(clinicId, actorUserId),
      ).resolves.toBeUndefined();
    });

    it('refuses a doctor when the setting is off', async () => {
      await expect(
        make([Permission.AppointmentWrite], false).assertCanCollectPayment(clinicId, actorUserId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a role that can neither bill nor book', async () => {
      await expect(
        make([Permission.PatientRead], true).assertCanCollectPayment(clinicId, actorUserId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('billReadScope / getBillScoped', () => {
    it('gives billing:read every bill', async () => {
      await expect(
        make([Permission.BillingRead], false).billReadScope(clinicId, actorUserId),
      ).resolves.toBe('all');
    });

    it('gives a collecting doctor consultation bills only', async () => {
      await expect(
        make([Permission.AppointmentWrite], true).billReadScope(clinicId, actorUserId),
      ).resolves.toBe('fees');
    });

    it('refuses a doctor when the setting is off', async () => {
      await expect(
        make([Permission.AppointmentWrite], false).billReadScope(clinicId, actorUserId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('serves an appointment bill under the fees scope', async () => {
      const bill = { _id: new Types.ObjectId(), appointmentId: new Types.ObjectId() };
      await expect(
        make([], true, bill).getBillScoped(clinicId, String(bill._id), 'fees'),
      ).resolves.toBe(bill);
    });

    it('hides a non-appointment bill (e.g. pharmacy) under the fees scope', async () => {
      const bill = { _id: new Types.ObjectId() };
      await expect(
        make([], true, bill).getBillScoped(clinicId, String(bill._id), 'fees'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
