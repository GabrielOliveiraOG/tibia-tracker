const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');

const outfits = [
  { name: 'knight', page: 'https://tibia.fandom.com/wiki/File:Outfit_Knight_Male_Addon_2.gif' },
  { name: 'druid', page: 'https://tibia.fandom.com/wiki/File:Outfit_Druid_Male_Addon_2.gif' },
  { name: 'sorcerer', page: 'https://tibia.fandom.com/wiki/File:Outfit_Mage_Male_Addon_2.gif' },
  { name: 'paladin', page: 'https://tibia.fandom.com/wiki/File:Outfit_Hunter_Male_Addon_2.gif' }
];

async function run() {
  console.log('Launching browser to capture authentic outfit PNGs...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const item of outfits) {
    console.log(`Processing ${item.name}...`);
    try {
      await page.goto(item.page, { waitUntil: 'networkidle2', timeout: 15000 });
      // Find the main image element
      const imgSelector = '.internal img, .fullMedia a, #file img';
      await page.waitForSelector(imgSelector, { timeout: 5000 });
      const imgElement = await page.$(imgSelector);
      
      if (imgElement) {
        const destPath = path.join(__dirname, 'public', 'assets', 'outfits', `${item.name}.png`);
        await imgElement.screenshot({ path: destPath, omitBackground: true });
        console.log(`Successfully saved ${item.name}.png (${fs.statSync(destPath).size} bytes)`);
      }
    } catch (err) {
      console.error(`Failed ${item.name}:`, err.message);
    }
  }

  await browser.close();
  console.log('Done downloading outfits!');
}

run();
