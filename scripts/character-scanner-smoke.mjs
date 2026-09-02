import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scanCharacterPackages } = require('../electron/character-scanner.cjs');

function makeVp8lHeader(width, height) {
  const buffer = Buffer.alloc(26);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8L', 12, 'ascii');
  buffer.writeUInt32LE(5, 16);
  buffer[20] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  buffer.writeUInt32LE(bits >>> 0, 21);
  return buffer;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pet-character-scan-'));

try {
  const validDir = path.join(tempRoot, '测试角色');
  fs.mkdirSync(validDir);
  fs.writeFileSync(path.join(validDir, 'pet.json'), JSON.stringify({
    id: 'demo',
    displayName: '测试桌宠',
    description: 'smoke test',
    spritesheetPath: 'spritesheet.webp',
    spriteVersionNumber: 1,
    atlas: { columns: 8, rows: 9 },
    animations: [
      { id: 'idle', label: '待机', row: 0, states: ['idle'] },
      { id: 'wave', label: '挥手', row: 3, mode: 'once', states: ['hover'] },
    ],
    behavior: { fps: 10, thinkingRow: 7 },
  }));
  fs.writeFileSync(path.join(validDir, 'spritesheet.webp'), makeVp8lHeader(1536, 1872));

  const customAtlasDir = path.join(tempRoot, '扩展动作角色');
  fs.mkdirSync(customAtlasDir);
  fs.writeFileSync(path.join(customAtlasDir, 'pet.json'), JSON.stringify({
    id: 'extended-demo',
    displayName: '扩展动作',
    spritesheetPath: 'spritesheet.webp',
    atlas: { columns: 6, rows: 10 },
    animations: [{ id: 'special', label: '特殊动作', row: 9, fps: 12, states: [] }],
  }));
  fs.writeFileSync(path.join(customAtlasDir, 'spritesheet.webp'), makeVp8lHeader(1200, 2000));

  const invalidJsonDir = path.join(tempRoot, '损坏配置');
  fs.mkdirSync(invalidJsonDir);
  fs.writeFileSync(path.join(invalidJsonDir, 'pet.json'), '{invalid');

  const traversalDir = path.join(tempRoot, '越界路径');
  fs.mkdirSync(traversalDir);
  fs.writeFileSync(path.join(traversalDir, 'pet.json'), JSON.stringify({
    displayName: '不安全包',
    spritesheetPath: '../outside.webp',
  }));

  const missingDir = path.join(tempRoot, '缺少图片');
  fs.mkdirSync(missingDir);
  fs.writeFileSync(path.join(missingDir, 'pet.json'), JSON.stringify({ displayName: '缺图' }));

  const result = scanCharacterPackages(tempRoot);
  assert.equal(result.packages.length, 2);
  const standardPackage = result.packages.find((item) => item.manifest.displayName === '测试桌宠');
  const extendedPackage = result.packages.find((item) => item.manifest.displayName === '扩展动作');
  assert.equal(standardPackage.manifest.behavior.fps, 10);
  assert.equal(standardPackage.manifest.spriteVersionNumber, 1);
  assert.equal(standardPackage.manifest.animations.length, 2);
  assert.equal(standardPackage.manifest.animations[1].mode, 'once');
  assert.equal(standardPackage.image.codec, 'VP8L');
  assert.equal(standardPackage.image.width, 1536);
  assert.equal(standardPackage.image.height, 1872);
  assert.equal(standardPackage.image.atlas.frameWidth, 192);
  assert.equal(standardPackage.image.atlas.frameHeight, 208);
  assert.equal(standardPackage.image.atlas.referenceCompatible, true);
  assert.equal(extendedPackage.image.atlas.columns, 6);
  assert.equal(extendedPackage.image.atlas.rows, 10);
  assert.equal(extendedPackage.image.atlas.frameWidth, 200);
  assert.equal(extendedPackage.image.atlas.frameHeight, 200);
  assert.equal(extendedPackage.manifest.animations[0].row, 9);
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.some((item) => item.folderName === '损坏配置'));
  assert.ok(result.issues.some((item) => item.folderName === '越界路径' && item.message.includes('只允许')));
  assert.ok(result.issues.some((item) => item.folderName === '缺少图片' && item.code === 'MISSING_SPRITESHEET'));

  console.log('Character package scanner smoke test passed.');
} finally {
  const resolved = path.resolve(tempRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
}
