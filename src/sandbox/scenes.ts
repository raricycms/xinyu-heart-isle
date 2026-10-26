import type { SceneId } from '@/lib/types';

/**
 * 心屿 · 沙盘场景主题
 *
 * background 直接用 CSS 渐变字符串，绑到画布 style 上。
 * ground 用于画布底部"地面"色，让摆件有落脚处。
 */

export interface SandboxScene {
  id: SceneId;
  label: string;
  /** 画布背景 */
  background: string;
  /** 地面色（画布底部一层柔和渐变） */
  ground: string;
  /** 画布内文字颜色（深色场景用浅字） */
  ink: string;
  /** 是不是深色场景（影响工具条配色） */
  dark: boolean;
}

export const SCENES: SandboxScene[] = [
  {
    id: 'beach',
    label: '沙滩',
    background:
      'linear-gradient(180deg, #e8f1f2 0%, #dcebe8 42%, #f4e7d3 62%, #e9d8bd 100%)',
    ground: 'linear-gradient(180deg, rgba(233,216,189,0) 0%, rgba(214,192,160,0.55) 100%)',
    ink: '#4a4235',
    dark: false,
  },
  {
    id: 'meadow',
    label: '草地',
    background:
      'linear-gradient(180deg, #eaf2ea 0%, #dfece0 45%, #cfe2cd 68%, #bcd7b8 100%)',
    ground: 'linear-gradient(180deg, rgba(188,215,184,0) 0%, rgba(150,190,146,0.5) 100%)',
    ink: '#33452f',
    dark: false,
  },
  {
    id: 'night',
    label: '夜晚',
    background:
      'radial-gradient(120% 90% at 50% 0%, #2c3a4a 0%, #1d2733 45%, #141b24 100%)',
    ground: 'linear-gradient(180deg, rgba(10,14,20,0) 0%, rgba(8,11,16,0.6) 100%)',
    ink: '#dfe6ee',
    dark: true,
  },
  {
    id: 'room',
    label: '房间',
    background:
      'linear-gradient(180deg, #f6efe4 0%, #f3e7d6 40%, #e8d8c2 72%, #dcc9ae 100%)',
    ground: 'linear-gradient(180deg, rgba(220,201,174,0) 0%, rgba(198,175,143,0.55) 100%)',
    ink: '#4a4034',
    dark: false,
  },
  {
    id: 'void',
    label: '虚空',
    background:
      'radial-gradient(90% 80% at 50% 45%, #f7f5f1 0%, #eceae5 55%, #e2ded6 100%)',
    ground: 'linear-gradient(180deg, rgba(226,222,214,0) 0%, rgba(205,199,188,0.45) 100%)',
    ink: '#4d4842',
    dark: false,
  },
];

const sceneMap = new Map(SCENES.map((scene) => [scene.id, scene]));

export function getScene(id: string): SandboxScene {
  return sceneMap.get(id as SceneId) ?? SCENES[0];
}
