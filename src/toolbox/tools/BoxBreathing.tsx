import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { usePreferences } from '@/lib/storage';
import { useBreathCycle, type BreathPhase } from '@/toolbox/useTimer';
import { FinishBar, ToolShell, useFinishTool } from '@/toolbox/ToolShell';

const PHASES: BreathPhase[] = [
  { key: 'inhale', label: '吸气', seconds: 4 },
  { key: 'holdIn', label: '屏息', seconds: 4 },
  { key: 'exhale', label: '呼气', seconds: 4 },
  { key: 'holdOut', label: '停留', seconds: 4 },
];

/** 方形路径上的点位置，按阶段进度插值（百分比） */
function orbPosition(phaseIndex: number, progress: number): { left: string; top: string } {
  // 四个顶点：左上 -> 右上 -> 右下 -> 左下
  const corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const from = corners[phaseIndex % 4];
  const to = corners[(phaseIndex + 1) % 4];
  return {
    left: `${from.x + (to.x - from.x) * progress}%`,
    top: `${from.y + (to.y - from.y) * progress}%`,
  };
}

export function BoxBreathing() {
  const { reducedMotion } = usePreferences();
  const breath = useBreathCycle(PHASES, 4);
  const finish = useFinishTool();
  const [recorded, setRecorded] = useState(false);

  const pos = useMemo(
    () => orbPosition(breath.phaseIndex, breath.phaseProgress),
    [breath.phaseIndex, breath.phaseProgress],
  );

  const isDone = breath.finished;

  return (
    <ToolShell toolId="box-breathing">
      <div className="box-stage">
        <div className="box-frame">
          <div className="box-frame__inner" aria-hidden />
          {!reducedMotion ? (
            <div
              className="box-orb"
              style={{
                left: pos.left,
                top: pos.top,
                transition: 'left 0.1s linear, top 0.1s linear',
              }}
              aria-hidden
            />
          ) : null}
          <div className="box-center">
            <span className="box-center__phase">
              {isDone ? '完成' : breath.active ? breath.phase.label : '准备好'}
            </span>
            <span className="box-center__count mono">
              {breath.active ? breath.phase.seconds - Math.ceil(breath.phaseProgress * breath.phase.seconds) : '4-4-4-4'}
            </span>
            <span className="box-center__hint small">四拍一顿，走一圈</span>
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
        <h3>什么时候用方块呼吸</h3>
        <p>
          四段等长，节奏方正，比 4-7-8 更容易记，也更容易在别人面前"看起来只是在发呆"。
          在会议室、地铁上、考试前都可以做。
        </p>
        <p className="small muted">
          如果 4 秒对你太长，全部改成 3 秒也可以。重点是节奏稳定，不是数字。
        </p>
      </div>

      {isDone || breath.cycleCount > 0 || breath.elapsed > 3 ? (
        <FinishBar
          finishLabel={recorded ? '已记录' : '记下这次练习'}
          onFinish={() => {
            if (recorded) return;
            finish('box-breathing', breath.elapsed, { cycles: breath.cycleCount });
            setRecorded(true);
          }}
        />
      ) : null}
    </ToolShell>
  );
}
