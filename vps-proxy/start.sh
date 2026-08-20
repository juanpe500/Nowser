#!/bin/bash
# Nowser: Start/restart mitmdump proxy
# Runs from wherever this script lives (e.g. ~/nowser), so no fixed path / sudo needed.
cd "$(dirname "$0")" || exit 1

# Kill any existing instance
pkill -f 'mitmdump.*nowser_proxy' 2>/dev/null
sleep 1

# Clear old log
> nowser.log

# Start mitmdump as a proper daemon
setsid ./venv/bin/mitmdump -s nowser_proxy.py -p 26652 --set block_global=false \
    > nowser.log 2>&1 < /dev/null &
disown

# Wait and verify
sleep 3
if ss -tlnp 2>/dev/null | grep -q 26652; then
    echo "[OK] Proxy listening on port 26652"
    head -5 nowser.log
else
    echo "[ERROR] Proxy failed to start. Log:"
    cat nowser.log
    exit 1
fi
