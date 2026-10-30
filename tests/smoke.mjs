import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForFunction(async () => { const reg = await navigator.serviceWorker?.getRegistration(); return !!reg?.active && reg.active.state === 'activated'; }, { timeout: 15000 });
  assert.match(await page.title(), /CLIVELLE/i);
  assert.ok(await page.locator('.product-card').count() >= 8, 'catalogue renders');
  assert.ok(await page.locator('.site-header .brand-logo').isVisible(), 'website brand logo renders');
  assert.ok(await page.locator('.announcement').isVisible(), 'website storefront header remains visible');

  // Product search and product detail
  await page.locator('#searchInput').fill('Rosewood');
  assert.equal(await page.locator('.product-card').count(), 1, 'product search filters catalogue');
  await page.locator('#searchInput').fill('');
  await page.locator('.product-name').first().click();
  assert.ok(await page.locator('#productModal.open').count(), 'product detail opens');
  await page.locator('#productModal [data-close]').click();

  // Hair accessory finder
  await page.locator('#openFinder').click();
  await page.locator('#finderForm button').click();
  assert.equal(await page.locator('#finderResults').isVisible(), true, 'finder returns recommendations');
  await page.locator('#finderModal [data-close]').click();

  // Colour finder (this previously crashed due to treating querySelector as a list)
  await page.locator('#colourFinder button[data-colour="Pearl"]').click();
  assert.match(await page.locator('#colourStatus').innerText(), /Pearl/i);
  assert.ok(await page.locator('.product-card').count() >= 1, 'colour filter returns matching items');

  // Bundle builder, account demo sign-in and bag total
  await page.locator('#colourFinder button[data-colour="All"]').click();
  await page.locator('#bundleChoices input').nth(0).check();
  await page.locator('#bundleChoices input').nth(1).check();
  assert.match(await page.locator('#bundleTotal').innerText(), /10% off/i);
  await page.locator('#addBundle').click();
  await page.locator('#authName').fill('Clivelle Tester');
  await page.locator('#authPhone').fill('9876543210');
  await page.locator('#acceptTerms').check();
  await page.locator('#authForm button').click();
  assert.equal(await page.locator('#bagDrawer.open').count(), 1, 'bundle opens bag after sign-in');
  assert.match(await page.locator('#bagSubtotal').innerText(), /430/, '10 percent bundle saving reaches bag total');
  await page.locator('#bagDrawer [data-close]').click();

  // Gift options persist and review can be submitted
  await page.locator('#giftWrap').check();
  await page.locator('#giftNoteEnabled').check();
  await page.locator('#giftMessage').fill('A little something lovely!');
  await page.locator('#saveGift').click();
  assert.match(await page.locator('#giftStatus').innerText(), /saved/i);
  await page.locator('#openReview').click();
  await page.locator('#reviewForm input[name=name]').fill('A Tester');
  await page.locator('#reviewForm textarea[name=message]').fill('Lovely quality and colour.');
  await page.locator('#reviewForm button').click();
  assert.equal(await page.locator('#reviewCount').innerText(), '1', 'review saved and feed refreshed');

  // Checkout, address validation, demo order and rewards
  await page.locator('#bagTrigger').click();
  await page.locator('#checkoutButton').click();
  await page.locator('#addAddressToggle').click();
  const address = page.locator('#addressForm');
  await address.locator('[name=name]').fill('Clivelle Tester');
  await address.locator('[name=phone]').fill('9876543210');
  await address.locator('[name=street]').fill('12 Test Street');
  await address.locator('[name=area]').fill('Test Colony');
  await address.locator('[name=city]').fill('New Delhi');
  await address.locator('[name=state]').fill('Delhi');
  await address.locator('[name=pin]').fill('110067');
  await address.locator('button').click();
  await page.locator('#placeOrder').click();
  assert.equal(await page.locator('#confirmationModal.open').count(), 1, 'demo order confirmation appears');
  assert.ok(Number(await page.locator('#rewardPoints').innerText()) > 0, 'rewards points credited after demo order');
  assert.deepEqual(errors, [], 'no uncaught JavaScript errors during website flow');
  await context.close();

  // Installed PWA / Capacitor app shell is visually distinct from the website.
  const appContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await appContext.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }));
  const appPage = await appContext.newPage();
  appPage.on('pageerror', e => errors.push(e.message));
  await appPage.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  assert.ok(await appPage.locator('html.clv-app-mode').count(), 'installed app mode detected');
  assert.equal(await appPage.locator('.announcement').isVisible().catch(() => false), false, 'app hides website announcement bar');
  assert.equal(await appPage.locator('.mobile-tabbar').evaluate(el => getComputedStyle(el).position), 'fixed', 'app has fixed native-style bottom navigation');
  assert.equal(await appPage.locator('.product-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2, 'app uses two-column shopping cards');
  const icon = await appPage.request.get('http://127.0.0.1:4173/clivelle-home-icon-v9.png');
  assert.equal(icon.status(), 200, 'unique iOS home-screen icon is served');
  assert.match(icon.headers()['content-type'] || '', /image\/png/i, 'home-screen icon is a PNG');
  assert.deepEqual(errors, [], 'no uncaught JavaScript errors in installed app shell');
  await appContext.close();

  // Verify the deployed GitHub Pages build, not only the local test server.
  const liveContext = await browser.newContext();
  const livePage = await liveContext.newPage();
  const liveHome = await livePage.request.get('https://ankit-97.github.io/Clivelle/');
  assert.equal(liveHome.status(), 200, 'published website responds');
  const liveHtml = await liveHome.text();
  assert.ok(liveHtml.includes('clivelle-home-icon-v9.png'), 'published page references the new iOS icon URL');
  const liveManifestResponse = await livePage.request.get('https://ankit-97.github.io/Clivelle/manifest.webmanifest');
  assert.equal(liveManifestResponse.status(), 200, 'published web manifest responds');
  const liveManifest = await liveManifestResponse.json();
  assert.ok(liveManifest.icons.some(icon => icon.src === './clivelle-home-icon-v9.png'), 'published manifest points to the new icon');
  const liveIcon = await livePage.request.get('https://ankit-97.github.io/Clivelle/clivelle-home-icon-v9.png');
  assert.equal(liveIcon.status(), 200, 'published unique home-screen icon responds');
  assert.ok((liveIcon.headers()['content-type'] || '').includes('image/png'), 'published home-screen icon has PNG content type');

  await liveContext.close();
  console.log('CLIVELLE SMOKE TESTS PASSED: website, search, product detail, finder, colour filter, bundle discount, sign-in, gift options, reviews, checkout, rewards, installed-app layout and PNG icon.');
} finally {
  await browser.close();
}
