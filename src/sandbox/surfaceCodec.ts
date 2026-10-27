/**
 * 心屿 · 沙面高度场编解码
 *
 * VISION.md §5.1 L2 方案：`Uint8Array(cols*rows)` 高度（0~255 映射 0~7cm），
 * RLE 压缩后约 2~6KB，可直接进快照。
 *
 * 编码格式（自定义，无依赖，两端都在本文件）：
 *
 *   header: 'S1' | ver(1B) | cols(2B LE) | rows(2B LE) | count(4B LE)
 *   runs:   [ value(1B) | length(1B~3B varint) ] × count
 *   body:   Base64(header + runs)
 *
 * 约束：默认高度图在没有雕刻时是「全 0 或全 1」的均匀场，RLE 后只有几十字节。
 */

export const SURFACE_COLS = 128;
export const SURFACE_ROWS = 96;
export const SURFACE_VERSION = 1;

/** 高度归一化：0~255 映射 0~7cm */
export const HEIGHT_MAX_CM = 7;
/** 基准沙面高度（未雕刻时砂面在 0.35 高度处，留出挖到底的空间） */
export const SURFACE_BASE_LEVEL = 90;

export interface HeightField {
  cols: number;
  rows: number;
  data: Uint8Array;
}

/** 沙面运行时状态（渲染器与笔刷引擎共用的唯一形状） */
export interface SurfaceState {
  /** 高度场（0~255） */
  height: HeightField;
  /** 湿度分布（0~255，0 = 干沙，255 = 饱和湿沙），与 height 同尺寸 */
  wetness: Uint8Array;
  /** 全局湿度档（工具层快速判断） */
  state: 'dry' | 'wet';
  /** 已喷水次数（客观记录） */
  waterAdded: number;
}

/** 新建空白沙面 */
export function createSurfaceState(
  cols: number = SURFACE_COLS,
  rows: number = SURFACE_ROWS,
): SurfaceState {
  return {
    height: createHeightField(cols, rows, SURFACE_BASE_LEVEL),
    wetness: new Uint8Array(cols * rows),
    state: 'dry',
    waterAdded: 0,
  };
}

/** 深拷贝沙面状态（撤销/重放用，避免共享引用被原地修改） */
export function cloneSurfaceState(state: SurfaceState): SurfaceState {
  return {
    height: cloneHeightField(state.height),
    wetness: new Uint8Array(state.wetness),
    state: state.state,
    waterAdded: state.waterAdded,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  基础工具                                   */
/* -------------------------------------------------------------------------- */

export function createHeightField(
  cols: number = SURFACE_COLS,
  rows: number = SURFACE_ROWS,
  fill: number = SURFACE_BASE_LEVEL,
): HeightField {
  const data = new Uint8Array(cols * rows);
  if (fill !== 0) data.fill(fill);
  return { cols, rows, data };
}

export function cloneHeightField(field: HeightField): HeightField {
  return { cols: field.cols, rows: field.rows, data: new Uint8Array(field.data) };
}

export function fieldIndex(field: HeightField, col: number, row: number): number {
  return row * field.cols + col;
}

export function getHeight(field: HeightField, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) {
    // 边缘外推：取最近的内侧值，避免笔刷边界出现硬边
    const c = Math.min(field.cols - 1, Math.max(0, col));
    const r = Math.min(field.rows - 1, Math.max(0, row));
    return field.data[r * field.cols + c];
  }
  return field.data[row * field.cols + col];
}

/** 双线性采样，输入为归一化坐标 0~1 */
export function sampleHeight(field: HeightField, x: number, y: number): number {
  const fx = Math.min(field.cols - 1, Math.max(0, x * (field.cols - 1)));
  const fy = Math.min(field.rows - 1, Math.max(0, y * (field.rows - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(field.cols - 1, x0 + 1);
  const y1 = Math.min(field.rows - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const h00 = getHeight(field, x0, y0);
  const h10 = getHeight(field, x1, y0);
  const h01 = getHeight(field, x0, y1);
  const h11 = getHeight(field, x1, y1);
  const top = h00 * (1 - tx) + h10 * tx;
  const bottom = h01 * (1 - tx) + h11 * tx;
  return top * (1 - ty) + bottom * ty;
}

/** 高度 0~255 -> 0~7cm */
export function heightToCm(height: number): number {
  return (height / 255) * HEIGHT_MAX_CM;
}

/* -------------------------------------------------------------------------- */
/*                                  RLE 编解码                                 */
/* -------------------------------------------------------------------------- */

function writeVarint(target: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    target.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  target.push(v);
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    value |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) break;
  }
  return { value, next: cursor };
}

/** RLE 编码为字节数组 */
export function encodeRle(field: HeightField): Uint8Array {
  const runs: number[] = [];
  const data = field.data;
  let i = 0;
  while (i < data.length) {
    const value = data[i];
    let length = 1;
    while (i + length < data.length && data[i + length] === value && length < 0xffffff) {
      length += 1;
    }
    runs.push(value);
    writeVarint(runs, length);
    i += length;
  }

  const count = runs.length; // 注意：runs 里 value 与 length 交替，这里只用于分配
  void count;

  // 先统计 run 数量
  let runCount = 0;
  let k = 0;
  while (k < runs.length) {
    runCount += 1;
    k += 1;
    // 跳过 varint 字节
    while (k < runs.length && (runs[k] & 0x80) !== 0) k += 1;
    k += 1;
  }

  const headerSize = 2 + 1 + 2 + 2 + 4;
  const out = new Uint8Array(headerSize + runs.length);
  out[0] = 0x53; // 'S'
  out[1] = 0x31; // '1'
  out[2] = SURFACE_VERSION;
  out[3] = field.cols & 0xff;
  out[4] = (field.cols >> 8) & 0xff;
  out[5] = field.rows & 0xff;
  out[6] = (field.rows >> 8) & 0xff;
  out[7] = runCount & 0xff;
  out[8] = (runCount >> 8) & 0xff;
  out[9] = (runCount >> 16) & 0xff;
  out[10] = (runCount >> 24) & 0xff;
  out.set(runs, headerSize);
  return out;
}

/** RLE 解码；损坏数据返回 null（调用方回退到空沙面） */
export function decodeRle(bytes: Uint8Array): HeightField | null {
  if (bytes.length < 11) return null;
  if (bytes[0] !== 0x53 || bytes[1] !== 0x31) return null;
  const cols = bytes[3] | (bytes[4] << 8);
  const rows = bytes[5] | (bytes[6] << 8);
  const runCount = bytes[7] | (bytes[8] << 8) | (bytes[9] << 16) | (bytes[10] << 24);
  if (cols <= 0 || rows <= 0 || cols > 512 || rows > 512) return null;
  if (runCount <= 0 || runCount > cols * rows) return null;

  const data = new Uint8Array(cols * rows);
  let offset = 11;
  let written = 0;
  for (let i = 0; i < runCount; i += 1) {
    if (offset >= bytes.length) return null;
    const value = bytes[offset];
    offset += 1;
    const { value: length, next } = readVarint(bytes, offset);
    offset = next;
    if (length <= 0) return null;
    const end = Math.min(data.length, written + length);
    data.fill(value, written, end);
    written = end;
    if (written >= data.length) break;
  }
  if (written !== data.length) return null;
  return { cols, rows, data };
}

/* -------------------------------------------------------------------------- */
/*                                Base64 包装                                  */
/* -------------------------------------------------------------------------- */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 手写 Base64（不依赖 btoa，Node 环境下也能跑，便于单元测试） */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i += 1) table[B64_CHARS.charCodeAt(i)] = i;
  return table;
})();

