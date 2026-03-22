import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest, verifyToken } from '@/lib/auth';
import mongoose from 'mongoose';

const COOLIFY_API = process.env.COOLIFY_API_URL || 'http://coolify:8080/api/v1';
const COOLIFY_TOKEN = '9|7wp1NRfygYeSo7C2nbx45vyclhcfWJOV5d9hSbB066fb0fa6';
const CF_API_KEY = '7880a19394646bfb0138f4171f6aeefbb6292';
const CF_EMAIL = 'newsweeties2020@protonmail.com';
const CF_ZONE_ID = '22e72641c6905f6d8d0d9a36604acec7';
const SERVER_IP = '111.90.140.72';
const SERVER_UUID = 'ug4s448ggk0wwc00s8cwg8wg';
const DESTINATION_UUID = 'k444gcgc84wwsgkko8scwg0g';
const PROJECT_UUID = 'xit2jlqhl4f8jvbpi3yb6nzp';
const GIT_REPO = 'https://github.com/GreenBritain-coder/Auroneth_bot';
const GIT_BRANCH = 'main';

function getSharedEnvVars(mongoUri: string): Record<string, string> {
  return {
  MONGO_URI: mongoUri,
  SHKEEPER_API_URL: 'https://shkeeper.auroneth.info',
  SHKEEPER_API_KEY: 'knZIhomXoB5o61cgfYdRkQ',
  CRYPTAPI_BTC_WALLET_ADDRESS: 'bc1q7ldfwwz33ejtedntamrrpq4dtw9y2k5gja4n',
  CRYPTAPI_LTC_WALLET_ADDRESS: 'ltc1ql5r3mxt69mq4v45csa6srf8g473v7vpnamq',
  CRYPTAPI_ENABLED_CURRENCIES: 'BTC,LTC',
  ADDRESS_ENCRYPTION_KEY: process.env.ADDRESS_ENCRYPTION_KEY || 'pPELJJX8LjZwWK-FVmIyb8j4sLlh5BvCr3Yf9WaA',
  PLATFORM_COMMISSION_RATE: '0.10',
  PORT: '8000',
  };
}

async function coolify(method: string, endpoint: string, body?: object) {
  const res = await fetch(`${COOLIFY_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coolify ${method} ${endpoint}: ${res.status} ${text}`);
  }
  return res.json();
}

