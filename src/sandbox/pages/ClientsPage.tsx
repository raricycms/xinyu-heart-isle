import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Tag } from '@/components/ui/Primitives';
import {
  useClients,
  removeClient,
  saveClient,
  useSessions,
  purgeExpired,
} from '@/lib/sessionStore';
import { usePreferences, setPreferences } from '@/lib/storage';
import { createId } from '@/lib/id';
import { formatDate } from '@/lib/date';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';
import {
  XINYU_ARCHIVE_FORMAT,
  archiveFilename,
  buildArchiveEnvelope,
  clientSummaries,
  downloadJson,
  importArchive,
  looksLikeSessionFile,
  parseArchiveText,
  summarizeImportResult,
} from '@/sandbox/archive';
import { validateSandplayFile } from '@/format/sandplay';
import type { ArchiveImportResult } from '@/sandbox/archive';
import type { RetentionDays } from '@/lib/types';
import '@/styles/sandbox-archive.css';

/** 档案列表的归档筛选 */
type ArchiveFilter = 'all' | 'active' | 'archived';

/*
 * 保留期选项。
 *
 * 原来 label 是写死的中文，而 `settings.retention.forever` /
 * `settings.retention.days` 两个键在两套字典里都齐备却零引用。
 * 现在存 labelKey，渲染时再取文案 —— 因为 `t` 只能在组件里拿到，
 * 而这张表是模块级常量。
 */
const RETENTION_OPTIONS: Array<{ value: RetentionDays; labelKey: string; days?: number }> = [
  { value: 0, labelKey: 'settings.retention.forever' },
  { value: 30, labelKey: 'settings.retention.days', days: 30 },
  { value: 90, labelKey: 'settings.retention.days', days: 90 },
  { value: 180, labelKey: 'settings.retention.days', days: 180 },
];

/**
 * 本地档案列表。
 *
 * 隐私设计（CONTRACT §5.5）：
 * - 只要求化名，输入框旁常驻「不要填真实姓名、手机号、身份证号」；
 * - 删除要二次确认，并明确写「不可恢复」；
 * - 头部明确说明「只在这台设备上」。
 *
 * 数据可带走（CONTRACT §5.8）：
 * - 「导出全部数据」产出 `.sandplay-archive.json`（`xinyu-archive/v1` envelope，
 *   内层每条仍是合法的 `sandplay-session/v1`）；
 * - 「导入」只写本机，逐条校验并报告成功/失败条数。
 */
