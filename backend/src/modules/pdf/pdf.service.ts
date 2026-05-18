// fontkit's Indic complex-script shaping (used for Devanagari) is transpiled
// to reference a global `regeneratorRuntime` — load the polyfill once, here.
import 'regenerator-runtime/runtime';
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
import { StorageService } from '../storage/storage.service';

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const TOP_Y = 800;
const BOTTOM_Y = 100;

const ASSETS = path.resolve(process.cwd(), 'assets');

// Font paths. Set PDF_FONT_PATH / PDF_FONT_BOLD_PATH to override the Latin
// font; the script-specific fallbacks always look in ./assets.
const LATIN_REGULAR = process.env.PDF_FONT_PATH ?? path.join(ASSETS, 'NotoSans-Regular.ttf');
const LATIN_BOLD = process.env.PDF_FONT_BOLD_PATH ?? path.join(ASSETS, 'NotoSans-Bold.ttf');
const DEV_REGULAR = path.join(ASSETS, 'NotoSansDevanagari-Regular.ttf');
const DEV_BOLD = path.join(ASSETS, 'NotoSansDevanagari-Bold.ttf');
const TAM_REGULAR = path.join(ASSETS, 'NotoSansTamil-Regular.ttf');
const TAM_BOLD = path.join(ASSETS, 'NotoSansTamil-Bold.ttf');

type FontCache = Map<string, Uint8Array | null>;
const fontCache: FontCache = new Map();
let fontWarnEmitted = false;
const log = new Logger('PdfService');

// Tight cap on the logo we'll download from a public URL — anything
// bigger is almost certainly mis-uploaded, and we don't want to OOM the
// PDF renderer on a malicious URL.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Module-level cache so the same logo isn't refetched on every PDF.
const logoCache = new Map<string, { bytes: Uint8Array; at: number }>();
const LOGO_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Convert a `#RRGGBB` / `#RGB` hex string to pdf-lib's rgb(0..1).
 * Returns `null` on anything malformed so the caller falls back to its
 * default color. Lowercase / uppercase / leading-# both accepted.
 */
