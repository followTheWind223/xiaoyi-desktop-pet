@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 exit /b 1
)

start "桌宠控制台" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
exit /b 0
