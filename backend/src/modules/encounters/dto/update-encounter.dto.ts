export class UpdateEncounterDto {
  chiefComplaint?: string;
  notes?: string;
  diagnosis?: string;
  vitals?: Record<string, unknown>;
  followUpAt?: string; // ISO
}

