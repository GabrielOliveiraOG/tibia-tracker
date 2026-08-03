// ============================
// Tibia Tracker - Dashboard App
// ============================

// Supabase client helper (anon key is safe for frontend - RLS protects data)
const SUPABASE_URL = 'https://ovavbnbcjmdnypntvewm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92YXZibmJjam1kbnlwbnR2ZXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3OTExNzYsImV4cCI6MjEwMTM2NzE3Nn0.WrB6dvoGKyfPLO7l-TLZ6OXJBOdZ63kJxLOQGwg4Y7M';

let _supabaseClient = null;
function getSupabase() {
  if (!_supabaseClient) {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else if (typeof createClient === 'function') {
      _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  }
  return _supabaseClient;
}

let chart = null;
let currentRange = 'today';
let currentPtFilter = 'all'; // 'all' or party name
let currentRankingRange = 'today';
let currentRankingSort = 'xp'; // 'xp' or 'level'
let appData = { characters: {} };
let appConfig = { characters: [], parties: {} };

// ============================
// Init
// ============================
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  loadData();
  setupEventListeners();

  // Auto-refresh every 60 seconds
  setInterval(loadData, 60000);

  // Poll scrape status every 3 seconds when scraping
  setInterval(checkScrapeStatus, 3000);
});

// ============================
// Particles
// ============================
function initParticles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 25; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = (Math.random() * 100 + 100) + '%';
    particle.style.animationDelay = Math.random() * 8 + 's';
    particle.style.animationDuration = (6 + Math.random() * 6) + 's';
    particle.style.width = (1 + Math.random() * 2) + 'px';
    particle.style.height = particle.style.width;
    container.appendChild(particle);
  }
}

// ============================
// Data Loading (Supabase + Local Fallback)
// ============================
async function loadData() {
  try {
    const sb = getSupabase();
    if (sb) {
      // Fetch all data from Supabase in parallel
      const [charsRes, recordsRes, deathsRes, partiesRes, membersRes] = await Promise.all([
        sb.from('characters').select('*'),
        sb.from('records').select('*').order('timestamp', { ascending: true }),
        sb.from('deaths').select('*'),
        sb.from('parties').select('*'),
        sb.from('party_members').select('*')
      ]);

      if (charsRes.data && charsRes.data.length > 0) {
        const characters = {};
        const charNames = [];

        charsRes.data.forEach(c => {
          charNames.push(c.name || c.key);
          characters[c.key] = {
            name: c.name,
            vocation: c.vocation,
            world: c.world,
            records: [],
            deaths: []
          };
        });

        // Attach records to characters
        (recordsRes.data || []).forEach(r => {
          if (characters[r.character_key]) {
            characters[r.character_key].records.push({
              timestamp: r.timestamp,
              level: r.level
            });
          }
        });

        // Attach deaths to characters
        (deathsRes.data || []).forEach(d => {
          if (characters[d.character_key]) {
            characters[d.character_key].deaths.push({
              date: d.date,
              level: d.level,
              desc: d.description
            });
          }
        });

        // Build parties
        const parties = {};
        (partiesRes.data || []).forEach(p => {
          parties[p.name] = [];
        });
        (membersRes.data || []).forEach(m => {
          if (parties[m.party_name]) {
            parties[m.party_name].push(m.character_key);
          }
        });

        appData = { characters };
        appConfig = { characters: charNames, parties };

        renderAll();
        return;
      }
    }
  } catch (err) {
    console.warn('Aviso: Falha ao carregar do Supabase, tentando API local:', err);
  }

  // Fallback to local Express API
  try {
    const [dataRes, configRes] = await Promise.all([
      fetch('/api/data'),
      fetch('/api/config')
    ]);

    if (dataRes.ok && configRes.ok) {
      appData = await dataRes.json();
      appConfig = await configRes.json();
      if (!appConfig.parties) appConfig.parties = {};
    }
  } catch (err) {
    console.error('Erro ao carregar dados locais:', err);
  }

  renderAll();
}

function renderAll() {
  renderPtFilters();
  renderSummaryCards();
  renderRankingSection();
  renderHistoryTable();
  renderLogEntries();
  renderPtManager();
  renderCharList(); // Global characters
  updateLastUpdate();
}

// ============================
// Filtering Logic
// ============================
function getFilteredCharacters() {
  const allKeys = Object.keys(appData.characters);
  
  if (currentPtFilter === 'all') {
    return allKeys;
  }

  const ptMembers = appConfig.parties[currentPtFilter] || [];
  const ptMembersLower = ptMembers.map(m => m.toLowerCase());
  
  return allKeys.filter(key => ptMembersLower.includes(key));
}

// ============================
// UI Renderers
// ============================

function renderPtFilters() {
  const container = document.getElementById('ptFilterPills');
  const parties = Object.keys(appConfig.parties || {});
  
  let html = `<button class="pt-pill ${currentPtFilter === 'all' ? 'active' : ''}" data-pt="all" onclick="setPtFilter('all')">Todos</button>`;
  
  parties.forEach(pt => {
    const isActive = currentPtFilter === pt ? 'active' : '';
    html += `<button class="pt-pill ${isActive}" data-pt="${pt}" onclick="setPtFilter('${pt.replace(/'/g, "\\'")}')">${pt}</button>`;
  });
  
  container.innerHTML = html;
}

function setPtFilter(ptName) {
  currentPtFilter = ptName;
  renderAll(); // Re-render everything with new filter
}

