import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import puppeteer, { Browser } from 'puppeteer';

@Injectable()
export class ScreenshotService {
  private readonly logger = new Logger(ScreenshotService.name);
  private browser: Browser | null = null;

  constructor(private readonly config: ConfigService) {}

  private async getBrowser() {
    if (this.browser) return this.browser;
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
    });
    return this.browser;
  }

  async capturePrescription(token: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    
    // Log console messages from the browser to NestJS logger
    page.on('console', msg => {
      this.logger.debug(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });

    page.on('pageerror', err => {
      this.logger.error(`[Browser Error] ${err instanceof Error ? err.message : String(err)}`);
    });

    try {
      const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:5173';
      const url = `${frontendUrl}/share/${token}`;
      
      this.logger.log(`Capturing screenshot for token ${token} at ${url}`);
      
      await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
      
      // Wait for the page to load
      const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      if (!response || !response.ok()) {
        this.logger.warn(`Page load status: ${response?.status() || 'unknown'}`);
      }
      
      // Wait for the specific capture area to be visible
      try {
        await page.waitForSelector('#prescription-capture-area', { timeout: 10000 });
      } catch (e) {
        this.logger.error(`Selector #prescription-capture-area not found. Page title: ${await page.title()}`);
        // Log the HTML content of the body for debugging
        const body = await page.evaluate(() => document.body.innerHTML);
        this.logger.error(`Body content snippet: ${body.substring(0, 500)}...`);
        throw e;
      }
      
      const element = await page.$('#prescription-capture-area');
      if (!element) throw new Error('Capture area not found after waiting');

      const screenshot = await element.screenshot({
        type: 'png',
        omitBackground: true,
      });

      return screenshot as Buffer;
    } catch (err: any) {
      this.logger.error(`Failed to capture screenshot: ${err.message}`);
      throw err;
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}
