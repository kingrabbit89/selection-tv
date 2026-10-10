import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';

const {chromium, firefox} = createRequire(import.meta.url)('playwright');
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'data/manifest.json'), 'utf8'));
const weeks = [...new Set([manifest.latest, '2026-S42', '2026-S41'])];
const privateSelector = '.jellyfin-private-uploads-page';
const cardSelector = '.jellyfin-private-upload';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/PcAAAAASUVORK5CYII=', 'base64');
const types = {'.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html; charset=utf-8'};
// Exact installed wrapper from 77c7f838, before S42. This is deliberately not
// the maintained parent with one helper deleted: deployed Jellyfin copies do
// not acquire our new visibility hooks or status messages when Pages updates.
const historicalParent = await readFile(resolve(root, 'scripts/fixtures/jellyfin-selection-tv-pre-s42.html'));
assert.equal(createHash('sha256').update(historicalParent).digest('hex'),
  'fd7efb94261aed4c5c5f981a5640143cd18f0cd8c41bf37bd1e417485f7b245b', 'historical installed wrapper must remain frozen');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/SelectionTv/Uploads') {
    res.writeHead(503, {'Content-Type': 'application/problem+json'});
    res.end(JSON.stringify({title: 'Selection TV private uploads unavailable', status: 503,
      detail: url.searchParams.get('fixture') === 'private-error'
        ? 'PRIVATE_DIAGNOSTIC_DO_NOT_FORWARD' : 'Connexion Forumactif refusée ou session non authentifiée.'}));
    return;
  }
  const file = resolve(root, '.' + decodeURIComponent(url.pathname).replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + '/')) {res.writeHead(403); res.end(); return;}
  try {res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));}
  catch {res.writeHead(404); res.end();}
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

