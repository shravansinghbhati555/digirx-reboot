export type CreatePrescriptionItemDto = {
  medicineCatalogItemId?: string;
  customName?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
};

export class CreatePrescriptionDto {
  items!: CreatePrescriptionItemDto[];
}