function getVocationOutfit(vocationStr) {
  const voc = vocationStr || '';
  if (voc.includes('Druid')) return { name: 'Druid', img: 'vocations/Outfit_Druid_Male_Addon_3.gif' };
  if (voc.includes('Sorcerer')) return { name: 'Sorcerer', img: 'vocations/Outfit_Mage_Male_Addon_3.gif' };
  if (voc.includes('Paladin')) return { name: 'Paladin', img: 'vocations/Outfit_Hunter_Male_Addon_3.gif' };
  return { name: 'Knight', img: 'vocations/Outfit_Knight_Male_Addon_3.gif' };
}

function getCharUrl(charName) {
  if (!charName) return '#';
  return `https://rubinot.com.br/characters?name=${encodeURIComponent(charName.trim())}`;
}

function renderSummaryCards() {
  const container = document.getElementById('summaryCards');
  const keys = getFilteredCharacters();
  const chars = appData.characters;

  if (keys.length === 0) {
    container.innerHTML = `
      <div class="loading-placeholder">
        <span>Nenhum personagem encontrado${currentPtFilter !== 'all' ? ' nesta PT' : ''}.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = keys.map(key => {
    const char = chars[key];
    const records = char.records || [];
    const currentLevel = records.length > 0 ? records[records.length - 1].level : 0;
    const todayLevels = getLevelsToday(records);
    const weekLevels = getLevelsInRange(records, 7);
    const monthLevels = getLevelsInRange(records, 30);
    const deathStats = getDeathsInLastMonth(char.deaths || []);
    
    const outfit = getVocationOutfit(char.vocation);
    const charName = char.name || key;

    return `
      <div class="char-card clickable" onclick="openCharModal('${key}')">
        <div class="char-card-header">
          <div class="char-card-left">
            <div class="char-outfit-container">
              <img src="${outfit.img}" class="char-outfit-img" alt="${outfit.name}">
            </div>
            <div>
              <div class="char-name">
                <a href="${getCharUrl(charName)}" target="_blank" rel="noopener noreferrer" class="char-name-link" title="Abrir página no Rubinot">${charName}</a>
              </div>
              <span class="char-vocation">${char.vocation || 'Unknown'}</span>
            </div>
          </div>
        </div>
        <div class="char-level-row">
          <span class="char-level">${currentLevel}</span>
          <span class="char-level-label">Level</span>
        </div>
        <div class="char-stats">
          <div class="char-stat">
            <div class="char-stat-value ${todayLevels > 0 ? '' : 'zero'}">
              ${todayLevels > 0 ? '+' + todayLevels : '0'}
            </div>
            <div class="char-stat-label">Hoje</div>
          </div>
          <div class="char-stat">
            <div class="char-stat-value ${weekLevels > 0 ? '' : 'zero'}">
              ${weekLevels > 0 ? '+' + weekLevels : '0'}
            </div>
            <div class="char-stat-label">7 dias</div>
          </div>
          <div class="char-stat">
            <div class="char-stat-value ${monthLevels > 0 ? '' : 'zero'}">
              ${monthLevels > 0 ? '+' + monthLevels : '0'}
            </div>
            <div class="char-stat-label">Mês</div>
          </div>
          <div class="char-stat">
            <div class="char-stat-value zero">${records.length}</div>
            <div class="char-stat-label">Coletas</div>
          </div>
          <div class="char-stat">
            <div class="char-stat-value" style="color: var(--danger, #fb7185);">${deathStats.count}</div>
            <div class="char-stat-label">Mortes</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}



function renderHistoryTable() {
  const body = document.getElementById('historyBody');
  const chars = appData.characters;
  const keys = getFilteredCharacters();

  if (keys.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum dado coletado ainda</td></tr>`;
    return;
  }

  body.innerHTML = keys.map(key => {
    const char = chars[key];
    const records = char.records || [];
    const currentLevel = records.length > 0 ? records[records.length - 1].level : 0;
    const todayLevels = getLevelsToday(records);
    const weekLevels = getLevelsInRange(records, 7);
    const monthLevels = getLevelsInRange(records, 30);
    const outfit = getVocationOutfit(char.vocation);
    const charName = char.name || key;
    
    const deathStats = getDeathsInLastMonth(char.deaths || []);

    const lastCollect = records.length > 0
      ? new Date(records[records.length - 1].timestamp).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        })
      : '--';

    return `
      <tr>
        <td class="char-name-cell">
          <img src="${outfit.img}" class="table-outfit-img" alt="${outfit.name}">
          <a href="${getCharUrl(charName)}" target="_blank" rel="noopener noreferrer" class="char-name-link" title="Abrir página no Rubinot">${charName}</a>
        </td>
        <td>${char.vocation || '--'}</td>
        <td class="level-cell">${currentLevel}</td>
        <td>
          <span class="level-diff ${todayLevels > 0 ? 'positive' : 'zero'}">
            ${todayLevels > 0 ? '+' + todayLevels : '0'}
          </span>
        </td>
        <td>
          <span class="level-diff ${weekLevels > 0 ? 'positive' : 'zero'}">
            ${weekLevels > 0 ? '+' + weekLevels : '0'}
          </span>
        </td>
        <td>
          <span class="level-diff ${monthLevels > 0 ? 'positive' : 'zero'}">
            ${monthLevels > 0 ? '+' + monthLevels : '0'}
          </span>
        </td>
        <td>
          <span style="color: var(--danger, #fb7185); font-weight: 600;">
            ${deathStats.count > 0 ? deathStats.count : '0'}
          </span>
        </td>
        <td>${lastCollect}</td>
      </tr>
    `;
  }).join('');
}

function renderLogEntries() {
  const container = document.getElementById('logContainer');
  const chars = appData.characters;
  const keys = getFilteredCharacters();

  const allRecords = [];
  keys.forEach(key => {
    const char = chars[key];
    const records = char.records || [];
    records.forEach((r, i) => {
      const prevLevel = i > 0 ? records[i - 1].level : r.level;
      allRecords.push({
        charName: char.name || key, timestamp: r.timestamp, level: r.level, diff: r.level - prevLevel
      });
    });
  });

  const now = new Date();
  const last24h = allRecords
    .filter(r => (now - new Date(r.timestamp)) < 24 * 60 * 60 * 1000)
    .filter(r => r.diff !== 0) // Remove "sem mudança" logs
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (last24h.length === 0) {
    container.innerHTML = `<div class="empty-state">Nenhum registro nas últimas 24h</div>`;
    return;
  }

  container.innerHTML = last24h.map(r => {
    const time = new Date(r.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const diffClass = r.diff > 0 ? 'up' : 'same';
    const diffText = r.diff > 0 ? `+${r.diff} lvl` : 'sem mudança';

    return `
      <div class="log-entry">
        <span class="log-time">${time}</span>
        <span class="log-char">
          <a href="${getCharUrl(r.charName)}" target="_blank" rel="noopener noreferrer" class="log-char-link" title="Abrir página no Rubinot">${r.charName}</a>
        </span>
        <span class="log-level">Level ${r.level}</span>
        <span class="log-diff ${diffClass}">${diffText}</span>
      </div>
    `;
  }).join('');
}

function renderPtManager() {
  const container = document.getElementById('ptManagerList');
  const parties = appConfig.parties || {};
  const ptNames = Object.keys(parties);
  
  if (ptNames.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:10px!important; font-size:0.75rem;">Nenhuma PT criada ainda.</div>';
    return;
  }
  
  container.innerHTML = ptNames.map(pt => {
    const members = parties[pt] || [];
    return `
      <div class="pt-card">
        <div class="pt-card-header">
          <strong>${pt}</strong>
          <button class="char-tag-remove" onclick="removePt('${pt.replace(/'/g, "\\'")}')" title="Excluir PT">×</button>
        </div>
        <div class="inline-form" style="margin-bottom: 8px;">
          <input type="text" id="addMemberInput-${pt}" class="char-input" placeholder="Adicionar à PT..." style="padding: 4px 8px;">
          <button class="btn btn-primary" style="padding: 4px 8px;" onclick="addMemberToPt('${pt.replace(/'/g, "\\'")}')">Add</button>
        </div>
        <div class="char-list">
          ${members.map(m => `
            <div class="char-tag">
              ${m}
              <button class="char-tag-remove" onclick="removeMemberFromPt('${pt.replace(/'/g, "\\'")}', '${m.replace(/'/g, "\\'")}')" title="Remover da PT">×</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderCharList() {
  const container = document.getElementById('charList');
  const chars = appConfig.characters || [];

  container.innerHTML = chars.map(name => `
    <div class="char-tag">
      ${name}
      <button class="char-tag-remove" onclick="removeCharacter('${name.replace(/'/g, "\\'")}')" title="Excluir do sistema">×</button>
    </div>
  `).join('');
}

// ============================
// Event Listeners
// ============================
function setupEventListeners() {
  // Add global character
  document.getElementById('addCharBtn').addEventListener('click', addCharacter);
  document.getElementById('charNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCharacter();
  });

  // Create PT
  document.getElementById('createPtBtn').addEventListener('click', createPt);
  document.getElementById('ptNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createPt();
  });

  // Scrape button
  document.getElementById('scrapeBtn').addEventListener('click', triggerScrape);

  // Ranking sort buttons
  document.querySelectorAll('.ranking-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ranking-sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRankingSort = btn.dataset.sort;
      renderRankingSection();
    });
  });

  // Ranking range buttons
  document.querySelectorAll('.ranking-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ranking-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRankingRange = btn.dataset.range;
      renderRankingSection();
    });
  });
}

// ============================
// Actions (Supabase Calls)
// ============================
async function addCharacter() {
  const input = document.getElementById('charNameInput');
  const name = input.value.trim();
  if (!name) return showToast('Digite o nome do personagem', 'error');

  const key = name.toLowerCase();
  try {
    const sb = getSupabase();
    if (!sb) return showToast('Supabase não conectado', 'error');
    const { error } = await sb
      .from('characters')
      .upsert({ key, name }, { onConflict: 'key' });

    if (error) {
      showToast('Erro ao adicionar: ' + error.message, 'error');
    } else {
      input.value = '';
      showToast(`${name} adicionado!`, 'success');
      loadData();
    }
  } catch (err) {
    showToast('Erro de conexão', 'error');
  }
}

async function removeCharacter(name) {
  if (!confirm(`Deseja realmente excluir ${name} de TUDO?`)) return;
  const key = name.toLowerCase();
  try {
    const sb = getSupabase();
    if (!sb) return showToast('Supabase não conectado', 'error');
    const { error } = await sb
      .from('characters')
      .delete()
      .eq('key', key);

    if (error) {
      showToast('Erro ao remover: ' + error.message, 'error');
    } else {
      showToast(`${name} removido`, 'info');
      loadData();
    }
  } catch (err) {
    showToast('Erro ao remover', 'error');
  }
}

async function createPt() {
  const input = document.getElementById('ptNameInput');
  const name = input.value.trim();
  if (!name) return showToast('Digite o nome da PT', 'error');

  try {
    const sb = getSupabase();
    if (!sb) return showToast('Supabase não conectado', 'error');
    const { error } = await sb
      .from('parties')
      .insert({ name });

    if (error) {
      showToast('Erro ao criar PT: ' + error.message, 'error');
    } else {
      input.value = '';
      showToast(`PT ${name} criada!`, 'success');
      loadData();
    }
  } catch (err) {
    showToast('Erro ao criar PT', 'error');
  }
}

async function removePt(ptName) {
  if (!confirm(`Deseja remover a PT ${ptName}?`)) return;
  try {
    const sb = getSupabase();
    if (!sb) return showToast('Supabase não conectado', 'error');
    const { error } = await sb
      .from('parties')
      .delete()
      .eq('name', ptName);

    if (error) {
      showToast('Erro ao remover PT: ' + error.message, 'error');
    } else {
      if (currentPtFilter === ptName) currentPtFilter = 'all';
      showToast(`PT ${ptName} removida`, 'info');
      loadData();
    }
  } catch (err) {
    showToast('Erro ao remover PT', 'error');
  }
}

async function addMemberToPt(ptName) {
  const input = document.getElementById(`addMemberInput-${ptName}`);
  const character = input.value.trim();
  if (!character) return;

  const key = character.toLowerCase();
  try {
    const sb = getSupabase();
    if (!sb) return showToast('Supabase não conectado', 'error');

    // Ensure character exists in characters table first
    await sb
      .from('characters')
      .upsert({ key, name: character }, { onConflict: 'key' });

    const { error } = await sb
      .from('party_members')
      .insert({ party_name: ptName, character_key: key });

    if (error) {
      showToast('Erro ao adicionar membro: ' + error.message, 'error');
    } else {
      input.value = '';
      showToast(`${character} adicionado à PT!`, 'success');
      loadData();
    }
  } catch (err) {
    showToast('Erro ao adicionar membro', 'error');
  }
}

async function removeMemberFromPt(ptName, charName) {
  const key = charName.toLowerCase();
  try {
    const sb = getSupabase();
    if (!sb) return showToast('Supabase não conectado', 'error');

    const { error } = await sb
      .from('party_members')
      .delete()
      .match({ party_name: ptName, character_key: key });

    if (error) {
      showToast('Erro ao remover membro: ' + error.message, 'error');
    } else {
      showToast(`${charName} removido da PT`, 'info');
      loadData();
    }
  } catch (err) {
    showToast('Erro ao remover membro', 'error');
  }
}

async function triggerScrape() {
  const btn = document.getElementById('scrapeBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner" style="width:12px;height:12px;border-width:2px;"></div> Coletando...';
  setScrapingStatus(true);

  try {
    const res = await fetch('/api/scrape', { method: 'POST' });
    if (res.ok) {
      showToast('Coleta iniciada localmente! Aguarde...', 'info');
    } else {
      showToast('Servidor local de coleta offline', 'info');
      resetScrapeBtn();
    }
  } catch (err) {
    showToast('Servidor local de coleta offline', 'info');
    resetScrapeBtn();
  }
}

async function checkScrapeStatus() {
  try {
    const res = await fetch('/api/scrape/status');
    const data = await res.json();
    if (!data.isScraping && document.getElementById('scrapeBtn').disabled) {
      resetScrapeBtn();
      loadData();
    }
  } catch { /* ignore when offline / static on vercel */ }
}

function resetScrapeBtn() {
  const btn = document.getElementById('scrapeBtn');
  btn.disabled = false;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Coletar Agora`;
  setScrapingStatus(false);
}

function setScrapingStatus(scraping) {
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  if (scraping) { pill.classList.add('scraping'); text.textContent = 'Coletando...'; }
  else { pill.classList.remove('scraping'); text.textContent = 'Online'; }
}

// ============================
// Helpers
// ============================
function getLevelsToday(records) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayRecords = records.filter(r => new Date(r.timestamp) >= today);
  if (todayRecords.length < 1) return 0;

  const first = todayRecords[0].level;
  const last = todayRecords[todayRecords.length - 1].level;

  const beforeToday = records.filter(r => new Date(r.timestamp) < today);
  const baseline = beforeToday.length > 0 ? beforeToday[beforeToday.length - 1].level : first;

  return last - baseline;
}

