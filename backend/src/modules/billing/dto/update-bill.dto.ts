import { BillItemDto } from './bill-item.dto';
import { BillStatus } from '../schemas/bill.schema';

export class UpdateBillDto {
  items?: BillItemDto[];
  discount?: number;
  tax?: number;
  status?: BillStatus; // allow VOID via PATCH
}