export default function ClientsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const clients = useClients();
  const sessions = useSessions();
  const { retentionDays = 0 } = usePreferences();

  const [creating, setCreating] = useState(false);
  const [alias, setAlias] = useState('');
  const [note, setNote] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ArchiveFilter>('all');
  const [pendingPurge, setPendingPurge] = useState(false);
  const [importReport, setImportReport] = useState<ArchiveImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** 一次性算完所有档案的统计，避免每个列表项都全量 filter 一遍 */
  const summaries = useMemo(() => clientSummaries(clients, sessions), [clients, sessions]);

  const visibleClients = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return clients
      .filter((client) => {
        if (!keyword) return true;
        return client.alias.toLowerCase().includes(keyword);
      })
      .filter((client) => {
        if (filter === 'all') return true;
        const summary = summaries.get(client.id);
        const archivedCount = summary?.archivedCount ?? 0;
        const activeCount = summary?.sessionCount ?? 0;
        // 语义是「有已归档的」/「有未归档的」，不是互斥分类：
        // 一个档案既有在用也有归档的会话时，两个视图里都应该出现，
        // 否则用户会以为某条会话不见了。
        if (filter === 'archived') return archivedCount > 0;
        if (filter === 'active') return activeCount > 0;
        return true;
      });
  }, [clients, query, filter, summaries]);

  const unboundCount = useMemo(
    () => sessions.filter((session) => !session.meta?.clientRef).length,
    [sessions],
  );

  const submit = () => {
    const trimmed = alias.trim();
    if (!trimmed) return;
    saveClient({
      id: createId('client'),
      alias: trimmed,
      note: note.trim() || undefined,
      at: new Date().toISOString(),
    });
    setAlias('');
    setNote('');
    setCreating(false);
  };

  const handleExportAll = () => {
    if (sessions.length === 0 && clients.length === 0) {
      toast.show('这台设备上还没有可以导出的数据。', 'info');
      return;
    }
    const envelope = buildArchiveEnvelope(sessions, clients);
    const blob = downloadJson(archiveFilename(), envelope);
    toast.show(
      `已导出 ${envelope.sessions.length} 条会话、${envelope.clients.length} 个档案（${Math.max(
        1,
        Math.round(blob.size / 1024),
      )} KB）。`,
      'success',
    );
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 允许重复选同一个文件：先清空 value
    event.target.value = '';
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      toast.show('读取文件失败，请重试。', 'warn');
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      toast.show('这个文件不是合法的 JSON，可能选错了。', 'warn');
      return;
    }

    // 兼容单个会话文件：用户可能只拖来一个 .sandplay.json，
    // 这时直接包成"只含这一条会话"的临时 envelope 再走同一条导入路径，
    // 避免为两种格式维护两套写入逻辑。
    if (looksLikeSessionFile(raw)) {
      const single = validateSandplayFile(raw);
      if (!single.ok) {
        toast.show(single.issues[0]?.message ?? '会话文件结构不正确。', 'warn');
        return;
      }
      const outcome = importArchive(
        {
          format: XINYU_ARCHIVE_FORMAT,
          version: 1,
          exportedAt: new Date().toISOString(),
          producer: { app: '心屿 Xinyu', version: '2.0.0' },
          sessions: [raw],
          clients: [],
        },
        sessions,
        clients,
      );
      if (!outcome.ok || !outcome.result) {
        toast.show(outcome.message, 'warn');
        return;
      }
      setImportReport(outcome.result);
      toast.show(summarizeImportResult(outcome.result), 'success');
      return;
    }

    const parsed = parseArchiveText(text);
    if (!parsed.ok || !parsed.data) {
      toast.show(parsed.issues[0]?.message ?? '文件结构不正确。', 'warn');
      return;
    }

    const outcome = importArchive(parsed.data, sessions, clients);
    if (!outcome.ok || !outcome.result) {
      toast.show(outcome.message, 'warn');
      return;
    }

    // 导入已经写入存储；useClients/useSessions 会自动重渲染，这里只记录结果
    setImportReport(outcome.result);
    toast.show(summarizeImportResult(outcome.result), outcome.result.failed > 0 ? 'warn' : 'success');
  };

  const handlePurge = () => {
    const removed = purgeExpired((retentionDays ?? 0) as RetentionDays);
    setPendingPurge(false);
    if (removed.length === 0) {
      toast.show(
        retentionDays === 0
          ? '当前是「永久保留」，没有清理任何归档会话。'
          : '没有超过保留期的归档会话。',
        'info',
      );
      return;
    }
    toast.show(`已清理 ${removed.length} 条超过保留期的归档会话（不可恢复）。`, 'success');
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="档案"
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        action={
          <div className="btn-group">
            <Button variant="ghost" onClick={handleExportAll}>
              导出全部数据
            </Button>
            <Button variant="ghost" onClick={handleImportClick}>
              导入
            </Button>
            <Button variant="quiet" onClick={() => setCreating((prev) => !prev)}>
              {creating ? t('common.cancel') : t('clients.add')}
            </Button>
          </div>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="archive-file-input"
        onChange={handleFileChange}
        aria-label="选择要导入的档案文件"
      />

      <Notice tone="watch" title="隐私">
        {t('clients.privacy')}
        档案只保存在这台设备上，不会上传。导出前请确认已取得对方同意。
      </Notice>

      {importReport ? (
        <div className="archive-import-report mt-4">
          <Notice
            tone={importReport.failed > 0 ? 'warn' : 'teal'}
            title="上次导入结果"
          >
            <p className="small" style={{ margin: 0 }}>
              {summarizeImportResult(importReport)}
            </p>
            {importReport.issues.length > 0 ? (
              <ul className="archive-issue-list small">
                {importReport.issues.slice(0, 5).map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>
                    <span className="mono muted">{issue.path}</span> {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2">
              <Button size="sm" variant="quiet" onClick={() => setImportReport(null)}>
                知道了
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}

      {creating ? (
        <Card className="mt-4">
          <div className="field">
            <label className="field-label" htmlFor="client-alias">
              {t('clients.alias')}
            </label>
            <input
              id="client-alias"
              className="input"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              placeholder={t('clients.aliasPlaceholder')}
              maxLength={24}
              autoFocus
            />
            <p className="field-hint">{t('clients.privacy')}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="client-note">
              {t('clients.note')}
            </label>
            <textarea
              id="client-note"
              className="textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('clients.notePlaceholder')}
              rows={2}
            />
          </div>
          <div className="row">
            <Button onClick={submit} disabled={!alias.trim()}>
              {t('common.save')}
            </Button>
            <Button variant="quiet" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* 工具条：搜索 + 归档筛选 + 保留期清理 */}
      <Card className="mt-4 archive-toolbar" flat>
        <div className="field archive-search">
          <label className="field-label" htmlFor="client-search">
            按化名搜索
          </label>
          <input
            id="client-search"
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入化名的一部分"
          />
        </div>

        <div className="archive-filter" role="tablist" aria-label="归档筛选">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'active', label: '未归档' },
              { key: 'archived', label: '已归档' },
            ] as Array<{ key: ArchiveFilter; label: string }>
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={filter === option.key}
              className={`archive-filter__tab${filter === option.key ? ' archive-filter__tab--active' : ''}`}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="field archive-retention">
          <label className="field-label" htmlFor="client-retention">
            {t('settings.retention')}
          </label>
          <select
            id="client-retention"
            className="select"
            value={retentionDays}
            onChange={(event) => setPreferences({ retentionDays: Number(event.target.value) as RetentionDays })}
          >
            {RETENTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.days === undefined
                  ? t(option.labelKey)
                  : t(option.labelKey, { days: option.days })}
              </option>
            ))}
          </select>
          <p className="field-hint">0 / 永久保留时不会自动清理，也不会被手动清理。</p>
          {pendingPurge ? (
            <div className="archive-confirm">
              <p className="small archive-confirm__text">
                将永久删除已归档且超过保留期的会话，<strong>不可恢复</strong>。确定继续吗？
              </p>
              <div className="btn-group">
                <Button size="sm" variant="danger" onClick={handlePurge}>
                  确认清理
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setPendingPurge(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setPendingPurge(true)}
              disabled={retentionDays === 0}
            >
              按保留期清理
            </Button>
          )}
        </div>
      </Card>

      {unboundCount > 0 ? (
        <p className="small muted mt-3">
          另有 {unboundCount} 条会话还没有绑定档案。进入某个档案可以一键关联。
        </p>
      ) : null}

      {clients.length === 0 ? (
        <div className="mt-4">
          <Empty
            icon="◌"
            title={t('clients.empty')}
            desc="如果你只是自己用，也可以直接去沙盘摆一次；记录同样可以导出带走。"
            action={<Button onClick={() => setCreating(true)}>{t('clients.add')}</Button>}
          />
        </div>
      ) : visibleClients.length === 0 ? (
        <div className="mt-4">
          <Empty
            icon="◌"
            title="没有符合条件的档案"
            desc={query.trim() ? `没有化名包含「${query.trim()}」的档案。` : '换个筛选条件试试。'}
            action={
              <Button
                variant="quiet"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                清除筛选
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="client-list mt-4">
          {visibleClients.map((client) => {
            const summary = summaries.get(client.id);
            const activeCount = summary?.sessionCount ?? 0;
            const archivedCount = summary?.archivedCount ?? 0;
            // sessionCount 只统计未归档的，展示「共几次」要把归档的加回来，
            // 否则全部归档后会显示成 0 次，像是数据丢了。
            const totalCount = activeCount + archivedCount;
            return (
              <li key={client.id} className="client-row">
                <button
                  type="button"
                  className="client-row__main"
                  onClick={() => navigate(`/sandbox/clients/${client.id}`)}
                >
                  <span className="client-row__alias">
                    {client.alias}
                    {archivedCount > 0 ? (
                      <Tag outline className="client-row__tag">
                        {t('clients.archived')} {archivedCount}
                      </Tag>
                    ) : null}
                  </span>
                  <span className="small muted">
                    {t('clients.sessionCount', { count: totalCount })}
                    {archivedCount > 0 ? `（其中已归档 ${archivedCount}）` : ''} · 建档{' '}
                    {formatDate(client.at)}
                  </span>
                  <span className="small muted">
                    {summary?.lastAt
                      ? t('clients.lastSession', { date: formatDate(summary.lastAt) })
                      : '还没有沙盘记录'}
                  </span>
                  {client.note ? (
                    <span className="small muted client-row__note">{client.note}</span>
                  ) : null}
                </button>
                {pendingDelete === client.id ? (
                  <div className="client-row__confirm">
                    <span className="small">
                      删除档案本身<strong>不可恢复</strong>；已有的沙盘记录不会一起删除。
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        removeClient(client.id);
                        setPendingDelete(null);
                        toast.show('档案已删除（沙盘记录保留）。', 'success');
                      }}
                    >
                      确认删除
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setPendingDelete(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setPendingDelete(client.id)}
                    aria-label={`${t('clients.delete')} ${client.alias}`}
                  >
                    删除
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Card className="mt-5">
        <SectionHead
          title="数据可带走"
          desc="导出文件是纯 JSON，可以自己保存或交给信任的人。导入只写回这台设备，全程不走网络。"
        />
        <ul className="small muted archive-notes">
          <li>导出的文件名形如 sandplay-archive-20261027-0905.sandplay-archive.json。</li>
          <li>
            外层格式为 xinyu-archive/v1，里面的每条会话仍然是 sandplay-session/v1，
            可以被任何兼容工具单独读取。
          </li>
          <li>重复导入同一个文件不会产生重复记录（按会话 id 判重）。</li>
          <li>删除与清理都不可恢复。需要留档请先导出。</li>
        </ul>
        <div className="btn-group mt-3">
          <Button variant="ghost" onClick={handleExportAll}>
            导出全部数据
          </Button>
          <Button variant="ghost" onClick={handleImportClick}>
            导入档案文件
          </Button>
        </div>
      </Card>
    </div>
  );
}
