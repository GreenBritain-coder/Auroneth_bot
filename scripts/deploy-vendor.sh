#!/usr/bin/env bash
set -euo pipefail

# ─── Bot Vendor Deploy Script ───────────────────────────────────────────────
# Provisions a new Telegram bot vendor end-to-end:
#   1. Auto-detects next vendor number from Coolify
#   2. Creates bot record in MongoDB
#   3. Creates Coolify application
#   4. Sets environment variables
#   5. Deploys the application
#   6. Sets Telegram webhook
#
# Usage: ./deploy-vendor.sh <BOT_TOKEN> <VENDOR_NAME>
# Example: ./deploy-vendor.sh 123456:ABC-DEF "Cannabis Kings"
# ─────────────────────────────────────────────────────────────────────────────

BOT_TOKEN="${1:-}"
VENDOR_NAME="${2:-}"

if [[ -z "$BOT_TOKEN" || -z "$VENDOR_NAME" ]]; then
  echo "Usage: $0 <BOT_TOKEN> <VENDOR_NAME>"
  echo "Example: $0 123456:ABC-DEF \"Cannabis Kings\""
  exit 1
fi

# ─── Coolify Configuration ──────────────────────────────────────────────────
COOLIFY_API="http://111.90.140.72:8000/api/v1"
COOLIFY_TOKEN="9|7wp1NRfygYeSo7C2nbx45vyclhcfWJOV5d9hSbB066fb0fa6"
SERVER_UUID="ug4s448ggk0wwc00s8cwg8wg"
DESTINATION_UUID="k444gcgc84wwsgkko8scwg0g"
PROJECT_UUID="xit2jlqhl4f8jvbpi3yb6nzp"
ENVIRONMENT="production"
PRIVATE_KEY_UUID="zs8k80o4cwwk4cokkckgw0k4"
GIT_REPO="GreenBritain-coder/Auroneth_bot"
GIT_BRANCH="main"

# ─── Shared Environment Variables (from vendor2 template) ───────────────────
MONGO_URI='mongodb://root:36SdeuZbZCNtJYyWzUhCk85q7@111.90.140.72:27017/telegram_bot_platform?authSource=admin'
SHKEEPER_API_URL='https://shkeeper.auroneth.info'
SHKEEPER_API_KEY='knZIhomXoB5o61cgfYdRkQ'
CRYPTAPI_BTC_WALLET_ADDRESS='bc1q7ldfwwz33ejtedntamrrpq4dtw9y2k5gja4n'
CRYPTAPI_LTC_WALLET_ADDRESS='ltc1ql5r3mxt69mq4v45csa6srf8g473v7vpnamq'
CRYPTAPI_ENABLED_CURRENCIES='BTC,LTC'
ADDRESS_ENCRYPTION_KEY='pPELJJX8LjZwWK-FVmIyb8j4sLlh5BvCr3Yf9WaA'
PLATFORM_COMMISSION_RATE='0.10'
APP_PORT='8000'

# ─── Helper: Coolify API call ───────────────────────────────────────────────
coolify() {
  local method="$1" endpoint="$2"
  shift 2
  curl -sf -X "$method" \
    "${COOLIFY_API}${endpoint}" \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    "$@"
}

echo "═══════════════════════════════════════════════════════════"
echo "  Bot Vendor Deploy: ${VENDOR_NAME}"
echo "═══════════════════════════════════════════════════════════"

# ─── Step 1: Auto-detect next vendor number ─────────────────────────────────
echo ""
echo "[1/6] Detecting next vendor number..."

