import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Stat, Tag } from '@/components/ui/Primitives';
import { formatDate, formatDateTime } from '@/lib/date';
import {
  useSessions,
  useClients,
  saveSession,
  removeSession,
  archiveSession,
  unarchiveSession,
} from '@/lib/sessionStore';
import { getScene } from '@/sandbox/scenes';
import { computeSessionStats } from '@/sandbox/replay/stats';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';
import {
  attachSessionToClient,
  clientSummary,
  detachSession,
  downloadJson,
  sandplayFilename,
  sessionsOfClient,
  withArchived,
} from '@/sandbox/archive';
import { toSandplayFile, DEFAULT_EXPORT_OPTIONS } from '@/format/sandplay';
import type { ExportOptions } from '@/format/sandplay';
import type { SandSession } from '@/lib/types';
import '@/styles/sandbox-archive.css';

/** 单条会话卡片的行内操作状态 */
type SessionActions = {
  /** 展开「更多操作」的会话 id */
  expanded: string | null;
  /** 等待二次确认删除的会话 id */
  pendingDelete: string | null;
  /** 等待二次确认解绑的会话 id */
  pendingDetach: string | null;
};

const EMPTY_ACTIONS: SessionActions = { expanded: null, pendingDelete: null, pendingDetach: null };

/**
 * 单个档案的详情页。
 *
 * 内容：档案头部、会话时间线、客观统计、关联/归档/删除/导出。
 * **不做任何评估、不做趋势判断、不写解释性文字。**
 *
 * 交互上的两条硬规则：
 * 1. 删除必须二次确认，并明确写「不可恢复」；
 * 2. 导出前必须勾选「已取得同意」（未成年人场景由 CONTRACT §5.7 要求）。
 */
