-- ============================
-- Tibia Tracker - Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Characters table
CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,          -- lowercase name (e.g. 'gbr putifero')
  name TEXT NOT NULL,                -- display name (e.g. 'Gbr Putifero')
  vocation TEXT DEFAULT 'Unknown',
  world TEXT DEFAULT 'Unknown',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Records table (level snapshots)
CREATE TABLE IF NOT EXISTS records (
  id BIGSERIAL PRIMARY KEY,
  character_key TEXT NOT NULL REFERENCES characters(key) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  level INTEGER NOT NULL
);

-- Deaths table
CREATE TABLE IF NOT EXISTS deaths (
  id BIGSERIAL PRIMARY KEY,
  character_key TEXT NOT NULL REFERENCES characters(key) ON DELETE CASCADE,
  date TEXT NOT NULL,                -- original Tibia date format
  level INTEGER,
  description TEXT
);

-- Parties table
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Party members junction table
CREATE TABLE IF NOT EXISTS party_members (
  id BIGSERIAL PRIMARY KEY,
  party_name TEXT NOT NULL REFERENCES parties(name) ON DELETE CASCADE,
  character_key TEXT NOT NULL REFERENCES characters(key) ON DELETE CASCADE,
  UNIQUE(party_name, character_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_records_character_key ON records(character_key);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
CREATE INDEX IF NOT EXISTS idx_deaths_character_key ON deaths(character_key);
CREATE INDEX IF NOT EXISTS idx_party_members_party ON party_members(party_name);
CREATE INDEX IF NOT EXISTS idx_party_members_char ON party_members(character_key);

-- ============================
-- Row Level Security (RLS)
-- ============================

-- Enable RLS on all tables
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE deaths ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_members ENABLE ROW LEVEL SECURITY;

-- Public read access (anon can SELECT)
CREATE POLICY "Public read characters" ON characters FOR SELECT USING (true);
CREATE POLICY "Public read records" ON records FOR SELECT USING (true);
CREATE POLICY "Public read deaths" ON deaths FOR SELECT USING (true);
CREATE POLICY "Public read parties" ON parties FOR SELECT USING (true);
CREATE POLICY "Public read party_members" ON party_members FOR SELECT USING (true);

-- Public write access for party management (anon can INSERT/DELETE parties and members)
CREATE POLICY "Public insert parties" ON parties FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete parties" ON parties FOR DELETE USING (true);
CREATE POLICY "Public insert party_members" ON party_members FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete party_members" ON party_members FOR DELETE USING (true);

-- Public write for characters (add/remove from dashboard)
CREATE POLICY "Public insert characters" ON characters FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete characters" ON characters FOR DELETE USING (true);
CREATE POLICY "Public update characters" ON characters FOR UPDATE USING (true);

-- Records & deaths: only service_role can write (scraper)
CREATE POLICY "Service write records" ON records FOR INSERT WITH CHECK (true);
CREATE POLICY "Service write deaths" ON deaths FOR INSERT WITH CHECK (true);
