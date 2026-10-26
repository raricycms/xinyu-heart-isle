import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Primitives';
import { recordToolSession } from '@/toolbox/tools';
import { useToast } from '@/lib/toast';
import { FinishBar, ToolShell, useFinishTool } from '@/toolbox/ToolShell';
import { clock } from '@/toolbox/useTimer';

interface BodyPart {
  id: string;
  label: string;
  seconds: number;
  guide: string;
}

const PARTS: BodyPart[] = [
  {
    id: 'head',
    label: '头顶与额头',
    seconds: 25,
    guide: '把注意力放到额头。有没有皱着眉？不用刻意松开，只是注意到它。',
  },
  {
    id: 'face',
    label: '眼睛与下颌',
    seconds: 25,
    guide: '注意眼睛周围和牙关。很多紧张藏在这里，你自己都不知道。',
  },
  {
    id: 'neck',
    label: '脖子与肩膀',
    seconds: 30,
    guide: '肩膀是不是抬起来了？让它往下沉一点点就好，不用很用力。',
  },
  {
    id: 'chest',
    label: '胸口与呼吸',
    seconds: 30,
    guide: '感受胸口起伏。不用改变呼吸的节奏，只是跟着它。',
  },
  {
    id: 'belly',
    label: '腹部',
    seconds: 25,
    guide: '注意肚子的感觉。是紧的还是软的？有没有饿或胀？',
  },
  {
    id: 'hands',
    label: '双手',
    seconds: 25,
    guide: '感受指尖的温度，手掌贴着东西的触感。有发麻或发凉吗？',
  },
  {
    id: 'legs',
    label: '大腿与膝盖',
    seconds: 25,
    guide: '注意腿的重量，被椅子或床托住的那种感觉。',
  },
  {
    id: 'feet',
    label: '脚与脚趾',
    seconds: 25,
    guide: '脚底接触地面的地方。动一动脚趾，感受一下。最后，注意整个身体。',
  },
];

export function BodyScan() {
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(PARTS[0].seconds);
  const [recorded, setRecorded] = useState(false);
  const finish = useFinishTool();
  const { show } = useToast();
  const deadlineRef = useRef(0);
  const partStartRef = useRef(0);
  const totalElapsedRef = useRef(0);

  const part = PARTS[index];
  const isDone = index >= PARTS.length;

  // 计时：基于时间戳，切后台不漂移
  useEffect(() => {
    if (!running || isDone) return;
    deadlineRef.current = Date.now() + remaining * 1000;

    const id = window.setInterval(() => {
      const left = Math.max(0, (deadlineRef.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(id);
        setRunning(false);
      }
    }, 200);

    return () => window.clearInterval(id);
  }, [running, index, isDone]);

  // 切到下一部位
  const nextPart = useCallback(() => {
    totalElapsedRef.current += PARTS[index].seconds - remaining;
    if (index + 1 >= PARTS.length) {
      setIndex(PARTS.length);
      setRunning(false);
      recordToolSession('body-scan', totalElapsedRef.current);
      show('身体扫描完成。', 'success');
      setRecorded(true);
      return;
    }
    setIndex(index + 1);
    setRemaining(PARTS[index + 1].seconds);
    setRunning(false);
  }, [index, remaining, show]);

  // 当前部位时间到，自动进入下一部位
  useEffect(() => {
    if (!running || remaining > 0.2 || isDone) return;
    setRunning(false);
    show(`「${PARTS[index].label}」结束了，可以继续。`);
  }, [remaining, running, index, isDone, show]);

  function toggleRun() {
    if (!running && remaining <= 0) {
      setRemaining(part.seconds);
    }
    if (partStartRef.current === 0) partStartRef.current = Date.now();
    setRunning((v) => !v);
  }

  function reset() {
    setIndex(0);
    setRemaining(PARTS[0].seconds);
    setRunning(false);
    totalElapsedRef.current = 0;
    setRecorded(false);
  }

  if (isDone) {
    return (
      <ToolShell toolId="body-scan">
        <div className="tool-done">
          <div className="tool-done__mark" aria-hidden>
            ◍
          </div>
          <h2>扫描完成</h2>
          <p>
            你花了大约 {Math.round(totalElapsedRef.current / 60)} 分钟，把注意力一段一段地放回身体。
            <br />
            有没有哪个部位，是你之前完全没注意到的？
          </p>
          <div className="btn-group mt-5" style={{ justifyContent: 'center' }}>
            <Button variant="ghost" onClick={reset}>
              再做一次
            </Button>
          </div>
        </div>
        <div className="tool-explain">
          <h3>一个提醒</h3>
          <p>
            身体扫描不是"必须放松"的练习。有些人做的时候会发现更多疼痛或烦躁——那也是有效的信息。
            如果某个部位让你很不舒服，可以跳过它，去看别的地方。
          </p>
        </div>
      </ToolShell>
    );
  }

  return (
    <ToolShell toolId="body-scan">
      <div className="scan-stage">
        <Progress value={index / PARTS.length} />
        <p className="small muted mt-2">
          第 {index + 1} / {PARTS.length} 段 · 整轮约 {Math.round(PARTS.reduce((s, p) => s + p.seconds, 0) / 60)} 分钟
        </p>

        <div className="scan-part">
          <span className="scan-part__index mono">{String(index + 1).padStart(2, '0')}</span>
          <h2 className="scan-part__label">{part.label}</h2>
          <p className="scan-part__guide">{part.guide}</p>

          <div className="scan-timer">
            <span className={`scan-timer__value mono ${remaining < 5 ? 'is-ending' : ''}`}>
              {clock(remaining)}
            </span>
            <div className="scan-timer__bar">
              <div
                className="scan-timer__fill"
                style={{ width: `${(1 - remaining / part.seconds) * 100}%` }}
              />
            </div>
          </div>

          <div className="btn-group" style={{ justifyContent: 'center' }}>
            <Button size="lg" variant={running ? 'ghost' : 'primary'} onClick={toggleRun}>
              {running ? '暂停' : remaining < part.seconds ? '继续' : '开始这一段'}
            </Button>
            <Button variant="quiet" size="lg" onClick={nextPart}>
              {index + 1 >= PARTS.length ? '结束扫描' : '下一段'}
            </Button>
          </div>
        </div>
      </div>

      <div className="tool-explain">
        <h3>做的时候不用做的事</h3>
        <ul>
          <li>不用刻意深呼吸——正常呼吸就好。</li>
          <li>不用"清空大脑"——走神了就把注意力拉回来，走神本身就是练习的一部分。</li>
          <li>不用做完。随时停下都不影响什么。</li>
        </ul>
      </div>

      {index > 0 ? (
        <FinishBar
          finishLabel={recorded ? '已记录' : '提前结束并记录'}
          onFinish={() => {
            if (recorded) return;
            finish('body-scan', totalElapsedRef.current, { reachedPart: index });
            setRecorded(true);
          }}
        />
      ) : null}
    </ToolShell>
  );
}
