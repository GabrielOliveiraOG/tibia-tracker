/**
 * Execute SQL schema on Supabase
 * Uses the Supabase Management API to run DDL
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function runSchema() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  // Split into individual statements
  const statements = sql
    .split(';')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s.length > 0 && !s.startsWith('--'); });

  console.log('Running ' + statements.length + ' SQL statements on Supabase...\n');

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';';
    const firstLine = stmt.split('\n').filter(function(l) { return l.trim() && !l.trim().startsWith('--'); })[0] || '';
    
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ query: stmt })
      });

      // Try the pg/query endpoint instead if rpc fails
      if (!res.ok) {
        const res2 = await fetch(SUPABASE_URL + '/pg/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY
          },
          body: JSON.stringify({ query: stmt })
        });

        if (res2.ok) {
          console.log('  ✅ [' + (i + 1) + '] ' + firstLine.substring(0, 60));
        } else {
          const errBody = await res2.text();
          console.log('  ⚠️ [' + (i + 1) + '] ' + firstLine.substring(0, 60) + ' -> ' + res2.status);
        }
      } else {
        console.log('  ✅ [' + (i + 1) + '] ' + firstLine.substring(0, 60));
      }
    } catch (err) {
      console.log('  ❌ [' + (i + 1) + '] ' + err.message);
    }
  }

  console.log('\n⚠️  If statements failed, please run scripts/schema.sql manually in the Supabase Dashboard SQL Editor.');
  console.log('   URL: https://supabase.com/dashboard/project/ovavbnbcjmdnypntvewm/sql');
}

runSchema();
