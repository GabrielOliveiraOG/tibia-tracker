@echo off
REM ============================================
REM Tibia Tracker - Scraper Automatico
REM Roda o scraper para coletar levels
REM Adicione este script no Windows Task Scheduler
REM para rodar a cada 1 hora
REM ============================================

cd /d "%~dp0"
node scraper.js >> data\scraper.log 2>&1
