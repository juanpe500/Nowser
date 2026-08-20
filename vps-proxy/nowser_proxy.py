"""
Nowser VPS Proxy Addon for mitmproxy

Measures request timing from VPS to target server and injects
Server-Timing headers for the Nowser Chrome extension to read.

Usage:
    mitmdump -s nowser_proxy.py -p 26652

The addon injects these Server-Timing metrics:
    vps-connect  — TCP connection time (VPS → Target)
    vps-tls      — TLS handshake time
    vps-wait     — Server processing / TTFB
    vps-download — Response body transfer
    vps-total    — Total time from VPS perspective
"""

from mitmproxy import http


class NowserTimingAddon:
    """Injects VPS-to-target timing into Server-Timing response headers."""

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.response is None:
            return

        parts = []
        sc = flow.server_conn

        # --- Connection-level timing (only on fresh connections) ---
        if sc:
            ts_start = getattr(sc, 'timestamp_start', None)
            ts_tcp = getattr(sc, 'timestamp_tcp_setup', None)
            ts_tls = getattr(sc, 'timestamp_tls_setup', None)

            if ts_start and ts_tcp:
                ms = (ts_tcp - ts_start) * 1000
                parts.append(f'vps-connect;dur={ms:.2f};desc="TCP Connect"')

            if ts_tcp and ts_tls:
                ms = (ts_tls - ts_tcp) * 1000
                parts.append(f'vps-tls;dur={ms:.2f};desc="TLS Handshake"')

        # --- Request / Response timing ---
        req = flow.request
        resp = flow.response

        req_end = getattr(req, 'timestamp_end', None)
        resp_start = getattr(resp, 'timestamp_start', None)
        resp_end = getattr(resp, 'timestamp_end', None)

        if req_end and resp_start:
            ms = (resp_start - req_end) * 1000
            parts.append(f'vps-wait;dur={ms:.2f};desc="Server Wait (TTFB)"')

        if resp_start and resp_end:
            ms = (resp_end - resp_start) * 1000
            parts.append(f'vps-download;dur={ms:.2f};desc="Content Download"')

        # --- Total VPS-side time (per request, not per connection) ---
        origin = getattr(req, 'timestamp_start', None)

        if origin and resp_end:
            ms = (resp_end - origin) * 1000
            parts.append(f'vps-total;dur={ms:.2f};desc="VPS Total"')

        # --- Inject headers ---
        if parts:
            existing = resp.headers.get('Server-Timing', '')
            nowser = ', '.join(parts)
            resp.headers['Server-Timing'] = (
                f'{existing}, {nowser}' if existing else nowser
            )

        # Target IP for CDN / geo debugging
        if sc:
            peername = getattr(sc, 'peername', None)
            if peername:
                resp.headers['X-Nowser-Target-IP'] = str(peername[0])

        # Ensure browser can read custom headers (CORS)
        expose = resp.headers.get('Access-Control-Expose-Headers', '')
        extra = 'Server-Timing, X-Nowser-Target-IP'
        if expose:
            resp.headers['Access-Control-Expose-Headers'] = f'{expose}, {extra}'
        else:
            resp.headers['Access-Control-Expose-Headers'] = extra


addons = [NowserTimingAddon()]
