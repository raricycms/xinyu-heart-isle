import { useCallback, useEffect, useRef } from 'react';
import { getScene } from '@/sandbox/scenes';
import { glyphFor, imageFor, imageReady, loadImage } from '@/sandbox/render/symbolSource';
import { symbolLabel } from '@/sandbox/symbols';
import { computeSandCells, glossFill, GLOSS_H_RATIO, GLOSS_INSET_X, GLOSS_INSET_Y, GLOSS_W_RATIO } from '@/sandbox/surface/sandCells';
import type { SandCell, Tray } from '@/sandbox/surface/sandCells';
import { useBrush } from '@/sandbox/surface/useBrush';
import { measureSandboxGeometry } from '@/sandbox/view/measure';
import type { SandboxItem } from '@/lib/types';
import type { SandRendererProps } from '@/sandbox/render/types';

/**
 * 2.5D 轴测渲染器（默认）。
 *
 * 为什么是手写 Canvas 2D 而不是 three（VISION.md §7.3 §13）：
 * 1. 主包预算 175KB——three 一进来就超；
 * 2. 沙盘是「俯视 + 轻微纵深」，正交投影足够，透视反而让人误判位置；
 * 3. Canvas 2D 在移动端更省电，且不会因为 WebGL 上下文丢失而白屏。
 *
 * 渲染管线（每帧）：
 *   高度场抽样 -> 逐格四边形（带高程位移 + 湿润/阴影调色）
 *   -> 摆件按 y+z 排序 -> 影子 -> emoji 字形
 *
 * 性能约束（CONTRACT §7）：
 * - 网格固定 32×24（768 格），单帧 < 4ms；
 * - 只在 items/surface/selection 变化时重绘，不跑 rAF 循环；
 * - 笔刷预览单独用一层浮层 canvas，避免整盘重绘。
 *
 * 视觉细节（沙面介质层，见 `src/sandbox/surface/sandCells.ts`）：
 * - 湿沙加深 ≥12% 并带高光；
 * - LIFT_RATIO 0.55，起伏看得见；
 * - 每格按坡度分左右明暗（光从左上）；
 * - 高度低于基准面处转冷灰，像挖到下层湿沙。
 */

/** 托盘在画布中的占比 */
const TRAY_W_RATIO = 0.88;
const TRAY_ASPECT = 0.6;

/**
 * 工具的中文名，只用于读屏播报。
 *
 * 为什么不用 `brush.tool` 直接插进 aria-label：
 * 那样读屏会念出 `raise` / `dig` 这样的**英文内部标识**，
 * 而界面全中文 —— 屏幕阅读器用户听到的是"当前工具：raise"，
 * 既听不懂又和视觉上的「推沙」对不上。
 * 这里做一次显式映射，未知值回落成通用说法，绝不漏出内部 id。
 */
const TOOL_LABELS: Record<string, string> = {
  raise: '推沙',
  dig: '挖沙',
  smooth: '抹平',
  rake: '耙纹',
  water: '喷水',
  tunnel: '挖洞',
  flatten: '重新铺沙',
};

function toolLabelFor(tool: string): string {
  return TOOL_LABELS[tool] ?? '沙面工具';
}

