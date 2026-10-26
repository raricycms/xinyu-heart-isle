import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Primitives';
import { ToolShell, useFinishTool } from '@/toolbox/ToolShell';

interface Step {
  sense: string;
  count: number;
  prompt: string;
  hint: string;
}

const STEPS: Step[] = [
  {
    sense: '看见',
    count: 5,
    prompt: '说出 5 样你现在能看见的东西。',
    hint: '不用好看，越具体越好：灰色的桌面、杯子上的水痕、窗外的电缆。',
  },
  {
    sense: '触摸',
    count: 4,
    prompt: '说出 4 样你能碰到的东西。',
    hint: '椅子的扶手、衣服的布料、自己的手臂、脚下的地面。真的去碰一下。',
  },
  {
    sense: '听见',
    count: 3,
    prompt: '说出 3 个你现在听到的声音。',
    hint: '可能有空调声、远处车流、自己的呼吸。安静也是一种声音。',
  },
  {
    sense: '闻到',
    count: 2,
    prompt: '说出 2 种你能闻到的气味。',
    hint: '闻不到也没关系——试着闻一下自己的手背或衣领。',
  },
  {
    sense: '尝到',
    count: 1,
    prompt: '说出 1 种你能尝到的味道。',
    hint: '嘴里的余味、口水的感觉都算。可以喝一口水再感受。',
  },
];

export function Grounding54321() {
  const [stepIndex, setStepIndex] = useState(0);
  const [inputs, setInputs] = useState<string[][]>(STEPS.map((s) => Array(s.count).fill('')));
  const [recorded, setRecorded] = useState(false);
  const finish = useFinishTool();

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const values = inputs[stepIndex];
  const filled = values.filter((v) => v.trim().length > 0).length;
  const totalProgress = (stepIndex + filled / step.count) / STEPS.length;

  function setValue(index: number, value: string) {
    setInputs((prev) => {
      const next = prev.map((arr) => [...arr]);
      next[stepIndex][index] = value;
      return next;
    });
  }

  const summary = STEPS.map((s, i) => {
    const items = inputs[i].map((v) => v.trim()).filter(Boolean);
    return items.length > 0 ? `${s.sense}：${items.join('、')}` : '';
  })
    .filter(Boolean)
    .join('\n');

  return (
    <ToolShell toolId="grounding-54321">
      <div className="ground-stage">
        <Progress value={totalProgress} />
        <div className="ground-steps">
          {STEPS.map((s, i) => (
            <button
              key={s.sense}
              type="button"
              className={`ground-step ${i === stepIndex ? 'is-active' : ''} ${i < stepIndex ? 'is-done' : ''}`}
              onClick={() => setStepIndex(i)}
            >
              <span className="ground-step__num mono">{s.count}</span>
              <span className="ground-step__sense">{s.sense}</span>
            </button>
          ))}
        </div>

        <div className="ground-card">
          <h2 className="ground-card__prompt">{step.prompt}</h2>
          <p className="ground-card__hint small muted">{step.hint}</p>

          <div className="ground-inputs">
            {values.map((value, index) => (
              <label key={index} className="ground-input">
                <span className="ground-input__num mono">{index + 1}</span>
                <input
                  className="input"
                  value={value}
                  maxLength={40}
                  placeholder={`第 ${index + 1} 个…`}
                  onChange={(e) => setValue(index, e.target.value)}
                />
              </label>
            ))}
          </div>

          <p className="small muted">
            填不填都可以——真正起作用的是"去找"，不是"写下来"。已填 {filled} / {step.count}
          </p>

          <div className="btn-group mt-4">
            <Button
              variant="ghost"
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              disabled={stepIndex === 0}
            >
              上一步
            </Button>
            {!isLast ? (
              <Button onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}>
                下一步
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (recorded) return;
                  finish('grounding-54321', undefined, { summary });
                  setRecorded(true);
                }}
                disabled={recorded}
              >
                {recorded ? '已记录' : '完成并记下'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {summary ? (
        <div className="tool-explain">
          <h3>你刚才把注意力放在了哪里</h3>
          <pre className="ground-summary">{summary}</pre>
          <p className="small muted">
            焦虑常常把人拉到"还没发生的未来"或"已经过去的某件事"。这个练习做的事很朴素：
            用五感把你拽回此时此刻。此刻你在这里，暂时是安全的。
          </p>
        </div>
      ) : (
        <div className="tool-explain">
          <h3>为什么数数有用</h3>
          <p>
            惊恐发作时，大脑的前额叶会被情绪接管。让你"想一想别的"通常没用，
            但让你"具体地找五样蓝色的东西"会占用工作记忆，把注意力从警报里抢回来。
            这就是为什么提示越具体越有效。
          </p>
        </div>
      )}
    </ToolShell>
  );
}
