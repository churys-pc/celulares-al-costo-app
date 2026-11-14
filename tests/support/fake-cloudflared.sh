#!/bin/sh
# Simula cloudflared (solo pruebas): anuncia un enlace de túnel rápido y queda corriendo.
echo "2026-11-14T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com..." >&2
echo "2026-11-14T12:00:01Z INF |  https://prueba-enlace-seguro.trycloudflare.com  |" >&2
exec sleep 600
