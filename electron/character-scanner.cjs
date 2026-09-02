const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_FILE = 'pet.json';
const DEFAULT_SPRITESHEET_FILE = 'spritesheet.webp';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SPRITESHEET_BYTES = 64 * 1024 * 1024;
const WEBP_HEADER_READ_BYTES = 64 * 1024;
const MAX_ATLAS_AXIS = 64;
const MAX_DECODED_PIXELS = 16 * 1024 * 1024;
const ALLOWED_ANIMATION_STATES = new Set([
  'idle',
  'hover',
  'input_open',
  'moving_right',
  'moving_left',
  'dragging',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
  'sleeping',
  'error',
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = [...value.trim()].slice(0, maxLength).join('');
  return text || fallback;
}

function safeNumber(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Number(value))) : fallback;
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseWebpHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 21) throw new Error('文件头不完整');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('不是有效的 WebP 文件');
  }

  const declaredBytes = buffer.readUInt32LE(4) + 8;
  let offset = 12;
  let animated = false;

  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const available = buffer.length - dataOffset;

    if (chunkType === 'VP8X' && chunkSize >= 10 && available >= 10) {
      animated = Boolean(buffer[dataOffset] & 0x02);
      return {
        width: readUInt24LE(buffer, dataOffset + 4) + 1,
        height: readUInt24LE(buffer, dataOffset + 7) + 1,
        codec: 'VP8X',
        animated,
        declaredBytes,
      };
    }

    if (chunkType === 'VP8 ' && chunkSize >= 10 && available >= 10) {
      if (buffer[dataOffset + 3] !== 0x9d || buffer[dataOffset + 4] !== 0x01 || buffer[dataOffset + 5] !== 0x2a) {
        throw new Error('VP8 帧头无效');
      }
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
        codec: 'VP8',
        animated,
        declaredBytes,
      };
    }

    if (chunkType === 'VP8L' && chunkSize >= 5 && available >= 5) {
      if (buffer[dataOffset] !== 0x2f) throw new Error('VP8L 帧头无效');
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        codec: 'VP8L',
        animated,
        declaredBytes,
      };
    }

    if (chunkSize > available) break;
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error('无法读取 WebP 尺寸');
}

function inspectWebp(filePath, atlasConfig = { columns: 8, rows: 9 }) {
  const fileStat = fs.lstatSync(filePath);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new Error('WebP 必须是普通文件');
  if (fileStat.size <= 20) throw new Error('WebP 文件为空或不完整');
  if (fileStat.size > MAX_SPRITESHEET_BYTES) throw new Error('WebP 超过 64 MB 限制');

  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(fileStat.size, WEBP_HEADER_READ_BYTES));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    const parsed = parseWebpHeader(buffer);
    if (parsed.width < 1 || parsed.height < 1 || parsed.width > 16384 || parsed.height > 16384) {
      throw new Error('WebP 尺寸超出支持范围');
    }
    if (parsed.width * parsed.height > MAX_DECODED_PIXELS) throw new Error('WebP 解码尺寸超过 1600 万像素限制');
    if (parsed.declaredBytes > fileStat.size) throw new Error('WebP 文件数据不完整');

    const columns = atlasConfig.columns;
    const rows = atlasConfig.rows;
    const referenceAtlas = columns === 8 && rows === 9 && parsed.width === 1536 && parsed.height === 1872;
    return {
      format: 'webp',
      codec: parsed.codec,
      width: parsed.width,
      height: parsed.height,
      bytes: fileStat.size,
      animated: parsed.animated,
      atlas: {
        columns,
        rows,
        frameWidth: Number.isInteger(parsed.width / columns) ? parsed.width / columns : null,
        frameHeight: Number.isInteger(parsed.height / rows) ? parsed.height / rows : null,
        referenceCompatible: referenceAtlas,
      },
    };
  } finally {
    fs.closeSync(handle);
  }
}

function sanitizeAtlas(value) {
  if (!isPlainObject(value)) return { columns: 8, rows: 9 };
  return {
    columns: Number.isInteger(value.columns) ? Math.max(1, Math.min(MAX_ATLAS_AXIS, value.columns)) : 8,
    rows: Number.isInteger(value.rows) ? Math.max(1, Math.min(MAX_ATLAS_AXIS, value.rows)) : 9,
  };
}