function parseHexColor(hex?: string): ReturnType<typeof rgb> | null {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

async function fetchLogoBytes(url: string): Promise<Uint8Array | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const cached = logoCache.get(url);
  if (cached && Date.now() - cached.at < LOGO_CACHE_TTL_MS) {
    return cached.bytes;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_LOGO_BYTES) {
      log.warn(`Logo ${url} exceeds ${MAX_LOGO_BYTES} bytes — skipping`);
      return null;
    }
    const bytes = new Uint8Array(buf);
    logoCache.set(url, { bytes, at: Date.now() });
    return bytes;
  } catch (e) {
    log.warn(`fetchLogoBytes(${url}) failed: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function loadFontIfPresent(fontPath: string): Uint8Array | null {
  if (fontCache.has(fontPath)) return fontCache.get(fontPath) ?? null;
  try {
    if (!fs.existsSync(fontPath)) {
      fontCache.set(fontPath, null);
      return null;
    }
    const buf = fs.readFileSync(fontPath);
    const arr = new Uint8Array(buf);
    fontCache.set(fontPath, arr);
    return arr;
  } catch (e) {
    log.warn(
      `Could not read PDF font at ${fontPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    fontCache.set(fontPath, null);
    return null;
  }
}

/**
 * One slot per script. When a script-specific font is missing we substitute
 * the Latin font so the renderer never crashes — those glyphs will render as
 * .notdef boxes which is still better than throwing.
 */
type FontTriple = {
  latin: PDFFont;
  devanagari: PDFFont;
  tamil: PDFFont;
};

async function embedFonts(
  pdf: PDFDocument,
): Promise<{ font: FontTriple; bold: FontTriple; isUnicode: boolean }> {
  const latinReg = loadFontIfPresent(LATIN_REGULAR);
  const latinBold = loadFontIfPresent(LATIN_BOLD);

  if (latinReg && latinBold) {
    pdf.registerFontkit(fontkit);
    const latin = await pdf.embedFont(latinReg, { subset: true });
    const latinB = await pdf.embedFont(latinBold, { subset: true });

    const devRegBytes = loadFontIfPresent(DEV_REGULAR);
    const devBoldBytes = loadFontIfPresent(DEV_BOLD);
    const tamRegBytes = loadFontIfPresent(TAM_REGULAR);
    const tamBoldBytes = loadFontIfPresent(TAM_BOLD);

    const devanagari = devRegBytes
      ? await pdf.embedFont(devRegBytes, { subset: true })
      : latin;
    const devanagariBold = devBoldBytes
      ? await pdf.embedFont(devBoldBytes, { subset: true })
      : latinB;
    const tamil = tamRegBytes
      ? await pdf.embedFont(tamRegBytes, { subset: true })
      : latin;
    const tamilBold = tamBoldBytes
      ? await pdf.embedFont(tamBoldBytes, { subset: true })
      : latinB;

    return {
      font: { latin, devanagari, tamil },
      bold: { latin: latinB, devanagari: devanagariBold, tamil: tamilBold },
      isUnicode: true,
    };
  }

  if (!fontWarnEmitted) {
    log.warn(
      `Unicode PDF font not found at ${LATIN_REGULAR}; falling back to Helvetica. ` +
      `Non-Latin glyphs will not render. Drop NotoSans-Regular.ttf, NotoSans-Bold.ttf, ` +
      `NotoSansDevanagari-Regular.ttf, NotoSansDevanagari-Bold.ttf, ` +
      `NotoSansTamil-Regular.ttf, NotoSansTamil-Bold.ttf into backend/assets/.`,
    );
    fontWarnEmitted = true;
  }
  const h = await pdf.embedFont(StandardFonts.Helvetica);
  const hb = await pdf.embedFont(StandardFonts.HelveticaBold);
  return {
    font: { latin: h, devanagari: h, tamil: h },
    bold: { latin: hb, devanagari: hb, tamil: hb },
    isUnicode: false,
  };
}

/**
 * Pick the right font for a single Unicode code point. Anything outside the
 * Devanagari / Tamil blocks falls back to the Latin slot.
 */
function fontForCodePoint(cp: number, triple: FontTriple): PDFFont {
  // Devanagari: U+0900–U+097F (+ extended U+A8E0–U+A8FF)
  if ((cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff)) {
    return triple.devanagari;
  }
  // Tamil: U+0B80–U+0BFF
  if (cp >= 0x0b80 && cp <= 0x0bff) {
    return triple.tamil;
  }
  return triple.latin;
}

/** Split a string into runs that share a font. */
function segmentByFont(
  text: string,
  triple: FontTriple,
): { text: string; font: PDFFont }[] {
  if (!text) return [];
  const segments: { text: string; font: PDFFont }[] = [];
  let cur = '';
  let curFont: PDFFont | null = null;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const f = fontForCodePoint(cp, triple);
    if (curFont === null) {
      curFont = f;
      cur = ch;
    } else if (f === curFont) {
      cur += ch;
    } else {
      segments.push({ text: cur, font: curFont });
      cur = ch;
      curFont = f;
    }
  }
  if (cur && curFont) segments.push({ text: cur, font: curFont });
  return segments;
}

type DrawOpts = {
  x: number;
  y: number;
  size: number;
  font: FontTriple;
  color?: ReturnType<typeof rgb>;
  opacity?: number;
  rotate?: ReturnType<typeof degrees>;
};

/** Drop-in replacement for page.drawText that walks font runs. */
function drawText(page: PDFPage, text: string, opts: DrawOpts) {
  const segments = segmentByFont(text, opts.font);
  let x = opts.x;
  const y = opts.y;
  for (const seg of segments) {
    page.drawText(seg.text, {
      x,
      y,
      size: opts.size,
      font: seg.font,
      color: opts.color,
      opacity: opts.opacity,
      rotate: opts.rotate,
    });
    x += seg.font.widthOfTextAtSize(seg.text, opts.size);
  }
}

@Injectable()
export class PdfService {
  constructor(private readonly storage: StorageService) {}

