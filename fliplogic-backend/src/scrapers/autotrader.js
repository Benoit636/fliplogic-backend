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

  if (!year || !make) {
    throw new Error('Year and make are required');
  }

  let browser;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // Docker/Railway containers give /dev/shm a tiny default size
          // (64MB), which is too small for Chrome's shared memory use on
          // image-heavy pages like AutoTrader's listings — this makes
          // Chrome fall back to disk instead of crashing the renderer.
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        // On Alpine (production), puppeteer's own bundled Chromium can't
        // run — the Dockerfile installs the system `chromium` package and
        // points this at it instead. Locally/on glibc this is unset, so
        // puppeteer falls back to its own downloaded browser.
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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

      // Wait for listings to load. `.list-page-item` is AutoTrader's real,
      // human-readable class name for each result card — verified against
      // the live site. Their other classes are CSS-module hashes
      // (e.g. `ListItem_article__qyYw7`) that change on every deploy, so
      // this is the more stable thing to key off.
      await page.waitForSelector('.list-page-item', { timeout: 15000 });

      // Extract listing data by recognizing the *shape* of each field
      // (a dollar amount, a "X,XXX km" figure, a "City, PR" location)
      // within a card's text, rather than exact attribute names — more
      // resilient to markup changes than guessing hidden test ids.
      const comparables = await page.evaluate(({ targetMileage, targetYear, targetMake, targetModel }) => {
        const listings = [];
        const cards = document.querySelectorAll('.list-page-item');
        const makeLower = targetMake.toLowerCase();
        const modelLower = targetModel ? targetModel.toLowerCase() : null;

        cards.forEach((card) => {
          try {
            const text = card.innerText || card.textContent || '';
            const textLower = text.toLowerCase();

            // Safety net: the search URL should already scope results to
            // this make/model, but never trust that alone — reject
            // anything whose card text doesn't actually mention the make
            // (and model, when known) being searched for.
            if (!textLower.includes(makeLower)) return;
            if (modelLower && !textLower.includes(modelLower)) return;

            const yearMatch = text.match(/\b(19|20)\d{2}\b/);
            const listingYear = yearMatch ? parseInt(yearMatch[0], 10) : null;
            if (listingYear !== null && Math.abs(listingYear - targetYear) > 1) return;

            const priceMatch = text.match(/\$\s?([\d,]{4,})/);
            if (!priceMatch) return;
            const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            if (!price || price < 500) return;

            const mileageMatch = text.match(/([\d,]+)\s*km\b/i);
            const listingMileage = mileageMatch
              ? parseInt(mileageMatch[1].replace(/,/g, ''), 10)
              : null;

            // Filter by mileage (±50,000 km of target) when we have a
            // mileage figure; keep the listing if we couldn't find one
            // rather than discarding it on unparseable data.
            if (listingMileage !== null && Math.abs(listingMileage - targetMileage) > 50000) {
              return;
            }

            const headingEl = card.querySelector('h2, h3');
            const linkEl = card.querySelector('a[href]');
            const locationMatch = text.match(/([A-Z][a-zA-Z.\s]+,\s?[A-Z]{2})\b/);

            listings.push({
              title: headingEl?.textContent.trim() || text.split('\n')[0]?.trim().slice(0, 80) || 'Unknown',
              price,
              mileage: listingMileage,
              location: locationMatch ? locationMatch[1].trim() : 'Unknown',
              url: linkEl?.href || '',
              source: 'autotrader',
              scrapedAt: new Date().toISOString(),
            });
          } catch (err) {
            // Skip problematic listings
          }
        });

        return listings;
      }, { targetMileage: mileage, targetYear: year, targetMake: make, targetModel: model });

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
 *
 * AutoTrader puts make/model in the URL *path*, not query params — e.g.
 * a real search for a Ford Escape near Dieppe, NB is:
 *   https://www.autotrader.ca/cars/ford/escape/reg_nb/cit_dieppe?...
 * (confirmed against the live site; an earlier version of this function
 * guessed `mkm=`/`sts=` query params that don't exist, silently landing on
 * an unfiltered listings page and returning unrelated vehicles).
 *
 * Radius is `zipr` in km (confirmed by comparing the live site's URL
 * before/after changing its distance filter from the default 100km to
 * 250km — `zipr=250` appeared). Without it, AutoTrader defaults to a
 * ~100km radius, which was cutting the comparable pool down to just a
 * couple of listings even when an appraisal asked for a much wider search.
 * `size` requests more results per page (confirmed present at 20 in that
 * same URL) rather than relying on however many the default page holds.
 *
 * Location is hardcoded to the Dieppe/Moncton, NB area since that's this
 * app's only dealership location. Year isn't a URL-filterable param we've
 * confirmed, so it's enforced client-side in the scrape instead (see
 * targetYear check above). `mcat`/`search_id`/`source` seen on the live
 * site look like category/session tracking rather than real filters, so
 * they're left out.
 *
 * @param {number} year - Vehicle year
 * @param {string} make - Vehicle make
 * @param {string} model - Vehicle model
 * @param {number} radiusKm - Search radius in km
 * @returns {string} Search URL
 */
function buildAutoTraderUrl(year, make, model, radiusKm) {
  const pathSegments = ['cars', slugify(make)];
  if (model) pathSegments.push(slugify(model));
  pathSegments.push('reg_nb', 'cit_dieppe');

  const params = new URLSearchParams({
    offer: 'N,U',
    ustate: 'N,U',
    cy: 'CA',
    zip: 'E1A7X9 Dieppe',
    zipr: Math.round(radiusKm).toString(),
    lat: '46.075922',
    lon: '-64.687669',
    atype: 'C',
    search_type: 'C',
    size: '20',
  });

  return `https://www.autotrader.ca/${pathSegments.join('/')}?${params.toString()}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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
