import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Tag } from '@/components/ui/Primitives';
import { formatDateTime, formatDuration } from '@/lib/date';
import { getSession } from '@/lib/sessionStore';
import { computeSessionStats } from '@/sandbox/replay/stats';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';
import {
  buildSessionReport,
  downloadImage,
  downloadJson,
  downloadMarkdown,
  formatSpan,
  reportImageFilename,
  reportToMarkdown,
  sandplayFilename,
} from '@/sandbox/archive';
import { DEFAULT_EXPORT_OPTIONS, toSandplayFile } from '@/format/sandplay';
import type { ExportOptions } from '@/format/sandplay';
import '@/styles/sandbox-archive.css';

/**
 * 沙盘记录单（可打印 / 存为 PDF）。
 *
 * 设计要点：
 * 1. 用 `@media print` 走浏览器原生打印，**不引入 PDF 库**（体积预算 + 离线性）；
 * 2. **只呈现事实**：时间、场景、模式、摆件清单（含坐标）、写下的文字、批注、沙面统计、免责声明；
 *    不出现任何解读、评价、诊断、建议（CONTRACT §5.1 / §5.6）；
 * 3. 导出前强制勾选「已取得同意」（CONTRACT §5.7）；
 * 4. 页脚固定一句「不含解释与诊断」；
 * 5. 三个导出选项真实影响导出内容（`ExportOptions` 直传 `toSandplayFile`）。
 *
 * 事实模型由 `@/sandbox/archive/reportFacts` 生成，页面只负责排版：
 * 这样"记录单里能出现什么"可以被单测逐字段守住，改样式不会悄悄绕过伦理检查。
 */
