#!/usr/bin/env bash
# One-time setup for a fresh Hetzner Ubuntu 24.04 server. Run as root:
#   ssh root@<server-ip> 'bash -s' < deploy/hetzner/setup-server.sh
# Creates a `deploy` user (with root's authorized SSH keys), installs Docker,
# adds swap, enables a firewall, and disables root/password SSH login.
set -euo pipefail

DEPLOY_USER=deploy
APP_DIR=/opt/replay-chess

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl ufw unattended-upgrades

# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# Deploy user, reusing the SSH key added in the Hetzner console
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
mkdir -p /home/$DEPLOY_USER/.ssh
cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
chmod 700 /home/$DEPLOY_USER/.ssh
chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys

mkdir -p "$APP_DIR"
chown $DEPLOY_USER:$DEPLOY_USER "$APP_DIR"

# 2 GB swap so the 4 GB box rides out memory spikes
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Firewall: SSH + HTTP/HTTPS only. Docker-published ports are 80/443 (Caddy).
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Key-only SSH, no root login. sshd uses the first value it sees, and the
# 00- drop-in is read before the image's 50-cloud-init.conf.
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'CONF'
PasswordAuthentication no
PermitRootLogin no
CONF
systemctl restart ssh

echo "Done. Log in as: ssh $DEPLOY_USER@<server-ip>"
