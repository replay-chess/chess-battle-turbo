#!/bin/bash
# =============================================================================
# Chess WebSocket Server - Application Deployment Script
# Run this on the EC2 server after setup-server.sh
# Usage: bash deploy-app.sh
# =============================================================================

set -e


REPO_DIR="/var/www/chess-websocket/chess-battle-turbo"
APP_DIR="$REPO_DIR/apps/web-socket"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }

echo "=========================================="
echo "Deploying Chess WebSocket Server"
echo "=========================================="

cd $APP_DIR

# =============================================================================
# Check for required files
# =============================================================================
if [ ! -f "package.json" ]; then
    print_error "package.json not found!"
    echo "Make sure repo is cloned at $REPO_DIR"
    exit 1
fi

# =============================================================================
# Check for .env file
# =============================================================================
if [ ! -f ".env" ]; then
    print_error ".env file not found!"
    echo "Create one with:"
    echo "  PORT=3002"
    echo "  NODE_ENV=production"
    echo "  WEB_APP_URL=https://playchess.tech"
    echo "  INTERNAL_API_SECRET=<must match Vercel production — required, or moves won't persist>"
    exit 1
fi

# =============================================================================
# Stop existing service (if running)
# =============================================================================
echo ""
echo "Stopping existing service..."
if sudo systemctl is-active --quiet chess-websocket; then
    sudo systemctl stop chess-websocket
    print_status "Stopped existing service"
else
    print_warning "Service was not running"
fi

# =============================================================================
# Install dependencies
# =============================================================================
echo ""
echo "Installing dependencies..."
pnpm install
print_status "Dependencies installed"

# =============================================================================
# Build TypeScript
# =============================================================================
echo ""
echo "Building TypeScript..."
pnpm run build
print_status "Build complete"

# Verify build output
if [ ! -f "dist/index.js" ]; then
    print_error "Build failed: dist/index.js not found"
    exit 1
fi

# =============================================================================
# Start service
# =============================================================================
echo ""
echo "Starting service..."
sudo systemctl start chess-websocket
print_status "Service started"

# =============================================================================
# Verify application is running
# =============================================================================
echo ""
echo "Verifying application..."
sleep 3

if sudo systemctl is-active --quiet chess-websocket; then
    print_status "Service is running!"

    # Test health endpoint
    HEALTH_RESPONSE=$(curl -s http://localhost:3002/health)
    if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
        print_status "Health check passed: $HEALTH_RESPONSE"
    else
        print_warning "Health check response: $HEALTH_RESPONSE"
    fi
else
    print_error "Service failed to start"
    echo "Check logs with: sudo journalctl -u chess-websocket -f"
    exit 1
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Service Status:"
sudo systemctl status chess-websocket --no-pager
echo ""
echo "Useful Commands:"
echo "  sudo systemctl status chess-websocket   # Check status"
echo "  sudo systemctl restart chess-websocket  # Restart"
echo "  sudo systemctl stop chess-websocket     # Stop"
echo "  sudo journalctl -u chess-websocket -f   # View logs"
echo ""