export default function SessionReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const toast = useToast();
  const [session, setSession] = useState<ReturnType<typeof getSession> | undefined>(undefined);
  const [consented, setConsented] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    ...DEFAULT_EXPORT_OPTIONS,
    includeAttachments: false,
  });

  useEffect(() => {
    setSession(id ? (getSession(id) ?? null) : null);
  }, [id]);

  const stats = useMemo(() => (session ? computeSessionStats(session) : null), [session]);
  const report = useMemo(
    () => (session && stats ? buildSessionReport(session, stats) : null),
    [session, stats],
  );

  if (session === undefined) {
    return (
      <div className="page">
        <div className="spinner" aria-label={t('common.loading')} />
      </div>
    );
  }

  if (session === null || !stats || !report) {
    return (
      <div className="page">
        <PageHeader eyebrow="记录单" title={t('report.title')} />
        <Empty
          icon="◌"
          title="找不到这次沙盘"
          desc="它可能已经被删除。已导出的文件不受影响。"
          action={<Button onClick={() => navigate('/sandbox')}>回到沙盘</Button>}
        />
      </div>
    );
  }

  const requireConsent = (): boolean => {
    if (consented) return true;
    toast.show(t('report.consentRequired'), 'warn');
    return false;
  };

  const handlePrint = () => {
    if (!requireConsent()) return;
    // 打印前把标题等信息留给纸张，交给 CSS @media print 处理分页
    window.print();
  };

  const handleExportJson = () => {
    if (!requireConsent()) return;
    const file = toSandplayFile(session, exportOptions);
    downloadJson(sandplayFilename(session.title), file);
    toast.show(t('toast.exported'), 'success');
  };

  const handleExportImage = () => {
    if (!requireConsent()) return;
    if (!session.thumbnail) {
      toast.show('这次沙盘没有保存画面，无法导出图片。可以改用「打印 / 存为 PDF」。', 'warn');
      return;
    }
    const blob = downloadImage(reportImageFilename(session.title), session.thumbnail);
    if (!blob) {
      toast.show('画面数据无法解析，导出图片失败。可以改用「打印 / 存为 PDF」。', 'warn');
      return;
    }
    toast.show(t('toast.exported'), 'success');
  };

  const handleExportMarkdown = () => {
    if (!requireConsent()) return;
    downloadMarkdown(
      `${sandplayFilename(session.title).replace(/\.sandplay\.json$/, '')}.md`,
      reportToMarkdown(report),
    );
    toast.show(t('toast.exported'), 'success');
  };

  return (
    <div className="page report-page">
      <div className="no-print">
        <PageHeader
          eyebrow="记录单"
          title={t('report.title')}
          subtitle={t('report.subtitle')}
          action={
            <Button variant="quiet" onClick={() => navigate(`/sandbox/session/${session.id}`)}>
              {t('common.back')}
            </Button>
          }
        />
      </div>

      <div className="report-sheet">
        <div className="report-head">
          <div className="report-head__left">
            <h1 className="report-head__title">{report.title}</h1>
            <p className="report-head__sub">心屿 · 赛博沙盘记录单</p>
          </div>
          <div className="report-head__meta">
            <div>开始：{formatDateTime(report.time.startedAt)}</div>
            {report.time.endedAt ? <div>结束：{formatDateTime(report.time.endedAt)}</div> : null}
            <div>场景：{report.sceneLabel}</div>
            <div>模式：{report.modeLabel}</div>
            <div>状态：{report.lockedLabel}</div>
            {report.clientAlias ? <div>档案：{report.clientAlias}</div> : null}
            {report.sessionNo !== undefined ? <div>第 {report.sessionNo} 次会谈</div> : null}
          </div>
        </div>

        <div className="report-facts">
          <div className="report-fact">
            <div className="report-fact__label">摆件数</div>
            <div className="report-fact__value">{report.itemCount}</div>
          </div>
          <div className="report-fact">
            <div className="report-fact__label">操作次数</div>
            <div className="report-fact__value">{report.eventCount}</div>
          </div>
          <div className="report-fact">
            <div className="report-fact__label">过程时长</div>
            <div className="report-fact__value">{formatDuration(stats.durationMs / 1000)}</div>
          </div>
          <div className="report-fact">
            <div className="report-fact__label">沙面改动</div>
            <div className="report-fact__value">
              {Math.round(report.surface.movedRatio * 100)}%
            </div>
          </div>
        </div>

        {session.thumbnail ? (
          <div className="report-section no-break">
            <h2 className="report-section__title">沙盘画面</h2>
            <img className="report-thumb" src={session.thumbnail} alt="沙盘画面缩略图" />
          </div>
        ) : null}

        <div className="report-section">
          <h2 className="report-section__title">摆件清单（含位置坐标）</h2>
          {report.items.length === 0 ? (
            <p className="small muted">无摆件。</p>
          ) : (
            <ul className="report-items">
              {report.items.map((item) => (
                <li key={item.itemId} className="report-item">
                  <span className="mono small muted">{String(item.index).padStart(2, '0')}</span>
                  <span aria-hidden="true">{item.glyph}</span>
                  <span>{item.label}</span>
                  {item.note ? <span className="report-item__note">“{item.note}”</span> : null}
                  {item.affectLabels && item.affectLabels.length > 0 ? (
                    <span className="row report-item__affect">
                      {item.affectLabels.map((label) => (
                        <Tag key={label} outline>
                          {label}
                        </Tag>
                      ))}
                    </span>
                  ) : null}
                  <span className="small muted mono report-item__pos">
                    ({item.x.toFixed(2)}, {item.y.toFixed(2)}) z{item.z}
                    {item.rotation !== 0 ? ` ${item.rotation}°` : ''}
                    {item.burial !== undefined ? ` 埋深 ${item.burial.toFixed(2)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="report-section">
          <h2 className="report-section__title">沙面统计</h2>
          {report.surface.recorded ? (
            <ul className="report-surface">
              <li>
                <span className="muted">网格</span>
                <span className="mono">
                  {report.surface.cols ?? '—'} × {report.surface.rows ?? '—'}
                </span>
              </li>
              <li>
                <span className="muted">沙面改动比例</span>
                <span className="mono">{Math.round(report.surface.movedRatio * 100)}%</span>
              </li>
              <li>
                <span className="muted">湿润比例</span>
                <span className="mono">{Math.round(report.surface.wetRatio * 100)}%</span>
              </li>
              {report.surface.waterAdded !== undefined ? (
                <li>
                  <span className="muted">喷水次数</span>
                  <span className="mono">{report.surface.waterAdded}</span>
                </li>
              ) : null}
              {report.surface.state ? (
                <li>
                  <span className="muted">湿度档</span>
                  <span className="mono">{report.surface.state === 'wet' ? '湿沙' : '干沙'}</span>
                </li>
              ) : null}
              <li>
                <span className="muted">最长停顿</span>
                <span className="mono">{formatSpan(report.time.longestPauseMs)}</span>
              </li>
            </ul>
          ) : (
            <p className="small muted">这次没有保存沙面数据。</p>
          )}
        </div>

        <div className="report-section">
          <h2 className="report-section__title">写下的文字</h2>
          {report.reflection ? (
            <p className="report-note">{report.reflection}</p>
          ) : (
            <p className="small muted">（这次没有写下文字。）</p>
          )}
        </div>

        <div className="report-section">
          <h2 className="report-section__title">批注</h2>
          {report.annotations.length > 0 ? (
            <ul className="report-annotations">
              {report.annotations.map((annotation) => (
                <li key={annotation.id}>
                  <span className="mono small muted">第 {annotation.step} 步</span>
                  {annotation.author ? (
                    <Tag outline>{annotation.author === 'counselor' ? '咨询师' : '本人'}</Tag>
                  ) : null}
                  <span>{annotation.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">（没有批注。）</p>
          )}
        </div>

        <div className="report-section">
          <h2 className="report-section__title">摆件分布（九宫格）</h2>
          <p className="report-zones small">
            {report.zones.map((zone) => (
              <span key={zone.zone} className="report-zones__cell">
                <span className="muted">{zone.label}</span> <span className="mono">{zone.count}</span>
              </span>
            ))}
          </p>
          <p className="field-hint">只是位置分布的计数，不代表任何含义。</p>
        </div>

        <div className="report-footer">
          {report.disclaimer}
          <br />
          生成时间：{formatDateTime(report.generatedAt)} · 数据来源：本机浏览器存储
        </div>
      </div>

      {/* ------------------------- 导出控制台（不打印） ------------------------- */}
      <Card className="mt-4 no-print">
        <SectionHead
          title="导出与打印"
          desc="先确认已取得对方同意，再选择要包含的内容。三个选项会真实影响导出文件。"
        />

        <label className="option-row report-consent">
          <input
            type="checkbox"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
          />
          <span>{t('report.consent')}</span>
        </label>

        <div className="report-options mt-3">
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
              <span className="field-hint"> 沙面高度场，关掉后文件更小。</span>
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
              <span className="field-hint"> 沙盘画面缩略图。</span>
            </span>
          </label>
        </div>

        <div className="btn-group mt-3">
          <Button onClick={handlePrint} disabled={!consented}>
            {t('report.print')}
          </Button>
          <Button variant="ghost" onClick={handleExportJson} disabled={!consented}>
            {t('report.exportJson')}
          </Button>
          <Button
            variant="ghost"
            onClick={handleExportImage}
            disabled={!consented || !session.thumbnail}
            title={session.thumbnail ? undefined : '这次沙盘没有保存画面'}
          >
            {t('report.exportPng')}
          </Button>
          <Button variant="quiet" onClick={handleExportMarkdown} disabled={!consented}>
            导出 Markdown
          </Button>
          <Button variant="quiet" onClick={() => navigate(`/sandbox/session/${session.id}`)}>
            回看过程
          </Button>
        </div>

        {!session.thumbnail ? (
          <p className="field-hint mt-2">
            这次沙盘没有保存画面，所以「导出图片」是灰的。用「打印 / 存为 PDF」同样可以留档。
          </p>
        ) : null}
      </Card>

      <div className="no-print">
        <Notice tone="teal" title="边界">
          {t('report.disclaimer')}如果这份记录让你不舒服，可以停下来，或者去「危机与求助」看看。
        </Notice>
      </div>
    </div>
  );
}
