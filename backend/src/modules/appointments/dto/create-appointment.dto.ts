import {
  AppointmentSource,
  AppointmentType,
} from '../schemas/appointment.schema';

export class CreateAppointmentDto {
  type!: AppointmentType;
  branchId!: string;
  doctorId!: string;
  patientId!: string;

  // TIME
  startAt?: string; // ISO
  endAt?: string; // ISO

  // QUEUE
  queueDate?: string; // YYYY-MM-DD

  source?: AppointmentSource;
  notes?: string;
}
