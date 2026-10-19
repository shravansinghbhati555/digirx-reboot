import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import {
  AddDependantDto,
  BookAppointmentDto,
  CancelAppointmentDto,
  InviteFamilyDto,
  NextAvailableDto,
  UpdateProfileDto,
  VerifyOtpDto,
} from './portal.dto';

const ID = '6ad1dcdb31eaa9c8af37843d';

describe('portal DTOs', () => {
  it('VerifyOtpDto', async () => {
    await expectValid(VerifyOtpDto, {
      phone: '+91 98450 12345',
      code: '123456',
    });
    await expectInvalid(
      VerifyOtpDto,
      { phone: '9845012345', code: '12345' },
      'code',
    );
    await expectInvalid(
      VerifyOtpDto,
      { phone: 'call me', code: '123456' },
      'phone',
    );
  });

  it('BookAppointmentDto', async () => {
    await expectValid(BookAppointmentDto, {
      clinicId: ID,
      doctorId: ID,
      date: '2026-10-20',
      time: '10:30 AM',
    });
    await expectInvalid(
      BookAppointmentDto,
      { clinicId: ID, doctorId: ID, date: '20/10/2026', time: '10:30 AM' },
      'date',
    );
    await expectInvalid(
      BookAppointmentDto,
      { clinicId: ID, doctorId: ID, date: '2026-10-20', time: '22:30' },
      'time',
    );
    await expectInvalid(
      BookAppointmentDto,
      { clinicId: 'x', doctorId: ID, date: '2026-10-20', time: '10:30 AM' },
      'clinicId',
    );
  });

  it('CancelAppointmentDto requires a reason', async () => {
    await expectValid(CancelAppointmentDto, { reason: 'Feeling better' });
    await expectInvalid(CancelAppointmentDto, { reason: '' }, 'reason');
  });

  it('UpdateProfileDto', async () => {
    await expectValid(UpdateProfileDto, {
      fullName: 'Riya Mehta',
      dob: '1992-08-14',
      gender: 'FEMALE',
      email: null,
    });
    await expectInvalid(UpdateProfileDto, { dob: '14/08/1992' }, 'dob');
    await expectInvalid(UpdateProfileDto, { bloodGroup: 'Z+' }, 'bloodGroup');
  });

  it('AddDependantDto / InviteFamilyDto', async () => {
    await expectValid(AddDependantDto, {
      fullName: 'Aarav',
      dob: '2018-01-01',
      relation: 'Son',
    });
    await expectInvalid(AddDependantDto, { fullName: 'Aarav' }, 'dob');
    await expectValid(InviteFamilyDto, { phone: '9845012345', name: 'Vikram' });
    await expectInvalid(InviteFamilyDto, { phone: 'nope' }, 'phone');
  });

  it('NextAvailableDto caps the batch', async () => {
    await expectValid(NextAvailableDto, {
      items: [{ clinicId: ID, doctorId: ID }],
    });
    await expectInvalid(
      NextAvailableDto,
      {
        items: Array.from({ length: 21 }, () => ({
          clinicId: ID,
          doctorId: ID,
        })),
      },
      'items',
    );
  });
});