export function Iso2DRenderer({
  items,
  sceneId,
  selectedId,
  surface,
  readOnly,
  outlineMode,
  brush,
  imageMap,
  onSelect,
  onItemDrag,
  onItemCommit,
  onItemActivate,
  onSurfaceStroke,
  onCanvasClick,
}: SandRendererProps) {
  const scene = getScene(sceneId);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    from: { x: number; y: number };
    offsetX: number;
    offsetY: number;
  } | null>(null);

  /** 归一化坐标 -> 像素 */
  const trayRect = useCallback((width: number, height: number) => {
    const trayW = width * TRAY_W_RATIO;
    const trayH = trayW * TRAY_ASPECT;
    return {
      x: (width - trayW) / 2,
      y: (height - trayH) / 2 + trayH * 0.08,
      w: trayW,
      h: trayH,
    };
  }, []);

  const toNormalized = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const wrap = wrapRef.current;
      if (!wrap) return null;
      /*
       * 用 `measureSandboxGeometry` 而不是 `getBoundingClientRect()`：
       * 视图旋转会让 rect 的宽高互换、缩放会让归一化失效，
       * 而 `.normalized()` 已经把屏幕点逆变换回布局坐标系了。
       * 详见 `src/sandbox/view/measure.ts`。
       *
       * tray 偏移要在**布局坐标系**里减：`geometry.rect` 也是布局坐标，
       * `geometry.pointer()` 给出的是逆变换后的屏幕点，两者同系。
       */
      const geometry = measureSandboxGeometry(wrap);
      const { rect } = geometry;
      if (rect.width === 0 || rect.height === 0) return null;
      const tray = trayRect(rect.width, rect.height);
      const p = geometry.pointer(clientX, clientY);
      return {
        x: Math.min(1, Math.max(0, (p.x - rect.left - tray.x) / tray.w)),
        y: Math.min(1, Math.max(0, (p.y - rect.top - tray.y) / tray.h)),
      };
    },
    [trayRect],
  );

  /* ------------------------------- 基础层绘制 ------------------------------- */

  useEffect(() => {
    const canvas = baseRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      /*
       * canvas 的像素尺寸要用**布局尺寸**（offsetWidth/Height），
       * 不能用 `getBoundingClientRect()`：
       *
       * 视图变换（缩放/旋转）是 CSS transform 作用在渲染器外层，
       * 而 rect 会跟着变换走 —— 旋转 90° 时 canvas 会被重设成宽高互换的
       * 错误尺寸（实测 802×601 变 601×802），画面被拉伸。
       *
       * offsetWidth 不受 transform 影响，正是我们想要的「逻辑绘制区」尺寸。
       * 缩放带来的模糊由浏览器合成层处理（放大 4 倍会略糊，可接受；
       * 重设 canvas 尺寸反而会让每次缩放都重新绘制整幅画面）。
       */
      const width = Math.max(200, Math.floor(wrap.offsetWidth));
      const height = Math.max(160, Math.floor(wrap.offsetHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const tray = trayRect(width, height);
      const outline = outlineMode ?? false;
      drawSand(ctx, tray, surface, scene.dark);
      drawTrayEdge(ctx, tray, scene.dark, outline);
      drawItems(ctx, tray, items, selectedId, scene.dark, outline, imageMap);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [surface, items, selectedId, scene.dark, outlineMode, trayRect]);

  /* ------------------------------- 笔刷预览层 ------------------------------- */

  useEffect(() => {
    const canvas = overlayRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    // 同上：overlay canvas 也必须用布局尺寸，否则旋转后宽高互换
    const width = Math.max(200, Math.floor(wrap.offsetWidth));
    const height = Math.max(160, Math.floor(wrap.offsetHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!brush) return;

    const tray = trayRect(width, height);
    const cx = tray.x + brush.x * tray.w;
    const cy = tray.y + brush.y * tray.h;
    const r = brush.radius * tray.w;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = brush.active ? 'rgba(74,154,143,0.95)' : 'rgba(74,154,143,0.6)';
    ctx.lineWidth = brush.active ? 2.5 : 1.5;
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(74,154,143,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [brush, trayRect]);

  /* -------------------------------- 交互处理 ------------------------------- */

  /*
   * 笔画采样统一走 `useBrush`（surface-dev 的介质层）。
   * 改造前这里写死 1% 距离阈值，dom2d / three 各有一套，同一次拖动在不同
   * 渲染器下笔迹长度都不一样。现在三家共用 0.008 归一化阈值 + rAF 节流，
   * 并且"点一下"（只有一个采样点）也能落笔 —— `applyStroke` 会吃掉单点。
   */
  const stroke = useBrush({
    tool: brush?.tool ?? null,
    radius: brush?.radius ?? 0.12,
    strength: 0.6,
    enabled: !readOnly && Boolean(brush && onSurfaceStroke),
    toNormalized,
    onStrokeCommit: (tool, points) => onSurfaceStroke?.(tool, points),
  });

  /** 拖动摆件（选择模式下用 pointer 事件，与笔画互斥） */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();

    // 笔刷模式：交给 useBrush 累积这一笔（它自己负责捕获指针，且捕获失败不影响绘制）
    if (brush && onSurfaceStroke) {
      stroke.onPointerDown(event);
      return;
    }

    // 捕获必须包在 try 里：指针已经抬起 / 合成事件带着未知 pointerId 时
    // 浏览器会抛 NotFoundError，一旦冒泡出去整次交互就废了（拍到的真实 bug）。
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* 捕获只是"移出元素后仍收到 move"的优化，失败就退化成普通 move */
    }

    // 选择模式：命中测试（从最上层往下）
    const hit = hitTest(items, point);
    if (hit) {
      dragRef.current = {
        id: hit.id,
        pointerId: event.pointerId,
        from: { x: hit.x, y: hit.y },
        offsetX: hit.x - point.x,
        offsetY: hit.y - point.y,
      };
      onSelect(hit.id);
    } else {
      onSelect(null);
      onCanvasClick?.();
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;

    if (brush && onSurfaceStroke) {
      stroke.onPointerMove(event);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onItemDrag?.(
      drag.id,
      Math.min(1, Math.max(0, point.x + drag.offsetX)),
      Math.min(1, Math.max(0, point.y + drag.offsetY)),
    );
  };

  const finishInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const point = toNormalized(event.clientX, event.clientY);

    if (brush && onSurfaceStroke) {
      stroke.onPointerUp(event);
      return;
    }

    const drag = dragRef.current;
    if (!drag || !point) return;
    dragRef.current = null;
    onItemCommit?.(drag.id, drag.from, {
      x: Math.min(1, Math.max(0, point.x + drag.offsetX)),
      y: Math.min(1, Math.max(0, point.y + drag.offsetY)),
    });
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    const hit = hitTest(items, point);
    if (hit) onItemActivate?.(hit);
  };

  /**
   * 摆件的键盘操作。键位与 `dom2d.tsx` 的 `handleKeyDown` **必须一致** ——
   * 同一个产品里两套键盘语义，用户换个渲染器就断手。
   *
   * 步长 0.02 / Shift 0.1 也和 dom2d 对齐（0.02 约等于画布上 2–3px，
   * 够精细；Shift 加速用于大跨度挪动）。
   *
   * 边界用 clamp 到 [0,1]，和 dom2d 一样 —— 拖出沙盘外会让摆件
   * 永远看不见，用户以为它被删了。
   */
  const handleItemKeyDown = (event: React.KeyboardEvent, item: SandboxItem) => {
    if (readOnly) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
    };
    const delta = deltas[event.key];
    if (!delta) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onItemActivate?.(item);
      }
      return;
    }
    event.preventDefault();
    const from = { x: item.x, y: item.y };
    const to = {
      x: Math.min(1, Math.max(0, item.x + delta.x)),
      y: Math.min(1, Math.max(0, item.y + delta.y)),
    };
    onItemCommit?.(item.id, from, to);
  };

  const cursorClass = brush ? 'iso2d--brush' : readOnly ? '' : 'iso2d--grab';
  /*
   * `.ss-drawable` 提供 `touch-action: none`（见 styles/sandbox-surface.css）：
   * 少了它，触摸设备上浏览器会把第一次 pointermove 当成滚动手势，
   * 于是"画一笔"变成"滑一下页面"，笔迹只留下一两个点。
   */
  const drawableClass = brush ? ' ss-drawable' : '';

  return (
    <div
      className={`iso2d ${cursorClass}${drawableClass}${outlineMode ? ' iso2d--outline' : ''}`}
      style={{ background: scene.background }}
      ref={wrapRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onDoubleClick={handleDoubleClick}
      onKeyDown={brush ? stroke.onKeyDown : undefined}
      onKeyUp={brush ? stroke.onKeyUp : undefined}
      tabIndex={brush ? 0 : undefined}
      role="application"
      aria-label={
        brush
          ? `沙面绘制区，当前工具：${toolLabelFor(brush.tool)}。拖动即可在沙上留下痕迹；也可按住空格用方向键绘制。`
          : '沙盘摆放区。点击选中摆件，拖动移动，双击编辑。'
      }
    >
      <canvas ref={baseRef} className="iso2d__canvas" aria-hidden="true" />
      <canvas ref={overlayRef} className="iso2d__canvas iso2d__canvas--overlay" aria-hidden="true" />
      {/*
       * 读屏与键盘的等价入口。
       *
       * ── 这里曾经只是个只读清单 ──────────────────────────────────
       *
       * 原来它是 `role="list"` + 纯文本，只能"听到"有哪些摆件，
       * 想移动必须用鼠标。而 iso2d 是**默认渲染器** ——
       * 也就是说默认配置下键盘用户无法操作摆件，
       * 而 "键盘可用" 是 WCAG 2.1 AA 的硬要求。
       *
       * （dom2d 渲染器没这个问题：它用真实 <button>，天然可 Tab。）
       *
       * ── 现在它是真按钮 ──────────────────────────────────────────
       *
       * Tab 可聚焦、方向键移动、Enter/空格编辑，
       * 和 dom2d 的键位完全一致（见 dom2d.tsx handleKeyDown）。
       * 视觉上仍然 `sr-only` —— 它服务的就是不看画面的人，
       * 而看得见画面的人有 canvas 上的指针操作。
       *
       * 为什么不做成"canvas 上一个透明可聚焦层"：
       * 那样焦点顺序和视觉位置对不上，读屏用户会听到
       * 一个没有名字的元素。用真实按钮列表，顺序与 z 序一致，
       * 每个按钮的 aria-label 说清它是谁、在哪。
       */}
      <div
        className="sr-only"
        role="group"
        aria-label={
          items.length === 0
            ? '摆件清单：还没有摆件'
            : `摆件清单，共 ${items.length} 个。用 Tab 选择，方向键移动，Enter 编辑。`
        }
      >
        {[...items]
          .sort((a, b) => a.z - b.z)
          .map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`${symbolLabel(item.symbolId)}${item.note ? `，注释：${item.note}` : ''}，位置 ${Math.round(item.x * 100)}% , ${Math.round(item.y * 100)}%`}
                aria-pressed={selected}
                disabled={readOnly}
                tabIndex={0}
                onFocus={() => onSelect(item.id)}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => handleItemKeyDown(event, item)}
                onDoubleClick={() => onItemActivate?.(item)}
              >
                {glyphFor(item.symbolId)}
              </button>
            );
          })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  绘制细节                                   */
