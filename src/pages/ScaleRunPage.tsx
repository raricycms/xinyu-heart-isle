import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader } from '@/components/ui/Card';
import { Empty, Notice, Progress, Tag, TONE_LABEL } from '@/components/ui/Primitives';
import { formatDateTime, nowISO } from '@/lib/date';
import { createId } from '@/lib/id';
import { STORAGE_KEYS, scaleResultStore, useCollection } from '@/lib/storage';
import { useToast } from '@/lib/toast';
import type { Scale, ScaleLevel, ScaleResult } from '@/lib/types';
import { cx, percent } from '@/lib/utils';
import { answerPrompt, CRISIS_LINES, getScaleById } from '@/scales/data';
import type { ScoreOutcome } from '@/scales/scoring';
import { countAnswered, detectCrisis, findLevel, optionRange, scoreScale, totalRange } from '@/scales/scoring';
import '@/styles/scales.css';

/* -------------------------------------------------------------------------- */
/*                                   入口                                      */
/* -------------------------------------------------------------------------- */

type View = 'intro' | 'run' | 'result';

export default function ScaleRunPage() {
  const { scaleId } = useParams<{ scaleId: string }>();
  const scale = scaleId ? getScaleById(scaleId) : undefined;

  const [view, setView] = useState<View>('intro');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<ScoreOutcome | null>(null);
  const [crisis, setCrisis] = useState(false);

  const reset = useCallback(() => {
    setAnswers({});
    setIndex(0);
    setOutcome(null);
    setCrisis(false);
  }, []);

  if (!scale) {
    return (
      <div className="page">
        <PageHeader eyebrow="Scales" title="找不到这份量表" />
        <Empty
          icon="◍"
          title="没有这个量表编号"
          desc="可能是链接里的编号不对，也可能这份量表已经不在这里了。量表库里有全部可用的量表。"
          action={<ButtonLink to="/scales">返回量表库</ButtonLink>}
        />
      </div>
    );
  }

  if (view === 'intro') {
    return (
      <IntroView
        scale={scale}
        onStart={() => {
          reset();
          setView('run');
        }}
      />
    );
  }

  if (view === 'result' && outcome) {
    return (
      <ResultView
        scale={scale}
        outcome={outcome}
        crisis={crisis}
        answers={answers}
        onRestart={() => {
          reset();
          setView('run');
        }}
      />
    );
  }

  return (
    <RunView
      scale={scale}
      answers={answers}
      index={index}
      setAnswers={setAnswers}
      setIndex={setIndex}
      onFinish={(finalAnswers) => {
        const nextOutcome = scoreScale(scale, finalAnswers);
        const nextCrisis = detectCrisis(scale, finalAnswers);
        const record: ScaleResult = {
          id: createId('scale'),
          at: nowISO(),
          scaleId: scale.id,
          answers: finalAnswers,
          total: nextOutcome.total,
          levelId: nextOutcome.levelId,
        };
        if (nextOutcome.dimensionScores) record.dimensionScores = nextOutcome.dimensionScores;
        // 立即落库：结果一旦算出就保存，不依赖后续页面状态
        scaleResultStore.add(record);
        setOutcome(nextOutcome);
        setCrisis(nextCrisis);
        setView('result');
      }}
      onBackToLibrary={() => setView('intro')}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*                                  说明页                                     */
/* -------------------------------------------------------------------------- */

function IntroView({ scale, onStart }: { scale: Scale; onStart: () => void }) {
  const range = totalRange(scale);
  const results = useCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
  const last = useMemo(() => {
    const mine = results.filter((item) => item.scaleId === scale.id);
    return mine.sort((a, b) => b.at.localeCompare(a.at))[0];
  }, [results, scale.id]);

  return (
    <div className="page scale-intro-page">
      <div className="scale-run__top">
        <Link to="/scales" className="scale-run__back">
          ← 量表库
        </Link>
        <Tag tone="teal">{scale.shortName}</Tag>
      </div>

      <Card className="scale-intro">
        <span className="eyebrow">{scale.category} · {scale.timeframe}</span>
        <h1 className="page-title scale-intro__title">{scale.name}</h1>
        <p className="page-subtitle">{scale.description}</p>

        <div className="scale-intro__meta">
          <div className="scale-fact">
            <span className="scale-fact__label">题目数量</span>
            <span className="scale-fact__value mono">{scale.questions.length} 题</span>
          </div>
          <div className="scale-fact">
            <span className="scale-fact__label">预计用时</span>
            <span className="scale-fact__value mono">约 {scale.estimatedMinutes} 分钟</span>
          </div>
          <div className="scale-fact">
            <span className="scale-fact__label">时间范围</span>
            <span className="scale-fact__value">{scale.timeframe}</span>
          </div>
          <div className="scale-fact">
            <span className="scale-fact__label">分数范围</span>
            <span className="scale-fact__value mono">
              {range.min}–{range.max} 分
            </span>
          </div>
        </div>

        <div className="scale-intro__block">
          <h2 className="scale-intro__label">作答前请先看看</h2>
          <p className="scale-intro__text">{scale.instruction}</p>
        </div>

        <div className="scale-intro__block">
          <h2 className="scale-intro__label">分数是怎么算的</h2>
          <p className="scale-intro__text small muted">{scale.scoringNote}</p>
        </div>

        <div className="scale-intro__block">
          <h2 className="scale-intro__label">接下来会发生什么</h2>
          <ul className="scale-intro__list">
            <li>屏幕上一题一题出现，选完自动进入下一题，也可以随时回上一题改答案。</li>
            <li>全部答完后立刻看到分数区间与一些自我照顾的建议。</li>
            <li>结果只保存在这台设备的浏览器里，不上传、不需要登录。</li>
            <li>中途觉得不舒服可以随时停下，没答完不会保存任何内容。</li>
          </ul>
        </div>

        {last ? (
          <Notice tone="teal" title="你之前做过这份量表">
            上次是 <span className="mono">{formatDateTime(last.at)}</span>，总分{' '}
            <span className="mono">{last.total}</span> 分。可以只把它当作参照，不必和这次比较高低。
          </Notice>
        ) : null}

        <div className="scale-intro__actions">
          <Button size="lg" onClick={onStart}>
            开始作答
          </Button>
          <ButtonLink to="/scales" variant="ghost" size="lg">
            先不做
          </ButtonLink>
        </div>

        <p className="scale-intro__note small muted">
          这是一份自我了解用的问卷，不是诊断工具，结果不能替代专业评估。
        </p>
        {scale.attribution ? <p className="scale-intro__attr small muted">{scale.attribution}</p> : null}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  作答页                                     */
/* -------------------------------------------------------------------------- */

interface RunViewProps {
  scale: Scale;
  answers: Record<string, number>;
  index: number;
  setAnswers: Dispatch<SetStateAction<Record<string, number>>>;
  setIndex: Dispatch<SetStateAction<number>>;
  onFinish: (answers: Record<string, number>) => void;
  onBackToLibrary: () => void;
}

function RunView({ scale, answers, index, setAnswers, setIndex, onFinish, onBackToLibrary }: RunViewProps) {
  const [exitOpen, setExitOpen] = useState(false);
  const finishedRef = useRef(false);
  const total = scale.questions.length;
  const current = Math.min(index, total - 1);
  const question = scale.questions[current];
  const answeredCount = countAnswered(scale, answers);
  // 进度条跟随「看到第几题」，与上方「第 N / 总数 题」保持一致；
  // 已答数量单独用文字展示，避免跳题时出现「题号前进但进度条不动」的割裂感。
  const progress = percent(current + 1, total);

  const finish = useCallback(
    (finalAnswers: Record<string, number>) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinish(finalAnswers);
    },
    [onFinish],
  );

  const goNext = useCallback(() => {
    if (finishedRef.current) return;
    const next = current + 1;
    if (next >= total) finish(answers);
    else setIndex(next);
  }, [answers, current, finish, setIndex, total]);

  const goPrev = useCallback(() => {
    if (current <= 0) return;
    setIndex(current - 1);
  }, [current, setIndex]);

  const select = useCallback(
    (value: number) => {
      if (finishedRef.current) return;
      const nextAnswers = { ...answers, [question.id]: value };
      setAnswers(nextAnswers);
      const next = current + 1;
      // 一屏一题：选完立刻进入下一题；最后一题直接结算
      if (next >= total) finish(nextAnswers);
      else setIndex(next);
    },
    [answers, current, finish, question.id, setAnswers, setIndex, total],
  );

  // 键盘作答：数字键选项，←/→ 切题
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (exitOpen || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;

      if (/^[1-9]$/.test(key)) {
        const option = scale.options[Number(key) - 1];
        if (option) {
          event.preventDefault();
          select(option.value);
        }
        return;
      }
      if (key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        goNext();
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        setExitOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitOpen, goNext, goPrev, scale.options, select]);

  // 作答中意外刷新 / 关闭页面时给出浏览器原生提示
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const answeredHere = typeof answers[question.id] === 'number';
  const keyboardHint = scale.options.length > 1 ? `1–${scale.options.length}` : '1';

  return (
    <div className="page scale-run">
      <div className="scale-run__top">
        <button type="button" className="scale-run__back" onClick={() => setExitOpen(true)}>
          ← 退出作答
        </button>
        <span className="small muted">
          {scale.shortName} · {scale.timeframe}
        </span>
      </div>

      <div className="scale-run__meter">
        <div className="scale-run__meter-row">
          <span className="small muted">
            第 <span className="mono">{current + 1}</span> / <span className="mono">{total}</span> 题
            <span className="scale-run__answered"> · 已答 {answeredCount}</span>
          </span>
          <span className="small muted mono">{Math.round(progress * 100)}%</span>
        </div>
        <Progress value={progress} max={1} />
      </div>

      <Card className="scale-question" key={question.id}>
        <span className="scale-question__index mono">第 {current + 1} 题</span>
        <h2 className="scale-question__text">{question.text}</h2>
        <p className="scale-question__guide small muted">{answerPrompt(scale)}</p>

        <div className="scale-options" role="group" aria-label="选项">
          {scale.options.map((option, optionIndex) => {
            const active = answers[question.id] === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={cx('option-row', 'scale-option', active && 'option-row--active')}
                aria-pressed={active}
                onClick={() => select(option.value)}
              >
                <span className="scale-option__key mono" aria-hidden>
                  {optionIndex + 1}
                </span>
                <span className="option-dot" aria-hidden />
                <span className="scale-option__label">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="scale-run__nav">
          <Button variant="ghost" size="sm" onClick={goPrev} disabled={current === 0}>
            ← 上一题
          </Button>
          <div className="scale-run__nav-right">
            {answeredHere ? null : (
              <span className="scale-run__nav-note small muted">可以直接跳过，之后再回来补</span>
            )}
            <Button
              variant="quiet"
              size="sm"
              onClick={goNext}
              aria-label={current + 1 === total ? '跳过本题并结算' : '跳过本题'}
            >
              {current + 1 === total ? '跳过并查看结果' : '跳过 →'}
            </Button>
          </div>
        </div>
      </Card>

      <p className="scale-run__hint small muted">
        键盘也可以答：<kbd>{keyboardHint}</kbd> 选择选项，<kbd>←</kbd> <kbd>→</kbd> 切换题目，<kbd>Esc</kbd> 退出。
        没有「正确的答案」，选最接近的那个就好。
      </p>

      {exitOpen ? (
        <div className="scale-exit" role="dialog" aria-modal="true" aria-labelledby="scale-exit-title">
          <div className="scale-exit__dialog">
            <h2 className="scale-exit__title" id="scale-exit-title">
              还没有答完
            </h2>
            <p className="scale-exit__desc">
              已经答了 <span className="mono">{answeredCount}</span> / {total} 题。
              现在离开不会保存这次作答，之后需要重新开始。
            </p>
            <div className="scale-exit__actions">
              <Button size="sm" onClick={() => setExitOpen(false)}>
                继续作答
              </Button>
              <Button variant="ghost" size="sm" onClick={onBackToLibrary}>
                回到说明页
              </Button>
              <ButtonLink to="/scales" variant="quiet" size="sm">
                放弃并返回量表库
              </ButtonLink>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  结果页                                     */
/* -------------------------------------------------------------------------- */

interface ResultViewProps {
  scale: Scale;
  outcome: ScoreOutcome;
  crisis: boolean;
  answers: Record<string, number>;
  onRestart: () => void;
}

function ResultView({ scale, outcome, crisis, answers, onRestart }: ResultViewProps) {
  const toast = useToast();
  const result = useCollection<ScaleResult>(STORAGE_KEYS.scaleResults);
  const announced = useRef(false);
  const range = totalRange(scale);
  const level = findLevel(scale, outcome.total);
  const answered = countAnswered(scale, answers);
  const showCrisis = crisis || level?.tone === 'alert';

  /**
   * 安全红线：如果用户在自伤/自杀条目上得分 > 0，但总分落在"平稳"区间，
   * 绝不能同时给出"状态平稳"的结论——这会让求助者觉得"我没那么严重"。
   * 此时把主结论替换为中性且明确的说明，优先指向求助。
   */
  const crisisOverridesLevel = crisis && level?.tone !== 'alert';

  const saved = useMemo(() => {
    const mine = result.filter((item) => item.scaleId === scale.id);
    return mine.sort((a, b) => b.at.localeCompare(a.at))[0];
  }, [result, scale.id]);

  // 只在进入结果页时提示一次（避免 StrictMode 下重复弹出）
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    toast.show('结果已保存到本机浏览器', 'success');
  }, [toast]);

  return (
    <div className="page scale-result">
      <div className="scale-run__top">
        <Link to="/scales" className="scale-run__back">
          ← 量表库
        </Link>
        <span className="small muted">
          {scale.shortName} · {saved ? formatDateTime(saved.at) : formatDateTime(nowISO())}
        </span>
      </div>

      {showCrisis ? <CrisisBlock scale={scale} answers={answers} triggeredByItem={crisis} /> : null}

      <Card
        className={cx(
          'scale-result__hero',
          crisisOverridesLevel ? 'scale-result__hero--alert' : level && `scale-result__hero--${level.tone}`,
        )}
      >
        <span className="eyebrow">{scale.name}</span>
        <div className="scale-result__score">
          <span className="scale-result__score-value mono">{outcome.total}</span>
          <span className="scale-result__score-unit mono">/ {range.max} 分</span>
          {crisisOverridesLevel ? (
            <Tag tone="alert">需要优先关注</Tag>
          ) : level ? (
            <Tag tone={level.tone}>{TONE_LABEL[level.tone]}</Tag>
          ) : null}
        </div>
        {crisisOverridesLevel ? (
          <>
            <h1 className="scale-result__level">先说这一件事</h1>
            <p className="scale-result__summary">
              除了上面的分数，你在关于伤害自己的那一题上选择了有这种念头。
              <strong>这一项比总分更重要</strong>——不管总分落在哪一段，这样的念头都值得被认真对待。
              上面的分级描述的是整体情绪频率，不适用于你现在的情况，请不要用「我还好」来说服自己。
            </p>
          </>
        ) : (
          <>
            {level ? <h1 className="scale-result__level">{level.label}</h1> : null}
            <p className="scale-result__summary">{level?.summary ?? '这次的结果没有落在预设的区间里。'}</p>
          </>
        )}

        {scale.levels.length > 0 ? (
          <ScaleRuler scale={scale} total={outcome.total} currentLevelId={level?.id} />
        ) : null}

        <p className="scale-result__basis small muted">
          本次基于 {answered} / {scale.questions.length} 题的作答计算
          {answered < scale.questions.length ? '（跳过的题目按最轻选项计入）' : ''}，时间范围：{scale.timeframe}。
        </p>
      </Card>

      <div className="grid grid--2 scale-result__body">
        <Card>
          <h2 className="section-title">可以试试这些</h2>
          {crisisOverridesLevel ? (
            <ul className="scale-suggestions">
              <li className="scale-suggestions__item">
                <span className="scale-suggestions__dot" aria-hidden />
                <span>今天先不要一个人待着。哪怕只是让一个朋友知道你现在不太好。</span>
              </li>
              <li className="scale-suggestions__item">
                <span className="scale-suggestions__dot" aria-hidden />
                <span>把可能伤害到自己的东西暂时交给别人保管，或者放到需要费力才能拿到的地方。</span>
              </li>
              <li className="scale-suggestions__item">
                <span className="scale-suggestions__dot" aria-hidden />
                <span>如果念头变得具体（比如开始想时间和方式），请把它当作需要马上处理的事，拨打上面的热线。</span>
              </li>
              <li className="scale-suggestions__item">
                <span className="scale-suggestions__dot" aria-hidden />
                <span>这样的念头通常会过去，但"等它自己过去"不是唯一的选择——有人可以陪你一起等。</span>
              </li>
            </ul>
          ) : (
            <ul className="scale-suggestions">
              {(level?.suggestions ?? []).map((suggestion) => (
                <li key={suggestion} className="scale-suggestions__item">
                  <span className="scale-suggestions__dot" aria-hidden />
                  <span>{suggestion}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="stack">
          {scale.dimensions && outcome.dimensionScores ? (
            <Card>
              <h2 className="section-title">分维度看看</h2>
              <div className="stack-sm">
                {scale.dimensions.map((dimension) => {
                  const value = outcome.dimensionScores?.[dimension.id] ?? 0;
                  const { max } = optionRange(scale);
                  const dimMax = max * dimension.questionIds.length;
                  return (
                    <div className="scale-dim" key={dimension.id}>
                      <div className="scale-dim__head">
                        <span className="scale-dim__label">{dimension.label}</span>
                        <span className="small muted mono">
                          {value} / {dimMax}
                        </span>
                      </div>
                      <Progress value={value} max={dimMax} />
                      {dimension.hint ? <p className="scale-dim__hint small muted">{dimension.hint}</p> : null}
                    </div>
                  );
                })}
              </div>
              <p className="scale-dim__note small muted">
                维度分只是把题目分组加起来，方便你看到不同方面的高低，并不比总分更有诊断意义。
              </p>
            </Card>
          ) : null}

          <Card flat>
            <h2 className="card-title">怎么理解这个分数</h2>
            <p className="small muted scale-result__note">{scale.scoringNote}</p>
            {scale.attribution ? <p className="scale-result__attr small muted">{scale.attribution}</p> : null}
          </Card>
        </div>
      </div>

      <div className="scale-result__actions">
        <Button onClick={onRestart}>重新作答</Button>
        <ButtonLink to="/scales" variant="ghost">
          返回量表库
        </ButtonLink>
        <ButtonLink to="/records" variant="ghost">
          查看我的记录
        </ButtonLink>
        <ButtonLink to="/safety" variant="quiet">
          随时可以求助
        </ButtonLink>
      </div>

      <footer className="scale-disclaimer">
        <strong>声明：</strong>
        本次结果仅供自我了解，不构成医学诊断、心理评估或治疗建议。分数高低不代表你的价值，也不代表你「有病」或「没病」。
        如果这些困扰持续影响你的生活，请把这份结果当作一次提醒，去和专业的心理咨询师或医生聊聊。
        若你现在有伤害自己的念头，请立即拨打 <a href="tel:12356">12356</a> 或 <a href="tel:120">120</a>，
        或前往 <Link to="/safety">危机与求助</Link> 页面。
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 危机求助                                    */
/* -------------------------------------------------------------------------- */

function CrisisBlock({
  scale,
  answers,
  triggeredByItem,
}: {
  scale: Scale;
  answers: Record<string, number>;
  triggeredByItem: boolean;
}) {
  const item = scale.questions.find((question) => question.id === 'phq9-9');
  const itemValue = item ? answers[item.id] : undefined;

  return (
    <Notice tone="alert" title="看到你在题目里提到伤害自己的念头，这里有几件更重要的事" icon="◍">
      <p className="scale-crisis__lead">
        不管你的总分是多少，只要你脑子里出现过这样的念头，就值得立刻被认真对待。你不需要「撑到很严重」才配得到帮助。
      </p>
      {triggeredByItem && itemValue ? (
        <p className="scale-crisis__note small">
          你在「{item?.text ?? '关于伤害自己的念头'}」这题选了带有这个念头的选项。如果你现在就有具体的计划或已经做了准备，
          请马上联系下面的热线，或让身边的人陪你去最近的急诊。
        </p>
      ) : null}

      <ul className="scale-crisis__lines">
        {CRISIS_LINES.map((line) => (
          <li key={line.number} className="scale-crisis__line">
            <span className="scale-crisis__line-name">{line.name}</span>
            <a className="scale-crisis__number mono" href={`tel:${line.number.replace(/-/g, '')}`}>
              {line.number}
            </a>
            <span className="scale-crisis__hours small">{line.hours}</span>
          </li>
        ))}
      </ul>

      <div className="scale-crisis__actions">
        <ButtonLink to="/safety" size="sm">
          打开危机与求助页
        </ButtonLink>
        <ButtonLink to="/toolbox" variant="ghost" size="sm">
          先让自己缓一缓
        </ButtonLink>
      </div>
    </Notice>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  刻度尺                                     */
/* -------------------------------------------------------------------------- */

function ScaleRuler({
  scale,
  total,
  currentLevelId,
}: {
  scale: Scale;
  total: number;
  currentLevelId?: string;
}) {
  const range = totalRange(scale);
  const span = Math.max(1, range.max - range.min + 1);
  const offset = ((total - range.min) / span) * 100;
  const markerLeft = Math.min(100, Math.max(0, offset));

  return (
    <div className="scale-ruler">
      <div className="scale-ruler__track" role="img" aria-label={`总分 ${total} 在 ${range.min} 到 ${range.max} 分之间的位置`}>
        {scale.levels.map((level: ScaleLevel) => {
          const width = percent(level.max - level.min + 1, span) * 100;
          return (
            <div
              key={level.id}
              className={cx('scale-ruler__seg', `scale-ruler__seg--${level.tone}`, level.id === currentLevelId && 'is-current')}
              style={{ width: `${width}%` }}
              title={`${level.min}–${level.max} 分 · ${level.label}`}
            />
          );
        })}
        <span className="scale-ruler__marker" style={{ left: `${markerLeft}%` }} aria-hidden>
          <span className="scale-ruler__marker-bubble mono">{total}</span>
        </span>
      </div>

      <div className="scale-ruler__ends small muted mono">
        <span>{range.min}</span>
        <span>{range.max}</span>
      </div>

      <ul className="scale-ruler__legend">
        {scale.levels.map((level) => (
          <li
            key={level.id}
            className={cx('scale-ruler__legend-item', level.id === currentLevelId && 'is-current')}
          >
            <span className={cx('scale-ruler__dot', `scale-ruler__dot--${level.tone}`)} aria-hidden />
            <span className="mono">
              {level.min}–{level.max}
            </span>
            <span>{level.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
