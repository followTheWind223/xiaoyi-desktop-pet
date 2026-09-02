import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('C:/Users/15343/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const projectRoot = resolve('.');
const profileDir = mkdtempSync(join(tmpdir(), 'desktop-pet-console-electron-smoke-'));
const screenshotPath = resolve('artifacts', 'electron-desktop-preview.png');
const overviewScreenshotPath = resolve('artifacts', 'overview-window-preview.png');
const petScreenshotPath = resolve('artifacts', 'pet-window-preview.png');
const bubbleScreenshotPath = resolve('artifacts', 'bubble-window-preview.png');
const bubbleInputScreenshotPath = resolve('artifacts', 'bubble-input-preview.png');
const unexpectedRequests = [];
let electronApp;
let mockRequestCount = 0;
const mockServer = createServer((request, response) => {
  let rawBody = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    rawBody += chunk;
    if (rawBody.length > 64 * 1024) request.destroy();
  });
  request.on('end', () => {
    mockRequestCount += 1;
    if (request.url !== '/v1/chat/completions' || request.headers.authorization !== 'Bearer electron-secret-never-persist') {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'unauthorized' } }));
      return;
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end('{}');
      return;
    }
    if (!payload.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.on('error', () => undefined);
    const lastUserMessage = [...(payload.messages ?? [])].reverse().find((message) => message.role === 'user')?.content ?? '';
    const stopScenario = lastUserMessage.includes('测试停止回答');
    setTimeout(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '你好，我是 Rem。' } }] })}\n\n`);
    }, stopScenario ? 40 : 180);
    setTimeout(() => {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: stopScenario ? '这段回复不应完整显示。' : '已经收到你的桌面端交互验证。' } }] })}\n\n`);
    }, stopScenario ? 1200 : 360);
    setTimeout(() => response.end('data: [DONE]\n\n'), stopScenario ? 1800 : 560);
  });
});
await new Promise((resolveListen, rejectListen) => {
  mockServer.once('error', rejectListen);
  mockServer.listen(0, '127.0.0.1', resolveListen);
});
const mockAddress = mockServer.address();
const mockPort = typeof mockAddress === 'object' && mockAddress ? mockAddress.port : 0;

