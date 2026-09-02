import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/15343/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const baseUrl = process.env.CONSOLE_URL ?? 'http://127.0.0.1:1420';
const outputDir = resolve('artifacts');
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});

const context = await browser.newContext({
  viewport: { width: 1180, height: 760 },
  deviceScaleFactor: 1.5,
  colorScheme: 'light',
});
const page = await context.newPage();
const browserErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(message.text());
});
page.on('pageerror', (error) => browserErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.getByText('桌宠控制台', { exact: true }).waitFor();
await page.getByRole('heading', { name: /正在桌面陪伴你/ }).waitFor();
await page.getByRole('button', { name: '桌宠管理' }).click();
await page.getByRole('heading', { name: '选择今天陪伴你的角色' }).waitFor();

const initialLayout = await page.evaluate(() => ({
  bodyWidth: document.body.scrollWidth,
  viewportWidth: document.documentElement.clientWidth,
  contentWidth: document.querySelector('.content-area')?.scrollWidth ?? 0,
  contentClientWidth: document.querySelector('.content-area')?.clientWidth ?? 0,
}));

await page.screenshot({ path: resolve(outputDir, '01-pet-management.png'), fullPage: true });

const petCards = page.locator('.pet-list-card');
await petCards.nth(1).getByRole('button', { name: /切换/ }).click();
await page.getByText(/已切换到 星野/).waitFor();
const activePetId = await page.evaluate(() => {
  const raw = localStorage.getItem('desktop-pet-console:v1');
  return raw ? JSON.parse(raw).activePetId : null;
});

await page.getByRole('button', { name: '模型连接' }).click();
await page.getByRole('heading', { name: '配置 OpenAI 兼容模型' }).waitFor();
const modelScrollAfterNavigation = await page.locator('.content-area').evaluate((element) => element.scrollTop);
await page.locator('input[name="llm-api-key"]').fill('smoke-secret-never-persist');
await page.getByRole('button', { name: '测试连接' }).click();
await page.getByText(/连接成功/).waitFor();
const modelScrollAfterTest = await page.locator('.content-area').evaluate((element) => element.scrollTop);
const storageContainsSecret = await page.evaluate(() =>
  Object.values(localStorage).some((value) => value.includes('smoke-secret-never-persist')),
);
await page.locator('.content-area').evaluate((element) => element.scrollTo({ top: 0 }));
await page.screenshot({ path: resolve(outputDir, '02-model-settings.png'), fullPage: true });

await page.getByRole('button', { name: '语音与唤醒' }).click();
await page.getByRole('heading', { name: '本地语音组件' }).waitFor();
await page.screenshot({ path: resolve(outputDir, '03-voice-settings.png'), fullPage: true });

await page.getByRole('button', { name: '桌面行为' }).click();
await page.getByRole('heading', { name: '控制桌宠如何停留与响应' }).waitFor();
const movementSwitch = page.getByRole('switch', { name: '允许桌宠自主移动' });
const autoWalkSwitch = page.getByRole('switch', { name: '待机自动散步' });
const movementDefaultEnabled = await movementSwitch.getAttribute('aria-checked') === 'true';
const autoWalkInitiallyAvailable = !(await autoWalkSwitch.isDisabled());
await movementSwitch.click();
const autoWalkDisabledWithMovement = await autoWalkSwitch.isDisabled();
await movementSwitch.click();
await page.screenshot({ path: resolve(outputDir, '04-behavior-settings.png'), fullPage: true });

await page.setViewportSize({ width: 960, height: 640 });
await page.getByRole('button', { name: '桌宠管理' }).click();
await page.getByRole('heading', { name: '选择今天陪伴你的角色' }).waitFor();
const minimumLayout = await page.evaluate(() => ({
  bodyWidth: document.body.scrollWidth,
  viewportWidth: document.documentElement.clientWidth,
  contentWidth: document.querySelector('.content-area')?.scrollWidth ?? 0,
  contentClientWidth: document.querySelector('.content-area')?.clientWidth ?? 0,
}));
await page.screenshot({ path: resolve(outputDir, '05-minimum-window.png'), fullPage: true });

await browser.close();

const result = {
  passed: browserErrors.length === 0
    && activePetId === 'pet-xingye'
    && !storageContainsSecret
    && movementDefaultEnabled
    && autoWalkInitiallyAvailable
    && autoWalkDisabledWithMovement
    && initialLayout.bodyWidth <= initialLayout.viewportWidth
    && initialLayout.contentWidth <= initialLayout.contentClientWidth
    && minimumLayout.bodyWidth <= minimumLayout.viewportWidth
    && minimumLayout.contentWidth <= minimumLayout.contentClientWidth,
  activePetId,
  storageContainsSecret,
  movementDefaultEnabled,
  autoWalkInitiallyAvailable,
  autoWalkDisabledWithMovement,
  modelScrollAfterNavigation,
  modelScrollAfterTest,
  initialLayout,
  minimumLayout,
  browserErrors,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
