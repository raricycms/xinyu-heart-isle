import { useRef } from 'react';
import type { SandboxItem } from '@/lib/types';
import { getScene } from '@/sandbox/scenes';
import { symbolLabel } from '@/sandbox/symbols';
import { glyphFor, imageFor } from '@/sandbox/render/symbolSource';
import type { SandRendererProps } from '@/sandbox/render/types';

/**
 * 无障碍基线渲染器（DOM 绝对定位）。
 *
 * 为什么必须存在（VISION.md §7.3）：
 * - Canvas 对读屏是黑箱，键盘无法逐个选中摆件；
 * - `prefers-reduced-motion: reduce` 下用户不该被迫接受动画；
 * - 低端设备 / 老旧浏览器上 Canvas 2D 合成可能卡顿。
 *
 * 实现取舍：用真实 DOM 元素（`<button>`）承载每个摆件，
 * 因此**天然支持 Tab 聚焦、读屏播报、系统缩放**。
 * 拖动用 pointer events，坐标换算统一走归一化空间。
 */

export function Dom2DRenderer({
  items,
  sceneId,
  selectedId,
  readOnly,
  outlineMode,
  imageMap,
  onSelect,
  onItemDrag,
  onItemCommit,
  onItemActivate,
  onCanvasClick,
}: SandRendererProps) {
  const scene = getScene(sceneId);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    from: { x: number; y: number };
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const toNormalized = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent, item: SandboxItem) => {
    if (readOnly) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      from: { x: item.x, y: item.y },
      offsetX: item.x - point.x,
      offsetY: item.y - point.y,
    };
    onSelect(item.id);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    onItemDrag?.(
      drag.id,
      Math.min(1, Math.max(0, point.x + drag.offsetX)),
      Math.min(1, Math.max(0, point.y + drag.offsetY)),
    );
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const point = toNormalized(event.clientX, event.clientY);
    if (!point) return;
    const to = {
      x: Math.min(1, Math.max(0, point.x + drag.offsetX)),
      y: Math.min(1, Math.max(0, point.y + drag.offsetY)),
    };
    onItemCommit?.(drag.id, drag.from, to);
  };

  const handleKeyDown = (event: React.KeyboardEvent, item: SandboxItem) => {
    if (readOnly) return;
    // 方向键微调：0.02 精细，Shift 加速到 0.1
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

  const sorted = [...items].sort((a, b) => a.z - b.z);
  const interactive = !readOnly && Boolean(onItemCommit);

  return (
    <div
      className={`dom2d${outlineMode ? ' dom2d--outline' : ''}${scene.dark ? ' dom2d--dark' : ''}`}
      style={{ background: scene.background }}
      ref={surfaceRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onSelect(null);
          onCanvasClick?.();
        }
      }}
      role="application"
      aria-label="沙盘摆放区：用 Tab 选择摆件，方向键移动，Enter 编辑"
    >
      <div className="dom2d__ground" style={{ background: scene.ground }} aria-hidden="true" />

      {sorted.map((item) => {
        const selected = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            className={`dom2d__item${selected ? ' dom2d__item--selected' : ''}`}
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
              fontSize: `${16 + item.scale * 12}px`,
              transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
              opacity: 1 - (item.burial ?? 0) * 0.55,
              zIndex: Math.round(item.z),
            }}
            aria-label={`${symbolLabel(item.symbolId)}${item.note ? `，注释：${item.note}` : ''}`}
            aria-pressed={selected}
            tabIndex={0}
            disabled={readOnly}
            onPointerDown={(event) => handlePointerDown(event, item)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={(event) => handleKeyDown(event, item)}
            onDoubleClick={() => onItemActivate?.(item)}
            onFocus={() => onSelect(item.id)}
          >
            <span className="dom2d__glyph" aria-hidden="true">
              {/* 图片型沙具用图片，字形沙具用字形（见 render/symbolSource.ts） */}
              {imageFor(item.symbolId, imageMap) ? (
                <img className="dom2d__img" src={imageFor(item.symbolId, imageMap)} alt="" />
              ) : (
                glyphFor(item.symbolId)
              )}
            </span>
            {item.note ? <span className="dom2d__badge" aria-hidden="true">✎</span> : null}
            {!interactive && selected ? <span className="sr-only">（只读）</span> : null}
          </button>
        );
      })}

      {items.length === 0 ? (
        <p className="dom2d__empty small">从下面挑一个沙具放进来</p>
      ) : null}
    </div>
  );
}

export default Dom2DRenderer;
