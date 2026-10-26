import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Stat } from '@/components/ui/Primitives';
import {
  moodStore,
  STORAGE_KEYS,
  useCollection,
  usePreferences,
} from '@/lib/storage';
import { createId } from '@/lib/id';
import { dayKey, formatDateTime, greeting, nowISO, recentDayKeys, formatMonthDay } from '@/lib/date';
import { useToast } from '@/lib/toast';
import { cx } from '@/lib/utils';
import { getScaleById } from '@/scales/data';
import { getToolById } from '@/toolbox/tools';
import type { JournalEntry, MoodEntry, SandboxSnapshot, ScaleResult, ToolSession } from '@/lib/types';
import '@/styles/home.css';

const MOOD_FACES: { value: MoodEntry['mood']; glyph: string; label: string }[] = [
  { value: 1, glyph: '☹', label: '很糟' },
  { value: 2, glyph: '︿', label: '低落' },
  { value: 3, glyph: '•', label: '一般' },
  { value: 4, glyph: '⌣', label: '还行' },
  { value: 5, glyph: '☺', label: '很好' },
];

const MOOD_TAGS = ['平静', '焦虑', '疲惫', '充实', '孤独', '烦躁', '麻木', '有希望', '有压力', '被支持'];

const DAILY_PROMPTS = [
  '此刻你身体的哪个部位最紧绷？试着让它松一点点就好。',
  '如果今天的心情是一种天气，它会是什么？不用解释，看见它就够了。',
  '有什么小事让你今天稍微好过一点？哪怕只有一分钟。',
  '你最近在为什么事情耗着神？它现在有多重要？',
  '如果可以对一个人说一句真话，你会说什么？',
  '你已经撑过了很多个这样的日子，这不是理所当然的。',
];

type TimelineItem =
  | { kind: 'scale'; at: string; title: string; desc: string; to?: string }
  | { kind: 'sandbox'; at: string; title: string; desc: string; to?: string }
  | { kind: 'tool'; at: string; title: string; desc: string; to?: string }
  | { kind: 'journal'; at: string; title: string; desc: string; to?: string }
  | { kind: 'mood'; at: string; title: string; desc: string; to?: string };