function getLevelsInRange(records, days) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const inRange = records.filter(r => new Date(r.timestamp) >= cutoff);
  if (inRange.length < 1) return 0;

  const beforeRange = records.filter(r => new Date(r.timestamp) < cutoff);
  const baseline = beforeRange.length > 0 ? beforeRange[beforeRange.length - 1].level : inRange[0].level;

  return inRange[inRange.length - 1].level - baseline;
}

function filterRecordsByRange(records, range) {
  const now = new Date();
  let cutoff;
  switch (range) {
    case 'today': cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); break;
    case 'week': cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7); break;
    case 'month': cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30); break;
    case 'all': default: return records;
  }
  return records.filter(r => new Date(r.timestamp) >= cutoff);
}

function updateLastUpdate() {
  const el = document.getElementById('lastUpdate');
  const chars = appData.characters;
  let latestTimestamp = null;
  Object.keys(chars).forEach(key => {
    const records = chars[key].records || [];
    if (records.length > 0) {
      const last = new Date(records[records.length - 1].timestamp);
      if (!latestTimestamp || last > latestTimestamp) latestTimestamp = last;
    }
  });

  if (latestTimestamp) {
    el.textContent = `Última coleta: ${latestTimestamp.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    })}`;
  }
}

const monthMap = {
  'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5,
  'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11
};

