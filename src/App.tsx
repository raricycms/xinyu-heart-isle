import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { usePreferences } from '@/lib/storage';
import { getScaleById } from '@/scales/data';
import { getToolById } from '@/toolbox/tools';
import HomePage from '@/pages/HomePage';
import ScalesPage from '@/pages/ScalesPage';
import ScaleRunPage from '@/pages/ScaleRunPage';
import SandboxPage from '@/pages/SandboxPage';
import ToolboxPage from '@/pages/ToolboxPage';
import ToolRunPage from '@/pages/ToolRunPage';
import ResourcesPage from '@/pages/ResourcesPage';
import RecordsPage from '@/pages/RecordsPage';
import SafetyPage from '@/pages/SafetyPage';
import AboutPage from '@/pages/AboutPage';
import NotFoundPage from '@/pages/NotFoundPage';

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
      if (scaleMatch) {
        const scale = getScaleById(scaleMatch[1]);
        title = scale ? `${scale.shortName} · 心屿` : '找不到这份量表 · 心屿';
      } else if (toolMatch) {
        const tool = getToolById(toolMatch[1]);
        title = tool ? `${tool.label} · 心屿` : '找不到这个练习 · 心屿';
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
        <Route path="sandbox" element={<SandboxPage />} />
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
