import puppeteer from 'puppeteer';
import logger from '../config/logger.js';

/**
 * Scrape AutoTrader.ca for comparable vehicles
 * @param {string} vin - Vehicle VIN
 * @param {object} params - Search parameters
 * @returns {Promise<Array>} Array of comparable vehicles
 */
export async function scrapeAutoTrader(vin, params = {}) {
  const {
    year,
    make,
    model,
    mileage = 0,
    radiusKm = 400,
    maxRetries = 3,
  } = params;

  if (!year || !make || !model) {
    throw new Error('Year, make, and model are required');
  }

  let browser;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // Set user agent to avoid detection
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      // Build search URL
      const searchUrl = buildAutoTraderUrl(year, make, model, radiusKm);

      logger.info(`🔍 Scraping AutoTrader: ${searchUrl}`);

      // Navigate to page
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for listings to load
      await page.waitForSelector('[data-testid="listing"]', { timeout: 10000 });

      // Extract listing data
      const comparables = await page.evaluate((targetMileage) => {
        const listings = [];
        const elements = document.querySelectorAll('[data-testid="listing"]');

        elements.forEach((el) => {
          try {
            const titleEl = el.querySelector('h2, [data-testid="title"]');
            const priceEl = el.querySelector('[data-testid="price"]');
            const mileageEl = el.querySelector('[data-testid="mileage"]');
            const locationEl = el.querySelector('[data-testid="location"]');
            const linkEl = el.querySelector('a[href*="/listing/"]');

            if (titleEl && priceEl) {
              const price = parseInt(
                priceEl.textContent.replace(/[^0-9]/g, '')
              );
              const mileageText = mileageEl?.textContent || '0 km';
              const listingMileage = parseInt(mileageText.replace(/[^0-9]/g, ''));

              // Filter by mileage (±50,000 km of target)
              if (Math.abs(listingMileage - targetMileage) <= 50000) {
                listings.push({
                  title: titleEl.textContent.trim(),
                  price,
                  mileage: listingMileage,
                  location: locationEl?.textContent.trim() || 'Unknown',
                  url: linkEl?.href || '',
                  source: 'autotrader',
                  scrapedAt: new Date().toISOString(),
                });
              }
            }
          } catch (err) {
            // Skip problematic listings
          }
        });

        return listings;
      }, mileage);

      await browser.close();

      logger.info(`✅ AutoTrader scrape complete: ${comparables.length} listings found`);

      return comparables;
    } catch (error) {
      attempt++;
      logger.warn(
        `⚠️ AutoTrader scrape attempt ${attempt} failed:`,
        error.message
      );

      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          // Ignore close errors
        }
      }

      if (attempt >= maxRetries) {
        logger.error(`❌ AutoTrader scrape failed after ${maxRetries} attempts`);
        throw new Error(
          `Failed to scrape AutoTrader after ${maxRetries} attempts: ${error.message}`
        );
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}

/**
 * Build AutoTrader.ca search URL
 * @param {number} year - Vehicle year
 * @param {string} make - Vehicle make
 * @param {string} model - Vehicle model
 * @param {number} radiusKm - Search radius in km
 * @returns {string} Search URL
 */
function buildAutoTraderUrl(year, make, model, radiusKm) {
  const baseUrl = 'https://www.autotrader.ca/cars';
  const params = new URLSearchParams({
    mkm: `${make},${model}`,
    sts: year.toString(),
    rcs: Math.ceil(radiusKm / 1.60934).toString(), // Convert km to miles
    sort: 'price_asc',
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Normalize AutoTrader listings to standard format
 * @param {Array} listings - Raw listings
 * @returns {Array} Normalized listings
 */
export function normalizeAutoTraderListings(listings) {
  return listings.map((listing) => ({
    vin: listing.vin || '', // AutoTrader may not expose VIN
    year: extractYear(listing.title),
    make: extractMake(listing.title),
    model: extractModel(listing.title),
    price: listing.price,
    mileage: listing.mileage,
    location: listing.location,
    url: listing.url,
    source: 'autotrader',
    scrapedAt: listing.scrapedAt,
    condition: 'unknown', // Would need photo analysis
  }));
}

// Helper functions for parsing
function extractYear(title) {
  const match = title.match(/\b(\d{4})\b/);
  return match ? parseInt(match[1]) : null;
}

function extractMake(title) {
  const parts = title.split(' ');
  return parts[1] || '';
}

function extractModel(title) {
  const parts = title.split(' ');
  return parts.slice(2).join(' ');
}
