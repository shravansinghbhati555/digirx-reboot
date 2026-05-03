import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const TOP_Y = 800;
const BOTTOM_Y = 100;

const FONT_REGULAR_PATH =
  process.env.PDF_FONT_PATH ??
  path.resolve(process.cwd(), 'assets', 'NotoSans-Regular.ttf');
const FONT_BOLD_PATH =
  process.env.PDF_FONT_BOLD_PATH ??
  path.resolve(process.cwd(), 'assets', 'NotoSans-Bold.ttf');

let cachedRegular: Uint8Array | null = null;
let cachedBold: Uint8Array | null = null;
let fontWarnEmitted = false;
const log = new Logger('PdfService');

function loadFontIfPresent(fontPath: string): Uint8Array | null {
  try {
    if (!fs.existsSync(fontPath)) return null;
    const buf = fs.readFileSync(fontPath);
    return new Uint8Array(buf);
  } catch (e) {
    log.warn(
      `Could not read PDF font at ${fontPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * Try to embed a Unicode-supporting TTF (e.g. Noto Sans) so PDFs can render
 * non-Latin scripts like Devanagari, Tamil, Arabic. Falls back to Helvetica
 * if no font file is available — the caller still gets working Latin output.
 */
async function embedFonts(
  pdf: PDFDocument,
): Promise<{ font: PDFFont; bold: PDFFont; isUnicode: boolean }> {
  if (cachedRegular === null) cachedRegular = loadFontIfPresent(FONT_REGULAR_PATH);
  if (cachedBold === null) cachedBold = loadFontIfPresent(FONT_BOLD_PATH);

  if (cachedRegular && cachedBold) {
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(cachedRegular, { subset: true });
    const bold = await pdf.embedFont(cachedBold, { subset: true });
    return { font, bold, isUnicode: true };
  }

  if (!fontWarnEmitted) {
    log.warn(
      `Unicode PDF font not found at ${FONT_REGULAR_PATH}; falling back to Helvetica. ` +
        `Non-Latin glyphs will not render. Set PDF_FONT_PATH / PDF_FONT_BOLD_PATH ` +
        `or drop NotoSans-Regular.ttf and NotoSans-Bold.ttf into backend/assets/.`,
    );
    fontWarnEmitted = true;
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { font, bold, isUnicode: false };
}

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
    const { font, bold } = await embedFonts(pdf);

    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = TOP_Y;

    const drawHeader = () => {
      page.drawText(input.clinicName, {
        x: MARGIN_X,
        y,
        size: 16,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 24;
      page.drawText('Prescription', { x: MARGIN_X, y, size: 12, font: bold });
      y -= 18;
      page.drawText(`Patient: ${input.patientName}`, {
        x: MARGIN_X,
        y,
        size: 10,
        font,
      });
      y -= 14;
      page.drawText(`Doctor: ${input.doctorName}`, {
        x: MARGIN_X,
        y,
        size: 10,
        font,
      });
      y -= 14;
      page.drawText(`Date: ${input.createdAtIso}`, {
        x: MARGIN_X,
        y,
        size: 10,
        font,
      });
      y -= 22;
      page.drawText('Medicines', { x: MARGIN_X, y, size: 11, font: bold });
      y -= 14;
    };

    const newPage = () => {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = TOP_Y;
      drawHeader();
    };

    const ensureRoom = (lines: number) => {
      // 14pt line height, plus a 4pt cushion per item.
      if (y - lines * 14 < BOTTOM_Y + 60) newPage();
    };

    const line = (s: string) => {
      page.drawText(s, { x: MARGIN_X, y, size: 10, font });
      y -= 14;
    };

    drawHeader();

    input.items.forEach((it, idx) => {
      const detailLine = [it.dosage, it.frequency, it.duration]
        .filter(Boolean)
        .join(' • ');
      const lineCount = 1 + (detailLine ? 1 : 0) + (it.instructions ? 1 : 0);
      ensureRoom(lineCount + 1);

      line(`${idx + 1}. ${it.name}`);
      if (detailLine) line(`   ${detailLine}`);
      if (it.instructions) line(`   Notes: ${it.instructions}`);
      y -= 4;
    });

    drawSignatureLine(page, font, bold, input.doctorName);

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
    paid?: boolean;
    paidAtIso?: string;
  }): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const { font, bold } = await embedFonts(pdf);

    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = TOP_Y;

    const drawHeader = (continuation: boolean) => {
      page.drawText(input.clinicName, {
        x: MARGIN_X,
        y,
        size: 16,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 24;
      page.drawText(continuation ? 'Bill / Invoice (cont.)' : 'Bill / Invoice', {
        x: MARGIN_X,
        y,
        size: 12,
        font: bold,
      });
      y -= 18;
      if (!continuation) {
        page.drawText(`Bill No: ${input.billNo ?? '—'}`, {
          x: MARGIN_X,
          y,
          size: 10,
          font,
        });
        y -= 14;
        page.drawText(`Patient: ${input.patientName}`, {
          x: MARGIN_X,
          y,
          size: 10,
          font,
        });
        y -= 14;
        page.drawText(`Date: ${input.issuedAtIso ?? ''}`, {
          x: MARGIN_X,
          y,
          size: 10,
          font,
        });
        y -= 22;
      }
      page.drawText('Items', { x: MARGIN_X, y, size: 11, font: bold });
      y -= 14;
      drawColumnHeaders();
    };

    const drawColumnHeaders = () => {
      page.drawText('Name', { x: MARGIN_X, y, size: 9, font: bold });
      page.drawText('Qty', { x: 340, y, size: 9, font: bold });
      page.drawText('Rate', { x: 390, y, size: 9, font: bold });
      page.drawText('Amount', { x: 470, y, size: 9, font: bold });
      y -= 12;
    };

    const newPage = () => {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = TOP_Y;
      drawHeader(true);
    };

    drawHeader(false);

    for (const it of input.items) {
      // 12pt line height; reserve room for one row plus footer/totals on last page.
      if (y - 12 < BOTTOM_Y + 80) newPage();

      page.drawText(it.name.slice(0, 45), { x: MARGIN_X, y, size: 9, font });
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
    }

    // Reserve space for totals; move to next page if cramped.
    if (y - 80 < BOTTOM_Y) newPage();

    y = Math.max(y - 10, BOTTOM_Y + 20);
    const right = (label: string, value: string) => {
      page.drawText(label, { x: 340, y, size: 10, font });
      page.drawText(value, { x: 470, y, size: 10, font: bold });
      y -= 14;
    };

    right('Subtotal', `${input.currency} ${input.subtotal}`);
    right('Discount', `${input.currency} ${input.discount}`);
    right('Tax', `${input.currency} ${input.tax}`);
    right('Total', `${input.currency} ${input.total}`);

    if (input.paid) {
      drawPaidStamp(page, bold, input.paidAtIso);
    }

    return await pdf.save();
  }
}

function drawSignatureLine(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  doctorName: string,
) {
  const y = BOTTOM_Y;
  // Right-aligned signature block.
  page.drawLine({
    start: { x: 380, y: y + 18 },
    end: { x: 555, y: y + 18 },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  });
  page.drawText('Signature', {
    x: 380,
    y: y + 4,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText(doctorName, {
    x: 380,
    y: y - 10,
    size: 10,
    font: bold,
  });
}

function drawPaidStamp(page: PDFPage, bold: PDFFont, paidAtIso?: string) {
  // Diagonal "PAID" watermark across the totals area.
  page.drawText('PAID', {
    x: 360,
    y: 340,
    size: 90,
    font: bold,
    color: rgb(0.85, 0.15, 0.15),
    opacity: 0.25,
    rotate: degrees(-20),
  });
  if (paidAtIso) {
    page.drawText(`Paid on ${paidAtIso}`, {
      x: 340,
      y: 280,
      size: 9,
      font: bold,
      color: rgb(0.85, 0.15, 0.15),
      opacity: 0.5,
      rotate: degrees(-20),
    });
  }
}
