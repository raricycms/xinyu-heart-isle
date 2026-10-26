import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, SectionHead } from '@/components/ui/Card';
import { createId } from '@/lib/id';
import { formatDateTime, nowISO } from '@/lib/date';
import type { SandSession, SessionAnnotation } from '@/lib/types';
import { eventLabel, formatEventTime } from '@/sandbox/events';
import { saveSession } from '@/lib/sessionStore';
import { useI18n } from '@/i18n';

/**
 * 会话批注（标注在**某一步**上）。
 *
 * 设计要点：
 * 1. 批注挂在 `eventIndex` 上，语义与 `SessionAnnotation` 类型一致：
 *    - `eventIndex >= 0`：该 0-based 事件序号所在的那一步；
 *    - `eventIndex === -1`：会话结尾（总在最后一步之后）。
 *    点批注 = 把时间轴移到那一步，画面随之回到那一刻。
 * 2. 保存走 `saveSession({...session, annotations})`，**不回写原会话的 items/events**，
 *    因此加批注不会改变回放内容；
 * 3. 删除需二次确认（就地确认，不用 `window.confirm`，便于键盘与读屏）；
 * 4. 批注是写给「后来回看的人」的记录，本组件不生成任何解读文案。
 */

export interface AnnotationsProps {
  session: SandSession;
  /** 当前 cursor（0 ~ events.length），决定新批注挂在哪一步 */
  cursor: number;
  /** 点击批注时跳转到那一步 */
  onJump: (cursor: number) => void;
  /** 保存成功后的回调（父组件用于刷新 session） */
  onSaved?: (annotations: SessionAnnotation[]) => void;
}

const MAX_LENGTH = 500;

export function Annotations({ session, cursor, onJump, onSaved }: AnnotationsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const events = session.events ?? [];
  const total = events.length;
  /** 只有在某一步时才允许加批注（cursor = 0 表示还没开始，没有「这一步」） */
  const canAnnotate = cursor >= 1 && total > 0;
  /** 待批注的事件序号（0-based）；cursor = N 时对应第 N 条事件的 index N-1 */
  const draftEventIndex = cursor - 1;
  const draftEvent = canAnnotate ? events[draftEventIndex] : undefined;

  /** 按 eventIndex 升序（-1「结尾」排最后）；同序号按写入时间升序，保证稳定 */
  const annotations = useMemo(() => {
    const list = [...(session.annotations ?? [])];
    return list.sort(
      (a, b) =>
        sortKey(a.eventIndex) - sortKey(b.eventIndex) ||
        (a.at ?? '').localeCompare(b.at ?? ''),
    );
  }, [session.annotations]);

  const persist = (next: SessionAnnotation[]): boolean => {
    // 只改 annotations 字段，items / events / surface 原样写回
    const ok = saveSession({ ...session, annotations: next });
    if (ok) {
      onSaved?.(next);
      setError(null);
    } else {
      setError('保存失败：本地存储可能已满。可以先删除旧会话或导出备份。');
    }
    return ok;
  };

  const handleAdd = () => {
    const text = draft.trim();
    if (text.length === 0) {
      setError('批注内容不能为空。');
      return;
    }
    if (!canAnnotate) {
      setError('先把时间轴拖到某一步，再在这一步加批注。');
      return;
    }
    const annotation: SessionAnnotation = {
      id: createId('note'),
      eventIndex: draftEventIndex,
      t: draftEvent?.t ?? 0,
      text: text.slice(0, MAX_LENGTH),
      at: nowISO(),
    };
    if (persist([...annotations, annotation])) {
      setDraft('');
      setOpen(false);
    }
  };

  const handleDelete = (id: string) => {
    if (persist(annotations.filter((entry) => entry.id !== id))) {
      setPendingDelete(null);
    }
  };

  return (
    <Card className="mt-5 replay-annotations">
      <SectionHead
        title={t('replay.annotation')}
        desc={`共 ${annotations.length} 条。点击可跳到对应那一步。`}
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            disabled={!canAnnotate}
            title={canAnnotate ? undefined : '先把时间轴拖到某一步'}
          >
            {t('replay.annotationAdd')}
          </Button>
        }
      />

      {open && canAnnotate ? (
        <div className="annotation-form">
          <p className="small muted annotation-form__hint">
            会记在第 {cursor} 步（
            {eventLabel(draftEvent?.type ?? 'session.start')} · {formatEventTime(draftEvent?.t ?? 0)}
            ）。加批注不会改变这次沙盘的画面。
          </p>
          <label className="sr-only" htmlFor="annotation-input">
            {t('replay.annotation')}
          </label>
          <textarea
            id="annotation-input"
            className="textarea annotation-form__textarea"
            value={draft}
            maxLength={MAX_LENGTH}
            placeholder={t('replay.annotationPlaceholder')}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
          <div className="annotation-form__actions">
            <span className="small muted mono">
              {draft.length} / {MAX_LENGTH}
            </span>
            <div className="btn-group">
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  setOpen(false);
                  setDraft('');
                  setError(null);
                }}
              >
                取消
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={draft.trim().length === 0}>
                保存批注
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!canAnnotate && total > 0 ? (
        <p className="small muted annotation-empty">
          先把时间轴拖到某一步，就可以在这一步加批注。
        </p>
      ) : null}

      {error ? (
        <p className="small annotation-error" role="alert">
          {error}
        </p>
      ) : null}

      {annotations.length === 0 ? (
        <p className="small muted annotation-empty">{t('replay.annotationEmpty')}</p>
      ) : (
        <ol className="annotation-list">
          {annotations.map((annotation) => {
            const isEnd = annotation.eventIndex < 0;
            // eventIndex >= 0 → 第 (index+1) 步；-1「结尾」→ 末步之后
            const jumpTo = isEnd ? total : Math.min(annotation.eventIndex + 1, total);
            const stepText = isEnd ? '结尾' : `第 ${annotation.eventIndex + 1} 步`;
            const event = isEnd ? null : events[annotation.eventIndex];
            return (
              <li key={annotation.id} className="annotation-item">
                <button
                  type="button"
                  className="annotation-item__jump"
                  onClick={() => onJump(jumpTo)}
                  aria-label={`跳到${stepText}`}
                >
                  <span className="annotation-item__step mono small">{stepText}</span>
                  <span className="annotation-item__time mono small muted">
                    {event ? formatEventTime(event.t) : '—'}
                  </span>
                </button>
                <p className="annotation-item__text">{annotation.text}</p>
                <div className="annotation-item__foot">
                  <span className="small muted">
                    {annotation.at ? formatDateTime(annotation.at) : ''}
                  </span>
                  {pendingDelete === annotation.id ? (
                    <span className="annotation-item__confirm small">
                      确认删除？
                      <Button size="sm" variant="danger" onClick={() => handleDelete(annotation.id)}>
                        删除
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setPendingDelete(null)}>
                        取消
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => setPendingDelete(annotation.id)}
                      aria-label="删除这条批注"
                    >
                      删除
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** 排序键：普通序号按原值，-1「结尾」排到最后 */
function sortKey(eventIndex: number): number {
  return eventIndex < 0 ? Number.MAX_SAFE_INTEGER : eventIndex;
}
