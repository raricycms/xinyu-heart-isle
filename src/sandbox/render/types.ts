/**
 * 心屿 · 沙盘渲染器适配层
 *
 * VISION.md §7.3 的关键决策：**不把 3D 写进主路径**。
 * 所有渲染器实现同一套接口，页面按用户偏好选择，业务逻辑对渲染器无感知。
 *
 * | 实现 | 文件 | 体积 | 用途 |
 * | --- | --- | --- | --- |
 * | dom2d | render/dom2d.tsx | 0 | 无障碍基线、reduced-motion、低端设备 |
 * | iso2d | render/iso2d.tsx | ~0（Canvas 2D 手写） | **默认**，2.5D 轴测 |
 * | three | render/three.tsx | 动态 import（~150KB gzip） | 用户显式选择 |
 *
 * 实现方必须遵守：
 * 1. **不持有状态**：摆件数据由 `items` prop 传入，渲染器只画；
 * 2. **不写存储**：任何持久化都回到 `useSandboxSession`；
 * 3. **可辨识回调**：拖动结束才调 `onItemCommit`，拖动中只调 `onItemDrag`（纯视觉）；
 * 4. **命中测试**：必须支持键盘选中（`selectedId`）与 `aria-label`。
 */

import type { RefObject } from 'react';
import type { SandboxItem, SurfaceTool } from '@/lib/types';
import type { SurfaceState } from '@/sandbox/surfaceCodec';

/** 沙面笔刷视觉参数（渲染器只负责画，不负责算） */
export interface BrushCursor {
  /** 归一化坐标 */
  x: number;
  y: number;
  /** 归一化半径 */
  radius: number;
  tool: SurfaceTool;
  /** 是否正在按压（用于显示力度） */
  active: boolean;
}

/** 渲染器统一的 props */
export interface SandRendererProps {
  /** 摆件列表（只读） */
  items: SandboxItem[];
  /** 场景 id */
  sceneId: string;
  /** 选中摆件 */
  selectedId: string | null;
  /** 沙面状态（dom2d 可忽略；iso2d / three 必用） */
  surface: SurfaceState;
  /** 是否只读（回放 / 封盘后） */
  readOnly?: boolean;
  /** 减少动效 */
  reducedMotion?: boolean;
  /** 高对比 / 轮廓模式 */
  outlineMode?: boolean;
  /** 当前笔刷（null 表示摆件交互模式） */
  brush: BrushCursor | null;
  /**
   * 沙具包图片表：`symbolId -> dataURL`。
   *
   * 内置 327 个沙具都是字形（glyph）驱动，不需要图片；
   * 但用户导入的沙具包可以带 `image`（见 `sandbox-symbol-pack/v1`），
   * 这类沙具没有字形可用，必须靠这张表画出来 —— 否则会退化成占位符。
   *
   * 由页面用 `usePackImageMap()` 提供；不传则全部按字形渲染。
   */
  imageMap?: Record<string, string>;

  /* 事件 */
  onSelect: (id: string | null) => void;
  /** 拖动过程中的视觉更新（不落事件） */
  onItemDrag?: (id: string, x: number, y: number) => void;
  /** 拖动结束（应落一条 item.move 事件） */
  onItemCommit?: (id: string, from: { x: number; y: number }, to: { x: number; y: number }) => void;
  /** 双击摆件（写注释） */
  onItemActivate?: (item: SandboxItem) => void;
  /** 沙面笔画完成（应落一条 surface.stroke 事件） */
  onSurfaceStroke?: (tool: SurfaceTool, points: Array<{ x: number; y: number }>) => void;
  /** 画布空白点击 */
  onCanvasClick?: () => void;
}

/** 渲染器可选暴露的命令式接口（截图、导出缩略图） */
export interface SandRendererHandle {
  /** 导出当前画面为 dataURL（用于会话缩略图） */
  capture?: () => string | null;
  /** 回到初始视角（3D 用） */
  resetView?: () => void;
}

/** 渲染器组件类型 */
export type SandRendererComponent = (
  props: SandRendererProps & { handleRef?: RefObject<SandRendererHandle | null> },
) => React.ReactElement | null;

/** 渲染器元信息（用于设置页展示与懒加载决策） */
export interface RendererDescriptor {
  id: 'dom2d' | 'iso2d' | 'three';
  label: string;
  /** i18n 键：沙盘模块是双语区，标签必须能跟着语言切 */
  labelKey: string;
  description: string;
  /** 是否需要动态加载（影响是否显示 loading） */
  lazy: boolean;
}

/*
 * `labelKey` 是后补的。此前 label 是写死的中文，而 `settings.renderer.*`
 * 三个键在两套字典里都齐备却零引用 —— 又是「有文案、没接线」。
 * label 保留作为无 i18n 上下文时的兜底（如纯 TS 的快照/测试）。
 */
export const RENDERERS: RendererDescriptor[] = [
  {
    id: 'dom2d',
    label: '简洁平面',
    labelKey: 'settings.renderer.dom2d',
    description: '最稳、最省电，键盘与读屏最友好。',
    lazy: false,
  },
  {
    id: 'iso2d',
    label: '立体沙盘（推荐）',
    labelKey: 'settings.renderer.iso2d',
    description: '有纵深、能埋进沙里，看得到沙面起伏。',
    lazy: false,
  },
  {
    id: 'three',
    label: '3D 视角（实验）',
    labelKey: 'settings.renderer.three',
    description: '可旋转观察的立体沙盘。首次加载会稍慢。',
    lazy: true,
  },
];
