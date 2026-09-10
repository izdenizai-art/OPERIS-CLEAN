@echo off
chcp 65001 >nul
title OPERIS - Ag Tanilama
echo.
echo === OPERIS Ag Tanilama ===
echo.
echo [1] Yerel saglik kontrolu:
powershell -NoProfile -Command "try { Invoke-RestMethod 'http://localhost:3001/api/health' -TimeoutSec 5 | ConvertTo-Json -Compress } catch { Write-Host $_.Exception.Message -ForegroundColor Red }"
echo.
echo [2] 3001 portu:
netstat -ano | findstr ":3001"
echo.
echo [3] IPv4 adresleri:
ipconfig | findstr /I "IPv4"
echo.
echo [4] Guvenlik duvari kurallari:
netsh advfirewall firewall show rule name="Operis Enterprise TCP 3001 - DomainPrivate"
netsh advfirewall firewall show rule name="Operis Enterprise TCP 3001 - PublicLocalSubnet"
echo.
pause
