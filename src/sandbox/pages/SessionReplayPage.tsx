import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Tag } from '@/components/ui/Primitives';
import { formatDateTime } from '@/lib/date';
import { getScene } from '@/sandbox/scenes';
import { getSession } from '@/lib/sessionStore';
import type { SandSession } from '@/lib/types';
import { Annotations } from '@/sandbox/replay/Annotations';
import { SessionStats } from '@/sandbox/replay/SessionStats';
import { SessionViewer } from '@/sandbox/replay/SessionViewer';
import { Timeline } from '@/sandbox/replay/Timeline';
import { describeCursor, findKeyMoments } from '@/sandbox/replay/moments';
import { buildResumeHref, resumeHintText } from '@/sandbox/replay/resume';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';
import '@/styles/sandbox-replay.css';

/**
 * 会话回放页。
 *
 * 结构（自上而下）：
 * 1. 标题 / 元信息 / 操作（续接、导出、报告、封盘状态）
 * 2. 回放画布（**cursor 驱动**，时间轴拖到哪里就画那一刻）
 * 3. 时间轴（关键节点 + 过滤 + 播放 + `aria-valuetext`）+ 续接说明
 * 4. 批注（标注在某一步上，点击跳转）
 * 5. 客观统计（数字，不含解读）+ 导出 .md
 *
 * 伦理：本页**不得**输出任何解读性文字。统计面板顶部固定一句免责说明。
 *
 * 状态：`cursor` 是本页唯一的时间点来源，同时驱动画面、批注锚点与续接按钮，
 * 保证「你看到的那一步」和「你要写/要续接的那一步」永远是同一步。
 */
