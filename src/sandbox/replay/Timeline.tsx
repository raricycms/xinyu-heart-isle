import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SandboxEvent } from '@/lib/types';
import { eventLabel, formatEventTime } from '@/sandbox/events';
import {
  eventCategory,
  matchesFilter,
  type KeyMoment,
  type TimelineFilter,
} from '@/sandbox/replay/moments';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n';

/**
 * 事件时间轴（**受控组件**）。
 *
 * 交互模型（VISION.md §5.3）：时间轴不是「播放器进度条」，而是**过程目录**。
 * - 拖动滑块 = `cursor` 移动 = 重放前 N 条事件（纯函数，无副作用）
 * - 播放 = 定时推进 cursor（setTimeout 链，速度可调，最高 8×）
 * - 事件列表点击 = 直接跳到那一步
 *
 * 关键实现约束：
 * 1. **cursor 由父组件持有**（`cursor` + `onSeek`），这样画面（SessionViewer）、
 *    批注、续接按钮与时间轴共享同一个时间点；本组件不再自己维护第二份 cursor。
 * 2. 播放用 `setTimeout` 链而非 `setInterval`，慢速时不会累积漂移；
 * 3. 到达末尾自动停，不循环；
 * 4. 过滤（只看摆件 / 只看沙面）**只影响列表**，不影响 cursor 语义；
 * 5. 键盘：← → 单步，Home/End 首尾，空格播放/暂停；滑块有完整 aria 播报。
 */

export interface TimelineProps {
  events: SandboxEvent[];
  /** 当前位置（0 ~ events.length），由父组件持有 */
  cursor: number;
  /** 位置变化回调 */
  onSeek: (cursor: number) => void;
  /** 是否显示事件列表（窄屏可关掉） */
  showList?: boolean;
  /** 关键节点（由父组件用 findKeyMoments 算出；省略则不显示快速跳转） */
  moments?: KeyMoment[];
  /** 关键节点的场景名格式化（可选，用于 tooltip） */
  sceneLabel?: (sceneId: string) => string;
  /** 初始速度档位索引（默认 1×） */
  initialSpeedIndex?: number;
}

const SPEEDS = [
  { label: '0.5×', ms: 1200 },
  { label: '1×', ms: 600 },
  { label: '2×', ms: 300 },
  { label: '4×', ms: 120 },
  { label: '8×', ms: 60 },
];

const FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'item', label: '只看摆件' },
  { value: 'surface', label: '只看沙面' },
];

