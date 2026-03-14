# SHKeeper Self-Hosting Setup Guide

This guide will help you deploy SHKeeper on your own server using Kubernetes (k3s) and Helm.

## Prerequisites

- A fresh Ubuntu 22.04 server (or similar Linux distribution)
- At least 20GB of disk space
- Root or sudo access
- A domain name (for SSL setup)

## Step 1: Install k3s and Helm

Connect to your server via SSH and run:

```bash
# Install k3s (lightweight Kubernetes)
curl -sfL https://get.k3s.io | sh -

# Configure kubectl
mkdir /root/.kube && ln -s /etc/rancher/k3s/k3s.yaml /root/.kube/config

# Install Helm (Kubernetes package manager)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

## Step 2: Create SHKeeper Configuration

Create a `values.yaml` file with your desired cryptocurrencies enabled:

```bash
cat << EOF > values.yaml
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
```

**Note:** You can enable additional cryptocurrencies by adding them to the `values.yaml` file. See SHKeeper documentation for all supported cryptocurrencies.

## Step 3: Install SHKeeper

Add the required Helm repositories and install SHKeeper:

```bash
# Add Helm repositories
helm repo add vsys-host https://vsys-host.github.io/helm-charts
helm repo add mittwald https://helm.mittwald.de
helm repo update

# Install Kubernetes Secret Generator (required dependency)
helm install kubernetes-secret-generator mittwald/kubernetes-secret-generator

# Install SHKeeper
helm install -f values.yaml shkeeper vsys-host/shkeeper
```

## Step 4: Access SHKeeper Web Interface

1. Get your server's IP address:
   ```bash
   kubectl get svc shkeeper --namespace=shkeeper
   ```

2. Access SHKeeper in your browser:
   ```
   http://<your-server-ip>:5000/
   ```

3. On first login:
   - Username: `admin`
   - Set a new password for the admin user
   - Log in with your new password

## Step 5: Install SSL Certificate (Optional but Recommended)

### 5.1 Install cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm install \
  cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.9.1 \
  --set installCRDs=true
```

### 5.2 Create SSL Configuration

Create `ssl.yaml` file. **Replace the domain and email with your own:**

```bash
cat << EOF > ssl.yaml
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: shkeeper-cert
  namespace: shkeeper
spec:
  commonName: your-domain.com
  secretName: shkeeper-cert
  dnsNames:
    - your-domain.com
  issuerRef:
    name: letsencrypt-production
    kind: ClusterIssuer

---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    email: your-email@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: your-own-very-secretive-key
    solvers:
      - http01:
          ingress:
            class: traefik

---
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: shkeeper
  namespace: shkeeper
spec:
  entryPoints:
    - web
    - websecure
  routes:
    - match: Host(\`your-domain.com\`)
      kind: Rule
      services:
        - name: shkeeper
          port: 5000
          namespace: shkeeper
  tls:
    secretName: shkeeper-cert
EOF
```

**Important:** Before applying, edit `ssl.yaml` and replace:
- `your-domain.com` with your actual domain name
- `your-email@example.com` with your email address

### 5.3 Apply SSL Configuration

```bash
kubectl apply -f ssl.yaml
```

### 5.4 Configure DNS

Point your domain to your server's IP address:
- Add an A record: `your-domain.com` → `<your-server-ip>`

Wait a few minutes for Let's Encrypt to issue the certificate. Your SHKeeper will be accessible at:
```
https://your-domain.com
```

## Step 6: Get Your API Key

1. Log in to SHKeeper web interface
2. Navigate to: **Wallets** → **Manage** → **API key**
3. Copy your API key
4. Add it to your bot's `.env` file:

```env
SHKEEPER_API_KEY=your_api_key_here
SHKEEPER_API_URL=https://your-domain.com
WEBHOOK_URL=https://your-bot-domain.com
```

## Step 7: Wait for Blockchain Synchronization

⚠️ **Important:** On first initialization, SHKeeper's crypto servers will start syncing with the blockchain. This process can take up to **two days** depending on the cryptocurrencies you enabled.

- You can monitor sync status in the SHKeeper web interface
- Once synchronization is complete, you can begin accepting payments

## Troubleshooting

### Check SHKeeper Status

```bash
# Check if pods are running
kubectl get pods -n shkeeper

# Check logs if something is wrong
kubectl logs -n shkeeper <pod-name>

# Check service status
kubectl get svc -n shkeeper
```

### Common Issues

1. **Pods not starting:** Check disk space and resources
2. **SSL not working:** Verify DNS is pointing to your server IP
3. **Can't access web interface:** Check firewall rules (port 5000 should be open)
4. **Sync taking too long:** This is normal for first-time setup, especially for BTC

### Useful Commands

```bash
# Restart SHKeeper
kubectl rollout restart deployment -n shkeeper

# Update SHKeeper
helm upgrade -f values.yaml shkeeper vsys-host/shkeeper

# Uninstall SHKeeper (if needed)
helm uninstall shkeeper
```

## Security Recommendations

1. **Change default admin password** immediately after first login
2. **Use strong API keys** and rotate them periodically
3. **Enable firewall** and only allow necessary ports
4. **Keep SHKeeper updated** with latest Helm chart versions
5. **Backup your wallet keys** regularly
6. **Use SSL/HTTPS** in production (Step 5)

## Next Steps

After SHKeeper is installed and synced:

1. Configure wallets for the cryptocurrencies you want to accept
2. Set up fee policies in SHKeeper admin panel
3. Test payment creation via API
4. Configure webhooks in your bot application

## Resources

- Official SHKeeper Documentation: https://shkeeper.io/
- SHKeeper GitHub: https://github.com/vsys-host/shkeeper.io
- Helm Charts: https://github.com/vsys-host/helm-charts

## Support

If you encounter issues:
- Check SHKeeper logs: `kubectl logs -n shkeeper`
- Visit SHKeeper documentation: https://shkeeper.io/kb/
- Contact SHKeeper support: support@shkeeper.io