export default function SessionReplayPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const toast = useToast();
  const [session, setSession] = useState<SandSession | null | undefined>(undefined);
  const [cursor, setCursor] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  /** 首次载入时定位到末尾；之后 cursor 完全由用户操作驱动 */
  const initialisedRef = useRef(false);

  useEffect(() => {
    if (!id) {
      setSession(null);
      return;
    }
    const found = getSession(id);
    setSession(found);
    initialisedRef.current = false;
  }, [id]);

  const events = session?.events ?? [];
  const totalEvents = events.length;

  // 载入后把 cursor 放到末尾（= 最终画面），与「先看结果，再往回看过程」一致
  useEffect(() => {
    if (!session) return;
    if (initialisedRef.current) return;
    initialisedRef.current = true;
    setCursor(session.events.length);
  }, [session]);

  const sceneLabel = useCallback((sceneId: string) => getScene(sceneId).label, []);

  const moments = useMemo(
    () => (totalEvents > 0 ? findKeyMoments(events, { sceneLabel }) : []),
    [events, sceneLabel, totalEvents],
  );

  const handleSeek = useCallback((next: number) => {
    setCursor(Math.max(0, Math.min(next, totalEvents)));
  }, [totalEvents]);

  /** 批注保存后同步本地 session（saveSession 已落盘，这里只刷新视图） */
  const handleAnnotationsSaved = useCallback((annotations: SandSession['annotations']) => {
    setSession((prev) => (prev ? { ...prev, annotations } : prev));
    toast.show('批注已保存', 'success');
  }, [toast]);

  const handleResume = useCallback(() => {
    if (!session) return;
    navigate(buildResumeHref(session.id, cursor));
  }, [cursor, navigate, session]);

  if (session === undefined) {
    return (
      <div className="page">
        <div className="spinner" aria-label={t('common.loading')} />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="page">
        <PageHeader eyebrow="回看" title={t('replay.title')} />
        <Empty
          icon="◌"
          title={t('replay.notFound')}
          action={<ButtonLink to="/sandbox">回到沙盘</ButtonLink>}
        />
      </div>
    );
  }

  const scene = getScene(session.sceneId);
  const durationMs = totalEvents > 0 ? events[totalEvents - 1].t : 0;
  const cursorDescription = describeCursor(events, cursor, sceneLabel);
  const canResume = totalEvents > 0;

  return (
    <div className="page page--wide replay-page">
      <PageHeader
        eyebrow={`回看 · ${formatDateTime(session.at)}`}
        title={session.title}
        subtitle={t('replay.subtitle')}
        action={
          <div className="btn-group">
            <Button variant="quiet" onClick={() => setResumeOpen((prev) => !prev)} aria-expanded={resumeOpen}>
              从这一步继续摆
            </Button>
            <ButtonLink to={`/sandbox/session/${session.id}/report`} variant="ghost">
              {t('report.title')}
            </ButtonLink>
          </div>
        }
      />

      <div className="row replay-meta">
        <Tag tone="teal">{scene.label}</Tag>
        <Tag outline>{session.mode === 'self' ? t('sandbox.mode.self') : t('sandbox.mode.counselor')}</Tag>
        {session.locked ? <Tag tone="clay">{t('sandbox.locked')}</Tag> : null}
        {session.archived ? <Tag tone="watch">{t('clients.archived')}</Tag> : null}
        <span className="small muted">共 {totalEvents} 步</span>
        <span className="small muted mono">{formatDuration(durationMs)}</span>
      </div>

      {/* 续接说明（展开后给出明确的「会复制、不改原会话」承诺） */}
      {resumeOpen ? (
        <div className="resume-panel" role="region" aria-label="从这一步继续摆">
          <p className="resume-panel__hint">{resumeHintText(cursor, totalEvents)}</p>
          <ol className="resume-panel__steps small muted">
            <li>新会话会得到一个新 id，出现在你的会话列表里。</li>
            <li>复制后可以自由改动；这次原来的会话保持原样。</li>
            <li>批注只带上第 {Math.max(0, cursor)} 步之前的。</li>
          </ol>
          <div className="btn-group">
            <Button onClick={handleResume} disabled={!canResume}>
              复制到第 {cursor} 步并继续
            </Button>
            <Button variant="quiet" onClick={() => setResumeOpen(false)}>
              取消
            </Button>
          </div>
          {!canResume ? (
            <p className="small muted">这次会话没有过程记录，无法按步骤续接。</p>
          ) : null}
        </div>
      ) : null}

      {totalEvents === 0 ? (
        <Notice tone="watch" title={t('replay.noEvents')}>
          旧版本保存的沙盘只有最终画面，没有过程。你仍然可以看下面的客观统计。
        </Notice>
      ) : null}

      {/* 回放画面：cursor 是唯一驱动源 */}
      <SessionViewer session={session} cursor={cursor} />

      {totalEvents > 0 ? (
        <Card className="mt-5">
          <SectionHead
            title={t('replay.timeline')}
            desc={
              <>
                {t('replay.eventCount', { count: totalEvents })} ·{' '}
                <span className="mono">{cursorDescription}</span>
              </>
            }
            action={
              <div className="btn-group">
                <Button size="sm" variant="ghost" onClick={() => handleSeek(0)}>
                  回到开头
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleSeek(totalEvents)}>
                  跳到结尾
                </Button>
              </div>
            }
          />
          <Timeline
            events={events}
            cursor={cursor}
            onSeek={handleSeek}
            moments={moments}
            sceneLabel={sceneLabel}
          />
        </Card>
      ) : null}

      {/* 批注：标注在某一步上 */}
      <Annotations
        session={session}
        cursor={cursor}
        onJump={handleSeek}
        onSaved={handleAnnotationsSaved}
      />

      <SessionStats session={session} />

      {session.reflection ? (
        <Card className="mt-5">
          <SectionHead title="当时写下的那句话" />
          <p className="replay-reflection">{session.reflection}</p>
        </Card>
      ) : null}

      <Notice tone="teal" title="边界">
        {t('sandbox.ethics')}
      </Notice>

      <div className="mt-5">
        <Link to="/sandbox/clients" className="small muted">
          本地档案
        </Link>
        <span className="small muted"> · </span>
        <Link to="/sandbox/compare" className="small muted">
          {t('compare.title')}
        </Link>
      </div>

      <div className="mt-5">
        <Button variant="quiet" onClick={() => navigate('/sandbox')}>
          回到沙盘
        </Button>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
