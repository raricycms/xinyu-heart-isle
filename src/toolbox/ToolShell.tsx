import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { getToolById, recordToolSession } from '@/toolbox/tools';
import { useToast } from '@/lib/toast';

/** 简版页头：只用于错误页 / 找不到工具时 */
export function BareToolHeader({ title }: { title: string }) {
  return (
    <div className="tool-head">
      <Link to="/toolbox" className="tool-back">
        ← 返回工具箱
      </Link>
      <div className="tool-head__title">
        <h1 className="page-title">{title}</h1>
      </div>
    </div>
  );
}

/** 所有工具共用的外壳：返回链接 + 温和文案 + 内容区 */
export function ToolShell({
  toolId,
  children,
  footer,
}: {
  toolId: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const tool = getToolById(toolId);
  return (
    <div className="page">
      <div className="tool-head">
        <Link to="/toolbox" className="tool-back">
          ← 返回工具箱
        </Link>
        <div className="tool-head__title">
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {tool?.label ?? '练习'}
          </h1>
          <p className="small muted">{tool?.whenToUse}</p>
        </div>
      </div>

      <div className="tool-note">
        随时可以停下，这已经很好了。不用做完，也不用做得「对」。
      </div>

      <div className="tool-body">{children}</div>

      {footer ? <div className="mt-5">{footer}</div> : null}
    </div>
  );
}

/** 练习结束时统一记录 + 提示 */
export function useFinishTool() {
  const { show } = useToast();
  return (toolId: string, durationSec?: number, payload?: Record<string, unknown>) => {
    recordToolSession(toolId, durationSec, payload);
    show('这次练习已经记下了。', 'success');
  };
}

/** 「完成了」的操作区 */
export function FinishBar({
  onFinish,
  finishLabel = '记下这次练习',
  extra,
}: {
  onFinish: () => void;
  finishLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="tool-finish">
      <Button variant="quiet" onClick={onFinish}>
        {finishLabel}
      </Button>
      {extra}
    </div>
  );
}
