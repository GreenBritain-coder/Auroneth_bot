/**
 * Exchange rate service for GBP to USD conversion.
 * Caches rates for 5 minutes to avoid excessive API calls.
 */

interface CachedRate {
  rate: number;
  fetchedAt: number;
}

let cachedRate: CachedRate | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FALLBACK_GBP_USD = 1.26; // Reasonable fallback if all APIs fail

export async function getGbpToUsdRate(): Promise<number> {
  // Return cached rate if still valid
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate.rate;
  }

  // Try Open Exchange Rates API (free tier)
  const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
  if (appId) {
    try {
      const res = await fetch(
        `https://openexchangerates.org/api/latest.json?app_id=${appId}&symbols=GBP`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        // OER returns rates relative to USD, so GBP rate = how many GBP per 1 USD
        // We want GBP->USD, so: 1 GBP = 1/rate USD
        const gbpPerUsd = data.rates?.GBP;
        if (gbpPerUsd && gbpPerUsd > 0) {
          const rate = 1 / gbpPerUsd;
          cachedRate = { rate, fetchedAt: Date.now() };
          return rate;
        }
      }
    } catch (e) {
      console.error('[ExchangeRate] Open Exchange Rates failed:', e);
    }
  }

  // Fallback: try exchangerate-api.com (free, no key needed)
  try {
    const res = await fetch(
      'https://api.exchangerate-api.com/v4/latest/GBP',
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const rate = data.rates?.USD;
      if (rate && rate > 0) {
        cachedRate = { rate, fetchedAt: Date.now() };
        return rate;
      }
    }
  } catch (e) {
    console.error('[ExchangeRate] exchangerate-api.com failed:', e);
  }

  // Use cached rate even if expired
  if (cachedRate) {
    console.warn('[ExchangeRate] Using expired cached rate:', cachedRate.rate);
    return cachedRate.rate;
  }

  // Last resort fallback
  console.warn('[ExchangeRate] All sources failed, using fallback rate:', FALLBACK_GBP_USD);
  return FALLBACK_GBP_USD;
}