/* -------------------------------------------------------------------------- */

/*
 * 注意：`Tray` 类型现在由 `@/sandbox/surface/sandCells` 提供（与着色器共用），
 * 这里不再重复声明，避免两处形状漂移。
 */

/** 每帧复用的格子数组：避免 768 个对象反复分配触发 GC */
const CELL_BUFFER: SandCell[] = [];

/**
 * 画沙面。
 *
 * **绘制顺序是有语义的，别随手改成两遍 for-each：**
 * 从后往前（row 0 -> 23）逐格画，每格先画立面、再画顶面。
 * 这样前方更高的沙丘会自然遮住后方的坑（正确的遮挡关系）；
 * 如果按"先全部顶面、再全部立面"画，立面色块会盖在更靠前的顶面上，
 * 看起来像一张贴上去的条纹网。
 *
 * 立面（`cell.wall`）是本次修掉"悬空条带"的关键：
 * 每格按高度向上位移后，自己与下一行之间会露出 cellH 的缝隙，
 * 立面正好把它填满，于是 32×24 的格子读起来是一块有厚度的沙。
 */
function drawSand(
  ctx: CanvasRenderingContext2D,
  tray: Tray,
  surface: SandRendererProps['surface'],
  dark: boolean,
): void {
  const cells = computeSandCells(surface.height, surface.wetness, tray, dark, CELL_BUFFER);

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];

    // 1) 立面（先画，后面被顶面压住 1px，消掉接缝）
    if (cell.wall > 0) {
      ctx.fillStyle = cell.wallFill;
      ctx.fillRect(
        cell.x,
        cell.y + cell.h - 1,
        cell.w + 0.7,
        cell.wall + 1,
      );
    }

    // 2) 顶面
    ctx.fillStyle = cell.fill;
    // +0.7 消掉相邻格之间的缝（亚像素取整）
    ctx.fillRect(cell.x, cell.y, cell.w + 0.7, cell.h + 0.7);

    // 3) 湿沙高光（只画在顶面上，所以紧跟顶面之后）
    if (cell.gloss > 0) {
      ctx.fillStyle = glossFill(cell.gloss);
      ctx.fillRect(
        cell.x + cell.w * GLOSS_INSET_X,
        cell.y + cell.h * GLOSS_INSET_Y,
        cell.w * GLOSS_W_RATIO,
        cell.h * GLOSS_H_RATIO,
      );
    }
  }
}

