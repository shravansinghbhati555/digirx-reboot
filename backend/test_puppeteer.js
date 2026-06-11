const puppeteer = require('puppeteer');

async function run() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.error('[Browser Error]', err);
  });
  
  const token = 'f9711dad40249b10b2a5ca4ca5f4a6e74aa2cd04ae07ba8a';
  const url = `http://localhost:5173/share/${token}`;
  console.log(`Navigating to: ${url}`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    console.log('Navigation complete.');
    
    // Check if the selector is visible
    const hasCaptureArea = await page.$('#prescription-capture-area');
    console.log('Is #prescription-capture-area present?', !!hasCaptureArea);
    
    if (!hasCaptureArea) {
      const bodyHTML = await page.evaluate(() => document.body.innerHTML);
      console.log('Body HTML content snippet:', bodyHTML.substring(0, 1000));
    }
  } catch (err) {
    console.error('Error during execution:', err);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

run();
