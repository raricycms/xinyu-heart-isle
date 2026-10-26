import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { usePreferences } from '@/lib/storage';
import { getScaleById } from '@/scales/data';
import { getToolById } from '@/toolbox/tools';
import HomePage from '@/pages/HomePage';
import ScalesPage from '@/pages/ScalesPage';
import ScaleRunPage from '@/pages/ScaleRunPage';
import ToolboxPage from '@/pages/ToolboxPage';
import ToolRunPage from '@/pages/ToolRunPage';
import ResourcesPage from '@/pages/ResourcesPage';
import RecordsPage from '@/pages/RecordsPage';
import SafetyPage from '@/pages/SafetyPage';
import AboutPage from '@/pages/AboutPage';
import NotFoundPage from '@/pages/NotFoundPage';

/**
 * 路由级懒加载。
 *
 * 拆包策略（CONTRACT §7：主包 gzip ≤ 175KB）：
 * - 沙盘工作台是最大的单页（沙具库 327 条 + 三个渲染器 + 工作台组件），
 *   且首屏几乎没人直接落到 /sandbox，因此整个工作台按需加载；
 * - 回放/对比/档案/报告各自再拆，避免一次加载全部存档功能；
 * - three 由 SandRendererSwitch 内部 `import()`，只有用户真的选 3D 才下载。
 *
 * 注意：懒加载会让「点击到画面出现」之间多一次网络往返，
 * 因此 fallback 必须是一个占位骨架（而不是空白），否则用户会以为是页面卡住。
 */
const SandboxPage = lazy(() => import('@/pages/SandboxPage'));
const SessionReplayPage = lazy(() => import('@/sandbox/pages/SessionReplayPage'));
const SessionReportPage = lazy(() => import('@/sandbox/pages/SessionReportPage'));
const ComparePage = lazy(() => import('@/sandbox/pages/ComparePage'));
const ClientsPage = lazy(() => import('@/sandbox/pages/ClientsPage'));
const ClientProfilePage = lazy(() => import('@/sandbox/pages/ClientProfilePage'));

function RouteFallback() {
  return (
    <div className="page">
      <div className="spinner" role="status" aria-label="加载中" />
    </div>
  );
}

/** 统一的懒加载包裹，避免每个 Route 重复写 Suspense */
function lazyEl(node: React.ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export default function App() {
  const { reducedMotion } = usePreferences();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '心屿 · 心理自助工具站',
      '/scales': '心理量表 · 心屿',
      '/sandbox': '赛博沙盘 · 心屿',
      '/sandbox/compare': '纵向对比 · 心屿',
      '/sandbox/clients': '本地档案 · 心屿',
      '/toolbox': '情绪工具箱 · 心屿',
      '/resources': '资源地图 · 心屿',
      '/records': '我的记录 · 心屿',
      '/safety': '危机与求助 · 心屿',
      '/about': '关于与边界 · 心屿',
    };

    let title = titles[location.pathname];

    // 动态详情页：用真实条目名称作为标题，而不是回退到站点默认标题
    if (!title) {
      const scaleMatch = location.pathname.match(/^\/scales\/([^/]+)$/);
      const toolMatch = location.pathname.match(/^\/toolbox\/([^/]+)$/);
      const replayMatch = location.pathname.match(/^\/sandbox\/session\/([^/]+)$/);
      const clientMatch = location.pathname.match(/^\/sandbox\/clients\/([^/]+)$/);
      if (scaleMatch) {
        const scale = getScaleById(scaleMatch[1]);
        title = scale ? `${scale.shortName} · 心屿` : '找不到这份量表 · 心屿';
      } else if (toolMatch) {
        const tool = getToolById(toolMatch[1]);
        title = tool ? `${tool.label} · 心屿` : '找不到这个练习 · 心屿';
      } else if (replayMatch) {
        title = '回看沙盘 · 心屿';
      } else if (clientMatch) {
        title = '档案 · 心屿';
      }
    }

    document.title = title ?? '心屿 · 心理自助工具站';
  }, [location.pathname]);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="scales" element={<ScalesPage />} />
        <Route path="scales/:scaleId" element={<ScaleRunPage />} />
        <Route path="sandbox" element={lazyEl(<SandboxPage />)} />
        <Route path="sandbox/session/:id" element={lazyEl(<SessionReplayPage />)} />
        <Route path="sandbox/session/:id/report" element={lazyEl(<SessionReportPage />)} />
        <Route path="sandbox/compare" element={lazyEl(<ComparePage />)} />
        <Route path="sandbox/clients" element={lazyEl(<ClientsPage />)} />
        <Route path="sandbox/clients/:id" element={lazyEl(<ClientProfilePage />)} />
        <Route path="toolbox" element={<ToolboxPage />} />
        <Route path="toolbox/:toolId" element={<ToolRunPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
