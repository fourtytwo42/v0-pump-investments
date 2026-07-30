# Cloudflare Tunnel Runbook

The production VM is Ubuntu 24.04 x86-64. Install `cloudflared` from Cloudflare's
APT repository; do not use the Windows MSI shown by the dashboard.

## Cloudflare dashboard route

Create one remotely managed tunnel and add one published application:

- Hostname: `pump.investments`
- Service type: `HTTP`
- Service URL: `http://127.0.0.1:3000`

The route must have no path restriction. Nginx on port 3000 is the single origin
for the web application, API routes, token images, health endpoint, and both SSE
streams.

Do not publish ports 3001, 4000, 5432, or 22:

- `3001` is the internal Next.js listener behind Nginx.
- Nothing in the current application listens on `4000`.
- Realtime browser delivery uses same-origin fetch-based SSE at
  `POST /api/tokens/stream` and `POST /api/alerts/stream`.
- `5432` is PostgreSQL and remains loopback-only.
- SSH administration is outside the public application tunnel.

No separate WebSocket hostname or Cloudflare route is required. The ingester's
WebSocket/NATS connection is outbound to the upstream trade feed. Nginx already
disables proxy buffering for the SSE routes.

## Install and activate

The package is installed from:

```text
deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main
```

Copy the Linux connector command from the remotely managed tunnel dashboard. Run
the token-bearing command directly on the VM:

```bash
sudo cloudflared service install <TUNNEL_TOKEN>
```

Never place the tunnel token in this repository, `.env`, shell history, logs, or
chat. If a token is accidentally exposed, rotate it in Cloudflare before use.

## Cloudflare behavior

- Leave the `/api/tokens/stream` and `/api/alerts/stream` POST responses
  uncacheable. They are long-lived SSE connections.
- Do not create a Cache Rule that caches `/api/*` broadly.
- `/api/token-image/*` may use Cloudflare edge caching; Nginx and the application
  already provide origin-side image caching.
- Cloudflare Access is optional. Enabling it would require users to authenticate
  before using the public application and its API/SSE routes.
- The tunnel is outbound-only and does not require a router port-forward.

## Verification

On the VM:

```bash
cloudflared --version
systemctl is-enabled cloudflared
systemctl is-active cloudflared
systemctl status cloudflared --no-pager
curl -fsS http://127.0.0.1:3000/api/health
```

From outside the LAN:

```bash
curl -fsS https://pump.investments/api/health
```

Confirm the homepage and token images load, then use browser developer tools to
confirm the two stream requests remain open and receive `text/event-stream`
responses without recurring full-page polling.
