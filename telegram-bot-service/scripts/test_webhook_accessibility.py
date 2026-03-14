"""
Test if the webhook URL is accessible from external services (like CryptAPI)
This helps diagnose why webhooks might not be working
"""
import asyncio
import sys
import os
import requests
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load .env
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(env_path)


async def get_webhook_url_from_db():
    """Get webhook URL from bot config in database"""
    mongodb_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    db_name = mongodb_uri.split('/')[-1].split('?')[0] if '/' in mongodb_uri else 'telegram_bot_platform'
    
    client = AsyncIOMotorClient(mongodb_uri)
    db = client[db_name]
    
    bots_collection = db.bots
    # Get first bot config (assuming there's at least one)
    bot = await bots_collection.find_one({})
    
    client.close()
    
    if bot and bot.get("webhook_url"):
        return bot.get("webhook_url").strip().rstrip('/')
    return None


def test_webhook_url(webhook_url, order_id="test"):
    """Test if webhook URL is accessible"""
    print(f"\n{'='*60}")
    print(f"TESTING WEBHOOK ACCESSIBILITY")
    print(f"{'='*60}\n")
    
    # Build full webhook URL
    if not webhook_url:
        print("[ERROR] No webhook URL configured!")
        return False
    
    # Remove /webhook suffix if present (Telegram webhook, not payment webhook)
    if webhook_url.endswith("/webhook"):
        webhook_url = webhook_url[:-8]
    
    webhook_url = webhook_url.strip().rstrip('/')
    test_url = f"{webhook_url}/payment/cryptapi-webhook?order_id={order_id}"
    
    print(f"Webhook Base URL: {webhook_url}")
    print(f"Test URL: {test_url}")
    print(f"\nTesting accessibility...\n")
    
    # Test 1: Basic GET request (simulating CryptAPI)
    print("Test 1: GET request (CryptAPI format)...")
    try:
        # Use a realistic User-Agent (CryptAPI likely uses something generic)
        headers = {
            'User-Agent': 'CryptAPI/1.0',
            'Accept': '*/*'
        }
        
        response = requests.get(test_url, headers=headers, timeout=10, allow_redirects=False)
        print(f"  Status Code: {response.status_code}")
        print(f"  Response: {response.text[:200]}")
        
        # Check if we got redirected to a Cloudflare landing page
        if response.status_code in [301, 302, 307, 308]:
            redirect_url = response.headers.get('Location', 'N/A')
            print(f"  Redirect Location: {redirect_url}")
            if 'trycloudflare.com' in redirect_url or 'challenges.cloudflare' in response.text:
                print(f"  [ERROR] Cloudflare landing page blocking - CryptAPI cannot reach webhook!")
                print(f"  [INFO] Cloudflare tunnels show a landing page that blocks automated requests")
                return False
            print(f"  [WARNING] Webhook redirected (might be an issue)")
            return False
        elif response.status_code == 403:
            print(f"  [ERROR] Access forbidden - Cloudflare or firewall blocking")
            print(f"  [INFO] This is likely why CryptAPI cannot reach your webhook!")
            return False
        elif response.status_code == 404:
            # Check if the 404 is from our webhook handler (good) or Cloudflare (bad)
            if 'Order not found' in response.text or 'Missing order_id' in response.text:
                print(f"  [OK] Webhook handler is accessible! (404 because test order doesn't exist)")
                print(f"  [OK] CryptAPI should be able to reach this webhook")
                return True
            else:
                print(f"  [ERROR] Webhook endpoint not found")
                return False
        elif response.status_code == 200:
            print(f"  [OK] Webhook is accessible via GET")
            return True
        else:
            print(f"  [WARNING] Unexpected status code: {response.status_code}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"  [ERROR] Request timed out - webhook is not accessible")
        return False
    except requests.exceptions.ConnectionError:
        print(f"  [ERROR] Connection failed - webhook URL is not reachable")
        print(f"  [INFO] Check if the tunnel/server is running")
        return False
    except Exception as e:
        print(f"  [ERROR] {type(e).__name__}: {str(e)}")
        return False


def analyze_webhook_url(webhook_url):
    """Analyze webhook URL for potential issues"""
    print(f"\n{'='*60}")
    print(f"WEBHOOK URL ANALYSIS")
    print(f"{'='*60}\n")
    
    if not webhook_url:
        print("[ERROR] No webhook URL configured!")
        return
    
    parsed = urlparse(webhook_url)
    
    print(f"Protocol: {parsed.scheme}")
    print(f"Domain: {parsed.netloc}")
    print(f"Path: {parsed.path}")
    
    # Check for known issues
    issues = []
    warnings = []
    
    if parsed.netloc.endswith('.trycloudflare.com'):
        warnings.append("Using Cloudflare tunnel - may have reliability issues")
        warnings.append("  - Cloudflare tunnels may require browser interaction")
        warnings.append("  - Some services block .trycloudflare.com domains")
        warnings.append("  - Consider using ngrok or a permanent domain")
    
    if parsed.netloc.endswith('.ngrok.io'):
        warnings.append("Using ngrok free tier - URL changes on restart")
        warnings.append("  - Free ngrok URLs expire after 2 hours")
        warnings.append("  - Use ngrok authtoken for persistent URLs")
    
    if parsed.scheme != 'https':
        issues.append("Using HTTP instead of HTTPS - CryptAPI requires HTTPS")
    
    if 'localhost' in parsed.netloc or '127.0.0.1' in parsed.netloc:
        issues.append("Using localhost - not accessible from external services")
    
    if issues:
        print(f"\n[ISSUES FOUND]:")
        for issue in issues:
            print(f"  [X] {issue}")
    
    if warnings:
        print(f"\n[WARNINGS]:")
        for warning in warnings:
            print(f"  [!] {warning}")
    
    if not issues and not warnings:
        print(f"\n[OK] Webhook URL looks good!")


async def main():
    print(f"\n{'='*60}")
    print(f"WEBHOOK ACCESSIBILITY TEST")
    print(f"{'='*60}")
    
    # Get webhook URL from environment or database
    webhook_url = os.getenv("WEBHOOK_URL", "").strip()
    
    if not webhook_url:
        print("\n[INFO] WEBHOOK_URL not found in .env, checking database...")
        webhook_url = await get_webhook_url_from_db()
    
    if not webhook_url:
        print("\n[ERROR] No webhook URL found in environment or database!")
        print("\nTo fix:")
        print("  1. Set WEBHOOK_URL in .env file, or")
        print("  2. Configure webhook_url in bot settings via admin panel")
        return
    
    # Analyze URL
    analyze_webhook_url(webhook_url)
    
    # Test accessibility
    is_accessible = test_webhook_url(webhook_url)
    
    print(f"\n{'='*60}")
    print(f"RECOMMENDATIONS")
    print(f"{'='*60}\n")
    
    if not is_accessible:
        print("[FIX NEEDED] Webhook is not accessible from external services")
        
        if webhook_url and 'trycloudflare.com' in webhook_url:
            print("\n[CRITICAL] Cloudflare tunnel is blocking automated requests!")
            print("Cloudflare tunnels show a landing page that requires browser interaction.")
            print("CryptAPI cannot click through this landing page, so webhooks will fail.")
            print("\n[SOLUTION] Switch to ngrok (recommended for development):")
            print("  1. Download ngrok: https://ngrok.com/download")
            print("  2. Run: ngrok http 8000")
            print("  3. Copy the HTTPS URL (e.g., https://abc123.ngrok.io)")
            print("  4. Update WEBHOOK_URL in .env file:")
            print("     WEBHOOK_URL=https://abc123.ngrok.io")
            print("  5. Restart your bot")
            print("  6. Create a new payment to test (old payments won't work)")
            print("\nNote: ngrok free URLs change on restart. For production, use a permanent domain.")
        else:
            print("\nSolutions:")
            print("  1. Check if tunnel/service is running")
            print("  2. Verify firewall/security settings")
            print("  3. For production, use a permanent domain with HTTPS")
    else:
        print("[OK] Webhook appears to be accessible")
        print("\nIf CryptAPI still doesn't call the webhook:")
        print("  1. Wait a few more minutes after payment confirmation")
        print("  2. Check CryptAPI logs/docs for webhook retry behavior")
        print("  3. Verify payment amount matches exactly (exchanges may deduct fees)")
        print("  4. Ensure payment has required confirmations (1 for LTC)")
    
    print(f"\n{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
