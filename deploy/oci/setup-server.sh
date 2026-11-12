#!/usr/bin/env bash
# One-time setup for a fresh OCI Ampere A1 (arm64) Ubuntu 24.04 instance.
# OCI images log in as `ubuntu` with sudo, not root:
#   ssh -i ~/.ssh/oci_deploy ubuntu@<server-ip> 'sudo bash -s' < deploy/oci/setup-server.sh
# Creates a `deploy` user (with ubuntu's authorized SSH keys), opens 80/443 in
# the host firewall, installs Docker, adds swap, disables password SSH, and
# creates the worker-idle.slice the analysis worker container runs in.
#
# On a box that is already set up, only the slice (idempotent, no restart of
# anything that runs):
#   ssh -i ~/.ssh/oci_deploy ubuntu@<server-ip> 'sudo bash -s -- --worker-slice' < deploy/oci/setup-server.sh
set -euo pipefail

DEPLOY_USER=deploy
APP_DIR=/opt/replay-chess

# The analysis worker's CPU slice (phase-03 plan P3-D8): CPUWeight=idle sets cpu.idle=1 on the cgroup, so under
# cgroup v2 the worker container (compose `cgroup_parent: worker-idle.slice`) only gets CPU the socket container
# does not want. Check after the worker started: cat /sys/fs/cgroup/worker-idle.slice/cpu.idle  → 1
worker_slice() {
  cat > /etc/systemd/system/worker-idle.slice <<'UNIT'
[Unit]
Description=Replay Chess analysis worker (idle CPU weight; phase-03 plan P3-D8)
Before=slices.target

[Slice]
CPUWeight=idle
UNIT
  systemctl daemon-reload
  systemctl start worker-idle.slice
  echo "worker-idle.slice: cpu.idle=$(cat /sys/fs/cgroup/worker-idle.slice/cpu.idle 2>/dev/null || echo '?')"
}

if [ "${1:-}" = "--worker-slice" ]; then
  worker_slice
  exit 0
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl unattended-upgrades netfilter-persistent

# OCI's Ubuntu image ships iptables rules that REJECT everything but SSH, on
# top of the VCN security list. Open HTTP/HTTPS and persist the rules before
# Docker adds its own chains (Docker recreates those on every start).
if ! iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
  iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
fi
netfilter-persistent save

# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# Deploy user, reusing the SSH key OCI put on the ubuntu user
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
mkdir -p /home/$DEPLOY_USER/.ssh
cp /home/ubuntu/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
chmod 700 /home/$DEPLOY_USER/.ssh
chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys

mkdir -p "$APP_DIR"
chown $DEPLOY_USER:$DEPLOY_USER "$APP_DIR"

# 2 GB swap as a cushion for memory spikes
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Key-only SSH, no root login. sshd uses the first value it sees, and the
# 00- drop-in is read before the image's 50-cloud-init.conf.
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'CONF'
PasswordAuthentication no
PermitRootLogin no
CONF
systemctl restart ssh

worker_slice

echo "Done. Log in as: ssh $DEPLOY_USER@<server-ip>"