function parseTibiaDate(dateStr) {
  const regex = /(\d{1,2})\s+de\s+([a-z]+)\.?\s+de\s+(\d{4}),\s+(\d{2}):(\d{2})/i;
  const match = dateStr.match(regex);
  if (match) {
    const d = parseInt(match[1]);
    const mStr = match[2].toLowerCase().substring(0, 3);
    const m = monthMap[mStr];
    const y = parseInt(match[3]);
    const hr = parseInt(match[4]);
    const min = parseInt(match[5]);
    if (m !== undefined) {
      return new Date(y, m, d, hr, min);
    }
  }
  return new Date(0);
}

function getDeathsInLastMonth(deaths) {
  if (!deaths || deaths.length === 0) return { count: 0, levelsLost: 0 };
  
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let count = 0;
  for (const d of deaths) {
    const deathDate = parseTibiaDate(d.date);
    if (deathDate.getMonth() === currentMonth && deathDate.getFullYear() === currentYear) {
      count++;
    }
  }
  return { count, levelsLost: count };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================
// Tibia EXP & Ranking System
// ============================

/**
 * Calculates total Tibia experience for a given level.
 * Formula: (50/3)*L^3 - 100*L^2 + (850/3)*L - 200
 */
function getExpForLevel(L) {
  if (!L || L <= 1) return 0;
  return Math.floor((50 / 3) * Math.pow(L, 3) - 100 * Math.pow(L, 2) + (850 / 3) * L - 200);
}

/**
 * Formats XP into short and full representations.
 */
function formatXP(xp) {
  if (!xp || xp === 0) return { full: '0 XP', short: '0 XP' };
  const sign = xp > 0 ? '+' : '';
  const absXp = Math.abs(xp);
  
  let formattedShort = '';
  if (absXp >= 1000000000) {
    formattedShort = (xp / 1000000000).toFixed(2) + 'B';
  } else if (absXp >= 1000000) {
    formattedShort = (xp / 1000000).toFixed(2) + 'M';
  } else if (absXp >= 1000) {
    formattedShort = (xp / 1000).toFixed(1) + 'k';
  } else {
    formattedShort = xp.toString();
  }

  const fullNumber = xp.toLocaleString('pt-BR');
  return {
    full: `${sign}${fullNumber} XP`,
    short: `${sign}${formattedShort} XP`
  };
}

/**
 * Formats XP numbers into Tibia notation (k, kk, kkk).
 */
function formatTibiaShortXP(xp) {
  if (!xp || xp === 0) return '0 XP';
  const absXp = Math.abs(xp);
  const sign = xp < 0 ? '-' : '+';
  
  let valStr = '';
  if (absXp >= 1000000000) {
    valStr = (absXp / 1000000000).toFixed(2).replace(/\.00$/, '') + ' kkk';
  } else if (absXp >= 1000000) {
    valStr = (absXp / 1000000).toFixed(1).replace(/\.0$/, '') + ' kk';
  } else if (absXp >= 1000) {
    valStr = (absXp / 1000).toFixed(0) + ' k';
  } else {
    valStr = absXp.toString() + ' XP';
  }

  return `${sign}${valStr}`;
}

function getBaselineAndCurrentLevel(records, range) {
  if (!records || records.length === 0) {
    return { baseline: 0, current: 0, levelDiff: 0 };
  }
  const current = records[records.length - 1].level;
  let cutoff;
  if (range === 'today') {
    cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
  } else if (range === 'week') {
    cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  } else if (range === 'month') {
    cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  } else {
    cutoff = new Date(0);
  }

  const inRange = records.filter(r => new Date(r.timestamp) >= cutoff);
  if (inRange.length === 0) {
    return { baseline: current, current, levelDiff: 0 };
  }

  const beforeRange = records.filter(r => new Date(r.timestamp) < cutoff);
  const baseline = beforeRange.length > 0 ? beforeRange[beforeRange.length - 1].level : inRange[0].level;

  return { baseline, current, levelDiff: current - baseline };
}

function renderRankingSection() {
  const container = document.getElementById('rankingContent');
  if (!container) return;

  const chars = appData.characters;
  const keys = getFilteredCharacters();

  if (keys.length === 0) {
    container.innerHTML = `<div class="empty-state">Nenhum personagem para ranquear${currentPtFilter !== 'all' ? ' nesta PT' : ''}.</div>`;
    return;
  }

  const rankedData = keys.map(key => {
    const char = chars[key];
    const records = char.records || [];
    const { baseline, current, levelDiff } = getBaselineAndCurrentLevel(records, currentRankingRange);
    
    const xpBaseline = getExpForLevel(baseline);
    const xpCurrent = getExpForLevel(current);
    const xpDiff = xpCurrent - xpBaseline;

    return {
      key,
      name: char.name || key,
      vocation: char.vocation || 'Unknown',
      baseline,
      current,
      levelDiff,
      xpBaseline,
      xpCurrent,
      xpDiff
    };
  });

  // Sort
  rankedData.sort((a, b) => {
    if (currentRankingSort === 'xp') {
      if (b.xpDiff !== a.xpDiff) return b.xpDiff - a.xpDiff;
      return b.levelDiff - a.levelDiff;
    } else {
      if (b.levelDiff !== a.levelDiff) return b.levelDiff - a.levelDiff;
      return b.xpDiff - a.xpDiff;
    }
  });

  // Calculate maximum for progress bar fill
  const topVal = currentRankingSort === 'xp'
    ? Math.max(...rankedData.map(d => Math.max(0, d.xpDiff)), 1)
    : Math.max(...rankedData.map(d => Math.max(0, d.levelDiff)), 1);

  const top3 = rankedData.slice(0, 3);

  let html = `<div class="ranking-layout">`;

  // Render Podium / Top 3 Cards
  if (top3.length > 0) {
    html += `<div class="ranking-podium">`;
    const displayTop3 = [];
    if (top3[1]) displayTop3.push({ item: top3[1], rank: 2 });
    if (top3[0]) displayTop3.push({ item: top3[0], rank: 1 });
    if (top3[2]) displayTop3.push({ item: top3[2], rank: 3 });

    displayTop3.forEach(({ item, rank }) => {
      const xpObj = formatXP(item.xpDiff);
      const isNegative = item.xpDiff < 0;
      const rankBadge = rank === 1 ? '👑 #1' : rank === 2 ? '🥈 #2' : '🥉 #3';
      const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
      const outfit = getVocationOutfit(item.vocation);

      html += `
        <div class="podium-card ${rankClass}">
          <div class="podium-badge">${rankBadge}</div>
          <div class="podium-outfit-container">
            <img src="${outfit.img}" class="podium-outfit-img" alt="${outfit.name}">
          </div>
          <div class="podium-char-name">
            <a href="${getCharUrl(item.name)}" target="_blank" rel="noopener noreferrer" class="podium-char-name-link" title="Abrir página no Rubinot">${item.name}</a>
          </div>
          <div class="podium-voc">${item.vocation}</div>
          <div class="podium-level-info">
            <span class="podium-current-lv">Lv ${item.current}</span>
            <span class="podium-level-diff ${item.levelDiff > 0 ? 'positive' : item.levelDiff < 0 ? 'negative' : ''}">
              ${item.levelDiff > 0 ? '+' + item.levelDiff + ' lvls' : item.levelDiff < 0 ? item.levelDiff + ' lvls' : '0 lvls'}
            </span>
          </div>
          <div class="podium-xp-value ${isNegative ? 'negative' : item.xpDiff > 0 ? 'positive' : 'zero'}">
            ${xpObj.full}
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  // Leaderboard list
  html += `
    <div class="ranking-list-table">
      <div class="ranking-list-header">
        <span class="col-pos">Pos</span>
        <span class="col-name">Personagem</span>
        <span class="col-level">Level</span>
        <span class="col-gain">Evolução</span>
        <span class="col-xp">XP Ganhada</span>
      </div>
      <div class="ranking-list-body">
  `;

  rankedData.forEach((item, idx) => {
    const rankNum = idx + 1;
    const xpObj = formatXP(item.xpDiff);
    const primaryMetricVal = currentRankingSort === 'xp' ? Math.max(0, item.xpDiff) : Math.max(0, item.levelDiff);
    const progressPct = Math.min(100, Math.max(0, (primaryMetricVal / topVal) * 100));
    const outfit = getVocationOutfit(item.vocation);

    let gapHtml = '';
    if (idx === 0) {
      gapHtml = `<div class="rank-gap leader">👑 Líder</div>`;
    } else {
      const prevItem = rankedData[idx - 1];
      if (currentRankingSort === 'xp') {
        const xpGap = item.xpDiff - prevItem.xpDiff;
        const gapFormatted = formatTibiaShortXP(xpGap);
        gapHtml = `<div class="rank-gap">${gapFormatted} atrás do #${idx}</div>`;
      } else {
        const levelGap = item.levelDiff - prevItem.levelDiff;
        gapHtml = `<div class="rank-gap">${levelGap > 0 ? '+' + levelGap : levelGap} Lvs atrás do #${idx}</div>`;
      }
    }

    html += `
      <div class="ranking-row ${rankNum <= 3 ? 'top-three-row rank-' + rankNum : ''}">
        <div class="col-pos">
          <span class="rank-number rank-${rankNum}">${rankNum}</span>
        </div>
        <div class="col-name">
          <div class="rank-char-name">
            <img src="${outfit.img}" class="rank-outfit-img" alt="${outfit.name}">
            <a href="${getCharUrl(item.name)}" target="_blank" rel="noopener noreferrer" class="rank-char-name-link" title="Abrir página no Rubinot">${item.name}</a>
          </div>
          <div class="rank-char-voc">${item.vocation}</div>
        </div>
        <div class="col-level">
          <span class="rank-current-level">Lv ${item.current}</span>
          <span class="rank-baseline-level">(era Lv ${item.baseline})</span>
        </div>
        <div class="col-gain">
          <span class="level-gain-badge ${item.levelDiff > 0 ? 'positive' : item.levelDiff < 0 ? 'negative' : 'neutral'}">
            ${item.levelDiff > 0 ? '+' + item.levelDiff : item.levelDiff < 0 ? item.levelDiff : '0'} Lvs
          </span>
        </div>
        <div class="col-xp">
          <div class="xp-gain-value ${item.xpDiff > 0 ? 'positive' : item.xpDiff < 0 ? 'negative' : 'neutral'}">
            ${xpObj.full}
          </div>
          ${gapHtml}
          <div class="rank-progress-bg">
            <div class="rank-progress-fill rank-fill-${rankNum <= 3 ? rankNum : 'default'}" style="width: ${progressPct}%;"></div>
          </div>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  </div>`;

  container.innerHTML = html;
}

// ============================
// Character Detail Modal
// ============================

let modalLevelChart = null;
let modalXPBarChart = null;
let modalCurrentCharKey = null;
let modalChartRange = 'week';

function openCharModal(charKey) {
  const char = appData.characters[charKey];
  if (!char) return;

  modalCurrentCharKey = charKey;
  modalChartRange = 'week';

  // Render all sections
  renderModalHeader(char);
  renderModalStats(char);
  renderCharLevelChart(char.records || [], modalChartRange);
  renderCharXPBarChart(char.records || [], modalChartRange);
  renderCharDeathHistory(char.deaths || []);
  renderCharRecentRecords(char.records || []);

  // Reset range buttons
  document.querySelectorAll('#levelChartRange .chart-range-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === 'week');
  });

  // Show modal
  document.getElementById('charModalOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCharModal() {
  document.getElementById('charModalOverlay').classList.remove('active');
  document.body.style.overflow = '';
  
  // Destroy charts to prevent memory leaks
  if (modalLevelChart) { modalLevelChart.destroy(); modalLevelChart = null; }
  if (modalXPBarChart) { modalXPBarChart.destroy(); modalXPBarChart = null; }
  modalCurrentCharKey = null;
}

function setModalChartRange(range) {
  modalChartRange = range;

  // Update range buttons
  document.querySelectorAll('#levelChartRange .chart-range-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });

  // Re-render charts
  const char = appData.characters[modalCurrentCharKey];
  if (char) {
    renderCharLevelChart(char.records || [], range);
    renderCharXPBarChart(char.records || [], range);
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalCurrentCharKey) closeCharModal();

  // Secret admin shortcut: Ctrl+Shift+S toggles the scrape button
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    const btn = document.getElementById('scrapeBtn');
    if (btn) {
      const isHidden = btn.style.display === 'none';
      btn.style.display = isHidden ? 'inline-flex' : 'none';
      showToast(isHidden ? '🔧 Modo admin ativado' : '🔒 Modo admin desativado', 'info');
    }
  }
});

function renderModalHeader(char) {
  const outfit = getVocationOutfit(char.vocation);
  const charName = char.name || '';
  const records = char.records || [];
  const currentLevel = records.length > 0 ? records[records.length - 1].level : 0;

  document.getElementById('charModalHeader').innerHTML = `
    <div class="char-modal-outfit-container">
      <img src="${outfit.img}" class="char-modal-outfit-img" alt="${outfit.name}">
    </div>
    <div class="char-modal-info">
      <div class="char-modal-name">
        <a href="${getCharUrl(charName)}" target="_blank" rel="noopener noreferrer" class="char-modal-name-link" title="Abrir página no Rubinot">${charName}</a>
      </div>
      <div class="char-modal-subtitle">
        <span>⚔️ ${char.vocation || 'Unknown'}</span>
        <span>🌐 ${char.world || 'Unknown'}</span>
      </div>
    </div>
    <div class="char-modal-level-big">
      <div class="char-modal-level-number">${currentLevel}</div>
      <div class="char-modal-level-label">Level</div>
    </div>
  `;
}

function renderModalStats(char) {
  const records = char.records || [];
  const deaths = char.deaths || [];
  const currentLevel = records.length > 0 ? records[records.length - 1].level : 0;

  const todayLevels = getLevelsToday(records);
  const weekLevels = getLevelsInRange(records, 7);
  const monthLevels = getLevelsInRange(records, 30);
  const deathStats = getDeathsInLastMonth(deaths);

  // XP calculations
  const xpTotal = getExpForLevel(currentLevel);
  const xpToday = getExpForLevel(currentLevel) - getExpForLevel(currentLevel - todayLevels);
  const xpWeek = getExpForLevel(currentLevel) - getExpForLevel(currentLevel - weekLevels);
  const xpMonth = getExpForLevel(currentLevel) - getExpForLevel(currentLevel - monthLevels);

  // Average XP per day this month
  const avgXpDay = monthLevels > 0 ? Math.floor(xpMonth / 30) : 0;

  function statClass(val) { return val > 0 ? 'positive' : val < 0 ? 'negative' : 'zero'; }

  document.getElementById('charModalStats').innerHTML = `
    <div class="modal-stat-card">
      <div class="modal-stat-value">${formatTibiaShortXP(xpTotal).replace('+', '')}</div>
      <div class="modal-stat-label">XP Total</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value ${statClass(todayLevels)}">${todayLevels > 0 ? '+' + todayLevels : todayLevels}</div>
      <div class="modal-stat-label">Lvls Hoje</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value ${statClass(weekLevels)}">${weekLevels > 0 ? '+' + weekLevels : weekLevels}</div>
      <div class="modal-stat-label">Lvls 7 Dias</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value ${statClass(monthLevels)}">${monthLevels > 0 ? '+' + monthLevels : monthLevels}</div>
      <div class="modal-stat-label">Lvls Mês</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value ${statClass(xpWeek)}">${formatTibiaShortXP(xpWeek)}</div>
      <div class="modal-stat-label">XP 7 Dias</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value ${statClass(xpMonth)}">${formatTibiaShortXP(xpMonth)}</div>
      <div class="modal-stat-label">XP Mês</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value">${avgXpDay > 0 ? formatTibiaShortXP(avgXpDay).replace('+', '') : '0'}</div>
      <div class="modal-stat-label">Média XP/Dia</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value">${records.length}</div>
      <div class="modal-stat-label">Coletas</div>
    </div>
    <div class="modal-stat-card">
      <div class="modal-stat-value" style="color: var(--red);">${deathStats.count}</div>
      <div class="modal-stat-label">Mortes (Mês)</div>
    </div>
  `;
}

function renderCharLevelChart(records, range) {
  const canvas = document.getElementById('charLevelChart');
  if (!canvas) return;

  // Destroy previous chart
  if (modalLevelChart) { modalLevelChart.destroy(); modalLevelChart = null; }

  const filtered = filterRecordsByRange(records, range);
  if (filtered.length === 0) {
    canvas.parentElement.innerHTML = '<div class="modal-empty-state">Sem dados neste período</div>';
    return;
  }

  // Group by day and get last level of each day
  const dayMap = {};
  filtered.forEach(r => {
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dayMap[key] = r.level;
  });

  const labels = Object.keys(dayMap).sort();
  const data = labels.map(k => dayMap[k]);

  // Format labels for display
  const displayLabels = labels.map(l => {
    const parts = l.split('-');
    return `${parts[2]}/${parts[1]}`;
  });

  modalLevelChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: displayLabels,
      datasets: [{
        label: 'Level',
        data: data,
        borderColor: '#fcd34d',
        backgroundColor: 'rgba(252, 211, 77, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: data.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#fcd34d',
        pointBorderColor: '#000'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(20, 14, 10, 0.95)',
          titleColor: '#fcd34d',
          bodyColor: '#f5ebd9',
          borderColor: '#5c4736',
          borderWidth: 1,
          cornerRadius: 4,
          padding: 10
        }
      },
      scales: {
        x: {
          ticks: { color: '#80715f', font: { size: 10 }, maxRotation: 45 },
          grid: { color: 'rgba(184, 134, 11, 0.08)' }
        },
        y: {
          ticks: { color: '#80715f', font: { size: 10 } },
          grid: { color: 'rgba(184, 134, 11, 0.08)' }
        }
      }
    }
  });
}

