import { Suspense, lazy, type ComponentType } from 'react';
import type { RendererKind } from '@/lib/types';
import { Dom2DRenderer } from '@/sandbox/render/dom2d';
import { Iso2DRenderer } from '@/sandbox/render/iso2d';
import type { SandRendererProps } from '@/sandbox/render/types';

/**
 * 渲染器注册表。
 *
 * `three` 必须走动态 import——它是唯一会把主包撑大的依赖（CONTRACT §7 预算）。
 * 这里用 `lazy` 而不是静态 import，Vite 会自动切出独立 chunk。
 */
const ThreeRenderer = lazy(() =>
  import('@/sandbox/render/three').then((module) => ({ default: module.ThreeRenderer })),
);

type RendererComponent = ComponentType<SandRendererProps>;

const REGISTRY: Record<RendererKind, RendererComponent | 'lazy-three'> = {
  dom2d: Dom2DRenderer as RendererComponent,
  iso2d: Iso2DRenderer as RendererComponent,
  three: 'lazy-three',
};

export interface SandRendererSwitchProps extends SandRendererProps {
  renderer: RendererKind;
}

/** 按偏好选择渲染器；`three` 加载失败时静默回退到 iso2d（不能白屏） */
export function SandRendererSwitch({ renderer, ...props }: SandRendererSwitchProps) {
  if (renderer === 'three') {
    return (
      <Suspense fallback={<Iso2DRenderer {...props} />}>
        <ThreeRenderer {...props} />
      </Suspense>
    );
  }
  const Component = REGISTRY[renderer] as RendererComponent;
  return <Component {...props} />;
}

export { Dom2DRenderer, Iso2DRenderer };
