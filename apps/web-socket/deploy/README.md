# Chess WebSocket Server - AWS EC2 Deployment Guide

Deploy the chess WebSocket server to a dedicated EC2 instance with Node.js, systemd, Nginx, and SSL.

## Prerequisites

- AWS Account
- SSH key pair for EC2
- A domain/subdomain pointing to your EC2 IP (e.g., `ws-chess.playchess.tech`)

## Quick Start

### Step 1: Launch EC2 Instance

1. Go to AWS Console → EC2 → Launch Instance
2. Configure:
   - **Name**: `chess-websocket-server`
   - **AMI**: Ubuntu Server 22.04 LTS
   - **Instance type**: `t3.micro` (free tier eligible)
   - **Key pair**: Create new or select existing
   - **Security Group**: Create with these inbound rules:
     | Type   | Port | Source         |
     |--------|------|----------------|
     | SSH    | 22   | Your IP        |
     | HTTP   | 80   | 0.0.0.0/0     |
     | HTTPS  | 443  | 0.0.0.0/0     |
   - **Storage**: 8GB gp3 (default)

3. Launch instance

### Step 2: Allocate Elastic IP

1. EC2 → Elastic IPs → Allocate Elastic IP
2. Associate with your instance
3. Note the IP address (e.g., `54.xxx.xxx.xxx`)

### Step 3: Configure DNS

Point your WebSocket subdomain to the Elastic IP:
- **Type**: A record
- **Name**: `ws-chess` (or your chosen subdomain)
- **Value**: Your Elastic IP

Verify with `dig ws-chess.yourdomain.com` — the A record should show your EC2 IP.

### Step 4: Setup Server

```bash
# SSH into your instance
ssh -i your-key.pem ubuntu@<ELASTIC-IP>

# Clone the repository
sudo mkdir -p /var/www/chess-websocket
cd /var/www/chess-websocket
sudo chown -R $USER:$USER /var/www
git clone https://github.com/replay-chess/chess-battle-turbo.git

# Run setup script (installs Node.js, pnpm, Nginx, Certbot, configures firewall and systemd)
bash /var/www/chess-websocket/chess-battle-turbo/apps/web-socket/deploy/setup-server.sh
```

> **Required**: Edit `/var/www/chess-websocket/chess-battle-turbo/apps/web-socket/.env` and set `INTERNAL_API_SECRET` to the same value as Vercel's `INTERNAL_API_SECRET` (production). Without this, every `/api/chess/*` call returns 401, moves never persist, and games stay stuck in `IN_PROGRESS`.

### Step 5: Deploy Application

```bash
cd /var/www/chess-websocket/chess-battle-turbo/apps/web-socket

# Install dependencies and build
pnpm install
pnpm run build

# Start the service
sudo systemctl start chess-websocket
```

### Step 6: Setup SSL with Certbot

```bash
# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d ws-chess.yourdomain.com

# Verify Nginx is running
sudo systemctl status nginx
```

Certbot will automatically insert `ssl_certificate` and `ssl_certificate_key` lines into the Nginx config.

### Step 7: Verify Deployment

```bash
# Local health check (bypasses Nginx)
curl http://localhost:3002/health
# Expected: {"status":"ok","message":"WebSocket server is running"}

# External health check (through Nginx + SSL)
curl https://ws-chess.yourdomain.com/health
# Expected: same response over HTTPS

# Check services
sudo systemctl status chess-websocket
sudo systemctl status nginx
```

### Step 8: Update Vercel Environment

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - **Name**: `NEXT_PUBLIC_WEBSOCKET_URL`
   - **Value**: `wss://ws-chess.yourdomain.com` (must be `wss://`, not `ws://`)
   - **Environment**: Production
3. Redeploy your app

---

## CI/CD Auto-Deploy

Once set up, pushing to `main` will auto-deploy. See `.github/workflows/deploy-websocket.yml`.

**Required GitHub Secrets:**

| Secret | Value |
|--------|-------|
| `EC2_SSH_KEY` | Your EC2 private key (`.pem` file contents) |
| `EC2_HOST` | Your EC2 Elastic IP |
| `EC2_USER` | `ubuntu` |

---

## Manual Deployment (after initial setup)

```bash
ssh -i your-key.pem ubuntu@<ELASTIC-IP>
cd /var/www/chess-websocket
git pull origin main
cd apps/web-socket
pnpm install
pnpm run build
sudo systemctl restart chess-websocket
```

---

## Environment Variables

| Variable              | Description                                                                 | Example                           |
|-----------------------|-----------------------------------------------------------------------------|-----------------------------------|
| `PORT`                | Server port                                                                 | `3002`                            |
| `NODE_ENV`            | Environment                                                                 | `production`                      |
| `WEB_APP_URL`         | Your Next.js app URL (for API calls)                                        | `https://playchess.tech`          |
| `INTERNAL_API_SECRET` | Shared secret for server-to-server auth with the Next.js app. **MUST** match Vercel's `INTERNAL_API_SECRET` (production). Generate with `openssl rand -hex 32`. | `<64-char hex>`                   |

> ⚠️ **If `INTERNAL_API_SECRET` is missing or doesn't match Vercel**, every `/api/chess/*` call from the WebSocket server returns `401 Unauthorized`. Moves won't persist and games get stuck in `IN_PROGRESS` (won't show up in user history).

---

## Useful Commands

```bash
# WebSocket Service
sudo systemctl status chess-websocket   # Check status
sudo systemctl start chess-websocket    # Start
sudo systemctl stop chess-websocket     # Stop
sudo systemctl restart chess-websocket  # Restart
sudo journalctl -u chess-websocket -f   # View logs (follow)
sudo journalctl -u chess-websocket -n 100  # View last 100 lines

# Nginx
sudo systemctl status nginx             # Check status
sudo systemctl restart nginx            # Restart
sudo nginx -t                           # Test config
sudo cat /var/log/nginx/error.log       # Error logs

# SSL Certificate
sudo certbot certificates               # Check cert status
sudo certbot renew --dry-run            # Test auto-renewal
```

---

## Troubleshooting

### WebSocket connection fails from browser
- Verify `NEXT_PUBLIC_WEBSOCKET_URL` uses `wss://` (not `ws://`) — browsers block `ws://` from HTTPS pages (mixed content)
- Check Nginx is running: `sudo systemctl status nginx`
- Check SSL cert is valid: `sudo certbot certificates`
- Test externally: `curl -v https://ws-chess.yourdomain.com/health`

### WebSocket connects but game doesn't start
- Check WebSocket service: `sudo systemctl status chess-websocket`
- Check logs: `sudo journalctl -u chess-websocket -f`
- Verify `WEB_APP_URL` in `.env` is correct and reachable from EC2

### SSL certificate issues
- Ensure DNS A record points to the EC2 Elastic IP
- Ensure ports 80 and 443 are open in EC2 security group
- Re-run: `sudo certbot --nginx -d ws-chess.yourdomain.com`

### Application crashes
- Check logs: `sudo journalctl -u chess-websocket -n 100`
- Verify `.env` file has correct values
- Ensure `WEB_APP_URL` is accessible from the server
