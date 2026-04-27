const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Set viewport to a good size
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', msg => {
    const text = msg.text();
    // Filter out some spam if needed, but we want to see errors
    console.log(`[Browser Console] ${msg.type()}: ${text}`);
  });

  page.on('pageerror', err => {
    console.log(`[Browser Error] ${err.toString()}`);
  });

  console.log("Navigating to http://localhost:3000 ...");
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Wait for Cannon and Three.js to initialize
  await new Promise(r => setTimeout(r, 2000));

  console.log("Enabling Auto Mode...");
  await page.evaluate(() => {
    document.getElementById('btn-auto').click();
    window.controls.heldKeys.add('ArrowRight');
    window.simulator._debugCounter = 20;
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log("Arming drone...");
  await page.evaluate(() => {
    const btn = document.getElementById('ctrl-arm');
    if (btn) btn.click();
  });

  console.log("Waiting 3 seconds for simulation to stabilize/crash...");
  await new Promise(r => setTimeout(r, 3000));

  // Get HUD telemetry to see if it's NaN
  const telemetry = await page.evaluate(() => {
    return {
      alt: document.getElementById('h-alt')?.innerText,
      roll: document.getElementById('h-roll')?.innerText,
      pitch: document.getElementById('h-pitch')?.innerText,
      yaw: document.getElementById('h-yaw')?.innerText
    };
  });
  console.log("Telemetry after 3 seconds:", telemetry);

  console.log("Taking screenshot...");
  await page.screenshot({ path: 'auto_mode_screenshot.png' });

  await browser.close();
  console.log("Done. Saved auto_mode_screenshot.png.");
})();
