// Automated media capture: drives the real showcase repo with the extension
// loaded and produces the README assets.
//   npm run media
// Outputs (committed): media/01-docs-tab.png, media/02-reading.png,
// media/03-search.png, media/04-dark.png (all 16:9) and media/demo.gif.
// Requires: dist/ built, ffmpeg on PATH (for the GIF).
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const DIST = join(root, 'dist');
const MEDIA = join(root, 'media');
const REPO_URL = 'https://github.com/fwin-git/github-docs-tab';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('dist/ is not built — run: npm run build');
  process.exit(1);
}
let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
  console.warn('ffmpeg not found — screenshots only, no GIF.');
}

mkdirSync(MEDIA, { recursive: true });

// Each pass gets its own throwaway profile: viewer preferences (e.g. the
// dark-theme toggle in the stills pass) persist per profile and would leak
// into the video's starting state otherwise.
async function launchBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'gdt-media-'));
  const browser = await puppeteer.launch({
    headless: false, // extensions need full Chrome
    ignoreDefaultArgs: ['--disable-extensions'], // puppeteer disables them by default
    args: [
      `--load-extension=${DIST}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--window-size=1600,1000',
    ],
  });
  return { browser, profile };
}

async function openViewer(page, hash) {
  await page.goto(REPO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[data-gdt-tab-link]', { timeout: 45000 });
  if (hash) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForSelector('#gdt-root [data-gdt-article]', { timeout: 15000 });
  }
}

async function waitForIndex(page) {
  await page.waitForFunction(() => document.querySelector('#gdt-root [data-gdt-progress]')?.hidden === true, {
    timeout: 30000,
  });
}

// ---- pass 1: 16:9 stills at 2x ---------------------------------------------

{
  const { browser, profile } = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });

  await openViewer(page, null);
  await page.mouse.move(700, 650);
  await sleep(1000);
  await page.screenshot({ path: join(MEDIA, '01-docs-tab.png') });
  console.log('captured 01-docs-tab.png');

  await page.evaluate(() => (location.hash = '#docs/docs/installation.md'));
  await page.waitForSelector('#gdt-root .gdt-doc-title', { timeout: 15000 });
  await waitForIndex(page);
  await page.mouse.move(700, 650);
  await sleep(600);
  await page.screenshot({ path: join(MEDIA, '02-reading.png') });
  console.log('captured 02-reading.png');

  // Focus without the mouse: a real cursor path can open GitHub's own
  // hover menus behind the viewer and pollute the shot.
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#gdt-root .gdt-search-input').focus());
  await page.keyboard.type('frontmatter', { delay: 40 });
  await page.waitForSelector('#gdt-root .gdt-sr-item', { timeout: 10000 });
  await page.mouse.move(700, 650);
  await sleep(400);
  await page.screenshot({ path: join(MEDIA, '03-search.png') });
  console.log('captured 03-search.png');

  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const t = document.querySelector('#gdt-root [data-gdt-theme-toggle]');
    t.click();
    t.click(); // auto -> light -> dark
  });
  await page.evaluate(() => (location.hash = '#docs/docs/frontmatter.md'));
  await page.mouse.move(700, 650);
  await sleep(1200);
  await page.screenshot({ path: join(MEDIA, '04-dark.png') });
  console.log('captured 04-dark.png');
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

// ---- pass 2: screencast -> GIF ----------------------------------------------

if (hasFfmpeg) {
  const { browser, profile } = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const rawWebm = join(profile, 'demo-raw.webm');

  await page.goto(REPO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[data-gdt-tab-link]', { timeout: 45000 });
  await sleep(500);

  const recorder = await page.screencast({ path: rawWebm });
  await sleep(1200);

  await page.click('a[data-gdt-tab-link]'); // open the Docs tab
  await page.mouse.move(700, 650);
  await page.waitForSelector('#gdt-root [data-gdt-article]', { timeout: 15000 });
  await waitForIndex(page).catch(() => {});
  await sleep(1600);

  await page.click('[data-gdt-tree] a[data-gdt-tree-path="docs/installation.md"]');
  await page.mouse.move(700, 650);
  await sleep(1800);
  await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
  await sleep(1200);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(900);

  await page.click('[data-gdt-tree] a[data-gdt-tree-path="docs/frontmatter.md"]');
  await page.mouse.move(700, 650);
  await sleep(1800);

  await page.evaluate(() => document.querySelector('#gdt-root .gdt-search-input').focus());
  await sleep(400);
  await page.keyboard.type('wiki links', { delay: 110 });
  await sleep(1200);
  await page.keyboard.press('Enter');
  await sleep(1800);

  await page.evaluate(() => {
    const t = document.querySelector('#gdt-root [data-gdt-theme-toggle]');
    t.click();
    t.click();
  });
  // The screencast only receives frames while the page paints — keep it
  // animating after the theme switch so the dark tail survives stop().
  await sleep(600);
  await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
  await sleep(1400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(1400);

  await recorder.stop();
  await sleep(300);
  await page.close();

  execFileSync('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-i', rawWebm,
    '-vf', 'fps=9,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    join(MEDIA, 'demo.gif'),
  ]);
  console.log('captured demo.gif');
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log('media capture complete →', MEDIA);