async function mount(browser, week, {hidden = false, standalone = false, historical = false, apiDelay = 0, feedDelay = 0, feedMode = 'items'} = {}) {
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const errors = [], httpFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/SelectionTv/Uploads') httpFailures.push(response);
  });
  await page.addInitScript(({apiDelay, feedDelay, feedMode}) => {
    if (window.top !== window) return;
    window.__privateFixture = {mode: feedMode, delay: feedDelay, calls: 0};
    const item = {Id: 'jf-private-paris-texas', Name: 'Paris, Texas', OriginalTitle: 'Paris, Texas',
      ProductionYear: 1984, ProviderIds: {Imdb: 'tt0087884', Tmdb: '655'}, Type: 'Movie',
      UserData: {Played: false}, MediaSources: [{Width: 1920, Height: 1080}],
      Genres: ['Drame'], People: [{Type: 'Director', Name: 'Wim Wenders'}], CommunityRating: 8.1};
    const fixtureApi = {
      serverId: () => 'private-fixture-server', serverAddress: () => 'http://jellyfin.local',
      getCurrentUserId: () => 'private-fixture-user',
      getImageUrl: () => 'https://images.example.test/private-poster.png',
      getUrl: path => '/' + String(path).replace(/^\//, ''),
      getItems: async (_user, options = {}) => options.SearchTerm || !Number(options.StartIndex || 0)
        ? {Items: [structuredClone(item)], TotalRecordCount: 1} : {Items: [], TotalRecordCount: 1},
      ajax: async options => {
        if (String(options.url).includes('SelectionTv/Uploads')) {
          const {mode, delay} = window.__privateFixture; window.__privateFixture.calls++;
          if (delay > 0) await new Promise(done => setTimeout(done, delay));
          if (delay < 0) await new Promise(done => {window.__privateFixture.releaseFeed = done;});
          if (mode === 'error') throw Error('Fixture private feed unavailable');
          if (mode === 'auth-error' || mode === 'private-error') {
            // Official jellyfin-apiclient v1.11.0 (used by Web 10.11.11)
            // ajax() rejects a failed fetch with its unconsumed native Response.
            // Exercise a real HTTP 503 body instead of a generic Error mock.
            const response = await fetch(options.url + '?fixture=' + mode);
            if (response.status >= 400) throw response;
            return response.json();
          }
          return {Items: mode === 'empty' ? [] : [{TopicTitle: 'Paris Texas 1984 1080p',
            TitleGuess: 'Paris, Texas', TopicUrl: 'https://forum.example.test/private-paris-texas',
            ActivityAt: new Date().toISOString(), Year: 1984}], WindowHours: 24, GeneratedAt: new Date().toISOString()};
        }
        if (String(options.url).includes('SelectionTv/Enrich')) return {ImdbRating: '8,1'};
        return [];
      }
    };
    if (apiDelay) setTimeout(() => {window.ApiClient = fixtureApi;}, apiDelay);
    else window.ApiClient = fixtureApi;
  }, {apiDelay, feedDelay, feedMode});
  const weeklyUrl = `https://kingrabbit89.github.io/selection-tv/semaines/${week}/`;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (historical && url.pathname === '/integrations/jellyfin/selection-tv.html') {
        let body = historicalParent.toString('utf8');
        if (hidden) body = body.replace('id="selectionTvFrame"', 'id="selectionTvFrame" style="display:none"');
        await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body});
      } else if (standalone && url.pathname === '/private-fixture.html') {
        await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
          <style>#selectionTvFrame{width:100%;height:750px;border:0}</style><div id="selectionTvBridgeStatus"></div>
          <iframe id="selectionTvFrame" src="${weeklyUrl}"></iframe><script src="/assets/js/jellyfin-private-uploads.js"><\/script>`});
      } else if (hidden && url.pathname === '/integrations/jellyfin/selection-tv.html') {
        const body = (await readFile(resolve(root, 'integrations/jellyfin/selection-tv.html'), 'utf8'))
          .replace('id="selectionTvFrame"', 'id="selectionTvFrame" style="display:none"');
        await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body});
      } else await route.continue();
      return;
    }
    if (url.origin === 'https://kingrabbit89.github.io' && url.pathname.startsWith('/selection-tv/')) {
      if (url.pathname === '/selection-tv/latest.html') {
        await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><script>location.replace(' + JSON.stringify(weeklyUrl) + ')<\/script>'});
        return;
      }
      const file = resolve(root, '.' + url.pathname.slice('/selection-tv'.length).replace(/\/$/, '/index.html'));
      if (!file.startsWith(root + '/')) {await route.abort(); return;}
      try {
        let body = await readFile(file);
        if (url.pathname.endsWith('/issue-loader.js')) {
          // Reproduce an installed/cached shell predating the shared formatter.
          body = Buffer.from(body.toString('utf8').replace(/^.*await addScript\(root\+'assets\/js\/rating-format\.js[^\n]*\n/m, ''));
        }
        await route.fulfill({status: 200, contentType: types[extname(file)] || 'application/octet-stream', body});
      } catch {await route.fulfill({status: 404, body: 'missing'});}
      return;
    }
    if (/\.(?:png|jpg|jpeg|webp)(?:$|\?)/i.test(url.pathname) || url.hostname === 'images.example.test') {
      await route.fulfill({status: 200, contentType: 'image/png', body: image});
    } else await route.abort();
  });
  await page.goto(origin + (standalone ? '/private-fixture.html' : '/integrations/jellyfin/selection-tv.html'), {waitUntil: 'domcontentloaded'});
  await page.locator('#selectionTvFrame').waitFor({state: 'attached'});
  await page.waitForFunction(url => [...document.querySelectorAll('iframe')].some(frame => frame.src.includes('latest.html') || frame.src === url), weeklyUrl);
  let child;
  for (let attempt = 0; attempt < 100; attempt++) {
    child = page.frames().find(frame => frame.url().startsWith(weeklyUrl));
    if (child) break;
    await page.waitForTimeout(50);
  }
  assert(child, `private fixture failed to reach ${week}`);
  await child.locator('.book').waitFor({state: 'attached'});
  return {page, child, errors, httpFailures};
}

async function retry(page, child, mode, delay = 0) {
  await page.evaluate(({mode, delay}) => Object.assign(window.__privateFixture, {mode, delay}), {mode, delay});
  const before = await page.evaluate(() => window.__privateFixture.calls);
  // The provisional card can precede the end of its metadata pass. A retry
  // during that pass is intentionally ignored, so wait for a real new fetch.
  for (let attempt = 0; attempt < 20; attempt++) {
    await child.evaluate(() => parent.postMessage({type: 'selection-tv:jellyfin-private-retry', version: 1}, '*'));
    try {
      await page.waitForFunction(count => window.__privateFixture.calls > count, before, {timeout: 200});
      return;
    } catch (error) {if (attempt === 19) throw error;}
  }
}

async function checkHistoricalParent(browser, name, scenario) {
  const options = {historical: true,
    ...(scenario === 'hidden' ? {hidden: true} : {}),
    ...(scenario === 'late-api' ? {apiDelay: 5200} : {}),
    ...(scenario === 'slow' ? {feedDelay: -1} : {})};
  const week = scenario === 'fast' ? '2026-S42' : '2026-S41';
  const {page, child, errors} = await mount(browser, week, options);
  try {
    if (scenario === 'hidden') {
      await page.waitForTimeout(4200);
      assert.equal(await page.evaluate(() => window.__privateFixture.calls), 0, 'historical hidden parent must not fetch before it is visible');
      await page.locator('#selectionTvFrame').evaluate(frame => {frame.style.display = 'block';});
      // Deliberately dispatch no focus/visibility event: the old installed
      // parent has neither new handler, and the user is already in this tab.
      await child.locator(cardSelector).first().waitFor({state: 'attached', timeout: 5000});
    } else if (scenario === 'late-api') {
      await child.locator(cardSelector).first().waitFor({state: 'attached', timeout: 8500});
    } else if (scenario === 'slow') {
      await page.waitForFunction(() => window.__privateFixture.calls === 1);
      await page.waitForTimeout(9500);
      assert.equal(await child.locator(cardSelector).count(), 0, 'the historical slow feed must still be pending');
      assert.notEqual(await child.locator(privateSelector).first().getAttribute('data-private-state'), 'error',
        'absence of legacy status messages must not falsely declare a broken private transport at eight seconds');
      assert.doesNotMatch(await child.locator(privateSelector).first().textContent(), /n.a pas encore transmis|n.a pas pu être affiché/i,
        'a pending historical API call must retain an honest loading state');
      await child.evaluate(() => {
        parent.postMessage({type: 'selection-tv:jellyfin-private-retry', version: 1}, '*');
        parent.postMessage({type: 'selection-tv:jellyfin-private-ready', version: 1}, '*');
      });
      assert.equal(await page.evaluate(() => window.__privateFixture.calls), 1, 'legacy ready/retry must not duplicate an unfinished API call');
      await page.evaluate(() => window.__privateFixture.releaseFeed());
      await child.locator(cardSelector).first().waitFor({state: 'attached', timeout: 6000});
    } else await child.locator(cardSelector).first().waitFor({state: 'attached', timeout: 10000});
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__privateFixture.calls), 1, 'repeated legacy handshakes must not refetch the same successful feed');
    assert.deepEqual(errors, [], `${name} frozen parent ${scenario} errors`);
    console.log(`✓ ${name}: exact pre-S42 installed parent (${scenario}), current ${week} reader, one private API call`);
  } finally {await page.close();}
}

async function checkForumAuthenticationError(browser, name, week) {
  const {page, child, errors, httpFailures} = await mount(browser, week, {feedMode: 'auth-error'});
  try {
    assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8', 'the parent fixture must use the Jellyfin Web document encoding');
    await child.waitForFunction(() => document.querySelector('.jellyfin-private-uploads-page')?.dataset.privateState === 'error');
    assert.equal(httpFailures.length, 1, 'the diagnostic must come from a real HTTP response');
    assert.equal(httpFailures[0].status(), 503);
    assert.match((await httpFailures[0].json()).detail, /Connexion Forumactif refusée/);
    assert.match(await child.locator(privateSelector).first().textContent(), /Connexion au forum refusée/);
    assert.doesNotMatch(await child.locator(privateSelector).first().textContent(), /Actualisation|Connexion au flux privé/,
      'a rejected login must leave the loading state immediately');
    assert.equal(await child.locator('.private-retry').count(), 1);
    await child.evaluate(() => parent.postMessage({type: 'selection-tv:jellyfin-private-ready', version: 1}, '*'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__privateFixture.calls), 1,
      'a repeated handshake must resend the settled error instead of retrying the failed login');
    await retry(page, child, 'private-error');
    await child.waitForFunction(() => /momentanément indisponible/.test(document.querySelector('.jellyfin-private-uploads-page')?.textContent || ''));
    assert.doesNotMatch(await child.locator(privateSelector).first().textContent(), /PRIVATE_DIAGNOSTIC_DO_NOT_FORWARD/,
      'unrecognised private response details must stay inside the parent');
    await page.evaluate(() => Object.assign(window.__privateFixture, {mode: 'items'}));
    await child.locator('.private-retry').click();
    await child.locator(cardSelector).first().waitFor({state: 'attached'});
    const title = await child.locator(cardSelector + ' h3').first().textContent();
    await retry(page, child, 'auth-error');
    await child.waitForFunction(() => document.querySelector('.jellyfin-private-uploads-page')?.dataset.privateState === 'error');
    assert.equal(await child.locator(cardSelector + ' h3').first().textContent(), title,
      'authentication failures must retain the last received private cards');
    assert.match(await child.locator(privateSelector).first().textContent(), /Connexion au forum refusée/);
    assert.deepEqual(errors, [], `${name} ${week} actual HTTP 503 page errors`);
    console.log(`✓ ${name} ${week}: actual HTTP 503 gives a private-safe login diagnostic, clears loading and preserves previous cards`);
  } finally {await page.close();}
}

// Targeted reproduction aid; the required CI invocation has no selector and
// therefore runs every maintained-parent and frozen-parent scenario.
const historicalOnly = process.argv.includes('--historical-only');
const selectedHistorical = process.argv.find(arg => arg.startsWith('--historical-case='))?.split('=')[1];
if (selectedHistorical) assert(['fast', 'hidden', 'late-api', 'slow'].includes(selectedHistorical), 'unknown historical scenario');
let browser;
try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
    browser = await engine.launch({headless: true});
    if (!historicalOnly && !selectedHistorical) {
    for (const week of weeks) await checkForumAuthenticationError(browser, name, week);
    for (const week of weeks) {
      const {page, child, errors} = await mount(browser, week);
      try {
        await child.locator(cardSelector).first().waitFor({state: 'attached'});
        assert.equal(await child.locator('#sommaire [data-jellyfin-private="1"]').count(), 1, 'private section remains in the contents');
        await child.waitForFunction(() => typeof window.SelectionTVRatingFormat?.entries === 'function');
        await child.locator(cardSelector + ' .rating-pill').first().waitFor({state: 'attached'});
        const title = await child.locator(cardSelector + ' h3').first().textContent();
        await retry(page, child, 'error', 700);
        await child.waitForFunction(() => document.querySelector('.jellyfin-private-uploads-page')?.dataset.privateState === 'loading');
        assert.equal(await child.locator(cardSelector + ' h3').first().textContent(), title, 'refresh must retain the existing card while loading');
        await child.waitForFunction(() => document.querySelector('.jellyfin-private-uploads-page')?.dataset.privateState === 'error');
        assert.equal(await child.locator(cardSelector + ' h3').first().textContent(), title, 'failed refresh must retain the last received card');
        assert.match(await child.locator(privateSelector).first().textContent(), /indisponible|dernier flux/i);
        await retry(page, child, 'empty');
        await child.waitForFunction(() => document.querySelector('.jellyfin-private-uploads-page')?.dataset.privateState === 'empty');
        assert.equal(await child.locator(cardSelector).count(), 0, 'an authoritative empty feed removes expired cards');
        assert.equal(await child.locator(privateSelector).count(), 1, 'an empty feed must retain an explanatory section');
        assert.equal(await child.locator('#sommaire [data-jellyfin-private="1"]').count(), 1, 'an empty feed must retain the contents entry');
        await page.evaluate(() => Object.assign(window.__privateFixture, {mode: 'items', delay: 0}));
        await child.locator('.private-retry').click();
        await child.locator(cardSelector).first().waitFor({state: 'attached'});
        assert.deepEqual(errors, [], `${name} ${week} private page errors`);
        console.log(`✓ ${name} ${week}: legacy loader without formatter, preserved cards during loading/error, empty state and actual retry button`);
      } finally {await page.close();}
    }
    const late = await mount(browser, '2026-S42', {hidden: true});
    try {
      await late.page.waitForTimeout(4000);
      assert.equal(await late.page.evaluate(() => window.__privateFixture.calls), 0, 'a hidden Plugin Pages view must not fetch the private feed');
      await late.page.locator('#selectionTvFrame').evaluate(frame => {frame.style.display = 'block';});
      await late.child.locator(cardSelector).first().waitFor({state: 'attached', timeout: 5000});
      assert(await late.page.evaluate(() => window.__privateFixture.calls) > 0, 'making the iframe visible must resume the feed without the ten-minute timer');
      assert.deepEqual(late.errors, [], `${name} late visibility page errors`);
      console.log(`✓ ${name}: iframe visible after startup timers immediately resumes private uploads`);
    } finally {await late.page.close();}
    const old = await mount(browser, '2026-S41', {standalone: true});
    try {
      assert.equal(await old.page.evaluate(() => typeof window.SelectionTvSessionCurrent), 'undefined', 'legacy standalone fixture must omit the new parent helper');
      await old.child.locator(cardSelector).first().waitFor({state: 'attached'});
      assert.deepEqual(old.errors, [], `${name} standalone parent page errors`);
      console.log(`✓ ${name}: standalone legacy parent without session helper retains its private uploads`);
    } finally {await old.page.close();}
    }
    for (const scenario of selectedHistorical ? [selectedHistorical] : ['fast', 'hidden', 'late-api', 'slow']) {
      await checkHistoricalParent(browser, name, scenario);
    }
    await browser.close(); browser = null;
  }
} finally {await browser?.close(); await new Promise(done => server.close(done));}