function renderCharXPBarChart(records, range) {
  const canvas = document.getElementById('charXPBarChart');
  if (!canvas) return;

  // Destroy previous chart
  if (modalXPBarChart) { modalXPBarChart.destroy(); modalXPBarChart = null; }

  const filtered = filterRecordsByRange(records, range);
  if (filtered.length === 0) {
    canvas.parentElement.innerHTML = '<div class="modal-empty-state">Sem dados neste período</div>';
    return;
  }

  // Group by day: get first and last level of each day
  const dayData = {};
  filtered.forEach(r => {
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!dayData[key]) {
      dayData[key] = { first: r.level, last: r.level };
    } else {
      dayData[key].last = r.level;
    }
  });

  // For XP per day, we need the level difference start-to-end of each day
  // Also include the previous day's last level for accurate deltas
  const sortedDays = Object.keys(dayData).sort();
  const labels = [];
  const xpData = [];
  const colors = [];

  for (let i = 0; i < sortedDays.length; i++) {
    const dayKey = sortedDays[i];
    const day = dayData[dayKey];
    const prevDayLevel = i > 0 ? dayData[sortedDays[i - 1]].last : day.first;
    const levelDiff = day.last - prevDayLevel;
    const xpGain = getExpForLevel(day.last) - getExpForLevel(prevDayLevel);

    const parts = dayKey.split('-');
    labels.push(`${parts[2]}/${parts[1]}`);
    xpData.push(xpGain);
    colors.push(xpGain >= 0 ? 'rgba(74, 222, 128, 0.8)' : 'rgba(251, 113, 133, 0.8)');
  }

  modalXPBarChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'XP Ganha',
        data: xpData,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace('0.8', '1')),
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(20, 14, 10, 0.95)',
          titleColor: '#fcd34d',
          bodyColor: '#f5ebd9',
          borderColor: '#5c4736',
          borderWidth: 1,
          cornerRadius: 4,
          padding: 10,
          callbacks: {
            label: function(ctx) {
              return formatTibiaShortXP(ctx.raw);
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#80715f', font: { size: 10 }, maxRotation: 45 },
          grid: { color: 'rgba(184, 134, 11, 0.08)' }
        },
        y: {
          ticks: {
            color: '#80715f',
            font: { size: 10 },
            callback: function(value) {
              return formatTibiaShortXP(value).replace('+', '');
            }
          },
          grid: { color: 'rgba(184, 134, 11, 0.08)' }
        }
      }
    }
  });
}

