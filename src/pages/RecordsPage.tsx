import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Stat, Tag } from '@/components/ui/Primitives';
import {
  clearAll,
  exportAll,
  importAll,
  journalStore,
  moodStore,
  scaleResultStore,
  STORAGE_KEYS,
  toolSessionStore,
  useCollection,
} from '@/lib/storage';
import { dayKey, formatDateTime, recentDayKeys, formatMonthDay } from '@/lib/date';
import { useToast } from '@/lib/toast';
import { cx } from '@/lib/utils';
import { getScaleById } from '@/scales/data';
import { getToolById } from '@/toolbox/tools';
import type { JournalEntry, MoodEntry, ScaleResult, ToolSession } from '@/lib/types';
import { removeSession, isArchived, useSessions } from '@/lib/sessionStore';
import '@/styles/home.css';

type TabId = 'all' | 'mood' | 'scale' | 'tool' | 'sandbox' | 'journal';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'mood', label: '心情' },
  { id: 'scale', label: '量表' },
  { id: 'tool', label: '练习' },
  { id: 'sandbox', label: '沙盘' },
  { id: 'journal', label: '笔记' },
];

const JOURNAL_LABEL: Record<JournalEntry['kind'], string> = {
  gratitude: '三件好事',
  'thought-record': '思维记录',
  'free-write': '自由书写',
};

const TOOL_LABEL_FALLBACK: Record<string, string> = {
  'breathing-478': '4-7-8 呼吸',
  'box-breathing': '方块呼吸',
  'grounding-54321': '5-4-3-2-1 着陆',
  'body-scan': '身体扫描',
  'thought-record': '思维记录表',
  'worry-time': '担忧时间',
  'three-good-things': '三件好事',
};

/** 优先用工具箱模块提供的真实名称，其次退回内置兜底表 */
function toolLabel(toolId: string): string {
  return getToolById(toolId)?.label ?? TOOL_LABEL_FALLBACK[toolId] ?? toolId;
}

interface Row {
  key: string;
  group: 'mood' | 'scale' | 'tool' | 'sandbox' | 'journal';
  at: string;
  title: string;
  desc?: string;
  badge?: string;
  tone?: 'good' | 'watch' | 'warn' | 'alert' | 'teal';
  link?: string;
  onDelete?: () => void;
}