try {
  electronApp = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: [`--user-data-dir=${profileDir}`, projectRoot],
    cwd: projectRoot,
    env: { ...process.env, DESKTOP_PET_ALLOW_LOCAL_MODEL: '1' },
  });

  await electronApp.firstWindow();
  let window;
  for (let attempt = 0; attempt < 50 && !window; attempt += 1) {
    for (const targetWindow of electronApp.windows()) {
      if (await targetWindow.title() === '桌宠控制台') window = targetWindow;
    }
    if (!window) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!window) throw new Error('桌宠控制台窗口未创建');
  const trackRequests = (targetWindow) => targetWindow.on('request', (request) => {
    const protocol = new URL(request.url()).protocol;
    if (!['file:', 'data:', 'petasset:'].includes(protocol)) unexpectedRequests.push(request.url());
  });
  for (const targetWindow of electronApp.windows()) trackRequests(targetWindow);
  electronApp.on('window', trackRequests);

  await window.getByRole('heading', { name: /正在桌面陪伴你/ }).waitFor();
  await window.screenshot({ path: overviewScreenshotPath });
  await window.getByRole('button', { name: '桌宠管理' }).click();
  await window.getByRole('heading', { name: '选择今天陪伴你的角色' }).waitFor();
  const runtime = await window.evaluate(() => ({
    isDesktop: window.desktopRuntime?.isDesktop,
    platform: window.desktopRuntime?.platform,
  }));
  const characterScan = await window.evaluate(() => window.desktopRuntime?.scanCharacterPackages());
  const locationProtocol = await window.evaluate(() => window.location.protocol);

  await window.locator('.pet-list-card').nth(1).getByRole('button', { name: /切换/ }).click();
  await window.getByText(/已切换到 星野/).waitFor();
  await window.getByRole('button', { name: '模型连接' }).click();
  await window.locator('input[name="llm-model-url"]').fill(`http://127.0.0.1:${mockPort}/v1`);
  await window.locator('input[name="llm-model-name"]').fill('mock-model');
  await window.locator('input[name="llm-api-key"]').fill('electron-secret-never-persist');
  const storageContainsSecret = await window.evaluate(() =>
    Object.values(localStorage).some((value) => value.includes('electron-secret-never-persist')),
  );
  await window.getByRole('button', { name: '安全保存 API Key' }).click();
  await window.getByText('API Key 已使用当前 Windows 账户加密保存').waitFor();
  await window.getByRole('button', { name: '测试连接' }).click();
  await window.getByText('连接成功，可以开始与桌宠对话').waitFor();

  await window.getByRole('button', { name: '桌宠管理' }).click();
  await window.getByRole('heading', { name: '选择今天陪伴你的角色' }).waitFor();

  let petWindow;
  let bubbleWindow;
  for (const targetWindow of electronApp.windows()) {
    const title = await targetWindow.title();
    if (title === '桌宠') petWindow = targetWindow;
    if (title === '桌宠对话') bubbleWindow = targetWindow;
  }
  if (!petWindow || !bubbleWindow) throw new Error('桌宠窗口或对话气泡未创建');

  const remCard = window.locator('.pet-list-card').filter({ hasText: 'Rem' });
  await remCard.waitFor();
  await remCard.getByRole('button', { name: /切换/ }).click();
  await window.getByText(/已切换到 Rem/).waitFor();
  const remDescription = await window.locator('textarea[name="pet-personality"]').inputValue();
  const animationButtons = window.locator('.motion-tile');
  await animationButtons.first().waitFor();
  const animationLabels = await animationButtons.locator('strong').allTextContents();
  const spriteCanvas = petWindow.locator('.pet-sprite-canvas.ready');
  await spriteCanvas.waitFor();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const spriteRuntime = await spriteCanvas.evaluate((canvas) => {
    const target = canvas;
    const context = target.getContext('2d');
    const pixels = context?.getImageData(0, 0, target.width, target.height).data ?? [];
    let hasVisiblePixel = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 4) {
        hasVisiblePixel = true;
        break;
      }
    }
    return {
      width: target.width,
      height: target.height,
      hasVisiblePixel,
      idleRow: Number(target.dataset.spriteRow),
      idleFrame: Number(target.dataset.spriteFrame),
      idleFrameCount: Number(target.dataset.spriteFrameCount),
      fps: Number(target.dataset.spriteFps),
    };
  });

  await petWindow.locator('.pet-surface').hover();
  await petWindow.waitForFunction(() => (
    document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'waving'
      && document.querySelector('.pet-sprite-canvas')?.dataset.spriteMode === 'loop'
  ));
  const hoverAnimationLoops = true;
  await petWindow.mouse.move(1, 1);
  await petWindow.waitForFunction(() => document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'idle');

  await window.getByRole('button', { name: '预览动作：向右跑' }).click();
  await petWindow.waitForFunction(() => document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'running-right');
  const previewRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));

  const petMoveResult = await petWindow.evaluate(async () => {
    const started = await window.desktopRuntime?.beginPetMove({ screenX: 500, screenY: 500 });
    const result = await window.desktopRuntime?.movePetWindow({ screenX: 482, screenY: 482 });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const draggingRow = Number(document.querySelector('.pet-sprite-canvas')?.dataset.spriteRow);
    await window.desktopRuntime?.finishPetMove();
    const afterFinish = await window.desktopRuntime?.movePetWindow({ screenX: 470, screenY: 470 });
    await window.desktopRuntime?.resetPetPosition();
    return { ...result, started: started?.started, draggingRow, rejectedAfterFinish: afterFinish?.moved === false };
  });

  const beforeGestureBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const petSurfaceBounds = await petWindow.locator('.pet-surface').boundingBox();
  if (!petSurfaceBounds) throw new Error('桌宠拖拽区域不可见');
  await petWindow.mouse.move(
    petSurfaceBounds.x + (petSurfaceBounds.width / 2),
    petSurfaceBounds.y + (petSurfaceBounds.height / 2),
  );
  await petWindow.mouse.down();
  await petWindow.mouse.move(
    petSurfaceBounds.x + (petSurfaceBounds.width / 2) - 22,
    petSurfaceBounds.y + (petSurfaceBounds.height / 2) - 16,
  );
  await petWindow.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 320));
  const afterGestureBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const gestureDragReady = Boolean(beforeGestureBounds && afterGestureBounds
    && (beforeGestureBounds.x !== afterGestureBounds.x || beforeGestureBounds.y !== afterGestureBounds.y));
  await petWindow.evaluate(() => window.desktopRuntime?.resetPetPosition());

  const longPressBefore = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const longPressSurface = await petWindow.locator('.pet-surface').boundingBox();
  if (!longPressSurface) throw new Error('桌宠长按区域不可见');
  await petWindow.mouse.move(
    longPressSurface.x + (longPressSurface.width / 2),
    longPressSurface.y + (longPressSurface.height / 2),
  );
  await petWindow.mouse.down();
  await new Promise((resolve) => setTimeout(resolve, 460));
  const longPressLabel = await petWindow.getByText('正在移动').isVisible();
  await petWindow.mouse.move(
    longPressSurface.x + (longPressSurface.width / 2) - 18,
    longPressSurface.y + (longPressSurface.height / 2) - 14,
  );
  await new Promise((resolve) => setTimeout(resolve, 180));
  const longPressDuring = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  await petWindow.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 180));
  const longPressReleased = !(await petWindow.getByText('正在移动').isVisible());
  const longPressAfter = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const longPressBounds = [longPressBefore, longPressDuring, longPressAfter];
  const longPressGeometryStable = longPressBounds.every((bounds) => (
    bounds
    && Math.abs(bounds.width - 260) <= 1
    && Math.abs(bounds.height - 310) <= 1
    && Math.abs(bounds.width - longPressBefore.width) <= 1
    && Math.abs(bounds.height - longPressBefore.height) <= 1
  ));
  const longPressMoved = Boolean(longPressBefore && longPressDuring
    && (longPressBefore.x !== longPressDuring.x || longPressBefore.y !== longPressDuring.y));
  const longPressReleaseStable = Boolean(longPressDuring && longPressAfter
    && longPressDuring.x === longPressAfter.x
    && longPressDuring.y === longPressAfter.y);

  await petWindow.evaluate(() => window.desktopRuntime?.resetPetPosition());
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
  const afterLeftWalkState = await petWindow.evaluate(() => window.desktopRuntime?.getDesktopSnapshot());
  const bubbleVisibleBeforeRight = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠对话')?.isVisible()
  ));
  const rightWalkStartBounds = await electronApp.evaluate(({ BrowserWindow }) => (
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
    && rightWalkStartBounds
    && afterRightWalkBounds
    && afterLeftWalkBounds.x < walkStartBounds.x
    && afterRightWalkBounds.x > rightWalkStartBounds.x
    && leftWalkRow === 2
    && rightWalkRow === 1
    && [walkStartBounds, afterLeftWalkBounds].every((bounds) => (
      Math.abs(bounds.width - walkStartBounds.width) <= 1
      && Math.abs(bounds.height - walkStartBounds.height) <= 1
      && Math.abs(bounds.y - walkStartBounds.y) <= 1
    ))
    && [rightWalkStartBounds, afterRightWalkBounds].every((bounds) => (
      Math.abs(bounds.width - rightWalkStartBounds.width) <= 1
      && Math.abs(bounds.height - rightWalkStartBounds.height) <= 1
      && Math.abs(bounds.y - rightWalkStartBounds.y) <= 1
    )),
  );

  const actionPreviewFromPet = await petWindow.evaluate(() => window.desktopRuntime?.previewPetAnimation('waving'));
  await petWindow.waitForFunction(() => (
    document.querySelector('.pet-sprite-canvas')?.dataset.spriteAnimation === 'waving'
  ));
  const actionPreviewRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));

  await window.getByRole('button', { name: '桌面行为' }).click();
  const movementSwitch = window.getByRole('switch', { name: '允许桌宠自主移动' });
  const movementEnabledByDefault = await movementSwitch.getAttribute('aria-checked') === 'true';
  await movementSwitch.click();
  await new Promise((resolve) => setTimeout(resolve, 420));
  const disabledWalk = await petWindow.evaluate(() => window.desktopRuntime?.walkPet('left'));
  const dragWhileMovementDisabled = await petWindow.evaluate(async () => {
    const started = await window.desktopRuntime?.beginPetMove({ screenX: 500, screenY: 500 });
    await window.desktopRuntime?.finishPetMove();
    return started;
  });
  const movementSettingReady = movementEnabledByDefault
    && disabledWalk?.started === false
    && disabledWalk?.reason === 'movement-disabled'
    && dragWhileMovementDisabled?.started === true;
  await movementSwitch.click();
  await new Promise((resolve) => setTimeout(resolve, 320));
  const scaleSlider = window.locator('input[name="pet-scale"]');
  const beforeScaleBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  await scaleSlider.evaluate((input) => {
    input.value = '1.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await petWindow.waitForFunction(async () => (await window.desktopRuntime?.getDesktopSnapshot())?.runtime.petScale === 1.2);
  const scaledPet = await petWindow.evaluate(() => {
    const stage = document.querySelector('.pet-stage');
    const transform = stage ? getComputedStyle(stage).transform : 'none';
    return { renderedScale: transform === 'none' ? 1 : new DOMMatrix(transform).a };
  });
  const scaledBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠')?.getBounds()
  ));
  const petScaleSettingReady = Boolean(beforeScaleBounds && scaledBounds
    && scaledBounds.width > beforeScaleBounds.width
    && scaledBounds.height > beforeScaleBounds.height
    && Math.abs(scaledBounds.width - 312) <= 2
    && Math.abs(scaledBounds.height - 372) <= 2
    && Math.abs(scaledPet.renderedScale - 1.2) < 0.01);
  await scaleSlider.evaluate((input) => {
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await petWindow.waitForFunction(async () => (await window.desktopRuntime?.getDesktopSnapshot())?.runtime.petScale === 1);
  await window.getByRole('button', { name: '桌宠管理' }).click();
  await window.getByRole('heading', { name: '选择今天陪伴你的角色' }).waitFor();

  await petWindow.getByRole('button', { name: /单击打开快捷输入/ }).click();
  const quickInput = petWindow.getByPlaceholder('想和 Rem 说什么？');
  await quickInput.waitFor({ state: 'visible' });
  await petWindow.waitForFunction(() => document.querySelector('.pet-sprite-canvas')?.dataset.spriteMode === 'loop');
  const quickVisualState = await petWindow.evaluate(() => {
    const surface = document.querySelector('.pet-surface');
    const composer = document.querySelector('.pet-quick-composer');
    const transform = surface ? getComputedStyle(surface).transform : 'none';
    const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform);
    const background = composer ? getComputedStyle(composer).backgroundColor : '';
    const alpha = Number(background.match(/[\d.]+(?=\)$)/)?.[0] ?? 1);
    return {
      scale: matrix.a,
      composerAlpha: alpha,
      spriteMode: document.querySelector('.pet-sprite-canvas')?.dataset.spriteMode,
    };
  });
  const bubbleHiddenDuringQuickInput = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠对话')?.isVisible() === false
  ));
  await petWindow.screenshot({ path: bubbleInputScreenshotPath });
  await quickInput.fill('验证桌面端交互');
  await petWindow.getByRole('button', { name: '发送消息' }).click();
  await petWindow.getByText('等待回复…').waitFor();
  await petWindow.waitForFunction(() => document.querySelector('.pet-sprite-canvas')?.dataset.spriteRow === '6');
  const thinkingRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));
  await petWindow.getByText(/你好，我是 Rem/).waitFor();
  await petWindow.waitForFunction(() => document.querySelector('.pet-sprite-canvas')?.dataset.spriteRow === '8');
  const speakingRow = await spriteCanvas.evaluate((canvas) => Number(canvas.dataset.spriteRow));
  await petWindow.getByText(/已经收到你的桌面端交互验证/).waitFor();
  await petWindow.locator('.pet-stream-caret').waitFor({ state: 'hidden' });
  const quickSpeechStillVisible = await petWindow.locator('.pet-speech-bubble').isVisible();
  const quickRuntime = await petWindow.evaluate(() => window.desktopRuntime?.getDesktopSnapshot());
  const petInteractionReady = bubbleHiddenDuringQuickInput
    && quickSpeechStillVisible
    && quickRuntime?.runtime.speechBubbleSeconds === 10
    && Math.abs(quickVisualState.scale - 1) < 0.01
    && quickVisualState.composerAlpha < 0.9
    && quickVisualState.spriteMode === 'loop';
  await petWindow.screenshot({ path: petScreenshotPath });

  await petWindow.evaluate(() => window.desktopRuntime?.openPetInput());
  await bubbleWindow.getByPlaceholder('输入消息…').waitFor({ state: 'visible' });
  await bubbleWindow.getByText(/已经收到你的桌面端交互验证/).waitFor();
  const fullConversationBounds = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows().find((item) => item.getTitle() === '桌宠对话')?.getBounds()
  ));
  const fullConversationLayout = Boolean(fullConversationBounds
    && Math.abs(fullConversationBounds.width - 420) <= 2
    && Math.abs(fullConversationBounds.height - 360) <= 2);
  await bubbleWindow.getByRole('button', { name: '关闭完整对话' }).click();
  await new Promise((resolve) => setTimeout(resolve, 520));
  await petWindow.evaluate(() => window.desktopRuntime?.openPetInput());
  await bubbleWindow.getByText(/已经收到你的桌面端交互验证/).waitFor();
  const restoredChat = await bubbleWindow.evaluate(() => window.desktopRuntime?.getChatState());
  const chatRecoveredAfterHide = Boolean(restoredChat?.messages.some((message) => (
    message.role === 'assistant' && message.content.includes('已经收到你的桌面端交互验证')
  )));
  const chatHistoryFile = join(profileDir, 'desktop-pet-data', 'chat-history.json');
  const chatHistoryText = existsSync(chatHistoryFile) ? readFileSync(chatHistoryFile, 'utf8') : '';
  const chatHistorySafe = chatHistoryText.includes('验证桌面端交互')
    && !chatHistoryText.includes('electron-secret-never-persist');
  await bubbleWindow.screenshot({ path: bubbleScreenshotPath });

  await bubbleWindow.getByPlaceholder('输入消息…').fill('测试停止回答');
  await bubbleWindow.getByRole('button', { name: '发送消息' }).click();
  await bubbleWindow.locator('.chat-message.pending').getByText(/你好，我是 Rem/).waitFor();
  await bubbleWindow.getByRole('button', { name: '停止当前回答' }).click();
  await bubbleWindow.getByRole('button', { name: '停止当前回答' }).waitFor({ state: 'hidden' });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const stoppedChat = await bubbleWindow.evaluate(() => window.desktopRuntime?.getChatState());
  const stopConversationReady = stoppedChat?.activeRequest === null;

  await window.screenshot({ path: screenshotPath });

  const result = {
    passed: runtime?.isDesktop === true
      && runtime?.platform === 'win32'
      && locationProtocol === 'file:'
      && characterScan?.rootPath.endsWith('resources\\characters')
      && characterScan?.packages.some((item) => item.manifest.displayName === 'Rem')
      && Array.isArray(characterScan?.issues)
      && spriteRuntime.width === 192
      && spriteRuntime.height === 208
      && spriteRuntime.hasVisiblePixel
      && spriteRuntime.idleRow === 0
      && spriteRuntime.idleFrameCount === 8
      && spriteRuntime.fps === 6
      && animationLabels.length === 9
      && animationLabels.includes('向右跑')
      && animationLabels.includes('复盘 / 回答')
      && hoverAnimationLoops
      && previewRow === 1
      && remDescription === '一只喜欢冰淇淋、安静又贴心的可爱桌宠。'
      && !storageContainsSecret
      && petMoveResult?.moved === true
      && petMoveResult?.started === true
      && petMoveResult?.draggingRow === 4
      && petMoveResult?.rejectedAfterFinish === true
      && gestureDragReady
      && longPressLabel
      && longPressMoved
      && longPressReleased
      && longPressReleaseStable
      && longPressGeometryStable
      && horizontalMovementReady
      && actionPreviewFromPet === true
      && actionPreviewRow === 3
      && movementSettingReady
      && petScaleSettingReady
      && petInteractionReady
      && thinkingRow === 6
      && speakingRow === 8
      && mockRequestCount >= 3
      && fullConversationLayout
      && chatRecoveredAfterHide
      && chatHistorySafe
      && stopConversationReady
      && unexpectedRequests.length === 0,
    runtime,
    characterScan: characterScan && {
      rootPath: characterScan.rootPath,
      packages: characterScan.packages.length,
      issues: characterScan.issues.length,
    },
    spriteRuntime,
    animationLabels,
    hoverAnimationLoops,
    previewRow,
    remDescription,
    locationProtocol,
    storageContainsSecret,
    petMoveResult,
    gestureDragReady,
    longPressLabel,
    longPressMoved,
    longPressReleased,
    longPressReleaseStable,
    horizontalMovementReady,
    leftWalk: { ...leftWalk, row: leftWalkRow },
    rightWalk: { ...rightWalk, row: rightWalkRow },
    horizontalWalkBounds: {
      start: walkStartBounds,
      left: afterLeftWalkBounds,
      rightStart: rightWalkStartBounds,
      right: afterRightWalkBounds,
    },
    afterLeftWalkState: afterLeftWalkState?.runtime,
    bubbleVisibleBeforeRight,
    actionPreviewFromPet,
    actionPreviewRow,
    movementSettingReady,
    petScaleSettingReady,
    scaleBounds: { before: beforeScaleBounds, scaled: scaledBounds, rendered: scaledPet.renderedScale },
    disabledWalk,
    dragWhileMovementDisabled,
    longPressGeometryStable,
    longPressBounds: { before: longPressBefore, during: longPressDuring, after: longPressAfter },
    petInteractionReady,
    quickVisualState,
    thinkingRow,
    speakingRow,
    mockRequestCount,
    fullConversationLayout,
    fullConversationBounds,
    chatRecoveredAfterHide,
    chatHistorySafe,
    stopConversationReady,
    unexpectedRequests,
    screenshotPath,
    overviewScreenshotPath,
    petScreenshotPath,
    bubbleScreenshotPath,
    bubbleInputScreenshotPath,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  await electronApp?.close();
  await new Promise((resolveClose) => mockServer.close(resolveClose));
  if (profileDir.startsWith(tmpdir())) rmSync(profileDir, { recursive: true, force: true });
}
