import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { usePreferences } from '@/lib/storage';
import { useBreathCycle, type BreathPhase } from '@/toolbox/useTimer';
import { FinishBar, ToolShell, useFinishTool } from '@/toolbox/ToolShell';

const PHASES: BreathPhase[] = [
  { key: 'inhale', label: '吸气', seconds: 4 },
  { key: 'holdIn', label: '屏息', seconds: 7 },
  { key: 'exhale', label: '呼气', seconds: 8 },
];

export function Breathing478() {
  const { reducedMotion } = usePreferences();
  const breath = useBreathCycle(PHASES, 4);
  const finish = useFinishTool();
  const [recorded, setRecorded] = useState(false);

  // 圆心缩放：吸气放大、屏息保持、呼气缩小
  const scale = useMemo(() => {
    const { key } = breath.phase;
    const p = breath.phaseProgress;
    if (key === 'inhale') return 0.62 + p * 0.38;
    if (key === 'holdIn') return 1;
    return 1 - p * 0.38;
  }, [breath.phase, breath.phaseProgress]);

  const isDone = breath.finished;

  return (
    <ToolShell toolId="breathing-478">
      <div className="breath-stage">
        <div className="breath-orb-wrap">
          <div
            className="breath-orb"
            style={{
              transform: reducedMotion ? 'none' : `scale(${scale})`,
              transition: reducedMotion ? 'none' : 'transform 0.12s linear',
            }}
            aria-hidden
          />
          {!reducedMotion ? (
            <div className="breath-orb breath-orb--halo" style={{ transform: `scale(${scale * 1.16})` }} aria-hidden />
          ) : null}
          <div className="breath-orb-text">
            <span className="breath-orb-phase">{isDone ? '完成' : breath.active ? breath.phase.label : '准备好'}</span>
            <span className="breath-orb-count mono">
              {isDone ? `${breath.targetCycles} 轮` : `${breath.phase.seconds - Math.ceil(breath.phaseProgress * breath.phase.seconds)}`}
            </span>
          </div>
        </div>

        <div className="breath-meta">
          <div className="breath-stats">
            <div className="breath-stat">
              <strong className="mono">{breath.cycleCount}</strong>
              <small>已完成轮次</small>
            </div>
            <div className="breath-stat">
              <strong className="mono">{breath.targetCycles || '∞'}</strong>
              <small>目标轮次</small>
            </div>
          </div>

          <div className="btn-group" style={{ justifyContent: 'center' }}>
            {!breath.active && !isDone ? (
              <Button onClick={breath.start} size="lg">
                {breath.elapsed > 0 ? '继续' : '开始'}
              </Button>
            ) : null}
            {breath.active ? (
              <Button variant="ghost" size="lg" onClick={breath.pause}>
                暂停
              </Button>
            ) : null}
            <Button variant="quiet" size="lg" onClick={breath.reset}>
              重来
            </Button>
          </div>

          <div className="breath-targets">
            <span className="small muted">目标</span>
            {[0, 4, 8, 12].map((n) => (
              <button
                key={n}
                type="button"
                className={`tag tag--selectable ${breath.targetCycles === n ? 'tag--selected' : ''}`}
                onClick={() => {
                  breath.setTargetCycles(n);
                  breath.reset();
                }}
              >
                {n === 0 ? '不限' : `${n} 轮`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tool-explain">
        {/*
         * h2 而不是 h3：这是页面里第一个分节标题，直接跟在 ToolShell 的 h1 后面。
         * 用 h3 会跳过 h2（h1 -> h3），屏幕阅读器按标题层级导航时会以为漏了一节。
         * 其余工具（body-scan / grounding-54321 / thought-record 等）正文里本来就有 h2，
         * 只有两个呼吸类工具没有，所以只有它们跳级。
         */}
        <h2>为什么是 4-7-8</h2>
        <p>
          关键是<strong>呼气比吸气长</strong>。延长呼气会激活副交感神经，让心率降下来——
          这是身体自带的"刹车"，不需要任何技巧。屏息 7 秒只是节奏，觉得憋得慌可以缩短，改成 4-4-6 也有效。
        </p>
        <p className="small muted">
          如果感到头晕，说明呼吸太用力了。轻一点，让气自己进来。
        </p>
      </div>

      {isDone || breath.cycleCount > 0 || breath.elapsed > 3 ? (
        <FinishBar
          finishLabel={recorded ? '已记录' : '记下这次练习'}
          onFinish={() => {
            if (recorded) return;
            finish('breathing-478', breath.elapsed, { cycles: breath.cycleCount });
            setRecorded(true);
          }}
        />
      ) : null}
    </ToolShell>
  );
}
