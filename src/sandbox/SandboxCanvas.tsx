import { useCallback, useEffect, useRef, useState } from 'react';
import { cx, clamp } from '@/lib/utils';
import type { SandboxItem } from '@/lib/types';
import { getScene } from './scenes';
import { symbolGlyph, symbolLabel } from './symbols';

interface SandboxCanvasProps {
  items: SandboxItem[];
  sceneId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChangeItems: (next: SandboxItem[]) => void;
  onEditNote: (item: SandboxItem) => void;
}

/** 拖拽状态：记录指针与元素中心在开始时相对画布的比例偏移，避免"跳一下" */
interface DragState {
  id: string;
  /** 指针在画布内的归一化位置 */
  pointerX: number;
  pointerY: number;
  /** 摆件中心相对指针的偏移（归一化） */
  offsetX: number;
  offsetY: number;
}

const KEY_STEP = 0.01;

export function SandboxCanvas({
  items,
  sceneId,
  selectedId,
  onSelect,
  onChangeItems,
  onEditNote,
}: SandboxCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const scene = getScene(sceneId);

  /** 把客户端坐标换算成画布内 0~1 归一化坐标 */
  const toNormalized = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, item: SandboxItem) => {
      // 只响应主键 / 触摸
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const pointer = toNormalized(event.clientX, event.clientY);
      dragRef.current = {
        id: item.id,
        pointerX: pointer.x,
        pointerY: pointer.y,
        offsetX: pointer.x - item.x,
        offsetY: pointer.y - item.y,
      };
      setDraggingId(item.id);
      onSelect(item.id);
    },
    [onSelect, toNormalized],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const pointer = toNormalized(event.clientX, event.clientY);
      const nextX = clamp(pointer.x - drag.offsetX, 0.03, 0.97);
      const nextY = clamp(pointer.y - drag.offsetY, 0.03, 0.97);

      onChangeItems(
        itemsRef.current.map((item) =>
          item.id === drag.id ? { ...item, x: nextX, y: nextY } : item,
        ),
      );
    },
    [onChangeItems, toNormalized],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const target = event.currentTarget;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraggingId(null);
  }, []);

  /** 键盘微调：方向键移动选中摆件，Delete/Backspace 删除 */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selectedId) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      let dx = 0;
      let dy = 0;
      if (event.key === 'ArrowLeft') dx = -KEY_STEP;
      else if (event.key === 'ArrowRight') dx = KEY_STEP;
      else if (event.key === 'ArrowUp') dy = -KEY_STEP;
      else if (event.key === 'ArrowDown') dy = KEY_STEP;
      else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onChangeItems(itemsRef.current.filter((item) => item.id !== selectedId));
        onSelect(null);
        return;
      } else {
        return;
      }

      event.preventDefault();
      onChangeItems(
        itemsRef.current.map((item) =>
          item.id === selectedId
            ? {
                ...item,
                x: clamp(item.x + dx, 0.03, 0.97),
                y: clamp(item.y + dy, 0.03, 0.97),
              }
            : item,
        ),
      );
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, onChangeItems, onSelect]);

  return (
    <div
      ref={canvasRef}
      className={cx('sandbox-canvas', scene.dark && 'sandbox-canvas--dark')}
      style={{ background: scene.background, color: scene.ink }}
      onPointerDown={() => onSelect(null)}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="application"
      aria-label="沙盘画布，可拖拽摆放象征物"
    >
      <div className="sandbox-canvas__ground" style={{ background: scene.ground }} aria-hidden />

      {items.length === 0 ? (
        <div className="sandbox-canvas__hint">
          <div className="sandbox-canvas__hint-glyph" aria-hidden>
            ◌
          </div>
          <p className="sandbox-canvas__hint-title">这里还空着</p>
          <p className="sandbox-canvas__hint-desc">
            从左侧选一个象征物放进来。
            <br />
            不用想清楚它代表什么，先摆下第一件。
          </p>
        </div>
      ) : null}

      {[...items]
        .sort((a, b) => a.z - b.z)
        .map((item) => {
          const isSelected = item.id === selectedId;
          return (
            <div
              key={item.id}
              className={cx(
                'sandbox-item',
                isSelected && 'is-selected',
                draggingId === item.id && 'is-dragging',
              )}
              style={{
                left: `${item.x * 100}%`,
                top: `${item.y * 100}%`,
                transform: `translate(-50%, -50%) scale(${item.scale}) rotate(${item.rotation}deg)`,
                zIndex: item.z,
              }}
              onPointerDown={(event) => handlePointerDown(event, item)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onEditNote(item);
              }}
              title={`${symbolLabel(item.symbolId)}${item.note ? ` · ${item.note}` : ''}（双击写注释）`}
              role="button"
              tabIndex={0}
              aria-label={`${symbolLabel(item.symbolId)}${item.note ? `，注释：${item.note}` : ''}`}
              aria-pressed={isSelected}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(item.id);
                }
              }}
            >
              <span className="sandbox-item__glyph" aria-hidden>
                {symbolGlyph(item.symbolId)}
              </span>
              {item.note ? (
                <span className="sandbox-item__note" aria-hidden>
                  {item.note}
                </span>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
