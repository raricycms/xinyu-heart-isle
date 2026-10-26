import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Primitives';
import { journalStore } from '@/lib/storage';
import { createId } from '@/lib/id';
import { nowISO } from '@/lib/date';
import { FinishBar, ToolShell, useFinishTool } from '@/toolbox/ToolShell';

const STEPS = [
  {
    id: 'situation',
    title: '发生了什么',
    hint: '只写事实，不写评价。例如"同事在会上否了我的方案"，而不是"同事针对我"。',
    placeholder: '今天下午的会上，我提的方案被直接否掉了…',
    minHeight: 88,
  },
  {
    id: 'thought',
    title: '当时你脑子里冒出的念头',
    hint: '第一反应是什么？往往是那句最刺的话。',
    placeholder: '我果然不行。他们一定觉得我很蠢。',
    minHeight: 88,
  },
  {
    id: 'evidence',
    title: '支持和反对这个念头的证据',
    hint: '两边都要写。只找反证会让你觉得在骗自己，只找正证会让念头更牢。',
    placeholder: '支持：上次汇报也被打断过。\n反对：上个月另一个方案通过了，组长还夸我做功课细。',
    minHeight: 120,
  },
  {
    id: 'balanced',
    title: '一个更平衡的说法',
    hint: '不是"我很棒"，而是"更接近真实"的那句。读起来应该让你觉得可信，而不是热血。',
    placeholder: '这次方案确实有没考虑到的地方，但不代表我能力不行。我可以问清楚他们的顾虑。',
    minHeight: 100,
  },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function ThoughtRecord() {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Record<StepId, string>>({
    situation: '',
    thought: '',
    evidence: '',
    balanced: '',
  });
  const [saved, setSaved] = useState(false);
  const finish = useFinishTool();

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const current = values[step.id];

  function setCurrent(value: string) {
    setValues((prev) => ({ ...prev, [step.id]: value }));
  }

  const canNext = current.trim().length > 0;

  return (
    <ToolShell toolId="thought-record">
      <div className="record-stage">
        <ol className="record-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={`record-step ${i === stepIndex ? 'is-active' : ''} ${i < stepIndex ? 'is-done' : ''}`}
            >
              <button type="button" onClick={() => setStepIndex(i)}>
                <span className="record-step__num mono">{i + 1}</span>
                <span className="record-step__label">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="record-card">
          <h2 className="record-card__title">
            <span className="mono muted">{stepIndex + 1} / {STEPS.length}</span>　{step.title}
          </h2>
          <p className="record-card__hint small muted">{step.hint}</p>

          <label className="sr-only" htmlFor={`tr-${step.id}`}>
            {step.title}
          </label>
          <textarea
            id={`tr-${step.id}`}
            className="textarea mt-3"
            style={{ minHeight: step.minHeight }}
            value={current}
            placeholder={step.placeholder}
            onChange={(e) => setCurrent(e.target.value)}
          />

          <div className="btn-group mt-4">
            <Button
              variant="ghost"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={stepIndex === 0}
            >
              上一步
            </Button>
            {!isLast ? (
              <Button onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))} disabled={!canNext}>
                下一步
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (saved) return;
                  const content = [
                    `情境：${values.situation}`,
                    `自动思维：${values.thought}`,
                    `证据：${values.evidence}`,
                    `平衡的想法：${values.balanced}`,
                  ].join('\n\n');
                  journalStore.add({
                    id: createId('journal'),
                    at: nowISO(),
                    kind: 'thought-record',
                    title: values.thought.trim().slice(0, 24) || '一次思维记录',
                    content,
                  });
                  finish('thought-record', undefined, { hasBalanced: Boolean(values.balanced.trim()) });
                  setSaved(true);
                }}
                disabled={!values.balanced.trim() || saved}
              >
                {saved ? '已保存' : '保存这条记录'}
              </Button>
            )}
          </div>
        </div>

        {saved ? (
          <Notice tone="good" title="已经存进「我的记录」">
            下次同一个念头再来的时候，可以回来读一遍你写的第四个格子。
            念头不会一次就消失，但你会越来越快地认出它。
          </Notice>
        ) : null}
      </div>

      <div className="tool-explain">
        <h3>为什么第四格最难写</h3>
        <p>
          很多人在这一步会写成"其实我很优秀"——然后自己都不信，练习就失效了。
          有效的替代想法有一个标准：<strong>它读起来是可信的</strong>，哪怕只有 60% 可信。
          "这次确实有疏漏，但不等于我整个人不行" 比 "我很棒" 有用得多。
        </p>
        <p className="small muted">
          如果这件事涉及真实的不公或伤害，"平衡的想法"不应该是"是我想多了"。
          有些痛苦来自环境，不是你认知的错。
        </p>
      </div>

      {stepIndex > 0 && !saved ? (
        <FinishBar
          finishLabel="先记到这里（存草稿为正稿）"
          onFinish={() => {
            const content = [
              `情境：${values.situation || '（未填）'}`,
              `自动思维：${values.thought || '（未填）'}`,
              `证据：${values.evidence || '（未填）'}`,
              `平衡的想法：${values.balanced || '（未填）'}`,
            ].join('\n\n');
            journalStore.add({
              id: createId('journal'),
              at: nowISO(),
              kind: 'thought-record',
              title: `未完成 · ${values.thought.trim().slice(0, 20) || '思维记录'}`,
              content,
            });
            finish('thought-record', undefined, { incomplete: true });
            setSaved(true);
          }}
        />
      ) : null}
    </ToolShell>
  );
}
