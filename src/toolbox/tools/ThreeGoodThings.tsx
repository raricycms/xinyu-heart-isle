import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Primitives';
import { journalStore } from '@/lib/storage';
import { createId } from '@/lib/id';
import { nowISO } from '@/lib/date';
import { FinishBar, ToolShell, useFinishTool } from '@/toolbox/ToolShell';

interface GoodThing {
  what: string;
  why: string;
}

const EMPTY: GoodThing[] = [
  { what: '', why: '' },
  { what: '', why: '' },
  { what: '', why: '' },
];

export function ThreeGoodThings() {
  const [items, setItems] = useState<GoodThing[]>(EMPTY);
  const [saved, setSaved] = useState(false);
  const finish = useFinishTool();

  const filled = items.filter((item) => item.what.trim().length > 0).length;

  function update(index: number, patch: Partial<GoodThing>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function save() {
    if (saved) return;
    const content = items
      .filter((item) => item.what.trim())
      .map(
        (item, index) =>
          `${index + 1}. ${item.what.trim()}${item.why.trim() ? `\n   为什么：${item.why.trim()}` : ''}`,
      )
      .join('\n\n');
    journalStore.add({
      id: createId('journal'),
      at: nowISO(),
      kind: 'gratitude',
      title: `三件好事 · ${new Date().getMonth() + 1}/${new Date().getDate()}`,
      content,
    });
    finish('three-good-things', undefined, { count: filled });
    setSaved(true);
  }

  return (
    <ToolShell toolId="three-good-things">
      <div className="good-stage">
        <div className="good-intro">
          <h2>今天有哪三件小事，还算不错？</h2>
          <p className="small muted">
            不需要是大事。「地铁刚好有座位」「同事帮我带了咖啡」「今天的阳光不错」都算。
            关键是第二栏：<strong>它为什么会发生</strong>。
          </p>
        </div>

        <div className="good-list">
          {items.map((item, index) => (
            <div key={index} className="good-item">
              <span className="good-item__num mono">{index + 1}</span>
              <div className="good-item__fields">
                <label className="sr-only" htmlFor={`good-what-${index}`}>
                  第 {index + 1} 件好事
                </label>
                <input
                  id={`good-what-${index}`}
                  className="input"
                  value={item.what}
                  maxLength={60}
                  placeholder={
                    index === 0 ? '例如：午休时睡着了 20 分钟' : index === 1 ? '例如：朋友发来一条消息' : '例如：把拖了两天的邮件回了'
                  }
                  onChange={(e) => update(index, { what: e.target.value })}
                />
                <label className="sr-only" htmlFor={`good-why-${index}`}>
                  第 {index + 1} 件好事的原因
                </label>
                <input
                  id={`good-why-${index}`}
                  className="input"
                  value={item.why}
                  maxLength={80}
                  placeholder="它为什么会发生？（例如：我今天提前放下了手机）"
                  onChange={(e) => update(index, { why: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="small muted mt-3">已填 {filled} / 3　（填一件也有效）</p>

        <div className="btn-group mt-4">
          <Button onClick={save} disabled={filled === 0 || saved} size="lg">
            {saved ? '已保存' : '保存到今天'}
          </Button>
          <Button
            variant="quiet"
            size="lg"
            onClick={() => {
              setItems(EMPTY);
              setSaved(false);
            }}
          >
            清空重写
          </Button>
        </div>

        {saved ? (
          <Notice tone="good" title="存好了">
            这些会出现在「我的记录」里。状态不好的时候翻一翻，会看到自己其实有过不少还算好的时刻。
          </Notice>
        ) : null}
      </div>

      <div className="tool-explain">
        <h3>为什么第二栏才是重点</h3>
        <p>
          只写"今天发生了什么好事"，效果会很快消失。真正起作用的是追问<strong>"为什么"</strong>——
          因为它把你从"运气好"移到"我做了什么"或"什么条件在支撑我"。
          前者是随机的，后者是你可以重复的。
        </p>
        <p className="small muted">
          这不是要求你感恩。如果今天真的很糟，写不出来是正常的——那时候更需要的是休息，
          或者去「情绪工具箱」里做一个安抚练习。
        </p>
      </div>

      {filled > 0 && !saved ? (
        <FinishBar finishLabel="记下这次练习（不保存内容）" onFinish={() => finish('three-good-things', undefined, { count: filled })} />
      ) : null}
    </ToolShell>
  );
}
