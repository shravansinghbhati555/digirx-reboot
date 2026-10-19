import { Types } from 'mongoose';
import {
  appointmentStatus,
  durationDays,
  isBillVisible,
  parseClockTime,
  scheduleFromFrequency,
  toAppointmentView,
  toSlotGroups,
} from './portal.mappers';
import {
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
} from '../../appointments/schemas/appointment.schema';
import { BillStatus } from '../../billing/schemas/bill.schema';

const TZ = 'Asia/Kolkata';

describe('toSlotGroups', () => {
  it('splits morning/evening in clinic time and never exposes who booked', () => {
    const groups = toSlotGroups(
      [
        {
          startAt: '2026-10-20T04:00:00.000Z',
          endAt: '2026-10-20T04:15:00.000Z',
          status: 'available',
        },
        {
          startAt: '2026-10-20T10:30:00.000Z',
          endAt: '2026-10-20T10:45:00.000Z',
          status: 'booked',
          bookedBy: {
            apptId: 'x',
            patientName: 'Someone Else',
            status: 'BOOKED',
          },
        } as any,
      ],
      TZ,
    );
    expect(groups.map((g) => g.name)).toEqual(['Morning', 'Evening']);
    expect(groups[0].slots[0].time).toBe('9:30 AM');
    expect(groups[1].slots[0]).toMatchObject({ time: '4:00 PM', booked: true });
    expect(JSON.stringify(groups)).not.toContain('Someone Else');
    expect(JSON.stringify(groups)).not.toContain('bookedBy');
  });
});

describe('appointment mapping', () => {
  const base = {
    _id: new Types.ObjectId(),
    doctorId: new Types.ObjectId(),
    type: AppointmentType.Time,
    startAt: new Date('2030-01-10T05:00:00Z'),
    endAt: new Date('2030-01-10T05:15:00Z'),
    status: AppointmentStatus.Booked,
    source: AppointmentSource.FrontDesk,
    notes: 'Internal: owes money from last time',
  };
  const view = (appt: any) =>
    toAppointmentView({
      appt,
      subjectId: 'acc',
      branchId: 'br',
      tz: TZ,
      today: '2030-01-01',
      shortName: 'Sunrise',
      fee: 500,
      paidOnline: false,
    });

  it('hides staff notes and shows the patient their own reason', () => {
    expect(view(base).reason).toBeUndefined();
    expect(
      view({ ...base, source: AppointmentSource.PatientPortal, notes: 'Fever' })
        .reason,
    ).toBe('Fever');
  });

  it('shows a staff cancellation reason only as "cancelled by the clinic"', () => {
    const v = view({
      ...base,
      status: AppointmentStatus.Cancelled,
      cancellationReason: 'Doctor unwell, internal',
    });
    expect(v.cancelledBy).toBe('clinic');
    expect(v.outcomeNote).toBe('Cancelled by the clinic');
    const mine = view({
      ...base,
      status: AppointmentStatus.Cancelled,
      cancelledVia: AppointmentSource.PatientPortal,
      cancellationReason: 'Feeling better',
    });
    expect(mine.cancelledBy).toBe('you');
    expect(mine.outcomeNote).toBe('Reason: feeling better');
  });

  it('formats clinic-local date and time', () => {
    const v = view(base);
    expect(v.date).toBe('2030-01-10');
    expect(v.time).toBe('10:30 AM');
    expect(v.durationMin).toBe(15);
  });

  it('treats a past booked appointment as missed', () => {
    expect(
      appointmentStatus(
        {
          status: AppointmentStatus.Booked,
          type: AppointmentType.Time,
          startAt: new Date('2020-01-01T05:00:00Z'),
        },
        '2026-10-16',
        TZ,
      ),
    ).toBe('missed');
    expect(
      appointmentStatus(
        { status: AppointmentStatus.Done, type: AppointmentType.Time },
        '2026-10-16',
        TZ,
      ),
    ).toBe('completed');
  });
});

describe('prescription parsing', () => {
  it.each([
    ['1-0-1', [1, 0, 1]],
    ['BD', [1, 0, 1]],
    ['TDS', [1, 1, 1]],
    ['HS', [0, 0, 1]],
    ['as needed', [0, 0, 0]],
  ])('%s', (freq, want) => {
    expect(scheduleFromFrequency(freq)).toEqual(want);
  });

  it('reads durations', () => {
    expect(durationDays('5 days')).toBe(5);
    expect(durationDays('2 weeks')).toBe(14);
    expect(durationDays('3 months')).toBe(90);
    expect(durationDays('SOS')).toBeNull();
  });
});

describe('bill visibility', () => {
  it('hides drafts and unpaid voids', () => {
    expect(isBillVisible({ status: BillStatus.Draft }, 0)).toBe(false);
    expect(isBillVisible({ status: BillStatus.Void }, 0)).toBe(false);
    expect(isBillVisible({ status: BillStatus.Void }, 100)).toBe(true);
    expect(isBillVisible({ status: BillStatus.Issued }, 0)).toBe(true);
  });
});

describe('parseClockTime', () => {
  it('parses the client time format', () => {
    expect(parseClockTime('10:30 AM')).toBe(630);
    expect(parseClockTime('12:00 PM')).toBe(720);
    expect(parseClockTime('12:15 AM')).toBe(15);
    expect(parseClockTime('13:00')).toBeNull();
  });
});
