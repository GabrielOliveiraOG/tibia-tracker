const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  const url = `https://rubinot.com.br/characters?name=Red%20Minato`;
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));
  
  const charData = await page.evaluate(() => {
    const body = document.body.innerText;
    const result = { deaths: [], rawText: body.substring(0, 3000) };
    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let inDeaths = false;
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      
      if (lowerLine.includes('mortes do personagem')) {
        inDeaths = true;
        continue;
      }
      
      if (inDeaths && lowerLine.includes('informa') && lowerLine.includes('conta')) {
        inDeaths = false;
      }
      
      if (inDeaths) {
        const parts = lines[i].split('\t');
        if (parts.length >= 2) {
          result.deaths.push({ line: lines[i] });
        }
      }
    }
    return result;
  });
  
  console.log(JSON.stringify(charData, null, 2));
  await browser.close();
}

run();
