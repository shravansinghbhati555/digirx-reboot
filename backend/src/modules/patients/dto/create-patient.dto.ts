import { PatientGender } from '../schemas/patient.schema';

export class CreatePatientDto {
  fullName!: string;
  gender?: PatientGender;
  dob?: string; // ISO date
  phones?: string[];
  emails?: string[];
  primaryBranchId?: string;
  tags?: string[];
  notes?: string;
}

