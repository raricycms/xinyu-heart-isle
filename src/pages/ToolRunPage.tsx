import { Link, useParams } from 'react-router-dom';
import { ButtonLink } from '@/components/ui/Button';
import { Empty } from '@/components/ui/Primitives';
import { getToolById } from '@/toolbox/tools';
import { BareToolHeader } from '@/toolbox/ToolShell';
import { Breathing478 } from '@/toolbox/tools/Breathing478';
import { BoxBreathing } from '@/toolbox/tools/BoxBreathing';
import { Grounding54321 } from '@/toolbox/tools/Grounding54321';
import { BodyScan } from '@/toolbox/tools/BodyScan';
import { ThoughtRecord } from '@/toolbox/tools/ThoughtRecord';
import { WorryTime } from '@/toolbox/tools/WorryTime';
import { ThreeGoodThings } from '@/toolbox/tools/ThreeGoodThings';
import '@/styles/toolbox.css';

export default function ToolRunPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const tool = toolId ? getToolById(toolId) : undefined;

  if (!toolId || !tool) {
    return (
      <div className="page">
        <BareToolHeader title="找不到这个练习" />
        <Empty
          icon="○"
          title="这个工具不存在"
          desc="可能是链接过期了，或者编号打错了。工具箱里的每个练习都可以从列表重新进入。"
          action={
            <ButtonLink to="/toolbox" variant="ghost">
              返回情绪工具箱
            </ButtonLink>
          }
        />
        <p className="small muted center mt-5">
          如果你现在很难受，也可以直接去
          <Link to="/safety"> 危机与求助</Link>。
        </p>
      </div>
    );
  }

  switch (tool.id) {
    case 'breathing-478':
      return <Breathing478 />;
    case 'box-breathing':
      return <BoxBreathing />;
    case 'grounding-54321':
      return <Grounding54321 />;
    case 'body-scan':
      return <BodyScan />;
    case 'thought-record':
      return <ThoughtRecord />;
    case 'worry-time':
      return <WorryTime />;
    case 'three-good-things':
      return <ThreeGoodThings />;
    default:
      return (
        <div className="page">
          <BareToolHeader title={tool.label} />
          <Empty icon="○" title="这个练习还在准备中" desc="换一个练习试试看。" />
        </div>
      );
  }
}
