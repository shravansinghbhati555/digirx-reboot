export class CreateEncounterDto {
  branchId!: string;
  doctorId!: string;
  patientId!: string;
  appointmentId?: string;

  visitedAt?: string; // ISO (defaults now)
  chiefComplaint?: string;
}

