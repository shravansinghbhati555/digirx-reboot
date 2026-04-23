import { AppointmentStatus } from '../schemas/appointment.schema';

export class UpdateAppointmentDto {
  // reschedule TIME
  startAt?: string; // ISO
  endAt?: string; // ISO

  // cancel / status update
  status?: AppointmentStatus;
  notes?: string;
}