function renderCharDeathHistory(deaths) {
  const container = document.getElementById('charModalDeaths');
  if (!container) return;

  if (!deaths || deaths.length === 0) {
    container.innerHTML = '<div class="modal-empty-state">Nenhuma morte registrada 🎉</div>';
    return;
  }

  // Show up to 20 most recent deaths
  const recentDeaths = deaths.slice(0, 20);

  container.innerHTML = recentDeaths.map(d => `
    <div class="modal-death-entry">
      <span class="modal-death-skull">💀</span>
      <div class="modal-death-info">
        <div class="modal-death-desc">${d.desc || 'Morte desconhecida'}</div>
        <div class="modal-death-meta">📅 ${d.date || '--'} · Level ${d.level || '--'}</div>
      </div>
    </div>
  `).join('');
}

function renderCharRecentRecords(records) {
  const container = document.getElementById('charModalRecords');
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = '<div class="modal-empty-state">Nenhuma coleta registrada</div>';
    return;
  }

  // Show last 25 records, newest first
  const recent = records.slice(-25).reverse();

  container.innerHTML = recent.map((r, i) => {
    const time = new Date(r.timestamp).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    // Calculate diff from previous record
    const originalIdx = records.length - 25 + (24 - i); // map back to original index
    const prevIdx = originalIdx - 1;
    let diff = 0;
    if (prevIdx >= 0 && prevIdx < records.length) {
      diff = r.level - records[prevIdx].level;
    }

    const diffClass = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
    const diffText = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '—';

    return `
      <div class="modal-record-entry">
        <span class="modal-record-time">${time}</span>
        <span class="modal-record-level">Level ${r.level}</span>
        <span class="modal-record-diff ${diffClass}">${diffText}</span>
      </div>
    `;
  }).join('');
}