APPS_JSON=$(coolify GET /applications)
# Find the highest existing vendor number
VENDOR_NUM=$(echo "$APPS_JSON" | python3 -c "
import sys, json, re
apps = json.load(sys.stdin)
if isinstance(apps, dict) and 'data' in apps:
    apps = apps['data']
nums = []
for a in apps:
    name = a.get('name','') or ''
    m = re.search(r'telegram-bot-service-vendor(\d+)', name)
    if m:
        nums.append(int(m.group(1)))
# Original bot.auroneth.info = vendor1, so start from at least 1
nums.append(1)
print(max(nums) + 1)
" 2>/dev/null || echo "4")
APP_NAME="telegram-bot-service-vendor${VENDOR_NUM}"
DOMAIN="bot${VENDOR_NUM}.auroneth.info"
FQDN="https://${DOMAIN}"

echo "  Found ${EXISTING_COUNT} existing vendors"
echo "  Next vendor: #${VENDOR_NUM}"
echo "  App name: ${APP_NAME}"
echo "  Domain: ${DOMAIN}"

# ─── Step 2: Create bot record in MongoDB ────────────────────────────────────
echo ""
echo "[2/6] Creating bot record in MongoDB..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

BOT_ID=$(MONGO_URI="$MONGO_URI" DEPLOY_BOT_TOKEN="$BOT_TOKEN" DEPLOY_VENDOR_NAME="$VENDOR_NAME" NODE_PATH="$REPO_DIR/admin-panel/node_modules" node -e '
const mongoose = require("mongoose");

const BotSchema = new mongoose.Schema({
  token: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  main_buttons: { type: [String], default: [] },
  inline_buttons: { type: mongoose.Schema.Types.Mixed, default: {} },
  messages: { type: mongoose.Schema.Types.Mixed, default: {} },
  products: { type: [String], default: [] },
  status: { type: String, enum: ["live", "offline"], default: "live" },
  owner: { type: String },
  public_listing: { type: Boolean, default: true },
  profile_picture_url: { type: String, default: "" },
  payment_methods: { type: [String], default: [] },
  web_shop_enabled: { type: Boolean, default: false },
});

const Bot = mongoose.model("Bot", BotSchema);
const token = process.env.DEPLOY_BOT_TOKEN;
const name = process.env.DEPLOY_VENDOR_NAME;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const existing = await Bot.findOne({ token });
  if (existing) {
    console.log(existing._id.toString());
    await mongoose.disconnect();
    return;
  }

  const bot = new Bot({
    token,
    name,
    description: `Telegram bot for ${name}`,
    main_buttons: ["Shop", "Support"],
    status: "live",
    public_listing: true,
    payment_methods: ["BTC", "LTC"],
    web_shop_enabled: false,
    messages: {
      welcome: `Welcome to ${name}! Your secret phrase is: {{secret_phrase}}`,
      thank_you: "Thank you for your purchase!",
    },
  });

  await bot.save();
  console.log(bot._id.toString());
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
')

if [[ -z "$BOT_ID" ]]; then
  echo "  ERROR: Failed to create bot in MongoDB"
  exit 1
fi
echo "  Bot ID: ${BOT_ID}"

# ─── Step 3: Create Coolify application ──────────────────────────────────────
echo ""
echo "[3/6] Creating Coolify application..."

CREATE_PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'name': sys.argv[1],
    'project_uuid': sys.argv[2],
    'server_uuid': sys.argv[3],
    'destination_uuid': sys.argv[4],
    'environment_name': 'production',
    'private_deploy_key_uuid': sys.argv[5],
    'git_repository': 'git@github.com:' + sys.argv[6] + '.git',
    'git_branch': sys.argv[7],
    'build_pack': 'dockerfile',
    'ports_exposes': '8000',
    'base_directory': '/telegram-bot-service',
    'dockerfile_location': '/telegram-bot-service/Dockerfile',
}))
" "$APP_NAME" "$PROJECT_UUID" "$SERVER_UUID" "$DESTINATION_UUID" "$PRIVATE_KEY_UUID" "$GIT_REPO" "$GIT_BRANCH")

CREATE_RESPONSE=$(coolify POST /applications/private-deploy-key -d "$CREATE_PAYLOAD")

APP_UUID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uuid',''))" 2>/dev/null)

if [[ -z "$APP_UUID" ]]; then
  echo "  ERROR: Failed to create Coolify app"
  echo "  Response: ${CREATE_RESPONSE}"
  exit 1