function sanitizeAnimations(value, rows) {
  if (!Array.isArray(value)) return undefined;
  const seenIds = new Set();
  const animations = [];
  for (const candidate of value.slice(0, 64)) {
    if (!isPlainObject(candidate) || !Number.isInteger(candidate.row) || candidate.row < 0 || candidate.row >= rows) continue;
    const id = safeText(candidate.id, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const states = Array.isArray(candidate.states)
      ? [...new Set(candidate.states.filter((state) => typeof state === 'string' && ALLOWED_ANIMATION_STATES.has(state)))].slice(0, 10)
      : [];
    animations.push({
      id,
      label: safeText(candidate.label, 32, id),
      row: candidate.row,
      mode: candidate.mode === 'once' ? 'once' : 'loop',
      states,
      ...(Number.isFinite(candidate.fps) ? { fps: safeNumber(candidate.fps, 1, 30, 6) } : {}),
    });
  }
  return animations.length ? animations : undefined;
}

function sanitizeBehavior(value, maximumRow = 8) {
  if (!isPlainObject(value)) return undefined;
  const output = {};
  if (Number.isFinite(value.fps)) output.fps = safeNumber(value.fps, 1, 30, 6);
  for (const key of ['walkRightRow', 'walkLeftRow', 'thinkingRow', 'talkingRow', 'draggingRow']) {
    if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= maximumRow) output[key] = value[key];
  }
  if (Array.isArray(value.idleRows)) {
    output.idleRows = value.idleRows.filter((row) => Number.isInteger(row) && row >= 0 && row <= maximumRow).slice(0, 16);
  }
  return Object.keys(output).length ? output : undefined;
}

function loadManifest(manifestPath, folderName) {
  const manifestStat = fs.lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw new Error('pet.json 必须是普通文件');
  if (manifestStat.size <= 1) throw new Error('pet.json 为空');
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error('pet.json 超过 256 KB 限制');

  const raw = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error('pet.json 顶层必须是对象');

  const requestedSheet = safeText(parsed.spritesheetPath, 120, DEFAULT_SPRITESHEET_FILE);
  if (path.basename(requestedSheet) !== requestedSheet || path.extname(requestedSheet).toLowerCase() !== '.webp') {
    throw new Error('spritesheetPath 只允许角色目录内的 .webp 文件名');
  }

  const atlas = sanitizeAtlas(parsed.atlas);
  return {
    id: safeText(parsed.id, 80, folderName),
    displayName: safeText(parsed.displayName, 32, folderName),
    description: safeText(parsed.description, 500),
    spritesheetPath: requestedSheet,
    spriteVersionNumber: Number.isInteger(parsed.spriteVersionNumber)
      ? Math.max(1, Math.min(999, parsed.spriteVersionNumber))
      : undefined,
    atlas,
    animations: sanitizeAnimations(parsed.animations, atlas.rows),
    behavior: sanitizeBehavior(parsed.behavior, atlas.rows - 1),
  };
}

function issue(folderName, code, message) {
  return { folderName, code, message };
}

function scanCharacterPackages(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  fs.mkdirSync(resolvedRoot, { recursive: true });

  const packages = [];
  const issues = [];
  const seenIds = new Set();
  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

  for (const entry of entries) {
    const folderName = safeText(entry.name, 120);
    if (!folderName) continue;
    const packagePath = path.join(resolvedRoot, entry.name);

    try {
      const packageStat = fs.lstatSync(packagePath);
      if (packageStat.isSymbolicLink() || !packageStat.isDirectory()) {
        issues.push(issue(folderName, 'UNSAFE_PACKAGE', '角色目录不能是符号链接'));
        continue;
      }

      const manifestPath = path.join(packagePath, MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        issues.push(issue(folderName, 'MISSING_MANIFEST', '缺少 pet.json'));
        continue;
      }

      const manifest = loadManifest(manifestPath, folderName);
      const spritesheetPath = path.join(packagePath, manifest.spritesheetPath);
      if (!fs.existsSync(spritesheetPath)) {
        issues.push(issue(folderName, 'MISSING_SPRITESHEET', `缺少 ${manifest.spritesheetPath}`));
        continue;
      }

      const image = inspectWebp(spritesheetPath, manifest.atlas);
      const packageId = `character-package:${folderName}`;
      if (seenIds.has(packageId)) {
        issues.push(issue(folderName, 'DUPLICATE_ID', '角色目录标识重复'));
        continue;
      }
      seenIds.add(packageId);
      packages.push({
        id: packageId,
        folderName,
        manifest,
        image,
      });
    } catch (error) {
      const message = error instanceof SyntaxError
        ? 'pet.json 不是有效 JSON'
        : safeText(error?.message, 180, '角色包解析失败');
      issues.push(issue(folderName, 'INVALID_PACKAGE', message));
    }
  }

  return {
    rootPath: resolvedRoot,
    scannedAt: new Date().toISOString(),
    packages,
    issues,
  };
}

module.exports = {
  DEFAULT_SPRITESHEET_FILE,
  MAX_MANIFEST_BYTES,
  MAX_SPRITESHEET_BYTES,
  inspectWebp,
  parseWebpHeader,
  scanCharacterPackages,
};
