import { describe, expect, it } from 'vitest';
import {
  SURFACE_BASE_LEVEL,
  SURFACE_COLS,
  SURFACE_ROWS,
  base64ToBytes,
  bytesToBase64,
  createHeightField,
  createSurfaceState,
  decodeField,
  encodeField,
  getHeight,
  heightToCm,
  relax,
  sampleHeight,
} from '@/sandbox/surfaceCodec';
import {
  applyBrush,
  applyStroke,
  digSand,
  emptySurface,
  estimateWetRatio,
  flattenSand,
  raiseSand,
  rakeSand,
  smoothSand,
  surfaceStats,
  tunnelSand,
  waterSand,
} from '@/sandbox/surfaceOps';

describe('height field 基础', () => {
  it('默认尺寸为 128×96，基准高度正确', () => {
    const field = createHeightField();
    expect(field.cols).toBe(SURFACE_COLS);
    expect(field.rows).toBe(SURFACE_ROWS);
    expect(field.data.length).toBe(SURFACE_COLS * SURFACE_ROWS);
    expect(field.data[0]).toBe(SURFACE_BASE_LEVEL);
  });

  it('越界读取按最近内侧值外推（笔刷边缘不留硬边）', () => {
    const field = createHeightField(4, 4, 0);
    field.data[0] = 100;
    expect(getHeight(field, -3, -2)).toBe(100);
  });

  it('双线性采样在角点为精确值', () => {
    const field = createHeightField(2, 2, 0);
    field.data[0] = 10;
    field.data[1] = 20;
    field.data[2] = 30;
    field.data[3] = 40;
    expect(sampleHeight(field, 0, 0)).toBeCloseTo(10, 5);
    expect(sampleHeight(field, 1, 1)).toBeCloseTo(40, 5);
    expect(sampleHeight(field, 0.5, 0.5)).toBeCloseTo(25, 5);
  });

  it('高度转厘米映射到 0~7cm', () => {
    expect(heightToCm(0)).toBe(0);
    expect(heightToCm(255)).toBeCloseTo(7, 5);
  });
});

describe('RLE 编解码', () => {
  it('均匀场编码后极小', () => {
    const field = createHeightField();
    const encoded = encodeField(field);
    // 128×96 = 12288 个同值格 -> 头部 11 字节 + 1 run（value + varint 长度）
    expect(encoded.length).toBeLessThan(40);
  });

  it('往返一致（随机噪声场）', () => {
    const field = createHeightField(32, 24, 0);
    let seed = 12345;
    for (let i = 0; i < field.data.length; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      field.data[i] = seed % 256;
    }
    const decoded = decodeField(encodeField(field));
    expect(decoded).not.toBeNull();
    expect(decoded!.cols).toBe(32);
    expect(decoded!.rows).toBe(24);
    expect(Array.from(decoded!.data)).toEqual(Array.from(field.data));
  });

  it('往返一致（雕刻后的场）', () => {
    const state = applyStroke(createSurfaceState(), 'dig', [
      { x: 0.2, y: 0.3 },
      { x: 0.7, y: 0.6 },
    ], 0.12, 0.8);
    const decoded = decodeField(encodeField(state.height));
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!.data)).toEqual(Array.from(state.height.data));
  });

  it('损坏数据返回 null 而不抛错', () => {
    expect(decodeField('')).toBeNull();
    expect(decodeField('!!!')).toBeNull();
    expect(decodeField('AAAA')).toBeNull();
    // 合法 Base64 但内容不是 RLE 头部
    expect(decodeField(bytesToBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])))).toBeNull();
  });

  it('编解码体积在预算内（< 8KB 典型雕刻）', () => {
    let state = createSurfaceState();
    for (let i = 0; i < 12; i += 1) {
      state = raiseSand(state, { x: 0.2 + i * 0.05, y: 0.5, radius: 0.08, strength: 0.7 });
    }
    const encoded = encodeField(state.height);
    expect(encoded.length).toBeLessThan(8192);
  });
});

describe('Base64', () => {
  it('往返一致', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const encoded = bytesToBase64(bytes);
    const decoded = base64ToBytes(encoded);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!)).toEqual(Array.from(bytes));
  });

  it('空输入返回 null', () => {
    expect(base64ToBytes('')).toBeNull();
  });

  it('三字节边界 padding 正确', () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(bytesToBase64(new Uint8Array([1, 2]))).toBe('AQI=');
    expect(bytesToBase64(new Uint8Array([1]))).toBe('AQ==');
  });
});

