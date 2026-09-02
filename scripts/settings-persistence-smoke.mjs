import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('C:/Users/15343/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const projectRoot = resolve('.');
const packaged = process.argv.includes('--packaged');
const executablePath = packaged
  ? resolve(process.env.DESKTOP_PET_EXECUTABLE ?? 'release/win-unpacked/桌宠.exe')
  : resolve('node_modules/electron/dist/electron.exe');
const profileDir = mkdtempSync(join(tmpdir(), 'desktop-pet-settings-smoke-'));
const settingsPath = join(profileDir, 'desktop-pet-data', 'console-settings.json');
const secretPath = join(profileDir, 'desktop-pet-data', 'model-api-key.bin');
const chatHistoryPath = join(profileDir, 'desktop-pet-data', 'chat-history.json');
const screenshotPath = resolve('artifacts', `model-settings-${packaged ? 'packaged' : 'dev'}-preview.png`);
const profileName = '持久化回归配置';
const secret = 'settings-secret-never-persist';
let electronApp;

if (!existsSync(executablePath)) throw new Error(`找不到待验证的桌宠入口：${executablePath}`);
mkdirSync(resolve('artifacts'), { recursive: true });

async function launch() {
  const args = packaged
    ? [`--user-data-dir=${profileDir}`]
    : [`--user-data-dir=${profileDir}`, projectRoot];
  const app = await electron.launch({ executablePath, args, cwd: projectRoot });
  await app.firstWindow();
  let consoleWindow;
  for (let attempt = 0; attempt < 80 && !consoleWindow; attempt += 1) {
    for (const targetWindow of app.windows()) {
      const pathname = new URL(targetWindow.url()).pathname.replaceAll('\\', '/');
      if (pathname.endsWith('/index.html')) consoleWindow = targetWindow;
    }
    if (!consoleWindow) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (!consoleWindow) throw new Error('桌宠控制台窗口未创建');
  try {
    await consoleWindow.getByText('已保存到本机', { exact: true }).waitFor({ timeout: 10000 });
  } catch {
    const saveIndicator = await consoleWindow.locator('.save-indicator').textContent().catch(() => '未渲染');
    throw new Error(`配置初始化未完成，当前状态：${saveIndicator?.trim()}`);
  }
  return { app, consoleWindow };
}

try {
  let session = await launch();
  electronApp = session.app;
  await session.consoleWindow.getByRole('button', { name: '模型连接' }).click();
  await session.consoleWindow.locator('input[name="llm-profile-name"]').fill(profileName);
  await session.consoleWindow.locator('input[name="llm-model-name"]').fill('desktop-pet-test-model');
  await session.consoleWindow.locator('input[name="llm-model-url"]').fill('https://example.com/v1');
  await session.consoleWindow.locator('input[name="llm-api-key"]').fill(secret);
  await session.consoleWindow.getByRole('button', { name: '安全保存 API Key' }).click();
  await session.consoleWindow.getByText('API Key 已使用当前 Windows 账户加密保存', { exact: true }).waitFor();
  await session.consoleWindow.getByRole('button', { name: '桌面行为' }).click();
  const movementSwitch = session.consoleWindow.getByRole('switch', { name: '允许桌宠自主移动' });
  await movementSwitch.click();
  const speechDuration = session.consoleWindow.locator('input[name="speech-bubble-seconds"]');
  await speechDuration.evaluate((input) => {
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const petScale = session.consoleWindow.locator('input[name="pet-scale"]');
  await petScale.evaluate((input) => {
    input.value = '1.15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await session.consoleWindow.getByText('已保存到本机', { exact: true }).waitFor();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  await session.consoleWindow.screenshot({ path: screenshotPath });
  await session.app.close();
  electronApp = undefined;

  if (!existsSync(settingsPath)) throw new Error('普通配置文件未写入用户数据目录');
  if (!existsSync(secretPath)) throw new Error('加密密钥文件未写入用户数据目录');
  const settingsBytes = readFileSync(settingsPath);
  const secretBytes = readFileSync(secretPath);
  const settingsJson = JSON.parse(settingsBytes.toString('utf8'));
  const plaintextAbsent = !settingsBytes.includes(Buffer.from(secret, 'utf8'))
    && !secretBytes.includes(Buffer.from(secret, 'utf8'));

  const memoryTimestamp = new Date().toISOString();
  writeFileSync(chatHistoryPath, `${JSON.stringify({
    version: 2,
    updatedAt: memoryTimestamp,
    conversations: [
      {
        petId: 'character-package:rem--l1',
        messages: [{ id: 'rem-recent-1', role: 'user', content: 'Rem 的近期消息', createdAt: memoryTimestamp }],
        memory: { summary: 'Rem 只记得用户喜欢冰淇淋。', updatedAt: memoryTimestamp, compressedMessages: 12, revision: 1 },
      },
      {
        petId: 'pet-xingye',
        messages: [{ id: 'xingye-recent-1', role: 'user', content: '星野的近期消息', createdAt: memoryTimestamp }],
        memory: { summary: '星野只记得用户喜欢夜空。', updatedAt: memoryTimestamp, compressedMessages: 18, revision: 2 },
      },
    ],
  }, null, 2)}\n`, 'utf8');

  session = await launch();
  electronApp = session.app;
  const restoredMemoryOverview = await session.consoleWindow.evaluate(() => window.desktopRuntime?.getCharacterMemoryOverview());
  const restoredRemMemory = restoredMemoryOverview?.find((item) => item.petId === 'character-package:rem--l1');
  const restoredXingyeMemory = restoredMemoryOverview?.find((item) => item.petId === 'pet-xingye');
  await session.consoleWindow.getByRole('button', { name: '模型连接' }).click();
  const restoredProfileName = await session.consoleWindow.locator('input[name="llm-profile-name"]').inputValue();
  const restoredApiKeyDraft = await session.consoleWindow.locator('input[name="llm-api-key"]').inputValue();
  await session.consoleWindow.getByText('已使用当前 Windows 账户加密保存', { exact: true }).waitFor();
  await session.consoleWindow.getByRole('button', { name: '桌面行为' }).click();
  const restoredMovementEnabled = await session.consoleWindow
    .getByRole('switch', { name: '允许桌宠自主移动' })
    .getAttribute('aria-checked');
  const restoredSpeechBubbleSeconds = await session.consoleWindow
    .locator('input[name="speech-bubble-seconds"]')
    .inputValue();
  const restoredPetScale = await session.consoleWindow.locator('input[name="pet-scale"]').inputValue();
  await session.consoleWindow.getByRole('button', { name: '模型连接' }).click();
  session.consoleWindow.once('dialog', (dialog) => dialog.accept());
  await session.consoleWindow.getByRole('button', { name: '移除已保存密钥' }).click();
  await session.consoleWindow.getByText('已移除本机保存的 API Key', { exact: true }).waitFor();
  await session.app.close();
  electronApp = undefined;

  const result = {
    passed: settingsJson.version === 1
      && settingsJson.settings?.llm?.profileName === profileName
      && settingsJson.settings?.behavior?.movementEnabled === false
      && settingsJson.settings?.behavior?.speechBubbleSeconds === 20
      && settingsJson.settings?.behavior?.petScale === 1.15
      && restoredProfileName === profileName
      && restoredMovementEnabled === 'false'
      && restoredSpeechBubbleSeconds === '20'
      && restoredPetScale === '1.15'
      && restoredApiKeyDraft === ''
      && restoredRemMemory?.status === 'ready'
      && restoredRemMemory.compressedMessages === 12
      && restoredRemMemory.recentMessages === 1
      && restoredXingyeMemory?.status === 'ready'
      && restoredXingyeMemory.compressedMessages === 18
      && restoredXingyeMemory.recentMessages === 1
      && plaintextAbsent
      && !existsSync(secretPath),
    packaged,
    settingsVersion: settingsJson.version,
    restoredProfileName,
    restoredMovementEnabled: restoredMovementEnabled === 'true',
    restoredSpeechBubbleSeconds: Number(restoredSpeechBubbleSeconds),
    restoredPetScale: Number(restoredPetScale),
    restoredApiKeyDraftEmpty: restoredApiKeyDraft === '',
    restoredCharacterMemories: restoredMemoryOverview?.filter((item) => item.status === 'ready'),
    plaintextAbsent,
    encryptedSecretRemoved: !existsSync(secretPath),
    screenshotPath,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  await electronApp?.close();
  if (profileDir.startsWith(tmpdir())) {
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    } catch (error) {
      process.stderr.write(`临时测试目录稍后由系统清理：${error.message}\n`);
    }
  }
}
