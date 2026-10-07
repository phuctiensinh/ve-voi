@echo off
chcp 65001 >nul
title Ve Voi - may chu game
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] May chua cai Node.js.
  echo      Hay tai ban LTS tai https://nodejs.org , cai xong thi bam dup lai file nay.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo.
  echo  [!] Node.js qua cu ^(can ban 18 tro len^). Hay cai ban LTS moi tai https://nodejs.org
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
set OPEN_BROWSER=1
node server\index.js
echo.
pause