fi
echo "  App UUID: ${APP_UUID}"

# Set FQDN on the application
coolify PATCH "/applications/${APP_UUID}" -d "{
  \"fqdn\": \"${FQDN}\",
  \"name\": \"${APP_NAME}\"
}" > /dev/null

echo "  FQDN set: ${FQDN}"

# ─── Step 4: Set environment variables ───────────────────────────────────────
echo ""
echo "[4/6] Setting environment variables..."

set_env() {
  local key="$1" value="$2" preview="${3:-false}"
  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({'key': sys.argv[1], 'value': sys.argv[2], 'is_preview': sys.argv[3] == 'true'}))
" "$key" "$value" "$preview")
  coolify POST "/applications/${APP_UUID}/envs" -d "$payload" > /dev/null 2>&1
  echo "  + ${key}"
}

# Shared vars
set_env "MONGO_URI" "$MONGO_URI"
set_env "SHKEEPER_API_URL" "$SHKEEPER_API_URL"
set_env "SHKEEPER_API_KEY" "$SHKEEPER_API_KEY"
set_env "CRYPTAPI_BTC_WALLET_ADDRESS" "$CRYPTAPI_BTC_WALLET_ADDRESS"
set_env "CRYPTAPI_LTC_WALLET_ADDRESS" "$CRYPTAPI_LTC_WALLET_ADDRESS"
set_env "CRYPTAPI_ENABLED_CURRENCIES" "$CRYPTAPI_ENABLED_CURRENCIES"
set_env "ADDRESS_ENCRYPTION_KEY" "$ADDRESS_ENCRYPTION_KEY"
set_env "PLATFORM_COMMISSION_RATE" "$PLATFORM_COMMISSION_RATE"
set_env "PORT" "$APP_PORT"

# Per-bot vars
set_env "BOT_TOKEN" "$BOT_TOKEN"
set_env "WEBHOOK_URL" "$FQDN"
set_env "bridge_url" "$FQDN"

echo "  (12 variables set)"

# ─── Step 5: Deploy the application ─────────────────────────────────────────
echo ""
echo "[5/6] Deploying application..."

DEPLOY_RESPONSE=$(coolify POST "/applications/${APP_UUID}/deploy")
DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('deployment_uuid', d.get('id','')))" 2>/dev/null || echo "triggered")

echo "  Deploy triggered: ${DEPLOY_ID}"
echo "  (Build will take 2-5 minutes)"

# ─── Step 6: Set Telegram webhook ────────────────────────────────────────────
echo ""
echo "[6/6] Setting Telegram webhook..."

WEBHOOK_RESULT=$(curl -sf "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${FQDN}/webhook" 2>/dev/null || echo '{"ok":false}')
WEBHOOK_OK=$(echo "$WEBHOOK_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null)

if [[ "$WEBHOOK_OK" == "True" ]]; then
  echo "  Webhook set: ${FQDN}/webhook"
else
  echo "  WARNING: Webhook will be set once DNS is configured for ${DOMAIN}"
  echo "  Manual: curl \"https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${FQDN}/webhook\""
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  DEPLOYMENT SUMMARY"
echo "═══════════════════════════════════════════════════════════"
echo "  Vendor:      ${VENDOR_NAME} (vendor${VENDOR_NUM})"
echo "  Bot ID:      ${BOT_ID}"
echo "  App UUID:    ${APP_UUID}"
echo "  Domain:      ${DOMAIN}"
echo "  FQDN:        ${FQDN}"
echo "  Webhook:     ${FQDN}/webhook"
echo "  Admin Panel: https://admin.auroneth.info"
echo "  Coolify:     http://111.90.140.72:8000"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. Add DNS A record: ${DOMAIN} -> 111.90.140.72"
echo "  2. Wait for Coolify build to complete (~2-5 min)"
echo "  3. Test: send /start to the bot on Telegram"
echo "  4. Configure products in admin panel"
echo ""
