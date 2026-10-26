/**
 * 心屿 · 沙面运行时状态 <-> 持久化 `SandSurface` 的桥接
 *
 * 会话里存的是压缩后的字符串，运行时用的是 Uint8Array。
 * 本文件负责两者互转，是渲染器、笔刷引擎、序列化三者的唯一连接点。
 */

import type { SandSurface } from '@/lib/types';
import {
  SURFACE_COLS,
  SURFACE_ROWS,
  SURFACE_VERSION,
  base64ToBytes,
  bytesToBase64,
  decodeField,
  encodeField,
  type HeightField,
  type SurfaceState,
  createSurfaceState,
} from '@/sandbox/surfaceCodec';

/** 运行时状态 -> 会话里的 `SandSurface` */
export function serializeSurface(state: SurfaceState): SandSurface {
  const encoded: SandSurface = {
    cols: state.height.cols,
    rows: state.height.rows,
    height: encodeField(state.height),
    state: state.state,
    waterAdded: state.waterAdded,
  };
  // 只有真的湿了才写湿度分布，避免无谓体积
  if (state.waterAdded > 0) {
    encoded.wetness = bytesToBase64(encodeWetnessRle(state.wetness));
  }
  return encoded;
}

/** 会话里的 `SandSurface` -> 运行时状态；无法解码时返回空白沙面 */
export function deserializeSurface(surface: SandSurface | undefined): SurfaceState {
  if (!surface) return createSurfaceState();
  const field = decodeField(surface.height);
  if (!field) return createSurfaceState(surface.cols || SURFACE_COLS, surface.rows || SURFACE_ROWS);
  const state = createSurfaceState(field.cols, field.rows);
  state.height = field;
  state.state = surface.state === 'wet' ? 'wet' : 'dry';
  state.waterAdded = surface.waterAdded ?? 0;
  if (surface.wetness) {
    const bytes = base64ToBytes(surface.wetness);
    const decoded = bytes ? decodeWetnessRle(bytes, field.cols * field.rows) : null;
    if (decoded) state.wetness = decoded;
  }
  return state;
}

/* -------------------------------------------------------------------------- */
/*                              湿度场（单通道）                                */
/* -------------------------------------------------------------------------- */

function encodeWetnessRle(wetness: Uint8Array): Uint8Array {
  const runs: number[] = [];
  let i = 0;
  while (i < wetness.length) {
    const value = wetness[i];
    let length = 1;
    while (i + length < wetness.length && wetness[i + length] === value && length < 0xffffff) {
      length += 1;
    }
    runs.push(value);
    let v = length;
    while (v >= 0x80) {
      runs.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    runs.push(v);
    i += length;
  }
  const header = new Uint8Array([0x57, 0x31, SURFACE_VERSION]);
  const out = new Uint8Array(header.length + runs.length);
  out.set(header, 0);
  out.set(runs, header.length);
  return out;
}

function decodeWetnessRle(bytes: Uint8Array, expected: number): Uint8Array | null {
  if (bytes.length < 3 || bytes[0] !== 0x57 || bytes[1] !== 0x31) return null;
  const out = new Uint8Array(expected);
  let offset = 3;
  let written = 0;
  while (offset < bytes.length && written < expected) {
    const value = bytes[offset];
    offset += 1;
    let length = 0;
    let shift = 0;
    while (offset < bytes.length) {
      const byte = bytes[offset];
      offset += 1;
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    if (length <= 0) return null;
    const end = Math.min(expected, written + length);
    out.fill(value, written, end);
    written = end;
  }
  return written === expected ? out : null;
}

export type { HeightField, SurfaceState };
export { SURFACE_COLS, SURFACE_ROWS, SURFACE_VERSION };
