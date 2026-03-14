"""Quick script to check if amount meets CryptAPI minimum"""
import requests
import sys

amount = float(sys.argv[1]) if len(sys.argv) > 1 else 0.22
currency = sys.argv[2] if len(sys.argv) > 2 else "GBP"
to_currency = sys.argv[3] if len(sys.argv) > 3 else "LTC"

r = requests.get('https://api.cryptapi.io/convert', 
                 params={'value': str(amount), 'from': currency, 'to': to_currency}, 
                 timeout=5)

if r.status_code == 200:
    data = r.json()
    if data.get('status') == 'success':
        ltc_amount = float(data.get('value_coin', 0))
        min_ltc = 0.002  # CryptAPI minimum for LTC
        
        print(f"{currency} {amount} = {ltc_amount} {to_currency}")
        print(f"Minimum required: {min_ltc} {to_currency}")
        print()
        if ltc_amount >= min_ltc:
            print("RESULT: ABOVE minimum - Payment will work!")
        else:
            print(f"RESULT: BELOW minimum - Need at least {min_ltc} {to_currency}")
            # Calculate minimum GBP needed
            exchange_rate = float(data.get('exchange_rate', 0))
            if exchange_rate:
                min_gbp = min_ltc / exchange_rate
                print(f"You need at least {currency} {min_gbp:.2f} for this payment to work")
    else:
        print(f"Error: {data.get('error', 'Unknown error')}")
else:
    print(f"API error: {r.status_code}")
