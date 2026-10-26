import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ToastContext } from '@/lib/toast';
import { cx } from '@/lib/utils';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warn';
}

const NAV_ITEMS = [
  { to: '/', label: '首页', end: true },
  { to: '/scales', label: '心理量表' },
  { to: '/sandbox', label: '赛博沙盘' },
  { to: '/toolbox', label: '情绪工具箱' },
  { to: '/resources', label: '资源地图' },
  { to: '/records', label: '我的记录' },
];

export function AppShell() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const seq = useRef(0);
  const location = useLocation();

  const show = useCallback((message: string, tone: 'info' | 'success' | 'warn' = 'info') => {
    seq.current += 1;
    const id = seq.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  // 路由切换时收起移动端菜单并回到顶部
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <ToastContext.Provider value={api}>
      <div className="app-shell">
        <header className="site-header">
          <div className="site-header__inner">
            <Link to="/" className="brand" aria-label="心屿 · 回到首页">
              <span className="brand__mark" aria-hidden>
                <svg viewBox="0 0 32 32" width="26" height="26">
                  <path
                    d="M3 21c4.5-3.4 7.6-3.4 12.2 0 4.5 3.4 7.6 3.4 12.8 0v7H3z"
                    fill="currentColor"
                    opacity="0.75"
                  />
                  <circle cx="16" cy="12.4" r="5.4" fill="currentColor" />
                </svg>
              </span>
              <span className="brand__text">
                <strong>心屿</strong>
                <small>心理自助工具站</small>
              </span>
            </Link>

            <nav className="site-nav" aria-label="主导航">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx('site-nav__link', isActive && 'is-active')}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="site-header__actions">
              <Link to="/safety" className="safety-chip" title="需要即时帮助？">
                <span aria-hidden>◍</span> 我需要帮助
              </Link>
              <button
                type="button"
                className="menu-toggle"
                aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span aria-hidden>{menuOpen ? '✕' : '☰'}</span>
              </button>
            </div>
          </div>

          {menuOpen ? (
            <nav className="mobile-nav" aria-label="移动端主导航">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx('mobile-nav__link', isActive && 'is-active')}
                >
                  {item.label}
                </NavLink>
              ))}
              <NavLink to="/safety" className="mobile-nav__link mobile-nav__link--alert">
                我需要即时帮助
              </NavLink>
            </nav>
          ) : null}
        </header>

        <main id="main" className="app-main">
          <Outlet />
        </main>

        <SiteFooter />
      </div>

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', `toast--${t.tone}`)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <strong>心屿</strong>
          <p className="small">
            一个安静的心理自助工具站。所有记录只保存在你自己的浏览器里，不会上传到任何服务器。
          </p>
        </div>
        <div className="site-footer__links">
          <Link to="/safety">危机与求助</Link>
          <Link to="/about">关于与边界</Link>
          <Link to="/records">我的记录</Link>
        </div>
      </div>
      <p className="site-footer__note small">
        本站内容仅供自我了解与情绪调节参考，不构成医学诊断或治疗建议。如果你正经历持续的痛苦，请
        <Link to="/safety">联系专业心理服务或紧急救助</Link>。
      </p>
    </footer>
  );
}