export default function RecordsPage() {
  const moods = useCollection<MoodEntry>(STORAGE_KEYS.moods);
  const scaleResults = useCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
  const toolSessions = useCollection<ToolSession>(STORAGE_KEYS.toolSessions);
  const sandboxes = useSessions();
  const journals = useCollection<JournalEntry>(STORAGE_KEYS.journal);
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<TabId>('all');

  const weekKeys = useMemo(() => recentDayKeys(7), []);
  const totalCount =
    moods.length + scaleResults.length + toolSessions.length + sandboxes.length + journals.length;

  const weekAverage = useMemo(() => {
    const recent = moods.filter((m) => weekKeys.includes(dayKey(m.at)));
    if (recent.length === 0) return null;
    return recent.reduce((s, m) => s + m.mood, 0) / recent.length;
  }, [moods, weekKeys]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];

    moods.forEach((m) => {
      list.push({
        key: `mood-${m.id}`,
        group: 'mood',
        at: m.at,
        title: `心情 ${m.mood}/5`,
        desc: [
          m.tags.length ? `标签：${m.tags.join('、')}` : '',
          m.note ? `备注：${m.note}` : '',
        ]
          .filter(Boolean)
          .join('　'),
        badge: '心情',
        tone: 'teal',
        onDelete: () => {
          moodStore.remove(m.id);
          show('已删除这条心情记录。');
        },
      });
    });

    scaleResults.forEach((r) => {
      const scale = getScaleById(r.scaleId);
      const level = scale?.levels.find((lv) => lv.id === r.levelId);
      list.push({
        key: `scale-${r.id}`,
        group: 'scale',
        at: r.at,
        title: `量表作答 · ${scale?.shortName ?? r.scaleId}`,
        desc: `总分 ${r.total}${level ? `　${level.label}` : ''}`,
        badge: '量表',
        tone: 'teal',
        link: `/scales/${r.scaleId}`,
        onDelete: () => {
          scaleResultStore.remove(r.id);
          show('已删除这条量表记录。');
        },
      });
    });

    toolSessions.forEach((t) => {
      list.push({
        key: `tool-${t.id}`,
        group: 'tool',
        at: t.at,
        title: `练习 · ${toolLabel(t.toolId)}`,
        desc: t.durationSec ? `时长约 ${Math.round(t.durationSec / 60)} 分钟` : '已完成',
        badge: '练习',
        tone: 'teal',
        link: `/toolbox/${t.toolId}`,
        onDelete: () => {
          toolSessionStore.remove(t.id);
          show('已删除这条练习记录。');
        },
      });
    });

    sandboxes.forEach((s) => {
      list.push({
        key: `sandbox-${s.id}`,
        group: 'sandbox',
        at: s.at,
        title: `沙盘 · ${s.title || '未命名'}`,
        desc: [
          `${s.items.length} 个摆件`,
          `${s.events.length} 次操作`,
          s.locked ? '已封盘' : '可继续',
          isArchived(s) ? '已归档' : '',
          s.reflection ? `写下的：${s.reflection.slice(0, 40)}` : '',
        ]
          .filter(Boolean)
          .join('　'),
        badge: '沙盘',
        tone: 'teal',
        // 直达回放页：过程本身就是内容（VISION.md 维度三）
        link: `/sandbox/session/${s.id}`,
        onDelete: () => {
          void removeSession(s.id);
          show('已删除这次沙盘。');
        },
      });
    });

    journals.forEach((j) => {
      list.push({
        key: `journal-${j.id}`,
        group: 'journal',
        at: j.at,
        title: `${JOURNAL_LABEL[j.kind]} · ${j.title}`,
        desc: j.content,
        badge: '笔记',
        tone: 'teal',
        onDelete: () => {
          journalStore.remove(j.id);
          show('已删除这条笔记。');
        },
      });
    });

    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [moods, scaleResults, toolSessions, sandboxes, journals, show]);

  const filtered = tab === 'all' ? rows : rows.filter((r) => r.group === tab);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    filtered.forEach((row) => {
      const key = dayKey(row.at);
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    });
    return [...map.entries()];
  }, [filtered]);

  function handleExport() {
    const bundle = exportAll();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xinyu-backup-${dayKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    show('已导出为 JSON 文件。', 'success');
  }

  function handleImportClick() {
    fileRef.current?.click();
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const result = importAll(JSON.parse(text));
      show(result.message, result.ok ? 'success' : 'warn');
    } catch {
      show('文件解析失败，请确认是心屿导出的 JSON。', 'warn');
    }
  }

  function handleClear() {
    const ok = window.confirm(
      '这会删除本浏览器里心屿的全部记录，且无法恢复。\n如果还想保留，请先点「导出备份」。\n\n确定要清空吗？',
    );
    if (!ok) return;
    clearAll();
    show('已清空全部本地记录。', 'warn');
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="My Records"
        title="我的记录"
        subtitle="这里只有你自己能看到的痕迹。它们存在这台设备的浏览器里，不会上传到任何服务器。"
      />

      <div className="records-stats mb-5">
        <Stat value={totalCount} label="全部记录" />
        <Stat value={moods.length} label="心情签到" />
        <Stat value={scaleResults.length} label="量表作答" />
        <Stat value={toolSessions.length} label="练习次数" />
        <Stat value={weekAverage ? weekAverage.toFixed(1) : '—'} label="7 日心情均值" />
      </div>

      <section className="grid grid--2 mb-5">
        <Card>
          <SectionHead title="近 14 天心情曲线" desc="同一天多次签到会取平均。" />
          {moods.length === 0 ? (
            <Empty
              icon="▁"
              title="还没有心情记录"
              desc="回到首页签个到，这里就会开始生长。"
              action={
                <ButtonLink to="/" variant="ghost" size="sm">
                  去首页签到
                </ButtonLink>
              }
            />
          ) : (
            <TrendChart moods={moods} days={14} />
          )}
        </Card>

        <Card>
          <SectionHead title="数据管理" desc="你的数据完全属于你，可随时带走或删除。" />
          <div className="data-actions">
            <Button variant="ghost" size="sm" onClick={handleExport}>
              导出备份（JSON）
            </Button>
            <Button variant="ghost" size="sm" onClick={handleImportClick}>
              导入备份
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="选择要导入的备份文件"
              onChange={handleImportFile}
            />
            <Button variant="danger" size="sm" onClick={handleClear}>
              清空全部记录
            </Button>
          </div>
          <hr className="divider" />
          <div className="stack-sm small muted">
            <p>· 数据保存在 localStorage，清理浏览器数据会一并丢失，建议定期导出。</p>
            <p>· 换设备不会自动同步，可以用导出 / 导入手动迁移。</p>
            <p>· 心屿没有服务器，也就意味着没有人能帮你找回丢失的记录。</p>
          </div>
        </Card>
      </section>

      <SectionHead
        title="时间线"
        action={
          <div className="tabs" role="tablist" aria-label="记录类型筛选">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={cx('tabs__item', tab === t.id && 'is-active')}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <Card flat>
        {grouped.length === 0 ? (
          <Empty
            icon="○"
            title="这里还空着"
            desc="做一次量表、练习一次呼吸，或者摆一座沙盘，都会留下记录。"
            action={
              <div className="btn-group">
                <ButtonLink to="/scales" variant="ghost" size="sm">
                  做量表
                </ButtonLink>
                <ButtonLink to="/toolbox" variant="ghost" size="sm">
                  用工具
                </ButtonLink>
              </div>
            }
          />
        ) : (
          grouped.map(([key, items]) => (
            <div key={key}>
              <h3 className="record-group-title">{formatMonthDay(new Date(`${key}T00:00:00`))}</h3>
              {items.map((row) => (
                <div key={row.key} className="record-row">
                  <div className="record-row__time">{formatDateTime(row.at).split(' ').slice(-1)}</div>
                  <div className="record-row__body">
                    <div className="record-row__title">
                      {row.link ? <Link to={row.link}>{row.title}</Link> : row.title}
                      {row.badge ? <Tag tone="plain">{row.badge}</Tag> : null}
                    </div>
                    {row.desc ? <div className="record-row__desc">{row.desc}</div> : null}
                  </div>
                  <Button variant="quiet" size="sm" onClick={row.onDelete} aria-label="删除这条记录">
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>

      <div className="mt-5">
        <Notice tone="watch" title="如果记录里出现了让你不安的内容">
          反复出现的低落、失眠、或伤害自己的念头，是值得认真对待的信号。这不是软弱，也不代表你不够努力。
          请考虑把这份记录带给心理咨询师或精神科医生看——它比口头回忆更清楚。
          <div className="mt-3">
            <ButtonLink to="/safety" variant="danger" size="sm">
              查看可以联系谁
            </ButtonLink>
          </div>
        </Notice>
      </div>
    </div>
  );
}

function TrendChart({ moods, days }: { moods: MoodEntry[]; days: number }) {
  const keys = useMemo(() => recentDayKeys(days), [days]);
  const today = dayKey(new Date());
  return (
    <div className="trend" style={{ height: 160 }} role="img" aria-label={`近 ${days} 天心情趋势`}>
      {keys.map((key) => {
        const dayMoods = moods.filter((m) => dayKey(m.at) === key);
        const avg =
          dayMoods.length > 0 ? dayMoods.reduce((s, m) => s + m.mood, 0) / dayMoods.length : null;
        const isToday = key === today;
        return (
          <div key={key} className="trend__col">
            <div
              className={cx(
                'trend__bar',
                avg === null && 'trend__bar--empty',
                isToday && avg !== null && 'trend__bar--today',
              )}
              style={{ height: avg === null ? '3px' : `${Math.round((avg / 5) * 100)}%` }}
              title={avg === null ? '未记录' : `${avg.toFixed(1)} / 5`}
            />
            {days <= 7 ? (
              <span className="trend__label">
                {isToday ? '今天' : formatMonthDay(new Date(`${key}T00:00:00`))}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