  private async loadLogoFromStorage(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.storage.getObject({ key });
      if (res.bytes.byteLength > MAX_LOGO_BYTES) {
        log.warn(`Storage logo at ${key} exceeds ${MAX_LOGO_BYTES} bytes — skipping`);
        return null;
      }
      return res.bytes;
    } catch (e) {
      log.warn(`loadLogoFromStorage(${key}) failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  async prescriptionPdf(input: {
    clinicName: string;
    clinicAddress?: string;
    clinicPhone?: string;
    // Branding fields from Settings → Clinic → Branding. When set,
    // override the defaults: displayName replaces clinicName on the
    // header, primaryColor recolors the brand bar + heading, logoUrl
    // is fetched and placed top-right.
    clinicDisplayName?: string;
    clinicLogoUrl?: string;
    primaryColor?: string;
    patientName: string;
    patientAge?: string | number;
    patientGender?: string;
    doctorName: string;
    createdAtIso: string;
    diagnosis?: string;
    vitals?: Record<string, string>;
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

    // Brand color: hex from settings overrides the legacy blue. Falls
    // back to the historical color when nothing is configured so old
    // clinics see no visual change.
    const BRAND_BLUE = parseHexColor(input.primaryColor) ?? rgb(0.06, 0.45, 0.92);
    const TEXT_DARK = rgb(0.1, 0.1, 0.1);
    const TEXT_MUTED = rgb(0.4, 0.4, 0.4);
    const BORDER_COLOR = rgb(0.9, 0.9, 0.9);
    const STRIP_BG = rgb(0.96, 0.97, 0.99);

    // The branding display name wins when set — typically a polished
    // "Sunshine Pediatrics" rather than the internal clinic record name.
    const headerName = (input.clinicDisplayName || '').trim() || input.clinicName;

    // Logo: load + embed at PDF-creation time. Two paths depending on
    // the stored value:
    //  • starts with http(s)://  → legacy URL form, fetched via HTTP
    //  • anything else           → S3 object key, loaded via the
    //    StorageService (same MinIO/S3 the rest of the backend writes
    //    to, so internal-network reads stay fast)
    // All failures are non-fatal — we just render without the logo.
    let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
    if (input.clinicLogoUrl) {
      try {
        const isUrl = /^https?:\/\//i.test(input.clinicLogoUrl);
        const bytes = isUrl
          ? await fetchLogoBytes(input.clinicLogoUrl)
          : await this.loadLogoFromStorage(input.clinicLogoUrl);
        if (bytes) {
          // pdf-lib needs format-specific embed methods. Detect by the
          // first few bytes rather than trusting the URL extension.
          if (bytes[0] === 0x89 && bytes[1] === 0x50) {
            logoImage = await pdf.embedPng(bytes);
          } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            logoImage = await pdf.embedJpg(bytes);
          } else {
            log.warn(`Logo at ${input.clinicLogoUrl} is not PNG/JPG — skipping`);
          }
        }
      } catch (e) {
        log.warn(
          `Failed to embed clinic logo from ${input.clinicLogoUrl}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = TOP_Y;

    const drawHeader = () => {
      // Brand Bar (Top)
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 60,
        width: PAGE_WIDTH,
        height: 60,
        color: BRAND_BLUE,
      });

      // Clinic Info — name on the left, logo on the right (when set).
      y = PAGE_HEIGHT - 35;
      drawText(page, headerName, { x: MARGIN_X, y, size: 20, font: bold, color: rgb(1, 1, 1) });

      if (logoImage) {
        // Scale to fit a 44px-tall slot in the brand bar, preserving
        // aspect ratio. Anchored to the right margin.
        const targetH = 44;
        const ratio = logoImage.height > 0 ? targetH / logoImage.height : 1;
        const w = Math.min(logoImage.width * ratio, 140);
        const h = w === logoImage.width * ratio ? targetH : (w / logoImage.width) * logoImage.height;
        page.drawImage(logoImage, {
          x: PAGE_WIDTH - MARGIN_X - w,
          y: PAGE_HEIGHT - 8 - h,
          width: w,
          height: h,
        });
      }

      y = PAGE_HEIGHT - 85;
      if (input.clinicAddress) {
        drawText(page, input.clinicAddress, { x: MARGIN_X, y, size: 9, font, color: TEXT_MUTED });
        y -= 12;
      }
      if (input.clinicPhone) {
        drawText(page, `Ph: ${input.clinicPhone}`, { x: MARGIN_X, y, size: 9, font, color: TEXT_MUTED });
      }

      // Prescription Label & Date
      y = PAGE_HEIGHT - 130;
      drawText(page, 'PRESCRIPTION', { x: MARGIN_X, y, size: 14, font: bold, color: BRAND_BLUE });
      const dateStr = new Date(input.createdAtIso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const dateWidth = bold.latin.widthOfTextAtSize(`Date: ${dateStr}`, 10);
      drawText(page, `Date: ${dateStr}`, { x: PAGE_WIDTH - MARGIN_X - dateWidth, y: y + 2, size: 10, font: bold });

      y -= 25;

      // Patient Info Strip
      page.drawRectangle({
        x: MARGIN_X,
        y: y - 10,
        width: PAGE_WIDTH - (MARGIN_X * 2),
        height: 40,
        color: STRIP_BG,
      });
      page.drawRectangle({
        x: MARGIN_X,
        y: y - 10,
        width: PAGE_WIDTH - (MARGIN_X * 2),
        height: 40,
        borderColor: BORDER_COLOR,
        borderWidth: 1,
      });

      const stripY = y + 10;
      drawText(page, 'PATIENT', { x: MARGIN_X + 15, y: stripY + 10, size: 8, font: bold, color: TEXT_MUTED });
      drawText(page, input.patientName, { x: MARGIN_X + 15, y: stripY - 4, size: 11, font: bold, color: TEXT_DARK });

      const genderAge = [input.patientGender, input.patientAge ? `${input.patientAge}y` : null].filter(Boolean).join(' / ');
      if (genderAge) {
        drawText(page, 'AGE/GENDER', { x: MARGIN_X + 220, y: stripY + 10, size: 8, font: bold, color: TEXT_MUTED });
        drawText(page, genderAge, { x: MARGIN_X + 220, y: stripY - 4, size: 11, font, color: TEXT_DARK });
      }

      drawText(page, 'DOCTOR', { x: PAGE_WIDTH - MARGIN_X - 120, y: stripY + 10, size: 8, font: bold, color: TEXT_MUTED });
      drawText(page, input.doctorName, { x: PAGE_WIDTH - MARGIN_X - 120, y: stripY - 4, size: 10, font, color: TEXT_DARK });

      y -= 60;

      // Vitals & Diagnosis
      if (input.vitals || input.diagnosis) {
        if (input.vitals) {
          const vitalsArr = Object.entries(input.vitals).filter(([_, v]) => !!v).map(([k, v]) => `${k.toUpperCase()}: ${v}`);
          if (vitalsArr.length > 0) {
            drawText(page, 'Vitals: ', { x: MARGIN_X, y, size: 9, font: bold, color: TEXT_MUTED });
            drawText(page, vitalsArr.join('  •  '), { x: MARGIN_X + 45, y, size: 9, font, color: TEXT_DARK });
            y -= 16;
          }
        }
        if (input.diagnosis) {
          drawText(page, 'Diagnosis: ', { x: MARGIN_X, y, size: 9, font: bold, color: TEXT_MUTED });
          drawText(page, input.diagnosis, { x: MARGIN_X + 65, y, size: 9, font, color: TEXT_DARK });
          y -= 25;
        }
      }

      // Medicines Table Header
      page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 1, color: BORDER_COLOR });
      y -= 15;
      drawText(page, 'Medicine', { x: MARGIN_X, y, size: 9, font: bold, color: TEXT_MUTED });
      drawText(page, 'Dosage', { x: MARGIN_X + 180, y, size: 9, font: bold, color: TEXT_MUTED });
      drawText(page, 'Freq', { x: MARGIN_X + 260, y, size: 9, font: bold, color: TEXT_MUTED });
      drawText(page, 'Duration', { x: MARGIN_X + 320, y, size: 9, font: bold, color: TEXT_MUTED });
      drawText(page, 'Instructions', { x: MARGIN_X + 380, y, size: 9, font: bold, color: TEXT_MUTED });
      y -= 10;
      page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 1, color: BORDER_COLOR });
      y -= 25;
    };

    const newPage = () => {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = TOP_Y - 40;
      drawHeader();
    };

    const ensureRoom = (lines: number) => {
      if (y - lines * 14 < BOTTOM_Y + 60) newPage();
    };

    drawHeader();

    input.items.forEach((it, idx) => {
      ensureRoom(3);

      drawText(page, `${idx + 1}.`, { x: MARGIN_X - 15, y, size: 10, font, color: TEXT_MUTED });
      drawText(page, it.name, { x: MARGIN_X, y, size: 10, font: bold, color: TEXT_DARK });

      if (it.dosage) drawText(page, it.dosage, { x: MARGIN_X + 180, y, size: 9, font, color: TEXT_DARK });
      if (it.frequency) drawText(page, it.frequency, { x: MARGIN_X + 260, y, size: 9, font, color: TEXT_DARK });
      if (it.duration) drawText(page, it.duration, { x: MARGIN_X + 320, y, size: 9, font, color: TEXT_DARK });
      if (it.instructions) {
        const wrapped = it.instructions.length > 30 ? it.instructions.slice(0, 27) + '...' : it.instructions;
        drawText(page, wrapped, { x: MARGIN_X + 380, y, size: 9, font, color: TEXT_MUTED });
      }

      y -= 24;
      page.drawLine({ start: { x: MARGIN_X, y: y + 12 }, end: { x: PAGE_WIDTH - MARGIN_X, y: y + 12 }, thickness: 0.5, color: BORDER_COLOR });
    });

    drawSignatureLine(page, font, bold, input.doctorName);

    return await pdf.save();
  }

  async billPdf(input: {
    clinicName: string;
    // Branding overrides — same shape as prescriptionPdf. displayName
    // wins over clinicName on the header; primaryColor recolors the
    // brand bar / pattern / table header; logoUrl is fetched (via
    // StorageService if it's a key, or HTTP if a legacy URL) and
    // replaces the hardcoded medical-cross glyph.
    clinicDisplayName?: string;
    clinicLogoUrl?: string;
    primaryColor?: string;
    branchName?: string;
    clinicAddress?: string;
    clinicPhone?: string;
    billNo?: string;
    patientName: string;
    patientAge?: string | number;
    patientGender?: string;
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

    // Brand color rules:
    //  • DARK_TEAL is the main brand surface (banner, totals row) —
    //    overridden by the clinic's primary color when set.
    //  • ACCENT_TEAL is the secondary accent (top/bottom pattern, logo
    //    glyph fallback) — also overridden, using the same color, so the
    //    pattern stays mono-brand instead of clashing.
    //  • MINT_BG stays as the page background regardless — recoloring
    //    it would require also re-evaluating all the text colors.
    const brandPrimary = parseHexColor(input.primaryColor);
    const DARK_TEAL = brandPrimary ?? rgb(1 / 255, 66 / 255, 76 / 255);
    const MINT_BG = rgb(240 / 255, 255 / 255, 240 / 255);
    const ACCENT_TEAL = brandPrimary ?? rgb(10 / 255, 185 / 255, 140 / 255);
    const TEXT_LIGHT = rgb(1, 1, 1);
    const TEXT_DARK = DARK_TEAL;

    const headerName = (input.clinicDisplayName || '').trim() || input.clinicName;

    // Logo: same load logic as prescriptionPdf. Failure → no logo.
    let logoImage: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
    if (input.clinicLogoUrl) {
      try {
        const isUrl = /^https?:\/\//i.test(input.clinicLogoUrl);
        const bytes = isUrl
          ? await fetchLogoBytes(input.clinicLogoUrl)
          : await this.loadLogoFromStorage(input.clinicLogoUrl);
        if (bytes) {
          if (bytes[0] === 0x89 && bytes[1] === 0x50) {
            logoImage = await pdf.embedPng(bytes);
          } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            logoImage = await pdf.embedJpg(bytes);
          }
        }
      } catch {
        // non-fatal — fall through to the medical-cross glyph below
      }
    }

    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let currentY = TOP_Y;
    let tableStartY = 0;

    const drawPageBackground = () => {
      // Light mint background
      page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        color: MINT_BG,
      });

      // Top pattern
      for (let i = 0; i < PAGE_WIDTH; i += 15) {
        page.drawRectangle({
          x: i,
          y: PAGE_HEIGHT - 15,
          width: 15,
          height: 15,
          color: (i / 15) % 2 === 0 ? ACCENT_TEAL : DARK_TEAL,
        });
      }

      // Bottom pattern
      for (let i = 0; i < PAGE_WIDTH; i += 15) {
        page.drawRectangle({
          x: i,
          y: 0,
          width: 15,
          height: 15,
          color: (i / 15) % 2 === 0 ? ACCENT_TEAL : DARK_TEAL,
        });
      }
    };

    const drawHeader = (continuation: boolean) => {
      drawPageBackground();

      // Header Background
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 220,
        width: PAGE_WIDTH,
        height: 205, // 220 - 15 (pattern)
        color: DARK_TEAL,
      });

      let hy = PAGE_HEIGHT - 60;

      // Title
      drawText(page, continuation ? 'INVOICE (cont.)' : 'INVOICE', { x: MARGIN_X, y: hy, size: 38, font: bold, color: TEXT_LIGHT });

      // Logo: when the clinic has uploaded one, render it top-right.
      // Otherwise fall back to the original medical-cross glyph so the
      // header doesn't read as visually broken.
      if (logoImage) {
        const targetH = 60;
        const ratio = logoImage.height > 0 ? targetH / logoImage.height : 1;
        const w = Math.min(logoImage.width * ratio, 140);
        const h = w === logoImage.width * ratio ? targetH : (w / logoImage.width) * logoImage.height;
        page.drawImage(logoImage, {
          x: PAGE_WIDTH - MARGIN_X - w,
          y: hy - 15,
          width: w,
          height: h,
        });
      } else {
        // Medical Cross (Logo approximation)
        const cx = PAGE_WIDTH - 80;
        const cy = hy + 10;
        page.drawRectangle({ x: cx - 25, y: cy - 10, width: 50, height: 20, color: ACCENT_TEAL });
        page.drawRectangle({ x: cx - 10, y: cy - 25, width: 20, height: 50, color: ACCENT_TEAL });
      }

      hy -= 15;
      page.drawLine({ start: { x: MARGIN_X, y: hy }, end: { x: MARGIN_X + 220, y: hy }, thickness: 1.5, color: TEXT_LIGHT });

      hy -= 30;

      const dateStr = input.issuedAtIso ? new Date(input.issuedAtIso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/\//g, ' - ') : new Date().toLocaleDateString('en-IN').replace(/\//g, ' - ');

      if (!continuation) {
        drawText(page, `INVOICE NO : ${input.billNo || '001'}`, { x: MARGIN_X, y: hy, size: 9, font: bold, color: TEXT_LIGHT });
        drawText(page, `DATE : ${dateStr}`, { x: MARGIN_X, y: hy - 14, size: 9, font: bold, color: TEXT_LIGHT });

        drawText(page, `DUE DATE : ${dateStr}`, { x: MARGIN_X + 220, y: hy, size: 9, font: bold, color: TEXT_LIGHT });

        hy -= 40;

        drawText(page, 'TO:', { x: MARGIN_X, y: hy, size: 9, font: bold, color: TEXT_LIGHT });
        drawText(page, input.patientName, { x: MARGIN_X, y: hy - 14, size: 10, font, color: TEXT_LIGHT });
        const pMeta = [input.patientGender, input.patientAge ? `${input.patientAge}y` : null].filter(Boolean).join(' / ');
        if (pMeta) drawText(page, pMeta, { x: MARGIN_X, y: hy - 26, size: 9, font, color: TEXT_LIGHT });

        drawText(page, 'FROM:', { x: MARGIN_X + 220, y: hy, size: 9, font: bold, color: TEXT_LIGHT });
        drawText(page, headerName, { x: MARGIN_X + 220, y: hy - 14, size: 10, font: bold, color: TEXT_LIGHT });
        
        let fromY = hy - 26;
        if (input.branchName) {
          drawText(page, input.branchName, { x: MARGIN_X + 220, y: fromY, size: 9, font, color: TEXT_LIGHT });
          fromY -= 12;
        }
        if (input.clinicAddress) {
          drawText(page, input.clinicAddress, { x: MARGIN_X + 220, y: fromY, size: 9, font, color: TEXT_LIGHT });
          fromY -= 12;
        }
        if (input.clinicPhone) {
          drawText(page, input.clinicPhone, { x: MARGIN_X + 220, y: fromY, size: 9, font, color: TEXT_LIGHT });
        }
      }

      // Prepare for table
      currentY = PAGE_HEIGHT - 250;
      tableStartY = currentY;

      // Table Header row
      page.drawLine({ start: { x: MARGIN_X, y: currentY }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY }, thickness: 1, color: DARK_TEAL });

      const ty = currentY - 25;
      drawText(page, 'DESCRIPTION', { x: MARGIN_X + 15, y: ty, size: 9, font: bold, color: TEXT_DARK });
      drawText(page, 'QTY', { x: 340, y: ty, size: 9, font: bold, color: TEXT_DARK });
      drawText(page, 'PRICE', { x: 400, y: ty, size: 9, font: bold, color: TEXT_DARK });
      drawText(page, 'TOTAL', { x: 475, y: ty, size: 9, font: bold, color: TEXT_DARK });

      currentY -= 40;
      page.drawLine({ start: { x: MARGIN_X, y: currentY }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY }, thickness: 1, color: DARK_TEAL });
      currentY -= 20;
    };

    const newPage = () => {
      // Draw bottom vertical lines for previous page table before adding new page
      page.drawLine({ start: { x: MARGIN_X, y: currentY + 10 }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY + 10 }, thickness: 1, color: DARK_TEAL });
      drawVerticalLines(page, tableStartY, currentY + 10, DARK_TEAL);

      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(true);
    };

    const drawVerticalLines = (p: PDFPage, top: number, bottom: number, color: any) => {
      const xs = [MARGIN_X, 320, 380, 460, PAGE_WIDTH - MARGIN_X];
      xs.forEach(x => {
        p.drawLine({ start: { x, y: top }, end: { x, y: bottom }, thickness: 1, color });
      });
    };

    drawHeader(false);

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      if (currentY - 12 < BOTTOM_Y + 120) newPage();

      drawText(page, it.name.slice(0, 45).toUpperCase(), { x: MARGIN_X + 15, y: currentY, size: 10, font: bold, color: TEXT_DARK });
      drawText(page, String(it.quantity), { x: 340, y: currentY, size: 10, font: bold, color: TEXT_DARK });
      drawText(page, `${input.currency.replace('INR', '₹')} ${it.unitPrice}`, {
        x: 400,
        y: currentY,
        size: 10,
        font: bold,
        color: TEXT_DARK
      });
      drawText(page, `${input.currency.replace('INR', '₹')} ${it.amount}`, {
        x: 475,
        y: currentY,
        size: 10,
        font: bold,
        color: TEXT_DARK
      });

      currentY -= 20;
    }

    if (currentY - 80 < BOTTOM_Y) newPage();

    currentY -= 10;

    // Close table
    page.drawLine({ start: { x: MARGIN_X, y: currentY }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY }, thickness: 1, color: DARK_TEAL });
    drawVerticalLines(page, tableStartY, currentY, DARK_TEAL);

    currentY -= 30;

    // Bottom section
    drawText(page, 'PAYMENT STATUS:', { x: MARGIN_X, y: currentY, size: 11, font: bold, color: TEXT_DARK });
    drawText(page, input.paid ? 'PAID' : 'PENDING', { x: MARGIN_X, y: currentY - 18, size: 11, font: bold, color: TEXT_DARK });

    const rightAlign = (label: string, value: string, fontToUse: FontTriple, yPos: number) => {
      const labelWidth = fontToUse.latin.widthOfTextAtSize(label, 11);
      drawText(page, label, { x: 450 - labelWidth, y: yPos, size: 11, font: fontToUse, color: TEXT_DARK });
      drawText(page, value, { x: 460, y: yPos, size: 11, font: fontToUse, color: TEXT_DARK });
    };

    let sY = currentY;
    const cur = input.currency.replace('INR', '₹');
    rightAlign('SUB TOTAL :', `${cur} ${input.subtotal}`, bold, sY);
    if (input.discount > 0) {
      sY -= 18;
      rightAlign('DISCOUNT :', `- ${cur} ${input.discount}`, bold, sY);
    }
    sY -= 18;
    rightAlign('TAX :', `${cur} ${input.tax}`, bold, sY);
    sY -= 18;
    rightAlign('TOTAL :', `${cur} ${input.total}`, bold, sY);

    return await pdf.save();
  }
}

function drawSignatureLine(
  page: PDFPage,
  font: FontTriple,
  bold: FontTriple,
  doctorName: string,
) {
  const y = BOTTOM_Y;
  page.drawLine({
    start: { x: 380, y: y + 18 },
    end: { x: 555, y: y + 18 },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  });
  drawText(page, 'Signature', {
    x: 380,
    y: y + 4,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  drawText(page, doctorName, {
    x: 380,
    y: y - 10,
    size: 10,
    font: bold,
  });
}

function drawPaidStamp(page: PDFPage, bold: FontTriple, paidAtIso?: string) {
  drawText(page, 'PAID', {
    x: 360,
    y: 340,
    size: 90,
    font: bold,
    color: rgb(0.85, 0.15, 0.15),
    opacity: 0.25,
    rotate: degrees(-20),
  });
  if (paidAtIso) {
    drawText(page, `Paid on ${paidAtIso}`, {
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