export default function HomePage() {
  const moods = useCollection<MoodEntry>(STORAGE_KEYS.moods);
  const scaleResults = useCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
  const sandboxes = useCollection<SandboxSnapshot>(STORAGE_KEYS.sandbox);
  const toolSessions = useCollection<ToolSession>(STORAGE_KEYS.toolSessions);
  const journals = useCollection<JournalEntry>(STORAGE_KEYS.journal);
  const preferences = usePreferences();
  const { show } = useToast();

  const [mood, setMood] = useState<MoodEntry['mood']>(3);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [todayPrompt] = useState(
    () => DAILY_PROMPTS[new Date().getDate() % DAILY_PROMPTS.length],
  );

  const today = dayKey(new Date());
  const todayMoods = useMemo(() => moods.filter((m) => dayKey(m.at) === today), [moods, today]);
  const latestTodayMood = todayMoods[0];

  const weekKeys = useMemo(() => recentDayKeys(7), []);
  const weekAverage = useMemo(() => {
    const recent = moods.filter((m) => weekKeys.includes(dayKey(m.at)));
    if (recent.length === 0) return null;
    return recent.reduce((sum, m) => sum + m.mood, 0) / recent.length;
  }, [moods, weekKeys]);

  const streak = useMemo(() => {
    const days = new Set(moods.map((m) => dayKey(m.at)));
    let count = 0;
    const cursor = new Date();
    for (let i = 0; i < 60; i += 1) {
      if (days.has(dayKey(cursor))) {
        count += 1;
        cursor.setDate(cursor.getDate() - 1);
      } else if (i === 0) {
        // 今天还没记录，从昨天开始算
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return count;
  }, [moods]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    scaleResults.slice(0, 3).forEach((r) => {
      const scale = getScaleById(r.scaleId);
      items.push({
        kind: 'scale',
        at: r.at,
        title: `量表作答 · ${scale?.shortName ?? r.scaleId}`,
        desc: `总分 ${r.total}`,
        to: `/scales/${r.scaleId}`,
      });
    });
    sandboxes.slice(0, 2).forEach((s) => {
      items.push({
        kind: 'sandbox',
        at: s.at,
        title: `沙盘 · ${s.title}`,
        desc: `${s.items.length} 个摆件`,
        to: '/sandbox',
      });
    });
    toolSessions.slice(0, 2).forEach((t) => {
      items.push({
        kind: 'tool',
        at: t.at,
        title: `练习 · ${getToolById(t.toolId)?.label ?? t.toolId}`,
        desc: t.durationSec ? `约 ${Math.round(t.durationSec / 60)} 分钟` : '已完成',
        to: `/toolbox/${t.toolId}`,
      });
    });
    journals.slice(0, 2).forEach((j) => {
      items.push({ kind: 'journal', at: j.at, title: j.title, desc: j.content.slice(0, 40), to: '/records' });
    });
    moods.slice(0, 2).forEach((m) => {
      items.push({
        kind: 'mood',
        at: m.at,
        title: '心情签到',
        desc: m.tags.length ? m.tags.join(' · ') : `心情 ${m.mood}/5`,
        to: '/records',
      });
    });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  }, [scaleResults, sandboxes, toolSessions, journals, moods]);

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function saveMood() {
    moodStore.add({
      id: createId('mood'),
      at: nowISO(),
      mood,
      energy: mood >= 4 ? 4 : mood >= 3 ? 3 : 2,
      tags,
      note: note.trim() || undefined,
    });
    setNote('');
    setTags([]);
    show('已经记下了。谢谢你照顾自己。', 'success');
  }

  return (
    <div className="page">
      <section className="hero fade-up">
        <span className="hero__glow" aria-hidden />
        <span className="eyebrow">Xinyu · 心屿</span>
        <h1 className="hero__title">
          先在这里停一停，
          <br />
          慢慢来，也没关系。
        </h1>
        <p className="hero__subtitle">
          心屿是一个安静的心理自助空间。你可以用几分钟做个自我了解的量表，把说不清的感受摆成一座沙盘，
          学几个当下就能用的安抚方法，或者只是看看今天过得怎么样。
          <br />
          这里没有账号，没有推送，也不会有人来评价你。
        </p>
        <div className="hero__actions">
          <ButtonLink to="/scales" size="lg">
            做一次心理自评
          </ButtonLink>
          <ButtonLink to="/toolbox" variant="ghost" size="lg">
            我现在有点难受
          </ButtonLink>
        </div>
        <div className="hero__meta">
          <span>◍ 数据只存在你的浏览器里</span>
          <span>◍ 不需要注册登录</span>
          <span>◍ 不构成医疗诊断</span>
        </div>
      </section>

      {preferences.nickname ? (
        <p className="small muted mb-3">
          {greeting()}，{preferences.nickname}。
        </p>
      ) : null}

      <section className="grid grid--2 mb-5">
        <Card>
          <div className="checkin">
            <div>
              <h2 className="card-title">今天感觉怎么样？</h2>
              <p className="card-desc mt-2">
                {latestTodayMood
                  ? `今天已经记录 ${todayMoods.length} 次，最近一次是 ${formatDateTime(latestTodayMood.at)}。`
                  : '选一个最接近的就好，不用精确。'}
              </p>
              <div className="checkin__options">
                {MOOD_FACES.map((face) => (
                  <button
                    key={face.value}
                    type="button"
                    className={cx('mood-face', mood === face.value && 'is-active')}
                    onClick={() => setMood(face.value)}
                    aria-pressed={mood === face.value}
                  >
                    <span className="mood-face__glyph" aria-hidden>
                      {face.glyph}
                    </span>
                    <span>{face.label}</span>
                  </button>
                ))}
              </div>
              <div className="row wrap checkin__note" style={{ gap: 6 }}>
                {MOOD_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={cx('tag', 'tag--selectable', tags.includes(tag) && 'tag--selected')}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="field checkin__note">
                <label className="sr-only" htmlFor="mood-note">
                  想补充点什么
                </label>
                <input
                  id="mood-note"
                  className="input"
                  placeholder="想补充一句吗？（可留空）"
                  value={note}
                  maxLength={120}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="btn-group mt-3">
                <Button onClick={saveMood} size="sm">
                  记下这一刻
                </Button>
                <ButtonLink to="/records" variant="quiet" size="sm">
                  看我的记录
                </ButtonLink>
              </div>
            </div>
            <div className="checkin__side">
              <strong className="mono">{weekAverage ? weekAverage.toFixed(1) : '—'}</strong>
              <small>
                近 7 天平均
                <br />
                心情指数
              </small>
              <span className="tag tag--teal" style={{ marginTop: 6 }}>
                连续 {streak} 天
              </span>
            </div>
          </div>
        </Card>

        <Card sunken>
          <div className="suggestion">
            <span className="suggestion__mark" aria-hidden>
              “
            </span>
            <div>
              <h2 className="card-title">今天的一句话</h2>
              <p className="mt-2" style={{ lineHeight: 1.9, color: 'var(--ink-700)' }}>
                {todayPrompt}
              </p>
              <div className="btn-group mt-4">
                <ButtonLink to="/toolbox/breathing-478" variant="ghost" size="sm">
                  跟着呼吸 1 分钟
                </ButtonLink>
                <ButtonLink to="/sandbox" variant="quiet" size="sm">
                  去摆个沙盘
                </ButtonLink>
              </div>
            </div>
          </div>
          <div className="disclaimer mt-4">
            <span aria-hidden>⚑</span>
            <span>
              心屿提供的是自我了解与情绪调节的辅助工具，不能替代心理咨询、精神科诊疗或危机干预。
              如果你正处在危险中，请查看
              <Link to="/safety"> 危机与求助</Link>。
            </span>
          </div>
        </Card>
      </section>

      <SectionHead
        title="四个可以开始的地方"
        desc="每一个都需要不超过 10 分钟，随时可以停下。"
      />
      <section className="entry-grid mb-5">
        <Link to="/scales" className="entry">
          <span className="entry__icon" aria-hidden>
            ◫
          </span>
          <span className="entry__title">心理量表</span>
          <span className="entry__desc">
            抑郁、焦虑、压力、睡眠、自尊，5 份常用自评量表，做完立刻看到分数落在哪一段。
          </span>
          <span className="entry__meta">约 3~5 分钟 · 有结果解读</span>
        </Link>
        <Link to="/sandbox" className="entry">
          <span className="entry__icon" aria-hidden>
            ◒
          </span>
          <span className="entry__title">赛博沙盘</span>
          <span className="entry__desc">
            把说不出口的东西，用摆件一个个放到画布上。不用会画画，摆出来就够了。
          </span>
          <span className="entry__meta">自由创作 · 可保存快照</span>
        </Link>
        <Link to="/toolbox" className="entry">
          <span className="entry__icon" aria-hidden>
            ◓
          </span>
          <span className="entry__title">情绪工具箱</span>
          <span className="entry__desc">
            呼吸引导、着陆练习、思维记录、担忧时间……情绪上头时，先做一件小事。
          </span>
          <span className="entry__meta">7 个工具 · 1~15 分钟</span>
        </Link>
        <Link to="/resources" className="entry">
          <span className="entry__icon" aria-hidden>
            ◔
          </span>
          <span className="entry__title">资源地图</span>
          <span className="entry__desc">
            热线、医院、靠谱的科普与自助手册、能读的书。需要更多支持时，从这里出发。
          </span>
          <span className="entry__meta">热线 + 30 余条资源</span>
        </Link>
      </section>

      <section className="grid grid--2 mb-5">
        <Card>
          <SectionHead
            title="最近"
            action={
              <Link to="/records" className="small">
                全部记录 →
              </Link>
            }
          />
          {timeline.length === 0 ? (
            <Empty
              icon="○"
              title="还没有记录"
              desc="做一次量表、摆一个沙盘，或者只是记一下今天的心情，这里就会有了。"
              action={
                <ButtonLink to="/scales" variant="ghost" size="sm">
                  从量表开始
                </ButtonLink>
              }
            />
          ) : (
            <ul>
              {timeline.map((item, index) => (
                <li key={`${item.kind}-${item.at}-${index}`} className="recent-item">
                  <span className="recent-item__dot" aria-hidden />
                  <div className="recent-item__body">
                    <div className="recent-item__title">{item.title}</div>
                    {item.desc ? <div className="recent-item__time">{item.desc}</div> : null}
                  </div>
                  <span className="recent-item__time">{formatDateTime(item.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHead title="近 7 天心情" desc="只统计你自己的心情签到。" />
          {moods.length === 0 ? (
            <Empty icon="▁" title="还没有心情数据" desc="在上方签到后，这里会长出你的曲线。" />
          ) : (
            <>
              <div className="trend" role="img" aria-label="近 7 天心情趋势">
                {weekKeys.map((key) => {
                  const dayMoods = moods.filter((m) => dayKey(m.at) === key);
                  const avg =
                    dayMoods.length > 0
                      ? dayMoods.reduce((s, m) => s + m.mood, 0) / dayMoods.length
                      : null;
                  const isToday = key === today;
                  return (
                    <div key={key} className="trend__col">
                      <div
                        className={cx(
                          'trend__bar',
                          avg === null && 'trend__bar--empty',
                          isToday && avg !== null && 'trend__bar--today',
                        )}
                        style={{ height: avg === null ? '4px' : `${Math.round((avg / 5) * 100)}%` }}
                        title={avg === null ? '未记录' : `${avg.toFixed(1)} / 5`}
                      />
                      <span className="trend__label">
                        {isToday ? '今天' : formatMonthDay(new Date(`${key}T00:00:00`))}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="row mt-4" style={{ gap: 'var(--sp-3)' }}>
                <Stat value={moods.length} label="累计签到" />
                <Stat value={streak} label="连续天数" />
                <Stat value={weekAverage ? weekAverage.toFixed(1) : '—'} label="7 日均值" />
              </div>
            </>
          )}
        </Card>
      </section>

      <section className="safety-band">
        <p className="safety-band__text">
          <strong>如果你现在有伤害自己的念头</strong>，请先不要一个人待着。
          <br />
          可以拨打 24 小时心理援助热线 <strong>12356</strong>，或直接联系身边可信赖的人。
        </p>
        <ButtonLink to="/safety" variant="danger" size="sm">
          查看求助方式
        </ButtonLink>
      </section>

      <Notice tone="plain" title="关于本站的边界">
        心屿不会给你下诊断，也没有办法在你危险的时候立刻出现。它是一个陪你把感受说清楚一点的地方，
        真正的帮助来自你身边的人，以及受过训练的专业人员。
      </Notice>
    </div>
  );
}
