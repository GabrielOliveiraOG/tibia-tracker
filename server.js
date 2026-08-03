const express = require('express');
const path = require('path');
const fs = require('fs');
const { runScraper } = require('./scraper');

const app = express();
const PORT = 3000;
const DATA_PATH = path.join(__dirname, 'data', 'levels.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (!config.parties) config.parties = {};
    return config;
  } catch {
    return { characters: [], parties: {}, scrapeIntervalMinutes: 60 };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Get level data
app.get('/api/data', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    res.json(data);
  } catch {
    res.json({ characters: {} });
  }
});

// API: Get config
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// API: Add character
app.post('/api/characters', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Nome do personagem é obrigatório' });
  }

  const config = loadConfig();
  const normalizedName = name.trim().toLowerCase();

  if (config.characters.some(c => c.toLowerCase() === normalizedName)) {
    return res.status(409).json({ error: 'Personagem já existe' });
  }

  config.characters.push(name.trim());
  saveConfig(config);
  res.json({ success: true, characters: config.characters });
});

// API: Remove character
app.delete('/api/characters/:name', (req, res) => {
  const nameToRemove = decodeURIComponent(req.params.name).toLowerCase();

  const config = loadConfig();
  config.characters = config.characters.filter(c => c.toLowerCase() !== nameToRemove);

  // Also remove from all parties
  for (const pt of Object.keys(config.parties)) {
    config.parties[pt] = config.parties[pt].filter(c => c.toLowerCase() !== nameToRemove);
  }
  saveConfig(config);

  // Remove from data (levels.json)
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    delete data.characters[nameToRemove];
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* ignore */ }

  res.json({ success: true, characters: config.characters });
});

// =====================
// PARTY ENDPOINTS
// =====================

// List all parties
app.get('/api/parties', (req, res) => {
  const config = loadConfig();
  res.json(config.parties || {});
});

// Create party
app.post('/api/parties', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Nome da PT é obrigatório' });
  }

  const config = loadConfig();
  const ptName = name.trim();

  if (config.parties[ptName]) {
    return res.status(409).json({ error: 'PT já existe' });
  }

  config.parties[ptName] = [];
  saveConfig(config);
  res.json({ success: true, parties: config.parties });
});

// Delete party
app.delete('/api/parties/:name', (req, res) => {
  const ptName = decodeURIComponent(req.params.name);
  const config = loadConfig();

  delete config.parties[ptName];
  saveConfig(config);
  res.json({ success: true, parties: config.parties });
});

// Add member to party
app.post('/api/parties/:name/members', (req, res) => {
  const ptName = decodeURIComponent(req.params.name);
  const { character } = req.body;

  if (!character || typeof character !== 'string') {
    return res.status(400).json({ error: 'Nome do personagem é obrigatório' });
  }

  const config = loadConfig();

  if (!config.parties[ptName]) {
    return res.status(404).json({ error: 'PT não encontrada' });
  }

  const charLower = character.trim().toLowerCase();
  if (config.parties[ptName].some(c => c.toLowerCase() === charLower)) {
    return res.status(409).json({ error: 'Personagem já está nessa PT' });
  }

  // Also add to global characters list if not there
  if (!config.characters.some(c => c.toLowerCase() === charLower)) {
    config.characters.push(character.trim());
  }

  config.parties[ptName].push(character.trim());
  saveConfig(config);
  res.json({ success: true, party: config.parties[ptName] });
});

// Remove member from party
app.delete('/api/parties/:name/members/:character', (req, res) => {
  const ptName = decodeURIComponent(req.params.name);
  const charName = decodeURIComponent(req.params.character).toLowerCase();

  const config = loadConfig();

  if (!config.parties[ptName]) {
    return res.status(404).json({ error: 'PT não encontrada' });
  }

  config.parties[ptName] = config.parties[ptName].filter(c => c.toLowerCase() !== charName);
  saveConfig(config);
  res.json({ success: true, party: config.parties[ptName] });
});

// API: Trigger manual scrape
let isScraping = false;
app.post('/api/scrape', async (req, res) => {
  if (isScraping) {
    return res.status(429).json({ error: 'Scrape já em andamento...' });
  }

  isScraping = true;
  res.json({ status: 'started', message: 'Scrape iniciado. Aguarde...' });

  try {
    await runScraper();
    console.log('[SERVER] Scrape manual concluído com sucesso');
  } catch (err) {
    console.error('[SERVER] Erro no scrape manual:', err.message);
  } finally {
    isScraping = false;
  }
});

// API: Scrape status
app.get('/api/scrape/status', (req, res) => {
  res.json({ isScraping });
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎮 Tibia Tracker Dashboard rodando em http://localhost:${PORT}`);
  console.log(`📊 API de dados: http://localhost:${PORT}/api/data`);
  console.log(`🔄 Trigger scrape: POST http://localhost:${PORT}/api/scrape\n`);
});