export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const toast = useToast();
  const clients = useClients();
  const sessions = useSessions();

  const [actions, setActions] = useState<SessionActions>(EMPTY_ACTIONS);
  const [consented, setConsented] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    ...DEFAULT_EXPORT_OPTIONS,
    includeAttachments: false,
  });

  const client = useMemo(() => clients.find((entry) => entry.id === id), [clients, id]);

  /** 时间线按时间正序（叙事方向）；统计用倒序的第一条当"最近一次" */
  const clientSessions = useMemo(
    () => (id ? sessionsOfClient(sessions, id, true).slice().sort((a, b) => a.at.localeCompare(b.at)) : []),
    [sessions, id],
  );

  const summary = useMemo(
    () => (id ? clientSummary(clients, sessions, id) : null),
    [clients, sessions, id],
  );

  /** 未绑定任何档案的会话（可一键关联到当前档案） */
  const unbound = useMemo(
    () => sessions.filter((session) => !session.meta?.clientRef),
    [sessions],
  );

  const patch = (next: Partial<SessionActions>) =>
    setActions((prev) => ({ ...EMPTY_ACTIONS, ...prev, ...next }));

  if (!client) {
    return (
      <div className="page">
        <PageHeader eyebrow="档案" title={t('clients.title')} />
        <Empty
          icon="◌"
          title="找不到这个档案"
          desc="它可能已经被删除。沙盘记录本身不受影响，仍可在「我的记录」里查看。"
          action={<ButtonLink to="/sandbox/clients">回到档案列表</ButtonLink>}
        />
      </div>
    );
  }

  const activeCount = summary?.sessionCount ?? 0;
  const archivedCount = summary?.archivedCount ?? 0;
  // sessionCount 只统计未归档的；「沙盘次数」应当是总量，
  // 否则把全部会话归档后会显示成 0 次，看起来像数据丢了。
  const totalCount = activeCount + archivedCount;

  const requireConsent = (): boolean => {
    if (consented) return true;
    toast.show(t('report.consentRequired'), 'warn');
    return false;
  };

  const handleExportSession = (session: SandSession) => {
    if (!requireConsent()) return;
    const file = toSandplayFile(session, exportOptions);
    downloadJson(sandplayFilename(session.title), file);
    toast.show(`已导出「${session.title}」。`, 'success');
  };

  const handleArchiveToggle = (session: SandSession) => {
    if (session.archived) {
      unarchiveSession(session.id);
      toast.show('已取消归档。', 'success');
    } else {
      archiveSession(session.id);
      toast.show('已归档。归档的内容仍在这台设备上，不会被删除。', 'success');
    }
  };

  const handleDelete = (session: SandSession) => {
    removeSession(session.id);
    setActions(EMPTY_ACTIONS);
    toast.show(`已永久删除「${session.title}」。此操作不可恢复。`, 'success');
  };

  const handleBind = (session: SandSession) => {
    const bound = attachSessionToClient(session.id, client.id, client.alias);
    if (!bound) {
      toast.show('关联失败：这条会话可能已经被删除。', 'warn');
      return;
    }
    toast.show(`已关联到「${client.alias}」。`, 'success');
  };

  const handleDetach = (session: SandSession) => {
    detachSession(session.id);
    setActions(EMPTY_ACTIONS);
    toast.show('已解除关联。会话本身仍然保留，出现在「未绑定会话」里。', 'success');
  };

  /** 把整个档案的会话连续归档/取消归档（一次处理一批，减少逐条点击） */
  const handleArchiveAll = (archived: boolean) => {
    const targets = clientSessions.filter((session) => Boolean(session.archived) !== archived);
    if (targets.length === 0) {
      toast.show(archived ? '这个档案下没有未归档的会话。' : '这个档案下没有已归档的会话。', 'info');
      return;
    }
    for (const session of targets) {
      saveSession(withArchived(session, archived));
    }
    toast.show(archived ? `已归档 ${targets.length} 条会话。` : `已取消归档 ${targets.length} 条会话。`, 'success');
  };

  return (
    <div className="page page--wide">
      <PageHeader
        eyebrow="档案"
        title={client.alias}
        subtitle={client.note}
        action={
          <Button variant="quiet" onClick={() => navigate('/sandbox/clients')}>
            {t('common.back')}
          </Button>
        }
      />

      <Notice tone="watch" title="隐私">
        {t('clients.privacy')}
        档案与记录都只保存在这台设备上。
      </Notice>

      <div className="profile-facts mt-4">
        <Stat value={totalCount} label="沙盘总次数" />
        <Stat value={activeCount} label="未归档" />
        <Stat value={archivedCount} label="已归档" />
        <Stat value={summary?.lastAt ? formatDate(summary.lastAt) : '—'} label="最近一次" />
        <Stat value={summary?.firstAt ? formatDate(summary.firstAt) : '—'} label="最早一次" />
      </div>

      {/* --------------------------- 会话时间线 --------------------------- */}
      {clientSessions.length === 0 ? (
        <div className="mt-4">
          <Empty
            icon="◌"
            title="这个档案还没有沙盘记录"
            desc="可以去摆一次，或者把下面「未绑定会话」里已有的记录关联过来。两条路都不会丢数据。"
            action={
              <div className="btn-group">
                <Button onClick={() => navigate('/sandbox')}>去摆一次</Button>
                <ButtonLink to="/records" variant="ghost">
                  看看已有记录
                </ButtonLink>
              </div>
            }
          />
        </div>
      ) : (
        <Card className="mt-4">
          <SectionHead
            title="沙盘时间线"
            desc="按时间正序。点开可以回看过程；每一行都可以单独导出、归档或删除。"
            action={
              <div className="btn-group">
                <Button size="sm" variant="quiet" onClick={() => handleArchiveAll(true)}>
                  全部归档
                </Button>
                <Button size="sm" variant="quiet" onClick={() => handleArchiveAll(false)}>
                  全部取消归档
                </Button>
              </div>
            }
          />
          <ol className="profile-timeline">
            {clientSessions.map((session) => {
              const stats = computeSessionStats(session);
              const isExpanded = actions.expanded === session.id;
              const isPendingDelete = actions.pendingDelete === session.id;
              const isPendingDetach = actions.pendingDetach === session.id;
              return (
                <li
                  key={session.id}
                  className={`profile-timeline__item${session.archived ? ' profile-timeline__item--archived' : ''}`}
                >
                  <button
                    type="button"
                    className="profile-timeline__button"
                    onClick={() => navigate(`/sandbox/session/${session.id}`)}
                  >
                    <span className="profile-timeline__date mono small">
                      {formatDate(session.at)}
                    </span>
                    <span className="profile-timeline__title">{session.title}</span>
                    <span className="row profile-timeline__tags">
                      <Tag outline>{getScene(session.sceneId).label}</Tag>
                      <Tag>{stats.itemCount} 件</Tag>
                      <Tag>{stats.eventCount} 步</Tag>
                      {session.locked ? <Tag tone="clay">已封盘</Tag> : null}
                      {session.archived ? <Tag tone="watch">已归档</Tag> : null}
                    </span>
                  </button>

                  <div className="profile-session-actions">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => patch({ expanded: isExpanded ? null : session.id })}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? '收起' : '更多操作'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/sandbox/session/${session.id}/report`)}
                    >
                      记录单
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleExportSession(session)}>
                      导出
                    </Button>
                  </div>

                  {isExpanded ? (
                    <div className="profile-session-more">
                      <div className="btn-group">
                        <Button size="sm" variant="quiet" onClick={() => handleArchiveToggle(session)}>
                          {session.archived ? '取消归档' : '归档'}
                        </Button>
                        {isPendingDetach ? null : (
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() => patch({ pendingDetach: session.id })}
                          >
                            解除关联
                          </Button>
                        )}
                        {isPendingDelete ? null : (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => patch({ pendingDelete: session.id })}
                          >
                            删除
                          </Button>
                        )}
                      </div>

                      {isPendingDetach ? (
                        <div className="archive-confirm">
                          <p className="small archive-confirm__text">
                            解除后这条会话会出现在「未绑定会话」里，<strong>不会被删除</strong>。
                          </p>
                          <div className="btn-group">
                            <Button size="sm" onClick={() => handleDetach(session)}>
                              确认解除
                            </Button>
                            <Button size="sm" variant="quiet" onClick={() => patch({ pendingDetach: null })}>
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {isPendingDelete ? (
                        <div className="archive-confirm archive-confirm--danger">
                          <p className="small archive-confirm__text">
                            删除后这条会话<strong>不可恢复</strong>（包括过程记录、批注与沙面数据）。
                            需要留档请先导出。
                          </p>
                          <div className="btn-group">
                            <Button size="sm" variant="danger" onClick={() => handleDelete(session)}>
                              确认永久删除
                            </Button>
                            <Button size="sm" variant="quiet" onClick={() => patch({ pendingDelete: null })}>
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {/* --------------------------- 未绑定会话 --------------------------- */}
      <Card className="mt-4">
        <SectionHead
          title="未绑定会话"
          desc="这些沙盘还没有归属到任何档案。关联只改一个引用，不会移动或复制数据。"
        />
        {unbound.length === 0 ? (
          <p className="small muted">没有未绑定的会话。</p>
        ) : (
          <ul className="profile-unbound">
            {unbound.map((session) => (
              <li key={session.id} className="profile-unbound__row">
                <span className="profile-unbound__main">
                  <span className="mono small muted">{formatDateTime(session.at)}</span>
                  <span className="profile-unbound__title">{session.title}</span>
                  <span className="small muted">
                    {getScene(session.sceneId).label} · {session.items.length} 件
                  </span>
                </span>
                <Button size="sm" onClick={() => handleBind(session)}>
                  关联到「{client.alias}」
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ----------------------------- 导出 ----------------------------- */}
      <Card className="mt-4">
        <SectionHead
          title="导出"
          desc="导出前请确认已取得对方同意。导出文件只包含你勾选的内容。"
        />

        <div className="report-options">
          <label className="option-row report-consent">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
            />
            <span>{t('report.consent')}</span>
          </label>

          <label className="option-row">
            <input
              type="checkbox"
              checked={exportOptions.includeEvents}
              onChange={(event) =>
                setExportOptions((prev) => ({ ...prev, includeEvents: event.target.checked }))
              }
            />
            <span>
              {t('report.includeEvents')}
              <span className="field-hint"> 关掉后只导出最终画面，不导出过程步骤。</span>
            </span>
          </label>

          <label className="option-row">
            <input
              type="checkbox"
              checked={exportOptions.includeSurface}
              onChange={(event) =>
                setExportOptions((prev) => ({ ...prev, includeSurface: event.target.checked }))
              }
            />
            <span>
              {t('report.includeSurface')}
              <span className="field-hint"> 沙面高度场数据，体积较大。</span>
            </span>
          </label>

          <label className="option-row">
            <input
              type="checkbox"
              checked={exportOptions.includeThumbnail}
              onChange={(event) =>
                setExportOptions((prev) => ({ ...prev, includeThumbnail: event.target.checked }))
              }
            />
            <span>
              {t('report.includeThumbnail')}
              <span className="field-hint"> 沙盘画面缩略图，如果没有画面则不会写入。</span>
            </span>
          </label>
        </div>

        <div className="btn-group mt-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (clientSessions.length === 0) {
                toast.show('这个档案还没有可以导出的会话。', 'info');
                return;
              }
              if (!requireConsent()) return;
              // 只导出这个档案下的会话（不含未绑定的）
              const latest = clientSessions[clientSessions.length - 1];
              handleExportSession(latest);
            }}
            disabled={clientSessions.length === 0}
          >
            导出最近一次会话
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              const target = clientSessions[clientSessions.length - 1];
              if (target) navigate(`/sandbox/session/${target.id}/report`);
            }}
            disabled={clientSessions.length === 0}
          >
            打开最近一次的记录单
          </Button>
          <ButtonLink to="/sandbox/compare" variant="quiet">
            与其他会话对比
          </ButtonLink>
        </div>
      </Card>

      <p className="small muted mt-4">
        档案只保存在这台设备上。删除档案不会删除已有的沙盘记录；删除单次会话则不可恢复。
      </p>
    </div>
  );
}