function drawTrayEdge(ctx: CanvasRenderingContext2D, tray: Tray, dark: boolean, outline: boolean): void {
  ctx.strokeStyle = dark
    ? 'rgba(226,232,240,0.24)'
    : outline
      ? 'rgba(60,52,42,0.5)'
      : 'rgba(120,104,84,0.28)';
  ctx.lineWidth = outline ? 2 : 1.4;
  roundRect(ctx, tray.x - 5, tray.y - 5, tray.w + 10, tray.h + 10, 12);
  ctx.stroke();
}

function drawItems(
  ctx: CanvasRenderingContext2D,
  tray: Tray,
  items: SandboxItem[],
  selectedId: string | null,
  dark: boolean,
  outline: boolean,
  imageMap?: Record<string, string>,
): void {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.z - b.z);

  for (const item of sorted) {
    const x = tray.x + item.x * tray.w;
    const baseY = tray.y + item.y * tray.h;
    const size = 14 + item.scale * 11;
    const burial = item.burial ?? 0;

    // 影子：埋在沙里的摆件影子更小更浅
    const shadowScale = 1 - burial * 0.6;
    ctx.fillStyle = `rgba(30,26,20,${0.18 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(x, baseY + size * 0.34, size * 0.38 * shadowScale, size * 0.15 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 选中环
    if (item.id === selectedId) {
      ctx.beginPath();
      ctx.ellipse(x, baseY + size * 0.3, size * 0.5, size * 0.2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = dark ? 'rgba(143,192,184,0.95)' : 'rgba(53,127,118,0.9)';
      ctx.lineWidth = outline ? 2.5 : 1.8;
      ctx.stroke();
      if (outline) {
        ctx.beginPath();
        ctx.arc(x - size * 0.5, baseY - size * 0.5, size * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(53,127,118,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(x, baseY - burial * size * 0.5);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.globalAlpha = 1 - burial * 0.5;

    // 沙具包里的图片型沙具没有有意义的字形，必须画图片，
    // 否则用户导入的图会退化成一个占位符（见 render/symbolSource.ts 注释）。
    const dataUrl = imageFor(item.symbolId, imageMap);
    let drewImage = false;
    if (dataUrl) {
      const image = loadImage(dataUrl);
      if (imageReady(image)) {
        // 以摆件中心为锚，保持等比，边长约 1.6 倍字号
        const side = size * 1.6;
        if (outline) {
          ctx.shadowColor = dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
          ctx.shadowBlur = 4;
        }
        ctx.drawImage(image, -side / 2, -side / 2, side, side);
        drewImage = true;
      }
    }

    if (!drewImage) {
      // 图片还没解码完（首帧）或本来就是字形沙具：画字形兜底。
      // 注意此时不能提前 return，否则首帧整幅图都缺这块内容。
      ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (outline) {
        ctx.shadowColor = dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 4;
      }
      ctx.fillText(glyphFor(item.symbolId), 0, 0);
    }
    ctx.restore();
  }
}

/** 命中测试：摆件中心 20px 内，取 y+z 最大的那个 */
function hitTest(items: SandboxItem[], point: { x: number; y: number }): SandboxItem | null {
  let best: SandboxItem | null = null;
  let bestDepth = -Infinity;
  for (const item of items) {
    const dist = Math.hypot(item.x - point.x, item.y - point.y);
    const tolerance = 0.03 + item.scale * 0.012;
    if (dist > tolerance) continue;
    const depth = item.y * 1000 + item.z;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = item;
    }
  }
  return best;
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

export default Iso2DRenderer;
