import { BillItemDto } from './bill-item.dto';

export class CreateBillDto {
  branchId!: string;
  patientId!: string;
  appointmentId?: string;
  encounterId?: string;

  currency?: string;
  items!: BillItemDto[];
  discount?: number;
  tax?: number;
}

