import { Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { usePreferences } from '@/lib/storage';
import HomePage from '@/pages/HomePage';
import ScalesPage from '@/pages/ScalesPage';
import ToolboxPage from '@/pages/ToolboxPage';
/*
 * SafetyPage 保持静态导入 —— 危机页不允许有加载延迟。
 * 详见下方拆包策略注释。
 */
import SafetyPage from '@/pages/SafetyPage';
import NotFoundPage from '@/pages/NotFoundPage';

/**
 * 路由级懒加载。
 *
 * 拆包策略（VISION §5.9 L344：**首屏 JS ≤ 200KB gzip**，不含 3D 路由）：
 *
 * - 沙盘工作台是最大的单页（沙具库 327 条 + 三个渲染器 + 工作台组件），
 *   且首屏几乎没人直接落到 /sandbox，因此整个工作台按需加载；
 * - 回放/对比/档案/报告各自再拆，避免一次加载全部存档功能；
 * - three 由 SandRendererSwitch 内部 `import()`，只有用户真的选 3D 才下载。
 * - **详情页也拆**（量表作答 / 练习详情 / 记录 / 资源 / 关于）：
 *   `ScaleRunPage` 一个就 27KB 源码，它承载的是「点进某份量表之后」
 *   的动作，不是首屏必需。
 *
 * 【哪些页面**必须**保持静态】
 *
 * - `HomePage` —— 就是首屏本身。
 * - `ScalesPage` / `ToolboxPage` —— 一级导航落点，多一次往返很突兀。
 * - **`SafetyPage`** —— 危机与求助页。CONTRACT §5 / VISION §5.6 要求
 *   「任何页面 ≤2 次点击可达」。给它加一层网络往返，等于在最需要它的
 *   时刻让它变慢甚至失败（弱网/离线）。**这一条不能为了体积让步。**
 * - `NotFoundPage` —— 兜底，不能自己也需要加载。
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

/* 详情页：内容是「某个具体条目」，不是首屏入口，按需加载 */
const ScaleRunPage = lazy(() => import('@/pages/ScaleRunPage'));
const ToolRunPage = lazy(() => import('@/pages/ToolRunPage'));
const RecordsPage = lazy(() => import('@/pages/RecordsPage'));
const ResourcesPage = lazy(() => import('@/pages/ResourcesPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));

/**
 * 懒加载骨架。
 *
 * `data-testid="route-loading"` 是给 E2E 用的**稳定**判据：
 * 测试靠「这个标记消失了没」来判断懒加载完成，而不是靠
 * `.spinner` 这个样式类（会被合法重命名）或 `role="status"`
 * （无障碍属性，可能因为改用别的骨架而调整）。
 *
 * 加这个 testid 的起因很具体：路由改成懒加载后，E2E 里
 * `waitAny(page, ['main', 'h1'])` 变成了恒真等待 —— `AppShell`
 * 自己就渲染 `<main>`，所以任何页面一挂载它就为真，断言在
 * chunk 尚未下载时就开始跑。表现为「功能没坏但 E2E 红」。
 * 稳定的做法是让「加载中」这个状态本身可观测。
 */
function RouteFallback() {
  return (
    <div className="page" data-testid="route-loading">
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

    /*
     * 动态详情页的标题。
     *
     * 【这里刻意不 import 数据来查名字】
     * 原实现 `getScaleById(id).shortName` 会把整个 `scales/data`（27KB）
     * 拖进主 chunk —— 就为了给 document.title 拼一个名字，等于让每个
     * 访问首页的人下载全部量表内容。详情页本身已经懒加载了，
     * 再为标题把它同步拉回来就白拆了。
     *
     * 代价是标签页显示的是通用名（「心理量表 · 心屿」而不是
     * 「PHQ-9 · 心屿」）。这个取舍是有意的：**SEO/标签页精度 < 首屏体积**。
     * 详情页挂载后由页面自己用更精确的标题覆盖即可（见各页 useEffect）。
     */
    if (!title) {
      if (/^\/scales\/[^/]+$/.test(location.pathname)) {
        title = '心理量表 · 心屿';
      } else if (/^\/toolbox\/[^/]+$/.test(location.pathname)) {
        title = '情绪工具箱 · 心屿';
      } else if (/^\/sandbox\/session\/[^/]+$/.test(location.pathname)) {
        title = '回看沙盘 · 心屿';
      } else if (/^\/sandbox\/clients\/[^/]+$/.test(location.pathname)) {
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
        <Route path="scales/:scaleId" element={lazyEl(<ScaleRunPage />)} />
        <Route path="sandbox" element={lazyEl(<SandboxPage />)} />
        <Route path="sandbox/session/:id" element={lazyEl(<SessionReplayPage />)} />
        <Route path="sandbox/session/:id/report" element={lazyEl(<SessionReportPage />)} />
        <Route path="sandbox/compare" element={lazyEl(<ComparePage />)} />
        <Route path="sandbox/clients" element={lazyEl(<ClientsPage />)} />
        <Route path="sandbox/clients/:id" element={lazyEl(<ClientProfilePage />)} />
        <Route path="toolbox" element={<ToolboxPage />} />
        <Route path="toolbox/:toolId" element={lazyEl(<ToolRunPage />)} />
        <Route path="resources" element={lazyEl(<ResourcesPage />)} />
        <Route path="records" element={lazyEl(<RecordsPage />)} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="about" element={lazyEl(<AboutPage />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