export function base64ToBytes(input: string): Uint8Array | null {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  if (clean.length === 0) return null;
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? B64_LOOKUP[code] : -1;
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return index === outLen ? out : out.subarray(0, index);
}

/* -------------------------------------------------------------------------- */
/*                              对外序列化接口                                 */
/* -------------------------------------------------------------------------- */

/** 高度场 -> 紧凑字符串（存入 `SandSurface.height`） */
export function encodeField(field: HeightField): string {
  return bytesToBase64(encodeRle(field));
}

/** 紧凑字符串 -> 高度场；损坏时返回 null */
export function decodeField(encoded: string): HeightField | null {
  const bytes = base64ToBytes(encoded);
  if (!bytes) return null;
  return decodeRle(bytes);
}

/** 估算编码后体积（字节） */
export function estimateEncodedSize(field: HeightField): number {
  return encodeRle(field).length;
}

/* -------------------------------------------------------------------------- */
/*                                  物理松弛                                   */
/* -------------------------------------------------------------------------- */

/**
 * 休止角松弛：相邻格高差超过 `threshold` 就把差值的一半转移给低的一侧。
 * 迭代 `passes` 次后得到「沙会流」的手感。
 *
 * 返回新场，不修改入参（便于撤销）。
 */
export function relax(field: HeightField, passes = 1, threshold = 18, wet = false): HeightField {
  const next = cloneHeightField(field);
  // 湿沙可以更陡（真的能立起来），干沙塌得更快
  const amp = wet ? 0.34 : 0.5;
  const limit = wet ? threshold * 1.9 : threshold;
  const { cols, rows, data } = next;

  for (let pass = 0; pass < passes; pass += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const here = data[i];
        // 四邻域：右、下（左/上由前序格子处理）
        if (col + 1 < cols) {
          const j = i + 1;
          const diff = here - data[j];
          if (Math.abs(diff) > limit) {
            const move = Math.round(diff * amp);
            data[i] -= move;
            data[j] += move;
          }
        }
        if (row + 1 < rows) {
          const k = i + cols;
          const diff = data[i] - data[k];
          if (Math.abs(diff) > limit) {
            const move = Math.round(diff * amp);
            data[i] -= move;
            data[k] += move;
          }
        }
      }
    }
  }
  return next;
}

/**
 * 说明：这里原本有一个 `fieldStats(field)`，返回平均高度 / 最低最高 /
 * 「挖到底」比例。它**一处调用都没有**（连测试都没写），纯死代码。
 *
 * 沙面统计的真实入口是 `surfaceOps.ts` 的 `surfaceStats(state)`，
 * 它会顺带算湿度，而且返回的字段确实被 SessionStats 展示。
 * 两个函数看起来像同一件事，实际只有后者在链路上 —— 留着前者只会
 * 让下一个改这里的人以为改的是产品行为。
 */
