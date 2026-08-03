/**
 * Tibia Tracker - Migration Script
 * Migrates data from local levels.json + config.json to Supabase
 * 
 * Usage: node scripts/migrate-to-supabase.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DATA_PATH = path.join(__dirname, '..', 'data', 'levels.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

async function migrate() {
  console.log('🚀 Starting migration to Supabase...\n');

  // Load local data
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  const chars = data.characters || {};
  const parties = config.parties || {};

  // ---- 1. Migrate Characters ----
  console.log('📦 Migrating characters...');
  const charEntries = Object.entries(chars);
  let charCount = 0;

  for (const [key, char] of charEntries) {
    const { error } = await supabase
      .from('characters')
      .upsert({
        key: key,
        name: char.name || key,
        vocation: char.vocation || 'Unknown',
        world: char.world || 'Unknown'
      }, { onConflict: 'key' });

    if (error) {
      console.error('  ❌ Error inserting character ' + key + ':', error.message);
    } else {
      charCount++;
      console.log('  ✅ ' + (char.name || key));
    }
  }
  console.log('  Total: ' + charCount + '/' + charEntries.length + ' characters\n');

  // ---- 2. Migrate Records ----
  console.log('📊 Migrating records...');
  let totalRecords = 0;

  for (const [key, char] of charEntries) {
    const records = char.records || [];
    if (records.length === 0) continue;

    // Batch insert in chunks of 500
    const chunks = [];
    for (let i = 0; i < records.length; i += 500) {
      chunks.push(records.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      const rows = chunk.map(function(r) {
        return {
          character_key: key,
          timestamp: r.timestamp,
          level: r.level
        };
      });

      const { error } = await supabase.from('records').insert(rows);
      if (error) {
        console.error('  ❌ Error inserting records for ' + key + ':', error.message);
      } else {
        totalRecords += chunk.length;
      }
    }
    console.log('  ✅ ' + key + ': ' + records.length + ' records');
  }
  console.log('  Total: ' + totalRecords + ' records\n');

  // ---- 3. Migrate Deaths ----
  console.log('💀 Migrating deaths...');
  let totalDeaths = 0;

  for (const [key, char] of charEntries) {
    const deaths = char.deaths || [];
    if (deaths.length === 0) continue;

    const rows = deaths.map(function(d) {
      return {
        character_key: key,
        date: d.date || '',
        level: d.level || null,
        description: d.desc || ''
      };
    });

    const { error } = await supabase.from('deaths').insert(rows);
    if (error) {
      console.error('  ❌ Error inserting deaths for ' + key + ':', error.message);
    } else {
      totalDeaths += deaths.length;
      console.log('  ✅ ' + key + ': ' + deaths.length + ' deaths');
    }
  }
  console.log('  Total: ' + totalDeaths + ' deaths\n');

  // ---- 4. Migrate Parties ----
  console.log('🎮 Migrating parties...');
  const ptNames = Object.keys(parties);

  for (const ptName of ptNames) {
    const { error: ptErr } = await supabase
      .from('parties')
      .upsert({ name: ptName }, { onConflict: 'name' });

    if (ptErr) {
      console.error('  ❌ Error creating party ' + ptName + ':', ptErr.message);
      continue;
    }

    const members = parties[ptName] || [];
    for (const member of members) {
      const memberKey = member.toLowerCase();
      const { error: memErr } = await supabase
        .from('party_members')
        .upsert(
          { party_name: ptName, character_key: memberKey },
          { onConflict: 'party_name,character_key' }
        );

      if (memErr) {
        console.error('    ❌ Error adding ' + member + ' to ' + ptName + ':', memErr.message);
      }
    }
    console.log('  ✅ ' + ptName + ': ' + members.length + ' members');
  }

  console.log('\n🎉 Migration complete!');
  console.log('   Characters: ' + charCount);
  console.log('   Records: ' + totalRecords);
  console.log('   Deaths: ' + totalDeaths);
  console.log('   Parties: ' + ptNames.length);
}

migrate().catch(function(err) {
  console.error('Migration failed:', err);
  process.exit(1);
});
