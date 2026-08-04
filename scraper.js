require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH = path.join(__dirname, 'data', 'levels.json');

async function loadConfig() {
  if (supabase) {
    try {
      const { data: chars } = await supabase.from('characters').select('name, key');
      if (chars && chars.length > 0) {
        return { characters: chars.map(c => c.name || c.key) };
      }
    } catch (e) {
      console.log('[SCRAPER] Aviso: Erro ao buscar lista de chars no Supabase, usando local...');
    }
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { characters: [] };
  }
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return { characters: {} };
  }
}

function saveData(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function scrapeCharacter(page, charName) {
  const url = `https://rubinot.com.br/characters?name=${encodeURIComponent(charName)}`;
  console.log(`[SCRAPER] Acessando: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Aguarda o conteúdo renderizar (Next.js CSR)
  // Tenta encontrar o container de dados do personagem
  try {
    await page.waitForFunction(() => {
      // Look for any text content that contains "Level" on the page
      const body = document.body.innerText;
      return body.includes('Level') || body.includes('level');
    }, { timeout: 30000 });
  } catch (e) {
    console.log(`[SCRAPER] Timeout esperando dados de ${charName}. Tentando extrair mesmo assim...`);
  }

  // Espera um pouco mais para garantir renderização completa
  await new Promise(r => setTimeout(r, 3000));

  // Extrai dados do personagem
  const charData = await page.evaluate(() => {
    const body = document.body.innerText;

    const result = {
      name: null,
      level: null,
      vocation: null,
      world: null,
      deaths: [],
      rawText: body.substring(0, 2000) // For debugging
    };

    // The Rubinot page uses Portuguese labels with tab-separated values:
    // We need to find the CHARACTER INFO section specifically to avoid
    // picking up level numbers from the deaths section.

    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let inCharInfo = false;
    let passedCharInfo = false;
    let inDeaths = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();

      // Detect character info section
      if (lowerLine.includes('informa') && lowerLine.includes('personagem') && !lowerLine.includes('conta')) {
        inCharInfo = true;
        inDeaths = false;
        continue;
      }

      // Detect deaths section
      if (lowerLine.includes('mortes do personagem')) {
        inCharInfo = false;
        passedCharInfo = true;
        inDeaths = true;
        continue;
      }

      // Detect end of deaths section
      if (inDeaths && lowerLine.includes('informa') && lowerLine.includes('conta')) {
        inDeaths = false;
      }

      if (inDeaths) {
        // Line format: "10 de jun. de 2026, 23:35  Morto no level 426 por Toxic Keiber..."
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

      if (inCharInfo || !passedCharInfo) {
        // Parse tab-separated or colon-separated key-value pairs
        const kvMatch = line.match(/^(.+?)[:]\s*\t?\s*(.+)$/);

        const labelOnlyMatch = line.match(/^(nome|name|nível|nivel|level|vocação|vocacao|vocation|mundo|world)[:]\s*$/i);
        if (labelOnlyMatch && i + 1 < lines.length) {
          const label = labelOnlyMatch[1].trim().toLowerCase();
          const nextValue = lines[i + 1].trim();
          if (nextValue && !nextValue.includes(':')) {
            if ((label === 'nome' || label === 'name') && !result.name) {
              result.name = nextValue;
            }
          }
        }

        if (kvMatch) {
          const label = kvMatch[1].trim().toLowerCase();
          const value = kvMatch[2].trim();

          if ((label === 'nome' || label === 'name') && !result.name) result.name = value;
          if ((label === 'nível' || label === 'nivel' || label === 'level') && !result.level) {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0 && num < 100000) result.level = num;
          }
          if ((label === 'vocação' || label === 'vocacao' || label === 'vocation') && !result.vocation) result.vocation = value;
          if ((label === 'mundo' || label === 'world') && !result.world) result.world = value;
        }
      }
    }

    // Fallback: if we didn't find the section, try a broader search
    if (!result.level) {
      for (const line of lines) {
        const levelMatch = line.match(/n[ií]vel[:.\s\t]+(\d+)/i);
        if (levelMatch) {
          result.level = parseInt(levelMatch[1]);
          break;
        }
        const levelMatch2 = line.match(/level[:.\s\t]+(\d+)/i);
        if (levelMatch2) {
          result.level = parseInt(levelMatch2[1]);
          break;
        }
      }
    }

    // Fallback for vocation
    if (!result.vocation) {
      const vocations = [
        'Elite Knight', 'Royal Paladin', 'Elder Druid', 'Master Sorcerer',
        'Knight', 'Paladin', 'Druid', 'Sorcerer'
      ];
      for (const line of lines) {
        if (line.toLowerCase().includes('voca')) {
          for (const voc of vocations) {
            if (line.includes(voc)) {
              result.vocation = voc;
              break;
            }
          }
          if (result.vocation) break;
        }
      }
    }

    return result;
  });

  return charData;
}

async function runScraper() {
  const config = await loadConfig();
  const data = loadData();
  const timestamp = new Date().toISOString();

  console.log(`[SCRAPER] Iniciando scrape em ${timestamp}`);
  console.log(`[SCRAPER] Personagens: ${config.characters.join(', ')}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });

    const page = await browser.newPage();

    // Set user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set language
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' });

    for (const charName of config.characters) {
      try {
        const charData = await scrapeCharacter(page, charName);

        console.log(`[SCRAPER] Resultado para ${charName}:`, JSON.stringify(charData, null, 2));

        if (charData.level) {
          const key = charName.toLowerCase();
          if (!data.characters[key]) {
            data.characters[key] = {
              name: charData.name || charName,
              vocation: charData.vocation || 'Unknown',
              world: charData.world || 'Unknown',
              records: []
            };
          }

          // Update vocation/world if we got new data
          if (charData.vocation) data.characters[key].vocation = charData.vocation;
          if (charData.world) data.characters[key].world = charData.world;
          if (charData.name) data.characters[key].name = charData.name;

          // Add level record
          data.characters[key].records.push({
            timestamp,
            level: charData.level
          });

          // Update deaths
          if (!data.characters[key].deaths) data.characters[key].deaths = [];
          if (charData.deaths && charData.deaths.length > 0) {
            for (const d of charData.deaths) {
              const exists = data.characters[key].deaths.find(existing => existing.date === d.date && existing.desc === d.desc);
              if (!exists) {
                data.characters[key].deaths.push(d);
              }
            }
          }

          // ---- Save to Supabase ----
          if (supabase) {
            try {
              await supabase.from('characters').upsert({
                key,
                name: charData.name || charName,
                vocation: charData.vocation || 'Unknown',
                world: charData.world || 'Unknown'
              }, { onConflict: 'key' });

              await supabase.from('records').insert({
                character_key: key,
                timestamp,
                level: charData.level
              });

              if (charData.deaths && charData.deaths.length > 0) {
                for (const d of charData.deaths) {
                  const { data: existingDeaths } = await supabase
                    .from('deaths')
                    .select('id')
                    .eq('character_key', key)
                    .eq('date', d.date)
                    .eq('description', d.desc);

                  if (!existingDeaths || existingDeaths.length === 0) {
                    await supabase.from('deaths').insert({
                      character_key: key,
                      date: d.date || '',
                      level: d.level || null,
                      description: d.desc || ''
                    });
                  }
                }
              }
              console.log(`[SCRAPER] ⚡ Salvo no Supabase: ${charName}`);
            } catch (sbErr) {
              console.error(`[SCRAPER] Erro ao salvar no Supabase (${charName}):`, sbErr.message);
            }
          }

          console.log(`[SCRAPER] ✅ ${charName}: Level ${charData.level}`);
        } else {
          console.log(`[SCRAPER] ❌ Não conseguiu extrair level de ${charName}`);
          console.log(`[SCRAPER] Raw text (primeiros 500 chars): ${charData.rawText?.substring(0, 500)}`);
        }
      } catch (err) {
        console.error(`[SCRAPER] Erro ao scrape ${charName}:`, err.message);
      }
    }

    saveData(data);
    console.log(`[SCRAPER] Dados salvos em ${DATA_PATH}`);
  } catch (err) {
    console.error('[SCRAPER] Erro geral:', err.message);
  } finally {
    if (browser) await browser.close();
  }

  return data;
}

// Se rodado diretamente
if (require.main === module) {
  runScraper().then(() => {
    console.log('[SCRAPER] Finalizado.');
    process.exit(0);
  }).catch(err => {
    console.error('[SCRAPER] Falha:', err);
    process.exit(1);
  });
}

module.exports = { runScraper };
