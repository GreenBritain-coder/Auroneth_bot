#!/bin/bash

echo "=== SHKeeper Diagnostic Script ==="
echo ""

# Check pod status
echo "1. Checking pod status..."
kubectl get pods -n shkeeper

echo ""
echo "2. Checking service..."
kubectl get svc -n shkeeper shkeeper-external

echo ""
echo "3. Checking if port 5000 is listening..."
netstat -tlnp | grep 5000 || ss -tlnp | grep 5000

echo ""
echo "4. Testing local connection..."
curl -I http://localhost:5000 2>&1 | head -3

echo ""
echo "5. Checking firewall..."
if command -v ufw &> /dev/null; then
    ufw status | grep 5000 || echo "UFW: Port 5000 not specifically mentioned"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --list-ports 2>&1 | grep 5000 || echo "Firewalld: Port 5000 not found in rules"
else
    echo "No common firewall tool found"
fi

echo ""
echo "6. SHKeeper pod logs (last 10 lines)..."
kubectl logs -n shkeeper -l app=shkeeper --tail=10 2>&1 | tail -10

echo ""
echo "=== Recommendations ==="
echo "If port 5000 is not accessible:"
echo "1. Try: http://111.90.140.72:5000 (not 30579)"
echo "2. Check if firewall needs to allow port 5000"
echo "3. Wait a few more minutes for pods to fully start"

