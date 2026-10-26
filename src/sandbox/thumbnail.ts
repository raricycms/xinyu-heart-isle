/**
 * 沙盘缩略图。
 *
 * 为什么需要：档案页与记录单的「导出图片」依赖 `session.thumbnail`。
 * 若封盘时不写，导出按钮只能 disabled，用户会觉得功能坏了。
 *
 * 设计取舍：
 * - **不截 canvas**。渲染器有三种（dom2d 是 DOM 按钮、iso2d 是 canvas、
 *   three 是 WebGL），只有 iso2d 能直接 `toDataURL`，另两种截不到。
 *   所以这里**按会话数据重画**，三个渲染器得到一致的缩略图。
 * - **体积优先**。缩略图会进 localStorage（约 5MB 上限），
 *   所以固定 320×200、JPEG 质量 0.72，单张约 8–14KB。
 * - **纯函数式**：输入会话，输出 dataURL，不读 DOM，可在测试里跑。
 */
import type { SandSession } from '@/lib/types';
import { SURFACE_COLS, SURFACE_ROWS } from '@/sandbox/surfaceCodec';
import { deserializeSurface } from '@/sandbox/surfaceState';
import { getScene } from '@/sandbox/scenes';
import { symbolGlyph } from '@/sandbox/symbols';

export const THUMB_WIDTH = 320;
export const THUMB_HEIGHT = 200;
const THUMB_QUALITY = 0.72;

/**
 * 从会话生成缩略图 dataURL。
 * 在没有 DOM（如 Node 测试环境）时返回 null，调用方需容错。
 */
export function renderThumbnail(session: SandSession): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const scene = getScene(session.sceneId);

    // 背景
    ctx.fillStyle = scene.background;
    ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

    // 沙盘托盘（与 iso2d 的比例保持视觉一致）
    const trayW = THUMB_WIDTH * 0.82;
    const trayH = trayW * 0.6;
    const trayX = (THUMB_WIDTH - trayW) / 2;
    const trayY = (THUMB_HEIGHT - trayH) / 2 + trayH * 0.06;

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, trayX, trayY, trayW, trayH, 8);
    ctx.clip();

    // 沙面底
    ctx.fillStyle = scene.ground;
    ctx.fillRect(trayX, trayY, trayW, trayH);

    // 沙面高低起伏：用高度场重画，让缩略图能看出"被推过"
    const surface = session.surface ? deserializeSurface(session.surface) : null;
    if (surface) {
      const cellW = trayW / SURFACE_COLS;
      const cellH = trayH / SURFACE_ROWS;
      const field = surface.height.data;
      for (let row = 0; row < SURFACE_ROWS; row += 1) {
        for (let col = 0; col < SURFACE_COLS; col += 1) {
          const height = field[row * SURFACE_COLS + col] ?? 0;
          if (height <= 0) continue;
          // 高度 0–255 → 亮度偏移，堆高更亮、凹陷更暗
          const lift = (height - 90) / 255;
          if (Math.abs(lift) < 0.02) continue;
          ctx.fillStyle = lift > 0 ? `rgba(255,248,235,${Math.min(0.5, lift * 1.6)})` : `rgba(120,96,70,${Math.min(0.5, -lift * 1.6)})`;
          ctx.fillRect(trayX + col * cellW, trayY + row * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }

    // 摆件：按 z 从低到高画，保证遮挡关系正确
    const sorted = [...session.items].sort((a, b) => a.z - b.z);
    for (const item of sorted) {
      const x = trayX + item.x * trayW;
      const y = trayY + item.y * trayH;
      const size = Math.max(9, Math.min(20, 11 * item.scale));
      ctx.save();
      ctx.globalAlpha = item.burial && item.burial > 0 ? Math.max(0.15, 1 - item.burial * 0.85) : 1;
      ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbolGlyph(item.symbolId), x, y);
      ctx.restore();
    }
    ctx.restore();

    // 托盘描边
    ctx.strokeStyle = scene.dark ? 'rgba(255,255,255,0.22)' : 'rgba(90,72,52,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    roundRect(ctx, trayX, trayY, trayW, trayH, 8);
    ctx.stroke();

    return canvas.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch {
    return null;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
