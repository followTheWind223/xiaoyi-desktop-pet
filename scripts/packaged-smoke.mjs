import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('C:/Users/15343/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const executablePath = resolve(process.env.DESKTOP_PET_EXECUTABLE ?? 'release/win-unpacked/桌宠.exe');
const profileDir = mkdtempSync(join(tmpdir(), 'desktop-pet-packaged-smoke-'));
const expectedCharactersRoot = join(profileDir, 'characters');
const screenshotPath = resolve('artifacts', 'packaged-pet-preview.png');
const bubbleScreenshotPath = resolve('artifacts', 'packaged-bubble-preview.png');
const unexpectedRequests = [];
let electronApp;

if (!existsSync(executablePath)) throw new Error(`找不到待验证的桌宠入口：${executablePath}`);

try {
  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profileDir}`],
    cwd: resolve('.'),
  });

  await electronApp.firstWindow();
  let consoleWindow;
  let petWindow;
  let bubbleWindow;
  for (let attempt = 0; attempt < 80 && (!consoleWindow || !petWindow || !bubbleWindow); attempt += 1) {
    for (const targetWindow of electronApp.windows()) {
      const pathname = new URL(targetWindow.url()).pathname.replaceAll('\\', '/');
      if (pathname.endsWith('/index.html')) consoleWindow = targetWindow;
      if (pathname.endsWith('/pet.html')) petWindow = targetWindow;
      if (pathname.endsWith('/bubble.html')) bubbleWindow = targetWindow;
    }
    if (!consoleWindow || !petWindow || !bubbleWindow) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (!consoleWindow || !petWindow || !bubbleWindow) throw new Error('打包后的控制台、桌宠或对话窗口未创建');

  const trackRequests = (targetWindow) => targetWindow.on('request', (request) => {
    const protocol = new URL(request.url()).protocol;
    if (!['file:', 'data:', 'petasset:'].includes(protocol)) unexpectedRequests.push(request.url());
  });
  for (const targetWindow of electronApp.windows()) trackRequests(targetWindow);
  electronApp.on('window', trackRequests);

  const scan = await consoleWindow.evaluate(() => window.desktopRuntime?.scanCharacterPackages());
  const remPackage = scan?.packages.find((item) => item.manifest.displayName === 'Rem');
  if (!remPackage) throw new Error('首次启动后未发现内置 Rem 角色包');

  await consoleWindow.getByRole('button', { name: '桌宠管理' }).click();
  const remCard = consoleWindow.locator('.pet-list-card').filter({ hasText: 'Rem' });
  await remCard.waitFor();
  await remCard.locator('button').last().click();
  await consoleWindow.waitForFunction(() => (
    document.querySelector('textarea[name="pet-personality"]')?.value
      === '一只喜欢冰淇淋、安静又贴心的可爱桌宠。'
  ));
  const remDescription = await consoleWindow.locator('textarea[name="pet-personality"]').inputValue();
  const animationLabels = await consoleWindow.locator('.motion-tile strong').allTextContents();

  const spriteCanvas = petWindow.locator('.pet-sprite-canvas.ready');
  await spriteCanvas.waitFor();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  const spriteRuntime = await spriteCanvas.evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let hasVisiblePixel = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 4) {
        hasVisiblePixel = true;
        break;
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      hasVisiblePixel,
      idleRow: Number(canvas.dataset.spriteRow),
      idleFrameCount: Number(canvas.dataset.spriteFrameCount),
      fps: Number(canvas.dataset.spriteFps),
    };
  });

  const moveResult = await petWindow.evaluate(async () => {
    const started = await window.desktopRuntime?.beginPetMove({ screenX: 500, screenY: 500 });
    const result = await window.desktopRuntime?.movePetWindow({ screenX: 482, screenY: 482 });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
    const draggingRow = Number(document.querySelector('.pet-sprite-canvas')?.dataset.spriteRow);
    await window.desktopRuntime?.finishPetMove();
    const afterFinish = await window.desktopRuntime?.movePetWindow({ screenX: 470, screenY: 470 });
    await window.desktopRuntime?.resetPetPosition();
    return { ...result, started: started?.started, draggingRow, rejectedAfterFinish: afterFinish?.moved === false };
  });

  const walkStartBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const leftWalk = await petWindow.evaluate(() => window.desktopRuntime?.walkPet('left'));
  await petWindow.waitForFunction(() => (
    document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'running-left'
  ));
  const leftWalkRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));
  await petWindow.waitForFunction(() => (
    document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'idle'
  ));
  const afterLeftWalkBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const rightWalk = await petWindow.evaluate(() => window.desktopRuntime?.walkPet('right'));
  let rightWalkRow = -1;
  if (rightWalk?.started) {
    await petWindow.waitForFunction(() => (
      document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'running-right'
    ));
    rightWalkRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));
    await petWindow.waitForFunction(() => (
      document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'idle'
    ));
  }
  const afterRightWalkBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const horizontalMovementReady = Boolean(
    leftWalk?.started
    && rightWalk?.started
    && walkStartBounds
    && afterLeftWalkBounds
    && afterRightWalkBounds
    && afterLeftWalkBounds.x < walkStartBounds.x
    && afterRightWalkBounds.x > afterLeftWalkBounds.x
    && leftWalkRow === 2
    && rightWalkRow === 1
  );

  const actionPreviewFromPet = await petWindow.evaluate(() => window.desktopRuntime?.previewPetAnimation('waving'));
  await petWindow.waitForFunction(() => (
    document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'waving'
  ));
  const actionPreviewRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));

  await consoleWindow.getByRole('button', { name: '桌面行为' }).click();
  const movementSwitch = consoleWindow.getByRole('switch', { name: '允许桌宠自主移动' });
  await movementSwitch.click();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 420));
  const disabledWalk = await petWindow.evaluate(() => window.desktopRuntime?.walkPet('left'));
  const movementSettingReady = disabledWalk?.started === false && disabledWalk?.reason === 'movement-disabled';
  await movementSwitch.click();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 320));
  await petWindow.screenshot({ path: screenshotPath });

  await petWindow.getByRole('button', { name: /单击打开快捷输入/ }).click();
  await petWindow.getByPlaceholder('想和 Rem 说什么？').waitFor({ state: 'visible' });
  await petWindow.getByPlaceholder('想和 Rem 说什么？').fill('打包版 Chat 错误提示验证');
  await petWindow.getByRole('button', { name: '发送消息' }).click();
  await petWindow.getByText(/请先在控制台配置模型地址与名称/).waitFor();
  const packagedChatState = await petWindow.evaluate(() => window.desktopRuntime?.getChatState());
  const quickInputBubbleHidden = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠对话')?.isVisible() === false
  ));
  await petWindow.screenshot({ path: bubbleScreenshotPath });
  await petWindow.evaluate(() => window.desktopRuntime?.openPetInput());
  await bubbleWindow.getByPlaceholder('输入消息…').waitFor({ state: 'visible' });
  const packagedChatErrorReady = packagedChatState?.activeRequest === null && quickInputBubbleHidden;

  const normalize = (value) => resolve(value).toLocaleLowerCase('en-US');
  const seededManifest = join(expectedCharactersRoot, 'rem--l1', 'pet.json');
  const seededSprite = join(expectedCharactersRoot, 'rem--l1', remPackage.manifest.spritesheetPath);
  const result = {
    passed: normalize(scan.rootPath) === normalize(expectedCharactersRoot)
      && existsSync(seededManifest)
      && existsSync(seededSprite)
      && spriteRuntime.width === 192
      && spriteRuntime.height === 208
      && spriteRuntime.hasVisiblePixel
      && spriteRuntime.idleRow === 0
      && spriteRuntime.idleFrameCount === 8
      && spriteRuntime.fps === 6
      && animationLabels.length === 9
      && animationLabels.includes('向右跑')
      && remDescription === '一只喜欢冰淇淋、安静又贴心的可爱桌宠。'
      && moveResult?.moved === true
      && moveResult?.started === true
      && moveResult?.draggingRow === 4
      && moveResult?.rejectedAfterFinish === true
      && horizontalMovementReady
      && actionPreviewFromPet === true
      && actionPreviewRow === 3
      && movementSettingReady
      && packagedChatErrorReady
      && unexpectedRequests.length === 0,
    executablePath,
    characterRoot: scan.rootPath,
    seededManifest: existsSync(seededManifest),
    seededSprite: existsSync(seededSprite),
    spriteRuntime,
    animationLabels,
    remDescription,
    moveResult,
    horizontalMovementReady,
    leftWalk: { ...leftWalk, row: leftWalkRow },
    rightWalk: { ...rightWalk, row: rightWalkRow },
    actionPreviewFromPet,
    actionPreviewRow,
    movementSettingReady,
    disabledWalk,
    packagedChatErrorReady,
    quickInputBubbleHidden,
    unexpectedRequests,
    screenshotPath,
    bubbleScreenshotPath,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  await electronApp?.close();
  if (profileDir.startsWith(tmpdir())) rmSync(profileDir, { recursive: true, force: true });
}
