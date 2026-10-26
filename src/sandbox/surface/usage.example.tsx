/**
 * 沙面介质层接入示例（可直接替换 SandboxPage 里的内联工具条）。
 *
 * 这个文件**不参与构建**（`.example.tsx` 不在 include 里），
 * 但它被 `npx tsc` 的 editor 检查覆盖——所以示例里的签名如果写错，
 * 打开编辑器就能看到红线，不会变成"文档和实现对不上"。
 *
 * 用法：把下面 30 行搬进 src/pages/SandboxPage.tsx，
 * 删掉那里的 `SURFACE_TOOLS` 常量和 `.wb-surfacebar` 内联 JSX。
 */
import { useCallback, useState } from 'react';
import {
  SurfaceToolbar,
  SilenceToggle,
  useBrush,
  BRUSH_RADIUS_MIN,
  BRUSH_STRENGTH_MIN,
} from '@/sandbox/surface';
import type { SurfaceTool } from '@/lib/types';

export function SurfaceWorkbenchExample() {
  const [tool, setTool] = useState<SurfaceTool | null>('raise');
  const [radius, setRadius] = useState(BRUSH_RADIUS_MIN * 2);
  const [strength, setStrength] = useState(BRUSH_STRENGTH_MIN + 0.4);
  const [silent, setSilent] = useState(false);

  /* useBrush 负责「指针 -> 一笔归一化采样」；提交时再交给会话层落盘。 */
  const stroke = useBrush({
    tool,
    radius,
    strength,
    enabled: tool !== null,
    onToolChange: setTool,
    onRadiusChange: setRadius,
    onStrengthChange: setStrength,
    onStrokeCommit: useCallback((committed: SurfaceTool, points: { x: number; y: number }[]) => {
      // session.strokeSurface(committed, points, radius, strength)
      console.log(committed, points.length);
    }, []),
  });

  return (
    <div className="wb-surface"
      onPointerDown={stroke.onPointerDown}
      onPointerMove={stroke.onPointerMove}
      onPointerUp={stroke.onPointerUp}
      onPointerCancel={stroke.onPointerUp}
      onKeyDown={stroke.onKeyDown}
      onKeyUp={stroke.onKeyUp}
    >
      <SurfaceToolbar
        tool={tool}
        onToolChange={setTool}
        radius={radius}
        onRadiusChange={setRadius}
        strength={strength}
        onStrengthChange={setStrength}
        onReset={() => { /* session.resetSurface() */ }}
        silent={silent}
      />
      <SilenceToggle silent={silent} onSilentChange={setSilent} />
    </div>
  );
}
