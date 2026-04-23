import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

@Injectable()
export class PdfService {
  async prescriptionPdf(input: {
    clinicName: string;
    patientName: string;
    doctorName: string;
    createdAtIso: string;
    items: Array<{
      name: string;
      dosage?: string;
      frequency?: string;
      duration?: string;
      instructions?: string;
    }>;
  }): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    page.drawText(input.clinicName, {
      x: 40,
      y,
      size: 16,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 24;
    page.drawText('Prescription', { x: 40, y, size: 12, font: bold });
    y -= 18;
    page.drawText(`Patient: ${input.patientName}`, {
      x: 40,
      y,
      size: 10,
      font,
    });
    y -= 14;
    page.drawText(`Doctor: ${input.doctorName}`, { x: 40, y, size: 10, font });
    y -= 14;
    page.drawText(`Date: ${input.createdAtIso}`, { x: 40, y, size: 10, font });
    y -= 22;

    page.drawText('Medicines', { x: 40, y, size: 11, font: bold });
    y -= 14;

    const line = (s: string) => {
      page.drawText(s, { x: 40, y, size: 10, font });
      y -= 14;
    };

    input.items.forEach((it, idx) => {
      line(`${idx + 1}. ${it.name}`);
      const details = [it.dosage, it.frequency, it.duration]
        .filter(Boolean)
        .join(' • ');
      if (details) line(`   ${details}`);
      if (it.instructions) line(`   Notes: ${it.instructions}`);
      y -= 4;
    });

    return await pdf.save();
  }

  async billPdf(input: {
    clinicName: string;
    billNo?: string;
    patientName: string;
    issuedAtIso?: string;
    currency: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
  }): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    page.drawText(input.clinicName, {
      x: 40,
      y,
      size: 16,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 24;
    page.drawText('Bill / Invoice', { x: 40, y, size: 12, font: bold });
    y -= 18;
    page.drawText(`Bill No: ${input.billNo ?? '—'}`, {
      x: 40,
      y,
      size: 10,
      font,
    });
    y -= 14;
    page.drawText(`Patient: ${input.patientName}`, {
      x: 40,
      y,
      size: 10,
      font,
    });
    y -= 14;
    page.drawText(`Date: ${input.issuedAtIso ?? ''}`, {
      x: 40,
      y,
      size: 10,
      font,
    });
    y -= 22;

    page.drawText('Items', { x: 40, y, size: 11, font: bold });
    y -= 14;

    const headerY = y;
    page.drawText('Name', { x: 40, y: headerY, size: 9, font: bold });
    page.drawText('Qty', { x: 340, y: headerY, size: 9, font: bold });
    page.drawText('Rate', { x: 390, y: headerY, size: 9, font: bold });
    page.drawText('Amount', { x: 470, y: headerY, size: 9, font: bold });
    y -= 12;

    for (const it of input.items) {
      page.drawText(it.name.slice(0, 45), { x: 40, y, size: 9, font });
      page.drawText(String(it.quantity), { x: 340, y, size: 9, font });
      page.drawText(`${input.currency} ${it.unitPrice}`, {
        x: 390,
        y,
        size: 9,
        font,
      });
      page.drawText(`${input.currency} ${it.amount}`, {
        x: 470,
        y,
        size: 9,
        font,
      });
      y -= 12;
      if (y < 140) break;
    }

    y = Math.max(y - 10, 140);
    const right = (label: string, value: string) => {
      page.drawText(label, { x: 340, y, size: 10, font });
      page.drawText(value, { x: 470, y, size: 10, font: bold });
      y -= 14;
    };

    right('Subtotal', `${input.currency} ${input.subtotal}`);
    right('Discount', `${input.currency} ${input.discount}`);
    right('Tax', `${input.currency} ${input.tax}`);
    right('Total', `${input.currency} ${input.total}`);

    return await pdf.save();
  }
}