export async function POST(request: NextRequest) {
  // Auth check
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'super-admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { botToken, vendorName } = await request.json();
  if (!botToken || !vendorName) {
    return NextResponse.json({ error: 'botToken and vendorName are required' }, { status: 400 });
  }

  const steps: { step: string; status: string; detail?: string }[] = [];

  try {
    // Step 1: Auto-detect next vendor number
    const apps = await coolify('GET', '/applications');
    const appList = Array.isArray(apps) ? apps : apps.data || [];
    // Find the highest existing vendor number
    const vendorNums = appList
      .map((a: any) => {
        const match = (a.name || '').match(/telegram-bot-service-vendor(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((n: number) => n > 0);
    vendorNums.push(1); // original bot.auroneth.info = vendor1
    const vendorNum = Math.max(...vendorNums) + 1;
    const appName = `telegram-bot-service-vendor${vendorNum}`;
    const domain = `bot${vendorNum}.auroneth.info`;
    const fqdn = `https://${domain}`;

    steps.push({
      step: 'Detect vendor number',
      status: 'done',
      detail: `Vendor #${vendorNum} (${vendorNums.length} existing)`,
    });

    // Step 2: Create bot in MongoDB
    const conn = mongoose.connection.readyState === 1
      ? mongoose.connection
      : await mongoose.connect(process.env.MONGO_URI || '');

    const BotModel =
      mongoose.models.Bot ||
      mongoose.model(
        'Bot',
        new mongoose.Schema({
          token: String,
          name: String,
          description: String,
          main_buttons: [String],
          inline_buttons: mongoose.Schema.Types.Mixed,
          messages: mongoose.Schema.Types.Mixed,
          products: [String],
          status: { type: String, enum: ['live', 'offline'], default: 'live' },
          owner: String,
          public_listing: { type: Boolean, default: true },
          profile_picture_url: { type: String, default: '' },
          payment_methods: [String],
          web_shop_enabled: { type: Boolean, default: false },
        })
      );

    let botDoc = await BotModel.findOne({ token: botToken });
    if (botDoc) {
      botDoc.name = vendorName;
      await botDoc.save();
    } else {
      botDoc = await BotModel.create({
        token: botToken,
        name: vendorName,
        description: `Telegram bot for ${vendorName}`,
        main_buttons: ['Shop', 'Support'],
        status: 'live',
        public_listing: true,
        payment_methods: ['BTC', 'LTC'],
        web_shop_enabled: false,
        messages: {
          welcome: `Welcome to ${vendorName}! Your secret phrase is: {{secret_phrase}}`,
          thank_you: 'Thank you for your purchase!',
        },
      });
    }

    steps.push({
      step: 'Create MongoDB bot',
      status: 'done',
      detail: `Bot ID: ${botDoc._id}`,
    });

    // Step 3: Create Coolify application
    const createRes = await coolify('POST', '/applications/public', {
      name: appName,
      project_uuid: PROJECT_UUID,
      server_uuid: SERVER_UUID,
      destination_uuid: DESTINATION_UUID,
      environment_name: 'production',
      git_repository: GIT_REPO,
      git_branch: GIT_BRANCH,
      build_pack: 'dockerfile',
      ports_exposes: '8000',
      base_directory: '/telegram-bot-service',
      dockerfile_location: '/Dockerfile',
      domains: fqdn,
    });

    const appUuid = createRes.uuid;
    if (!appUuid) {
      throw new Error('No UUID returned from Coolify app creation');
    }

    steps.push({
      step: 'Create Coolify app',
      status: 'done',
      detail: `${appName} (${appUuid})`,
    });

    // Step 4: Set environment variables
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set on admin panel');
    }
    const allEnvVars: Record<string, string> = {
      ...getSharedEnvVars(process.env.MONGO_URI),
      BOT_TOKEN: botToken,
      WEBHOOK_URL: fqdn,
      bridge_url: fqdn,
    };

    for (const [key, value] of Object.entries(allEnvVars)) {
      await coolify('POST', `/applications/${appUuid}/envs`, {
        key,
        value,
        is_preview: false,
      });
    }

    steps.push({
      step: 'Set environment variables',
      status: 'done',
      detail: `${Object.keys(allEnvVars).length} variables set`,
    });

    // Step 5: Deploy
    const deployRes = await coolify('POST', `/applications/${appUuid}/deploy`);

    steps.push({
      step: 'Deploy application',
      status: 'done',
      detail: `Deployment triggered (build takes 2-5 min)`,
    });

    // Step 6: Create Cloudflare DNS record
    let dnsStatus = 'pending';
    let dnsDetail = '';
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records`,
        {
          method: 'POST',
          headers: {
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'A',
            name: domain,
            content: SERVER_IP,
            proxied: true,
            ttl: 1,
          }),
        }
      );
      const cfData = await cfRes.json();
      if (cfData.success) {
        dnsStatus = 'done';
        dnsDetail = `${domain} → ${SERVER_IP} (proxied)`;
      } else {
        // Check if record already exists
        const errMsg = cfData.errors?.[0]?.message || 'Unknown error';
        if (errMsg.includes('already exists')) {
          dnsStatus = 'done';
          dnsDetail = `${domain} already exists in Cloudflare`;
        } else {
          dnsStatus = 'warning';
          dnsDetail = errMsg;
        }
      }
    } catch (e: any) {
      dnsStatus = 'warning';
      dnsDetail = e.message;
    }

    steps.push({
      step: 'Create DNS record',
      status: dnsStatus,
      detail: dnsDetail,
    });

    // Step 7: Set Telegram webhook
    let webhookStatus = 'pending';
    try {
      const whRes = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${fqdn}/webhook`
      );
      const whData = await whRes.json();
      webhookStatus = whData.ok ? 'done' : 'warning';
    } catch {
      webhookStatus = 'warning';
    }

    steps.push({
      step: 'Set Telegram webhook',
      status: webhookStatus,
      detail:
        webhookStatus === 'done'
          ? `${fqdn}/webhook`
          : `Webhook will work once DNS propagates and deploy completes.`,
    });

    return NextResponse.json({
      success: true,
      summary: {
        vendorName,
        vendorNum,
        botId: botDoc._id.toString(),
        appUuid,
        appName,
        domain,
        fqdn,
      },
      steps,
    });
  } catch (error: any) {
    steps.push({ step: 'Error', status: 'failed', detail: error.message });
    return NextResponse.json({ success: false, steps, error: error.message }, { status: 500 });
  }
}
