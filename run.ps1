Write-Host "Starting AI Email Automation..." -ForegroundColor Cyan
Write-Host ""

Write-Host "Starting Node.js API server..." -ForegroundColor Cyan
$serverProcess = Start-Process node -ArgumentList "backend/server.js" -NoNewWindow -PassThru
Start-Sleep -Seconds 2

Write-Host "Running background AI Email Agent..." -ForegroundColor Cyan
python -u backend/agent.py

Write-Host ""
Write-Host "Server is running. Open http://localhost:3000 in your browser." -ForegroundColor Green
Wait-Process -Id $serverProcess.Id