describe('休止角', () => {
  it('松弛后高差下降（沙会流）', () => {
    const field = createHeightField(16, 16, 0);
    field.data[8 * 16 + 8] = 255;
    const before = Math.abs(getHeight(field, 8, 8) - getHeight(field, 9, 8));
    const relaxed = relax(field, 3);
    const after = Math.abs(getHeight(relaxed, 8, 8) - getHeight(relaxed, 9, 8));
    expect(after).toBeLessThan(before);
  });

  it('松弛不改变总高度显著量级', () => {
    const field = createHeightField(8, 8, 100);
    field.data[10] = 200;
    const relaxed = relax(field, 2);
    const sum = (arr: Uint8Array) => Array.from(arr).reduce((a, b) => a + b, 0);
    // 转移允许 ±1 的取整误差
    expect(Math.abs(sum(relaxed.data) - sum(field.data))).toBeLessThanOrEqual(64);
  });

  it('湿沙允许更陡的坡（阈值更高）', () => {
    const dry = createHeightField(16, 16, 0);
    dry.data[8 * 16 + 8] = 200;
    const wet = createHeightField(16, 16, 0);
    wet.data[8 * 16 + 8] = 200;
    const dryOut = relax(dry, 1, 18, false);
    const wetOut = relax(wet, 1, 18, true);
    expect(getHeight(wetOut, 8, 8)).toBeGreaterThanOrEqual(getHeight(dryOut, 8, 8));
  });
});

describe('笔刷操作', () => {
  it('推沙抬升中心高度', () => {
    const state = raiseSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.15, strength: 1 });
    expect(sampleHeight(state.height, 0.5, 0.5)).toBeGreaterThan(SURFACE_BASE_LEVEL);
  });

  it('挖沙降低中心高度，可挖到底', () => {
    let state = createSurfaceState();
    for (let i = 0; i < 8; i += 1) {
      state = digSand(state, { x: 0.5, y: 0.5, radius: 0.2, strength: 1 });
    }
    expect(sampleHeight(state.height, 0.5, 0.5)).toBeLessThan(SURFACE_BASE_LEVEL);
    expect(surfaceStats(state).dugToBottomRatio).toBeGreaterThan(0);
  });

  it('抹平让邻域更平', () => {
    let state = raiseSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.1, strength: 1 });
    const before = Math.abs(
      sampleHeight(state.height, 0.5, 0.5) - sampleHeight(state.height, 0.56, 0.5),
    );
    for (let i = 0; i < 6; i += 1) {
      state = smoothSand(state, { x: 0.5, y: 0.5, radius: 0.2, strength: 1 });
    }
    const after = Math.abs(
      sampleHeight(state.height, 0.5, 0.5) - sampleHeight(state.height, 0.56, 0.5),
    );
    expect(after).toBeLessThan(before);
  });

  it('耙纹产生高低起伏', () => {
    const state = rakeSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.3, strength: 1, phase: 0 });
    const stats = surfaceStats(state);
    expect(stats.maxHeight).toBeGreaterThan(SURFACE_BASE_LEVEL);
    expect(stats.minHeight).toBeLessThan(SURFACE_BASE_LEVEL);
  });

  it('喷水提高湿度并进入湿沙状态', () => {
    let state = createSurfaceState();
    for (let i = 0; i < 3; i += 1) {
      state = waterSand(state, { x: 0.5, y: 0.5, radius: 0.3, strength: 1 });
    }
    expect(state.state).toBe('wet');
    expect(estimateWetRatio(state)).toBeGreaterThan(0);
    expect(state.waterAdded).toBe(3);
  });

  it('隧道挖到基准面以下并变湿', () => {
    const state = tunnelSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.12, strength: 1 });
    expect(sampleHeight(state.height, 0.5, 0.5)).toBeLessThan(SURFACE_BASE_LEVEL);
    expect(state.state).toBe('wet');
  });

  it('全网抹平回到基准面', () => {
    let state = raiseSand(createSurfaceState(), { x: 0.5, y: 0.5, radius: 0.4, strength: 1 });
    state = flattenSand(state);
    const stats = surfaceStats(state);
    expect(stats.minHeight).toBe(SURFACE_BASE_LEVEL);
    expect(stats.maxHeight).toBe(SURFACE_BASE_LEVEL);
  });

  it('applyBrush 未知工具返回原状态引用', () => {
    const state = createSurfaceState();
    const out = applyBrush(state, 'unknown' as never, { x: 0.5, y: 0.5, radius: 0.1, strength: 1 });
    expect(out).toBe(state);
  });

  it('applyStroke 在路径上连续生效（不跳点）', () => {
    const state = applyStroke(
      createSurfaceState(),
      'raise',
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      0.05,
      1,
    );
    // 路径中点也应有抬升
    expect(sampleHeight(state.height, 0.5, 0.5)).toBeGreaterThan(SURFACE_BASE_LEVEL);
    expect(sampleHeight(state.height, 0.3, 0.5)).toBeGreaterThan(SURFACE_BASE_LEVEL);
  });

  it('不改入参（纯函数）', () => {
    const state = createSurfaceState();
    const snapshot = Array.from(state.height.data);
    raiseSand(state, { x: 0.5, y: 0.5, radius: 0.2, strength: 1 });
    expect(Array.from(state.height.data)).toEqual(snapshot);
  });

  it('emptySurface 返回基准场', () => {
    const state = emptySurface(8, 8);
    expect(state.height.cols).toBe(8);
    expect(surfaceStats(state).movedRatio).toBe(0);
  });
});
