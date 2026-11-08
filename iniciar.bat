@echo off
title Chat RealTime - Servidor
cd /d "%~dp0"
echo ============================================
echo   Chat RealTime - servidor local
echo   Abra depois: http://localhost:8000
echo ============================================
cd backend
python main.py
pause