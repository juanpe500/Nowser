@echo off
title Nowser VPS Proxy
setlocal enabledelayedexpansion

echo ========================================
echo        NOWSER - VPS Proxy Connector
echo ========================================
echo.

:: Accept arguments or prompt
if "%~1" neq "" (
    set "SSH_ALIAS=%~1"
) else (
    set /p "SSH_ALIAS=SSH alias (e.g. Contabo): "
)

if "%~2" neq "" (
    set "LOCAL_PORT=%~2"
) else (
    set /p "LOCAL_PORT=Local port [26652]: "
)
if "!LOCAL_PORT!"=="" set "LOCAL_PORT=26652"

echo.
echo  VPS:  %SSH_ALIAS%
echo  Port: localhost:%LOCAL_PORT% -^> VPS:26652
echo ========================================

:: ── Step 1: Install mitmproxy on VPS if not present ──
echo.
echo [1/3] Ensuring mitmproxy is installed on VPS...
ssh %SSH_ALIAS% "mkdir -p ~/nowser && if ~/nowser/venv/bin/mitmdump --version > /dev/null 2>&1; then echo 'Already installed:' && ~/nowser/venv/bin/mitmdump --version; else echo 'Installing mitmproxy...' && rm -rf ~/nowser/venv && python3 -m venv ~/nowser/venv && ~/nowser/venv/bin/pip install -U pip && ~/nowser/venv/bin/pip install mitmproxy && echo 'Installed.' && ~/nowser/venv/bin/mitmdump --version; fi"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Setup failed. Check SSH connection and that python3 is on the VPS.
    pause
    exit /b 1
)

:: ── Step 2: Sync scripts to VPS (only if changed) ──
echo.
echo [2/3] Syncing scripts...
for /f "tokens=1" %%H in ('certutil -hashfile "%~dp0vps-proxy\nowser_proxy.py" MD5 ^| findstr /v "hash MD5"') do set "LOCAL_HASH_PY=%%H"
for /f "tokens=1" %%H in ('ssh %SSH_ALIAS% "md5sum ~/nowser/nowser_proxy.py 2>/dev/null | cut -d'' '' -f1"') do set "REMOTE_HASH_PY=%%H"
if "!LOCAL_HASH_PY!"=="!REMOTE_HASH_PY!" (
    echo      nowser_proxy.py unchanged.
) else (
    echo      Uploading nowser_proxy.py...
    scp "%~dp0vps-proxy\nowser_proxy.py" %SSH_ALIAS%:nowser/nowser_proxy.py
)
scp -q "%~dp0vps-proxy\start.sh" %SSH_ALIAS%:nowser/start.sh
ssh %SSH_ALIAS% "chmod +x ~/nowser/start.sh"

:: ── Step 3: (Re)start mitmdump on VPS ──
echo.
echo [3/3] Starting proxy on VPS...
ssh %SSH_ALIAS% "bash ~/nowser/start.sh"

:: ── Download CA cert if not present locally ──
set "CERT_DIR=%~dp0certs"
set "CERT_FILE=%CERT_DIR%\%SSH_ALIAS%-ca-cert.pem"
if not exist "!CERT_FILE!" (
    echo.
    echo [*] Downloading mitmproxy CA certificate...
    if not exist "!CERT_DIR!" mkdir "!CERT_DIR!"
    scp %SSH_ALIAS%:~/.mitmproxy/mitmproxy-ca-cert.pem "!CERT_FILE!"
    if exist "!CERT_FILE!" (
        echo.
        echo [*] Installing CA certificate in Windows trust store...
        certutil -user -addstore Root "!CERT_FILE!"
        if %ERRORLEVEL% equ 0 (
            echo [OK] Certificate installed. Restart your browser.
        ) else (
            echo [WARN] Auto-install failed. Install manually:
            echo        Open: !CERT_FILE!
            echo        Store: Trusted Root Certification Authorities
        )
    ) else (
        echo [WARN] Could not download CA cert. HTTPS will show certificate errors.
    )
)

:: ── Open SSH tunnel (blocks to keep alive) ──
echo.
echo ========================================
echo  Tunnel ACTIVE: localhost:%LOCAL_PORT% -^> %SSH_ALIAS%:26652
echo  Press Ctrl+C to disconnect.
echo ========================================
echo.
ssh -N -L %LOCAL_PORT%:localhost:26652 %SSH_ALIAS%

echo.
echo Tunnel closed.
pause
