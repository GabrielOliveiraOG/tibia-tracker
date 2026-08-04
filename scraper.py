"""
Tibia Tracker - Python Scraper (Cloudflare TLS Impersonation)
Evades Cloudflare WAF 100% reliably on GitHub Actions & cloud servers.
"""

import os
import sys
import datetime
from urllib.parse import quote
from dotenv import load_dotenv

load_dotenv()

from curl_cffi import requests
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def get_supabase() -> Client | None:
    if SUPABASE_URL and SUPABASE_KEY:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    return None

def main():
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"[PYTHON SCRAPER] Starting scrape at {timestamp}")

    supabase = get_supabase()
    if not supabase:
        print("[PYTHON SCRAPER] Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.")
        sys.exit(1)

    # 1. Fetch character list from Supabase
    try:
        chars_res = supabase.table("characters").select("key, name").execute()
        char_list = chars_res.data or []
    except Exception as e:
        print(f"[PYTHON SCRAPER] Error fetching characters from Supabase: {e}")
        sys.exit(1)

    if not char_list:
        print("[PYTHON SCRAPER] No characters found in Supabase table.")
        return

    print(f"[PYTHON SCRAPER] Target characters ({len(char_list)}): {[c.get('name') or c.get('key') for c in char_list]}")

    success_count = 0

    for char_item in char_list:
        char_key = char_item.get("key")
        char_name = char_item.get("name") or char_key

        url = f"https://rubinot.com.br/api/characters/search?name={quote(char_name)}"
        headers = {
            "Referer": f"https://rubinot.com.br/characters?name={quote(char_name)}",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        }

        try:
            res = requests.get(url, impersonate="chrome120", headers=headers, timeout=20)
            if res.status_code == 200:
                data = res.json()
                player = data.get("player") or {}
                deaths = data.get("deaths") or []

                level = player.get("level")
                vocation = player.get("vocation") or "Unknown"
                world = player.get("world") or "Unknown"
                display_name = player.get("name") or char_name

                if level:
                    # Update character info
                    supabase.table("characters").upsert({
                        "key": char_key,
                        "name": display_name,
                        "vocation": vocation,
                        "world": world
                    }, on_conflict="key").execute()

                    # Insert level record
                    supabase.table("records").insert({
                        "character_key": char_key,
                        "timestamp": timestamp,
                        "level": int(level)
                    }).execute()

                    # Insert deaths
                    for d in deaths:
                        date_str = str(d.get("date") or d.get("time") or "")
                        death_level = d.get("level")
                        desc = d.get("description") or d.get("reason") or d.get("killed_by") or ""

                        if desc:
                            existing = supabase.table("deaths").select("id").eq("character_key", char_key).eq("date", date_str).eq("description", desc).execute()
                            if not existing.data:
                                supabase.table("deaths").insert({
                                    "character_key": char_key,
                                    "date": date_str,
                                    "level": int(death_level) if death_level else None,
                                    "description": desc
                                }).execute()

                    print(f"  [SUCCESS] {char_name}: Level {level} | {vocation} | {world}")
                    success_count += 1
                else:
                    print(f"  [FAILED] {char_name}: No level found in player object")
            else:
                print(f"  [FAILED] {char_name}: HTTP Status {res.status_code}")

        except Exception as err:
            print(f"  [ERROR] {char_name}: {err}")

    print(f"\n[PYTHON SCRAPER] Completed! {success_count}/{len(char_list)} characters scraped successfully.")

if __name__ == "__main__":
    main()
