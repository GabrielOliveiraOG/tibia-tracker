const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');

async function scrapeCharacter(page, charName) {
  const url = `https://rubinot.com.br/characters?name=${encodeURIComponent(charName)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const charData = await page.evaluate(() => {
    const body = document.body.innerText;
    const result = { deaths: [], rawText: body.substring(0, 3000) };
    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let inDeaths = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();

      // Detect deaths section
      if (lowerLine.includes('mortes do personagem')) {
        inDeaths = true;
        continue;
      }

      // Detect end of deaths section
      if (inDeaths && lowerLine.includes('informa') && lowerLine.includes('conta')) {
        inDeaths = false;
      }

      if (inDeaths) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          const dateStr = parts[0].trim();
          const desc = parts[1].trim();
          if (desc.toLowerCase().includes('morto')) {
            const match = desc.match(/level (\d+)/i);
            const lvl = match ? parseInt(match[1]) : null;
            result.deaths.push({ date: dateStr, level: lvl, desc: desc });
          }
        }
      }
    }
    return result;
  });

  return charData;
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const data = await scrapeCharacter(page, "Red Minato");
  console.log(JSON.stringify(data.deaths, null, 2));
  await browser.close();
}

run();