export function Timeline({
  events,
  cursor,
  onSeek,
  showList = true,
  moments,
  sceneLabel,
  initialSpeedIndex = 1,
}: TimelineProps) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(initialSpeedIndex);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const listRef = useRef<HTMLOListElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const listId = useId();

  const total = events.length;
  const atEnd = cursor >= total;

  /** 对外唯一的位置变更入口：夹取 + 通知父组件 */
  const seek = useCallback(
    (next: number) => {
      setPlaying(false);
      const clamped = Math.max(0, Math.min(Math.round(next), total));
      if (clamped !== cursor) onSeek(clamped);
    },
    [cursor, onSeek, total],
  );

  // 播放：setTimeout 链，每步推进一条事件
  useEffect(() => {
    if (!playing) return;
    if (cursor >= total) {
      setPlaying(false);
      return;
    }
    const delay = SPEEDS[speedIndex].ms;
    timerRef.current = window.setTimeout(() => {
      onSeek(Math.min(cursor + 1, total));
      if (cursor + 1 >= total) setPlaying(false);
    }, delay);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [playing, cursor, total, speedIndex, onSeek]);

  // 键盘操作（分组级）
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seek(cursor - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seek(cursor + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      seek(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seek(total);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (atEnd) {
        onSeek(0);
        setPlaying(true);
        return;
      }
      setPlaying((prev) => !prev);
    }
  };

  /** 列表内容：过滤只影响展示，不影响 cursor */
  const visibleEvents = useMemo(() => {
    const rows: Array<{ event: SandboxEvent; index: number }> = [];
    for (let i = 0; i < total; i += 1) {
      if (i >= cursor) break; // 只列已播放的部分
      const event = events[i];
      if (!matchesFilter(event, filter)) continue;
      rows.push({ event, index: i });
    }
    return rows;
  }, [events, cursor, filter, total]);

  const currentEvent = cursor > 0 && cursor <= total ? events[cursor - 1] : null;
  const currentLabel = currentEvent
    ? `${eventLabel(currentEvent.type)} · ${formatEventTime(currentEvent.t)}`
    : cursor === 0
      ? '开头'
      : `第 ${cursor} 步`;
  const valueText =
    cursor === 0
      ? `开头，共 ${total} 步`
      : `第 ${cursor} 步，共 ${total} 步，${currentLabel}`;

  const filterEmpty = visibleEvents.length === 0 && cursor > 0;

  return (
    <div className="timeline" onKeyDown={onKeyDown} role="group" aria-label={t('replay.timeline')}>
      <div className="timeline__controls">
        <Button
          size="sm"
          variant="quiet"
          onClick={() => seek(0)}
          aria-label={t('replay.jumpStart')}
          title={t('replay.jumpStart')}
        >
          ⏮
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            if (atEnd) {
              onSeek(0);
              setPlaying(true);
              return;
            }
            setPlaying((prev) => !prev);
          }}
          aria-label={playing ? t('replay.pause') : t('replay.play')}
          title={playing ? t('replay.pause') : t('replay.play')}
        >
          {playing ? '⏸' : '▶'}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => seek(total)}
          aria-label={t('replay.jumpEnd')}
          title={t('replay.jumpEnd')}
        >
          ⏭
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => seek(cursor - 1)}
          disabled={cursor <= 0}
          aria-label="上一步"
          title="上一步"
        >
          ◀
        </Button>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => seek(cursor + 1)}
          disabled={atEnd}
          aria-label="下一步"
          title="下一步"
        >
          ▶
        </Button>

        <input
          className="range timeline__range"
          type="range"
          min={0}
          max={total}
          step={1}
          value={cursor}
          onChange={(event) => {
            setPlaying(false);
            onSeek(Number(event.target.value));
          }}
          aria-label={t('replay.timeline')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={cursor}
          aria-valuetext={valueText}
          aria-describedby={listId}
        />

        <span className="small muted mono timeline__count" aria-live="off">
          {cursor} / {total}
        </span>

        <select
          className="select select--sm timeline__speed"
          value={speedIndex}
          onChange={(event) => setSpeedIndex(Number(event.target.value))}
          aria-label={t('replay.speed')}
        >
          {SPEEDS.map((speed, index) => (
            <option key={speed.label} value={index}>
              {speed.label}
            </option>
          ))}
        </select>
      </div>

      {/* 当前这一步的播报（也给读屏用） */}
      <p className="timeline__now small" aria-live="polite">
        {cursor === 0 ? '当前在开头（还没有操作）' : `当前：第 ${cursor} 步 · ${currentLabel}`}
      </p>

      {/* 关键节点快速跳转 */}
      {moments && moments.length > 0 ? (
        <div className="timeline__moments">
          <span className="small muted timeline__moments-label">关键节点</span>
          <div className="timeline__chips">
            {moments.map((moment) => (
              <button
                key={moment.id}
                type="button"
                className="timeline__chip"
                onClick={() => seek(moment.cursor)}
                aria-pressed={cursor === moment.cursor}
                title={`${moment.label} · ${moment.time}${sceneLabel ? '' : ''}`}
              >
                <span className="timeline__chip-dot" data-kind={moment.kind} aria-hidden="true" />
                <span>{moment.label}</span>
                <span className="small muted mono">{moment.time}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 过滤 + 列表 */}
      {showList ? (
        <>
          <div className="timeline__filters" role="group" aria-label="事件列表过滤">
            {FILTERS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={`timeline__filter${filter === entry.value ? ' timeline__filter--active' : ''}`}
                onClick={() => setFilter(entry.value)}
                aria-pressed={filter === entry.value}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <ol className="timeline__list" ref={listRef} id={listId}>
            {filterEmpty ? (
              <li className="timeline__item timeline__item--future">
                <span className="small muted">这个过滤下，前 {cursor} 步里没有匹配的操作</span>
              </li>
            ) : null}

            {visibleEvents.map(({ event, index }) => (
              <li key={`${event.t}-${index}`} className="timeline__item">
                <button
                  type="button"
                  className="timeline__jump"
                  onClick={() => seek(index + 1)}
                  aria-current={index + 1 === cursor ? 'step' : undefined}
                >
                  <span className="timeline__index mono">{index + 1}</span>
                  <span className="timeline__tag" data-cat={eventCategory(event.type)} aria-hidden="true">
                    {eventCategory(event.type) === 'item'
                      ? '摆'
                      : eventCategory(event.type) === 'surface'
                        ? '沙'
                        : eventCategory(event.type) === 'scene'
                          ? '景'
                          : '记'}
                  </span>
                  <span className="timeline__label">{eventLabel(event.type)}</span>
                  <span className="timeline__time mono small muted">
                    {formatEventTime(event.t)}
                  </span>
                </button>
              </li>
            ))}

            {total > cursor ? (
              <li className="timeline__item timeline__item--future">
                <span className="small muted">还有 {total - cursor} 步未播放</span>
              </li>
            ) : null}
          </ol>
        </>
      ) : null}
    </div>
  );
}

export { SPEEDS as TIMELINE_SPEEDS };
