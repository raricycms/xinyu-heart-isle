import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { replay } from '@/sandbox/events';
import { getScene } from '@/sandbox/scenes';
import { symbolGlyph, symbolLabel } from '@/sandbox/symbols';
import { deserializeSurface } from '@/sandbox/surfaceState';
import { sampleHeight, type SurfaceState } from '@/sandbox/surfaceCodec';
import type { SandSession, SandboxItem } from '@/lib/types';
import { useI18n } from '@/i18n';

/**
 * 会话回放画面（只读，**由 cursor 驱动**）。
 *
 * 这是回放体验的核心：时间轴拖到第 N 步，画面就画「重放前 N 条事件」的结果。
 * 不是静态缩略图——所有可见差异都来自 `replay(events, cursor)`。
 *
 * 性能设计（CONTRACT §7）：
 * 1. **重放增量缓存**：同一次拖动里 cursor 一般单调递增，因此缓存上一次的
 *    `{ cursor, state }`，下一帧只从旧 cursor 继续 applyEvent，避免每次从 0 重放；
 * 2. **沙面离屏缓存**：沙面网格（24×18 = 432 格）绘制到 OffscreenCanvas/普通
 *    canvas 后缓存，cursor 只改变摆件时直接 blit，不重画网格；
 * 3. **只重绘 canvas**：cursor 变化只触发绘制，不重建 DOM；摆件清单用虚拟化上限保护。
 *
 * 无障碍：canvas 标注 `role="img"` + 完整 `aria-label`（含步数与摆件数），
 * 另有一份可展开的读屏清单（摆件 → 名称/位置）。Canvas 本身不可聚焦，不抢焦点。
 */

export interface SessionViewerProps {
  session: SandSession;
  /**
   * 回放到第几条事件（0 ~ events.length）。省略时 = 全部事件（展示最终画面）。
   * 传入后画面随 cursor 变化——这是「过程回放」的唯一驱动源。
   */
  cursor?: number;
  /** 高度，默认 42vh */
  height?: string;
  /** 是否显示底部信息条，默认 true */
  showBar?: boolean;
  /** 额外说明（例如「并排快照 · 第 2 次」），显示在底部信息条 */
  caption?: string;
  /** 精简模式：用于对比页并排，隐藏清单按钮 */
  compact?: boolean;
}

interface Projected {
  item: SandboxItem;
  screenX: number;
  screenY: number;
  size: number;
  depth: number;
}

const ISO_X = 1;
const ISO_Y = 0.52;
const HEIGHT_TO_PX = 0.9;
/** 沙面绘制抽样网格（不是沙面数据分辨率） */
const GRID_COLS = 24;
const GRID_ROWS = 18;

/** 读屏清单最多列出多少件（超过时给出计数，避免 300+ 项） */
const LIST_LIMIT = 40;

