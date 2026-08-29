@echo off
echo Starting AI Email Automation...
echo.
echo Starting Node.js API server...
start /b node backend/server.js
timeout /t 2 /nobreak >nul
echo Running background AI Email Agent...
python -u backend/agent.py
echo.
echo Server is running. Open http://localhost:3000 in your browser.
pause
