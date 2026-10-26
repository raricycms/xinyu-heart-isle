import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Primitives';
import { journalStore } from '@/lib/storage';
import { createId } from '@/lib/id';
import { nowISO } from '@/lib/date';
import { useToast } from '@/lib/toast';
import { useCountdown, clock } from '@/toolbox/useTimer';
import { ToolShell, useFinishTool } from '@/toolbox/ToolShell';

const DURATIONS = [5, 10, 15];

export function WorryTime() {
  const [minutes, setMinutes] = useState(10);
  const [worries, setWorries] = useState('');
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState(false);
  const finish = useFinishTool();
  const { show } = useToast();

  const onDone = useMemo(
    () => () => {
      show('时间到了。把担忧放回盒子里。', 'success');
    },
    [show],
  );

  const timer = useCountdown(minutes * 60, onDone);
  const totalSeconds = minutes * 60;

  function reset() {
    timer.reset();
    setStarted(false);
  }

  const worryCount = worries
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;

  return (
    <ToolShell toolId="worry-time">
      {!started ? (
        <div className="worry-stage">
          <div className="worry-setup">
            <h2>先把你现在担心的事，集中倒出来</h2>
            <p className="small muted">
              一行一件。倒的时候不用分析，也不用解决——现在只是把它们从脑子里搬到纸面上。
            </p>
            <textarea
              className="textarea mt-3"
              style={{ minHeight: 140 }}
              value={worries}
              placeholder={'明天的汇报会不会搞砸\n我妈的身体检查结果\n钱不够用'}
              onChange={(e) => setWorries(e.target.value)}
            />
            <p className="small muted mt-2">已写 {worryCount} 件</p>

            <div className="worry-duration mt-4">
              <span className="field-label">给自己多长的担忧时间？</span>
              <div className="btn-group">
                {DURATIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`tag tag--selectable ${minutes === m ? 'tag--selected' : ''}`}
                    onClick={() => setMinutes(m)}
                  >
                    {m} 分钟
                  </button>
                ))}
              </div>
            </div>

            <div className="btn-group mt-5">
              <Button
                size="lg"
                onClick={() => {
                  setStarted(true);
                  timer.start();
                }}
              >
                开始担忧时间
              </Button>
            </div>
          </div>

          <div className="tool-explain">
            <h3>这个练习反直觉的地方</h3>
            <p>
              通常我们想的是"别焦虑了"，但越压越反弹。担忧时间的思路相反：
              <strong>给焦虑一个固定的、有限的时间段</strong>。
              当大脑知道"晚上 8 点有专门的时间担心"，它在开会时反复提醒你的冲动就会弱一些。
            </p>
            <p className="small muted">
              关键在于边界：<strong>时间一到就停</strong>。如果做到了，大脑才会相信这个约定是真的。
            </p>
          </div>
        </div>
      ) : (
        <div className="worry-stage">
          <div className="worry-timer">
            <svg className="worry-ring" viewBox="0 0 200 200" aria-hidden>
              <circle cx="100" cy="100" r="88" fill="none" stroke="var(--sand-300)" strokeWidth="6" />
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke="var(--teal-400)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 88}
                strokeDashoffset={2 * Math.PI * 88 * (1 - timer.remaining / totalSeconds)}
                transform="rotate(-90 100 100)"
                style={{ transition: 'stroke-dashoffset 0.2s linear' }}
              />
            </svg>
            <div className="worry-timer__center">
              <span className="worry-timer__value mono">{clock(timer.remaining)}</span>
              <span className="small muted">{timer.done ? '时间到' : timer.running ? '担忧中' : '已暂停'}</span>
            </div>
          </div>

          {timer.done ? (
            <Notice tone="good" title="时间到了，把担忧放回盒子">
              现在做一件事：站起来，走动 30 秒，或者喝一口水。用一个动作告诉身体
              "这段时间结束了"。剩下的担忧，留给明天的担忧时间。
            </Notice>
          ) : (
            <div className="worry-list">
              <h3>现在只担心这些</h3>
              <ul>
                {worries
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
              </ul>
            </div>
          )}

          <div className="btn-group mt-4" style={{ justifyContent: 'center' }}>
            {!timer.done ? (
              <Button size="lg" variant={timer.running ? 'ghost' : 'primary'} onClick={timer.toggle}>
                {timer.running ? '暂停' : '继续'}
              </Button>
            ) : null}
            <Button variant="quiet" size="lg" onClick={reset}>
              重新开始
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={saved}
              onClick={() => {
                if (saved) return;
                journalStore.add({
                  id: createId('journal'),
                  at: nowISO(),
                  kind: 'free-write',
                  title: `担忧时间 · ${minutes} 分钟`,
                  content: worries.trim() || '（没有写下具体内容）',
                });
                finish('worry-time', totalSeconds - timer.remaining, {
                  minutes,
                  count: worryCount,
                });
                setSaved(true);
              }}
            >
              {saved ? '已保存' : '保存这次担忧'}
            </Button>
          </div>
        </div>
      )}
    </ToolShell>
  );
}