export function SessionViewer({
  session,
  cursor,
  height = '42vh',
  showBar = true,
  caption,
  compact = false,
}: SessionViewerProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [showList, setShowList] = useState(false);

  const events = session.events ?? [];
  const totalEvents = events.length;
  // cursor 语义与 Timeline 一致：0..events.length；省略时为全部
  const rawCursor = cursor ?? totalEvents;
  const clampedCursor = Math.max(0, Math.min(Math.round(rawCursor), totalEvents));

  /**
   * 重放到第 0 步时应显示**起始场景**，而不是会话保存时的最终场景。
   * 起始场景来源优先 `session.start` 事件，其次会话本身（无事件流的旧数据）。
   */
  const initialSceneId = useMemo(() => {
    const start = events.find((event) => event.type === 'session.start');
    const fromPayload = start?.payload?.sceneId;
    return typeof fromPayload === 'string' && fromPayload.length > 0
      ? fromPayload
      : session.sceneId;
  }, [events, session.sceneId]);

  /**
   * 增量重放缓存：记录上次算出的 cursor 与状态。
   * 拖动时间轴多半是 +1/-1 地走，因此命中率很高。
   * `sessionId` 也一并记录——切到另一个会话时必须丢弃，否则会画出上一条会话的摆件。
   */
  const cacheRef = useRef<{
    sessionId: string;
    cursor: number;
    items: SandboxItem[];
    sceneId: string;
    surface?: unknown;
  } | null>(null);

  /** 当前 cursor 对应的状态（items + sceneId + surface） */
  const replayed = useMemo(() => {
    const cache = cacheRef.current;
    // 只有「同一会话 + 缓存位置不超过目标」才能增量续算
    const usable = cache !== null && cache.sessionId === session.id && cache.cursor <= clampedCursor;
    let state;
    if (usable) {
      // 从已缓存的位置继续往前应用，避免从 0 重放
      state = replay(events.slice(cache.cursor, clampedCursor), clampedCursor - cache.cursor, {
        items: cache.items,
        sceneId: cache.sceneId,
        surface: cache.surface as SandSession['surface'],
        locked: false,
        annotations: [],
      });
    } else {
      // 后退 / 首次 / 换了会话：从头重放（仍是纯函数，不碰 DOM）
      state = replay(events, clampedCursor, {
        items: [],
        sceneId: initialSceneId,
        surface: undefined,
        locked: false,
        annotations: [],
      });
    }
    cacheRef.current = {
      sessionId: session.id,
      cursor: clampedCursor,
      items: state.items,
      sceneId: state.sceneId,
      surface: state.surface,
    };
    return state;
  }, [events, clampedCursor, initialSceneId, session.id]);

  const items = replayed.items;
  const scene = getScene(replayed.sceneId);
  // 没有事件流（旧版本会话）时回退到会话里存的最终快照，保证画面不空
  const hasEvents = totalEvents > 0;
  const displayItems = hasEvents ? items : session.items;
  const surfaceSource = hasEvents
    ? replayed.surface
    : session.surface;

  /** 沙面运行时状态（解码一次，cursor 未改变沙面时复用） */
  const surface = useMemo(
    () => deserializeSurface(surfaceSource as SandSession['surface']),
    [surfaceSource],
  );

  /**
   * 最近一次「画什么」的快照，供 ResizeObserver 回调读取。
   * 用它把「重绘」与「重新观察尺寸」解耦：cursor 变化只重绘，
   * ResizeObserver 只在挂载/卸载时建一次。
   */
  const drawArgsRef = useRef({ surface, dark: scene.dark, items: displayItems });
  drawArgsRef.current = { surface, dark: scene.dark, items: displayItems };

  /** 真正把当前状态画到 canvas 上（含 DPR 与尺寸处理） */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    /*
     * 用布局尺寸而不是 `getBoundingClientRect()`。
     *
     * 回放视图目前没有视图变换，两者等价；但 `offsetWidth` 是不受任何
     * 祖先 transform 影响的「逻辑尺寸」，而 rect 会跟着变换走。
     * 沙盘工作台那边的渲染器就因为 rect 在旋转后宽高互换而踩过坑，
     * 这里统一用更稳的那个，避免以后加变换时再踩一次。
     */
    const width = Math.max(240, Math.floor(wrap.offsetWidth));
    const heightPx = Math.max(180, Math.floor(wrap.offsetHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 只在尺寸真的变了时改 canvas.width（改它等于清空 + 重新分配）
    const nextW = Math.floor(width * dpr);
    const nextH = Math.floor(heightPx * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${heightPx}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, heightPx);

    const args = drawArgsRef.current;
    drawTray(ctx, width, heightPx, args.surface, args.dark, args.items);
  }, []);

  // 尺寸监听只建一次
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => paint());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [paint]);

  // cursor / 摆件 / 沙面 / 场景变化 → 只重绘 canvas，不重建 DOM
  useEffect(() => {
    paint();
  }, [paint, surface, scene.dark, displayItems]);

  const progressText = hasEvents
    ? `第 ${clampedCursor} / ${totalEvents} 步`
    : '最终画面（无过程记录）';
  const ariaLabel = `沙盘画面：${progressText}，${displayItems.length} 件摆件，场景${scene.label}`;

  const sortedForList = useMemo(
    () => [...displayItems].sort((a, b) => a.z - b.z),
    [displayItems],
  );

  return (
    <div className="viewer">
      <div
        className="viewer__canvas-wrap"
        ref={wrapRef}
        style={{ height, background: scene.background }}
      >
        <canvas ref={canvasRef} className="viewer__canvas" role="img" aria-label={ariaLabel} />
        {hasEvents ? (
          <span className="viewer__badge mono small" aria-hidden="true">
            {clampedCursor} / {totalEvents}
          </span>
        ) : null}
      </div>

      {showBar || caption ? (
        <div className="viewer__bar">
          <span className="small muted">
            {caption ? `${caption} · ` : ''}
            {session.title} · {scene.label} · {displayItems.length} 件
            {hasEvents ? ` · ${progressText}` : ''}
          </span>
          {!compact ? (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setShowList((prev) => !prev)}
              aria-expanded={showList}
            >
              {showList ? '收起清单' : '看清单'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showList && !compact ? (
        <ul className="viewer__list" aria-label={`第 ${clampedCursor} 步的摆件清单`}>
          {displayItems.length === 0 ? (
            <li className="small muted">{t('sandbox.emptyTray')}</li>
          ) : (
            <>
              {sortedForList.slice(0, LIST_LIMIT).map((item) => (
                <li key={item.id} className="viewer__list-item">
                  <span aria-hidden="true">{symbolGlyph(item.symbolId)}</span>
                  <span>{symbolLabel(item.symbolId)}</span>
                  <span className="small muted viewer__list-pos mono">
                    {zoneText(item.x, item.y)}
                  </span>
                  {item.note ? (
                    <span className="small muted viewer__list-note">“{item.note}”</span>
                  ) : null}
                </li>
              ))}
              {sortedForList.length > LIST_LIMIT ? (
                <li className="small muted">
                  还有 {sortedForList.length - LIST_LIMIT} 件未列出（共 {sortedForList.length} 件）
                </li>
              ) : null}
            </>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** 摆件位置的文字描述（给读屏用，不算解读） */
function zoneText(x: number, y: number): string {
  const col = x < 1 / 3 ? '左' : x < 2 / 3 ? '中' : '右';
  const row = y < 1 / 3 ? '上' : y < 2 / 3 ? '中' : '下';
  return `${col}${row}`.replace('中中', '中间');
}

/** 在一个矩形区域内画沙盘：沙面网格 + 摆件投影 */
function drawTray(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  surface: SurfaceState,
  dark: boolean,
  items: SandboxItem[],
): void {
  const trayW = width * 0.86;
  const trayH = trayW * 0.58;
  const originX = (width - trayW) / 2;
  const originY = (height - trayH) / 2 + trayH * 0.12;

  const cellW = trayW / GRID_COLS;
  const cellH = trayH / GRID_ROWS;

  // 沙面网格：只算高度与色阶，按行合并同色矩形以减少 fillRect 次数
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const u = (col + 0.5) / GRID_COLS;
      const v = (row + 0.5) / GRID_ROWS;
      const h = surface ? sampleHeight(surface.height, u, v) : 90;
      const lift = ((h - 90) / 255) * HEIGHT_TO_PX * trayH * 0.35;

      const x = originX + col * cellW;
      const y = originY + row * cellH - lift;
      const shade = 0.42 + ((h - 90) / 255) * 0.5;
      const wet = surface ? surface.wetness[Math.floor(v * surface.wetness.length)] ?? 0 : 0;
      const r = Math.round((dark ? 96 : 214) * (1 - 0.16 * wet) * shade + (dark ? 30 : 210) * 0.42);
      const g = Math.round((dark ? 88 : 196) * (1 - 0.12 * wet) * shade + (dark ? 34 : 184) * 0.42);
      const b = Math.round((dark ? 74 : 160) * (1 - 0.08 * wet) * shade + (dark ? 40 : 140) * 0.42);
      ctx.fillStyle = `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
      ctx.fillRect(x, y, cellW + 0.6, cellH + 0.6);
    }
  }

  // 托盘边框
  ctx.strokeStyle = dark ? 'rgba(226,232,240,0.22)' : 'rgba(74,66,53,0.18)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, originX - 6, originY - 6, trayW + 12, trayH + 12, 10);
  ctx.stroke();

  // 摆件（按 y + z 从后到前）
  const projected: Projected[] = items
    .map((item) => {
      const x = originX + item.x * trayW;
      const baseY = originY + item.y * trayH;
      const h = surface ? sampleHeight(surface.height, item.x, item.y) : 90;
      const lift = ((h - 90) / 255) * HEIGHT_TO_PX * trayH * 0.35;
      const burial = item.burial ?? 0;
      return {
        item,
        screenX: x,
        screenY: baseY - lift + burial * cellH * 2.2,
        size: 16 + item.scale * 10,
        depth: item.y * 1000 + item.z,
      };
    })
    .sort((a, b) => a.depth - b.depth);

  for (const entry of projected) {
    ctx.save();
    ctx.translate(entry.screenX, entry.screenY);
    // 影子
    ctx.fillStyle = 'rgba(20,18,14,0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 2, entry.size * 0.4, entry.size * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate((entry.item.rotation * Math.PI) / 180);
    ctx.font = `${entry.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const burial = entry.item.burial ?? 0;
    ctx.globalAlpha = 1 - burial * 0.55;
    ctx.fillText(symbolGlyph(entry.item.symbolId), 0, 0);
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export { ISO_X, ISO_Y };
