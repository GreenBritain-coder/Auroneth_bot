#!/bin/bash

# SHKeeper Installation Script
# This script installs SHKeeper on a fresh Ubuntu server

set -e  # Exit on error

echo "========================================="
echo "SHKeeper Installation Script"
echo "========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Step 1: Install k3s
echo "[1/6] Installing k3s..."
curl -sfL https://get.k3s.io | sh -

# Step 2: Configure kubectl
echo "[2/6] Configuring kubectl..."
mkdir -p /root/.kube
ln -sf /etc/rancher/k3s/k3s.yaml /root/.kube/config

# Step 3: Install Helm
echo "[3/6] Installing Helm..."
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Step 4: Create values.yaml
echo "[4/6] Creating SHKeeper configuration..."
cat << EOF > /root/values.yaml
#
# General
#
storageClassName: local-path

#
# BTC and forks
#
btc:
  enabled: true
ltc:
  enabled: true
doge:
  enabled: true

#
# Monero
#
monero:
  enabled: true
  fullnode:
    enabled: true
EOF

# Step 5: Add Helm repositories
echo "[5/6] Adding Helm repositories..."
helm repo add vsys-host https://vsys-host.github.io/helm-charts
helm repo add mittwald https://helm.mittwald.de
helm repo update

# Step 6: Install Kubernetes Secret Generator
echo "[6/6] Installing dependencies..."
helm install kubernetes-secret-generator mittwald/kubernetes-secret-generator

# Step 7: Install SHKeeper
echo "Installing SHKeeper..."
helm install -f /root/values.yaml shkeeper vsys-host/shkeeper

echo ""
echo "========================================="
echo "Installation Complete!"
echo "========================================="
echo ""
echo "Waiting for SHKeeper to start (this may take a few minutes)..."
sleep 10

# Check status
echo ""
echo "Checking SHKeeper status..."
kubectl get pods -n shkeeper

echo ""
echo "========================================="
echo "Next Steps:"
echo "========================================="
echo "1. Get your server IP:"
echo "   kubectl get svc shkeeper --namespace=shkeeper"
echo ""
echo "2. Access SHKeeper web interface:"
echo "   http://<your-server-ip>:5000/"
echo ""
echo "3. Login with:"
echo "   Username: admin"
echo "   Password: (set on first login)"
echo ""
echo "4. Get API key:"
echo "   Wallets -> Manage -> API key"
echo ""

