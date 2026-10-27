import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/Primitives';
import { useToast } from '@/lib/toast';
import { usePreferences, setPreferences } from '@/lib/storage';
import { clamp } from '@/lib/utils';
import { createId } from '@/lib/id';
import { getSession, saveSession, useSessions } from '@/lib/sessionStore';
import type { RendererKind, SandboxItem, SurfaceTool } from '@/lib/types';
import { useSandboxSession } from '@/sandbox/useSandboxSession';
import { createSandSound, SILENT_SAND_SOUND } from '@/sandbox/audio/sandSound';
import type { SandSound } from '@/sandbox/audio/sandSound';
import { replay } from '@/sandbox/events';
import { forkSessionAt, parseResumeParams } from '@/sandbox/replay/resume';
import { SandRendererSwitch } from '@/sandbox/render';
import { symbolLabel } from '@/sandbox/symbols';
import { SymbolTray } from '@/sandbox/library/SymbolTray';
import { usePackImageMap } from '@/sandbox/library';
import { Toolbar } from '@/sandbox/workbench/Toolbar';
import { Inspector } from '@/sandbox/workbench/Inspector';
import { PromptCard, SavePanel, LockDialog, SandboxAffect } from '@/sandbox/workbench/SidePanels';
import { SurfaceToolbar, SilenceToggle } from '@/sandbox/surface';
import { renderThumbnail } from '@/sandbox/thumbnail';
import { useI18n } from '@/i18n';
import '@/styles/sandbox-workbench.css';

/**
 * 沙盘工作台（v2）。
 *
 * 结构：
 *   顶栏（模式/场景/渲染器/撤销/保存）
 *   ├ 左栏：沙具库（SymbolTray，symbol-dev 提供）
 *   ├ 舞台：渲染器 + 沙面工具条 + 检查器浮层
 *   └ 右栏：引导语 / 感受 / 保存
 *
 * 关键设计决策：
 * 1. **单一真相**：所有状态在 `useSandboxSession` 的事件流里，页面只读不写。
 * 2. **静默模式**（focus）是一等公民：一键隐藏所有面板，Esc 退出。
 * 3. **封盘不可逆**：锁定后所有编辑入口同时禁用，但过程与文字仍可查看/导出。
 * 4. 沙面笔刷走 rAF 节流，松手才提交一笔（不污染事件流）。
 */

/*
 * 沙面工具的 7 个条目（含字形与 i18n key）已移到
 * `src/sandbox/surface/SurfaceToolbar.tsx` 的 `SURFACE_TOOL_LIST`。
 * 这里曾经有一份重复定义的 `SURFACE_TOOLS`——两个来源迟早会漂移
 * （改了一个忘了另一个），而且字形 `🪮` 这类 emoji 在不同字体下渲染不一致，
 * 只该有一个地方说了算。
 */

export default function SandboxPage() {
  const { t } = useI18n();
  const { show } = useToast();
  const prefs = usePreferences();
  const sessions = useSessions();
  const [searchParams, setSearchParams] = useSearchParams();

  const api = useSandboxSession({ initialMode: 'self' });
  /** 沙具包图片表：图片型沙具在沙盘上要画成图片，不能退化成占位符 */
  const packImages = usePackImageMap();

  /*
   * 沙声（VISION §5.1 P0：声音是触觉缺失的主要补偿）。
   *
   * 用 ref 持有控制器：声音是副作用，不该触发重渲染。
   * 开关变化时重建，`dispose()` 关掉旧 context —— 否则切来切去
   * 会攒下一堆音频线程。
   */
  const soundRef = useRef<SandSound>(SILENT_SAND_SOUND);
  useEffect(() => {
    const created = createSandSound(prefs?.soundEnabled ?? true);
    soundRef.current = created;
    return () => {
      created.dispose();
      soundRef.current = SILENT_SAND_SOUND;
    };
  }, [prefs?.soundEnabled]);

  /* ------------------------------ 本地 UI 状态 ------------------------------ */

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<RendererKind>(prefs?.renderer ?? 'iso2d');

  /*
   * 切换渲染器时**写回偏好**。
   *
   * 之前 `onRendererChange={setRenderer}` 直接给 useState 的 setter，
   * 只改本地 state —— 而 `Preferences.renderer` 的注释写着「默认渲染器」，
   * 用户切到 DOM 2D（低端机/无障碍场景）后一刷新就弹回 2.5D。
   * 幽灵字段检测器把「renderer 无人写入」报了出来，就是这里。
   *
   * 本地 state 仍然保留：切换要立即生效（不等偏好订阅回流），
   * 偏好则负责跨会话记住。
   */
  const handleRendererChange = useCallback((next: RendererKind) => {
    setRenderer(next);
    setPreferences({ renderer: next });
  }, []);
  /** 专注模式：只留沙盘（不属于持久化偏好） */
  const [focusMode, setFocusMode] = useState(false);
  const [tool, setTool] = useState<SurfaceTool | null>(null);
  const [radius, setRadius] = useState(0.12);
  const [strength, setStrength] = useState(0.6);
  const [promptSeed, setPromptSeed] = useState(() => new Date().getDate());
  const [sandboxAffects, setSandboxAffects] = useState<string[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const restoredRef = useRef(false);

  const items = api.state.items;
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  /* --------------------------- 从 URL 续接会话 ---------------------------- */

  useEffect(() => {
    if (restoredRef.current) return;
    const resume = parseResumeParams(searchParams);
    if (!resume) {
      restoredRef.current = true;
      return;
    }
    const source = getSession(resume.from);
    restoredRef.current = true;
    if (!source) {
      show('没有找到这次会话，已为你新建一个空白沙盘。', 'warn');
      setSearchParams({}, { replace: true });
      return;
    }
    const total = source.events?.length ?? 0;
    const cursor = resume.cursor === null ? total : clamp(resume.cursor, 0, total);
    // 用纯函数重放算出「第 cursor 步」的摆件与沙面，保证复制出来的会话自洽
    const replayed = replay(source.events ?? [], cursor);
    const forked = forkSessionAt(source, cursor, {
      newId: createId('sandbox'),
      now: new Date().toISOString(),
      replayItems: replayed.items,
      sceneId: replayed.sceneId,
      surface: replayed.surface,
    });
    api.loadSession(forked);
    show(`已从第 ${cursor} 步接着摆，原会话没有被改动。`, 'success');
    setSearchParams({}, { replace: true });
    // api 的方法引用稳定，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, show]);

  /* ------------------------------ 键盘快捷键 ------------------------------ */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 输入框里不拦截
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'Escape') {
        if (focusMode) {
          setFocusMode(false);
          event.preventDefault();
        } else if (selectedId) {
          setSelectedId(null);
          event.preventDefault();
        }
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!api.locked) setSaveOpen(true);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId && !api.locked) {
          event.preventDefault();
          api.removeItem(selectedId);
          setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, selectedId, focusMode]);

  /* -------------------------------- 操作 --------------------------------- */

  const handleAddSymbol = useCallback(
    (symbolId: string) => {
      if (api.locked) {
        show(t('sandbox.lockedHint'), 'warn');
        return;
      }
      const id = api.addItem(symbolId);
      if (id) {
        setSelectedId(id);
        // 落沙声：用 symbolId 的哈希做种子，同一个沙具每次声音一致
        let seed = 0;
        for (let i = 0; i < symbolId.length; i += 1) seed = (seed * 31 + symbolId.charCodeAt(i)) >>> 0;
        soundRef.current.drop(seed || 1);
      }
    },
    [api, show, t],
  );

  /**
   * 沙声开关。
   *
   * 写进偏好，`usePreferences` 会触发上面那个 effect 重建控制器 ——
   * 关闭时 `createSandSound(false)` 返回 SILENT，且**不会建 AudioContext**。
   */
  const handleSoundEnabledChange = useCallback((enabled: boolean) => {
    setPreferences({ soundEnabled: enabled });
  }, []);

  /*
   * 两个无障碍开关的写入入口。
   *
   * 这两个字段此前是「只读不写」的幽灵：`App.tsx` 会读 `reducedMotion`
   * 去写 `html[data-reduced-motion]`，`dom2d`/`iso2d` 会读 `outlineMode`
   * 去画轮廓，呼吸练习也会读 `reducedMotion` —— 全都实现了，
   * 但**没有任何 UI 能写入它们**，所以用户永远打不开。
   * 幽灵字段检测器（`scripts/audit/ghost-fields.mjs`）抓的就是这种。
   */
  const handleReducedMotionChange = useCallback((enabled: boolean) => {
    setPreferences({ reducedMotion: enabled });
  }, []);

  const handleOutlineModeChange = useCallback((enabled: boolean) => {
    setPreferences({ outlineMode: enabled });
  }, []);

  /**
   * 年龄门（CONTRACT §7.7）。
   *
   * 「未通过」要能区分出**三种**状态，不能只用一个 boolean 搪塞：
   * - 从没选过（`undefined`）→ 显示提示，两个按钮都要有；
   * - 选了「已满 18」→ 不再显示；
   * - 选了「未满 18，会和监护人一起用」→ **也不该再显示**。
   *
   * 最后一档容易写错：很多人会实现成「只有成年人才能关闭提示」，
   * 那等于未成年人在页面上永远顶着一块提示牌，而他并没有做错任何事。
   * 未成年人选了「会和监护人一起用」就是一种有效确认。
   *
   * 这个选择只写 localStorage，不上传（红线 §5.6 / CONTRACT §5.4）。
   */
  const [ageGateAnswered, setAgeGateAnswered] = useState(false);
  const showAgeGate = prefs?.acknowledgedAge === undefined || prefs.acknowledgedAge === false
    ? !ageGateAnswered
    : false;

  const handleAgeGateConfirm = useCallback((isAdult: boolean) => {
    setPreferences({ acknowledgedAge: true });
    setAgeGateAnswered(true);
    if (!isAdult) {
      // 未成年人不是「降级使用」，只是把监护人知情这件事说清楚
      show(t('sandbox.ageGate.minorHint'), 'info');
    }
  }, [show, t]);

  const handleItemDrag = useCallback(
    (id: string, x: number, y: number) => {
      api.moveItem(id, clamp(x, 0, 1), clamp(y, 0, 1));
    },
    [api],
  );

  const handleSurfaceStroke = useCallback(
    (strokeTool: SurfaceTool, points: Array<{ x: number; y: number }>) => {
      if (api.locked) return;
      api.strokeSurface(strokeTool, points, radius, strength);
      // 推沙声：力度与半径归一化成 0~1 的强度
      const intensity = Math.min(1, (radius / 10) * 0.6 + (strength / 10) * 0.4);
      soundRef.current.stroke(intensity, points.length);
    },
    [api, radius, strength],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const base = api.toSession();
      // 缩略图在这里生成：档案页与记录单的「导出图片」都依赖它。
      // 用数据重画而不是截 canvas，是为了让三种渲染器（doms/iso/three）结果一致。
      const thumbnail = renderThumbnail(base) ?? base.thumbnail;
      const session = api.toSession(thumbnail ? { thumbnail } : undefined);
      const ok = await saveSession({
        ...session,
        meta: { ...session.meta, sandboxAffects },
      });
      if (!ok) {
        show('保存失败：浏览器存储空间可能已满。可以先导出再清理。', 'warn');
        return;
      }
      setSaveOpen(false);
      show('沙盘已保存在这台设备上。', 'success');
    } catch {
      show('保存失败：浏览器存储空间可能已满。可以先导出再清理。', 'warn');
    } finally {
      setSaving(false);
    }
  }, [api, sandboxAffects, show]);

  const handleLock = useCallback(() => {
    api.lock();
    setLockOpen(false);
    setSelectedId(null);
    show('已封盘。这个沙盘不会再被改动了。', 'success');
  }, [api, show]);

  const handleNew = useCallback(() => {
    if (api.dirty && !window.confirm(t('sandbox.confirmDiscard'))) return;
    api.reset();
    setSelectedId(null);
    setSandboxAffects([]);
    show('已新建一个空白沙盘。', 'success');
  }, [api, show, t]);

  const handleSceneChange = useCallback(
    (sceneId: string) => {
      api.setScene(sceneId);
    },
    [api],
  );

  const handleItemChange = useCallback(
    (patch: Partial<SandboxItem>) => {
      if (!selectedId) return;
      if (patch.scale !== undefined) api.scaleItem(selectedId, patch.scale);
      if (patch.rotation !== undefined) api.rotateItem(selectedId, patch.rotation);
      if (patch.burial !== undefined) api.setItemBurial(selectedId, patch.burial);
      if (patch.note !== undefined) api.setItemNote(selectedId, patch.note);
      if (patch.affectLabels !== undefined) api.setItemAffect(selectedId, patch.affectLabels);
    },
    [api, selectedId],
  );

  const bringToFront = useCallback(() => {
    if (!selectedId) return;
    const maxZ = items.reduce((max, item) => Math.max(max, item.z), 0);
    api.setItemLayer(selectedId, maxZ + 1);
  }, [api, items, selectedId]);

  const sendToBack = useCallback(() => {
    if (!selectedId) return;
    const minZ = items.reduce((min, item) => Math.min(min, item.z), Infinity);
    api.setItemLayer(selectedId, Math.max(1, minZ - 1));
  }, [api, items, selectedId]);

  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    // 复制 = 用同 symbolId 在原位置偏移处新增
    const id = api.addItem(selected.symbolId, {
      x: clamp(selected.x + 0.06, 0.05, 0.95),
      y: clamp(selected.y + 0.06, 0.05, 0.95),
    });
    if (id) {
      api.scaleItem(id, selected.scale);
      api.rotateItem(id, selected.rotation);
      setSelectedId(id);
    }
  }, [api, selected]);

  /* -------------------------------- 渲染 --------------------------------- */

  return (
    <div className={`wb${focusMode ? ' wb--focus' : ''}`}>
      {/*
        年龄门（CONTRACT §7.7）。放在顶栏**之后**、舞台**之前**：
        顶栏是可以用的（换场景、看历史都不构成风险），
        但提示必须出现在真正开始摆之前。
        `role="region"` + `aria-labelledby` 让读屏用户能整块跳过，
        而不是被三行说明卡住。
      */}
      {showAgeGate ? (
        <div className="wb-agegate" role="region" aria-labelledby="agegate-title" data-testid="sandbox-age-gate">
          <div className="wb-agegate__inner">
            <h2 className="wb-agegate__title" id="agegate-title">
              {t('sandbox.ageGate.title')}
            </h2>
            <p className="wb-agegate__body">{t('sandbox.ageGate.body')}</p>
            <div className="wb-agegate__actions">
              <Button size="sm" variant="primary" onClick={() => handleAgeGateConfirm(true)} data-testid="agegate-adult">
                {t('sandbox.ageGate.adult')}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => handleAgeGateConfirm(false)} data-testid="agegate-minor">
                {t('sandbox.ageGate.minor')}
              </Button>
            </div>
            <p className="wb-agegate__hint">{t('sandbox.ageGate.hint')}</p>
          </div>
        </div>
      ) : null}
      <Toolbar
        title={api.title}
        onTitleChange={api.setTitle}
        mode={api.mode}
        onModeChange={api.setMode}
        sceneId={api.state.sceneId}
        onSceneChange={handleSceneChange}
        renderer={renderer}
        onRendererChange={handleRendererChange}
        dirty={api.dirty}
        locked={api.locked}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onUndo={api.undo}
        onRedo={api.redo}
        onSave={() => setSaveOpen(true)}
        onLock={() => setLockOpen(true)}
        onNew={handleNew}
        sessionCount={sessions.length}
        soundEnabled={prefs?.soundEnabled ?? true}
        onSoundEnabledChange={handleSoundEnabledChange}
        reducedMotion={prefs?.reducedMotion ?? false}
        onReducedMotionChange={handleReducedMotionChange}
        outlineMode={prefs?.outlineMode ?? false}
        onOutlineModeChange={handleOutlineModeChange}
      />

      {/*
        专注模式入口。
        放在顶部栏**下方**、主内容上方，让它始终在视口内可见：
        - 平常态：右对齐的一行，点它进入专注模式；
        - 专注态：`--floating` 改成 `position: fixed` 钉在右下角，
          因为此时下面整块 `.wb-main` 都不渲染了，没有流式位置可占。
        曾经的坑：把它放在页面最末尾，结果 y=1100 落在视口外，
        用户进了专注模式就**找不到出口**（只能猜 Esc）。出口不能藏。
      */}
      <SilenceToggle
        silent={focusMode}
        onSilentChange={setFocusMode}
        disabled={api.locked}
        className={focusMode ? 'wb-silence wb-silence--floating' : 'wb-silence'}
      />

      <main className="wb-main">
        {/* 左栏：沙具库 —— symbol-dev 的 SymbolTray 通过稳定 props 接入 */}
        <div className="wb-col wb-col--lib">
          <Card className="wb-card">
            <div className="wb-card__head">
              <strong>{t('sandbox.library')}</strong>
              <span className="small muted" data-testid="sandbox-item-count">{items.length} 件在场</span>
            </div>
            <SymbolTray
              onPick={handleAddSymbol}
              value={selectedId}
              disabled={api.locked}
            />
          </Card>

          <PromptCard seed={promptSeed} onRefresh={() => setPromptSeed((n) => n + 1)} />
        </div>

        {/* 舞台 */}
        <div className="wb-col wb-col--stage">
          <div className="wb-stage" data-testid="sandbox-stage">
            <div className="wb-stage__badge">
              <span>{t(`sandbox.scene.${api.state.sceneId}` as const) ?? api.state.sceneId}</span>
              <span aria-hidden="true">·</span>
              <span>{api.locked ? t('sandbox.locked') : t(`sandbox.phase.${api.state.phase}` as const)}</span>
            </div>

            <SandRendererSwitch
              renderer={renderer}
              items={items}
              sceneId={api.state.sceneId}
              selectedId={selectedId}
              surface={api.surface}
              readOnly={api.locked}
              imageMap={packImages}
              reducedMotion={prefs?.reducedMotion ?? false}
              outlineMode={prefs?.outlineMode ?? false}
              brush={
                tool && !api.locked
                  ? { x: 0.5, y: 0.5, radius, tool, active: false }
                  : null
              }
              onSelect={setSelectedId}
              onItemDrag={handleItemDrag}
              /*
               * ⚠️ 必须把 `to` 传进去。原来这里写成
               *   `onItemCommit={(id) => { ... commitMove(id, {x:item.x,y:item.y}, {x:item.x,y:item.y}) }}`
               * 即只用 `id`，from/to 都取**当前坐标** —— 于是「移动」被提交成
               * 一次原地不动的事件。拖动还能靠 `onItemDrag` 实时改坐标掩盖住，
               * 但**键盘方向键微调完全没有中间态**，它唯一的落点就是这里：
               * 按方向键 → 坐标算好了 → 提交成原地 → 位置不变。
               *
               * 结果是 dom2d 里那段 `handleKeyDown`（方向键 0.02 / Shift 0.1）
               * 从来没真正生效过，而它是键盘用户调整摆件位置的**唯一**途径。
               * 这个 bug 是 E2E 键盘全流程抓出来的：断言「方向键后 style.left 变了」
               * 连续两次读到同一个 45%。
               */
              onItemCommit={(id, from, to) => {
                api.commitMove(id, from, to);
              }}
              onItemActivate={(item) => setSelectedId(item.id)}
              onSurfaceStroke={handleSurfaceStroke}
              onCanvasClick={() => setSelectedId(null)}
            />

            {items.length === 0 && !api.locked ? (
              <div className="wb-stage__empty">
                <span className="wb-stage__empty-glyph" aria-hidden="true">
                  ⛱
                </span>
                <p className="small">{t('sandbox.emptyTray')}</p>
              </div>
            ) : null}

            {/*
              沙面工具条：使用 `src/sandbox/surface/SurfaceToolbar` 组件。
              早期这里是一段内联的 `.wb-surfacebar`，功能等价但：
                - 触摸目标只有 31.5px，不满足 CONTRACT §7 的 44px；
                - 半径/力度滑块被拆到页面下方另一个 `.wb-brushbar`，操作要来回看；
                - 重铺整盘沙用的是 `window.confirm`，与站点其他确认框风格不一致。

              专注态用组件的 `silent` 属性（整条返回 null），而不是在外面写
              `!focusMode ? ... : null`：组件内部会把「正在等二次确认重铺」的状态
              一起清掉，避免退出专注后看到一个悬了很久的确认按钮。
            */}
            {!api.locked ? (
              <SurfaceToolbar
                tool={tool}
                /*
                 * 选沙面工具时顺手取消摆件选中。
                 *
                 * 这两个是**互斥的操作模式**：手里拿着铲子在沙上画，
                 * 就不该同时开着「这块石头的大小/角度/埋深」面板 ——
                 * 面板会盖住工具条右侧的滑块，而屏幕小的时候几乎必盖。
                 *
                 * 纯 CSS 提 z-index 能解决遮挡，但解决不了「同时在做两件事」的
                 * 交互混乱：用户会不知道下一笔是画沙还是拖摆件。
                 * 所以模式切换时主动收敛状态。
                 */
                onToolChange={(next) => {
                  setTool(next);
                  if (next) setSelectedId(null);
                }}
                radius={radius}
                onRadiusChange={setRadius}
                strength={strength}
                onStrengthChange={setStrength}
                onReset={api.resetSurface}
                silent={focusMode}
                testIdPrefix="sandbox-tool"
                testId="sandbox-toolbar"
              />
            ) : null}

            {/* 检查器 */}
            {selected && !focusMode ? (
              <Inspector
                item={selected}
                readOnly={api.locked}
                onChange={handleItemChange}
                onRemove={() => {
                  api.removeItem(selected.id);
                  setSelectedId(null);
                }}
                onDuplicate={duplicateSelected}
                onBringFront={bringToFront}
                onSendBack={sendToBack}
                onDone={() => setSelectedId(null)}
              />
            ) : null}
          </div>

          {/*
            笔刷参数已并入 `SurfaceToolbar`（半径 + 力度两个滑杆就在工具条里），
            这里只保留那句操作提示。滑块移进工具条的原因：原来滑块在托盘下方、
            工具条在托盘上方，用户选完笔刷要往下看才能调大小，来回跳。
          */}
          {tool && !api.locked && !focusMode ? (
            <p className="small muted wb-brushbar__hint">{t('sandbox.surfaceHint')}</p>
          ) : null}
        </div>

        {/* 右栏 */}
        {!focusMode ? (
          <div className="wb-col wb-col--side">
            <Card className="wb-card">
              <div className="wb-card__head">
                <strong>这个沙盘让你想到什么</strong>
              </div>
              <p className="small muted">可以只选词，不写句子。</p>
              <SandboxAffect labels={sandboxAffects} onChange={setSandboxAffects} />
            </Card>

            {saveOpen ? (
              <SavePanel
                reflection={api.reflection}
                onReflectionChange={api.setReflection}
                onSave={handleSave}
                onCancel={() => setSaveOpen(false)}
                saving={saving}
              />
            ) : (
              <Card className="wb-card">
                <div className="wb-card__head">
                  <strong>{t('sandbox.reflectionLabel')}</strong>
                </div>
                {/* 用 label 包裹而不是同级 <strong>：否则读屏读出来是「编辑框，空白」 */}
                <label className="field">
                  <span className="sr-only">{t('sandbox.reflectionLabel')}</span>
                  <textarea
                    className="textarea"
                    rows={3}
                    maxLength={400}
                    value={api.reflection}
                    placeholder={t('sandbox.reflectionPlaceholder')}
                    onChange={(event) => api.setReflection(event.target.value)}
                  />
                </label>
              </Card>
            )}

            <Card className="wb-card">
              <div className="wb-card__head">
                <strong>过程与记录</strong>
              </div>
              <p className="small muted">
                当前已记录 {api.events.length} 次操作。
                {api.lastAction ? ` 最近一次：${api.lastAction}。` : ''}
              </p>
              <div className="btn-group mt-2" style={{ flexWrap: 'wrap' }}>
                <Link className="btn btn--ghost btn--sm" to="/records">
                  我的记录
                </Link>
                <Link className="btn btn--quiet btn--sm" to="/sandbox/compare">
                  对比两次
                </Link>
                <Link className="btn btn--quiet btn--sm" to="/sandbox/clients">
                  本地档案
                </Link>
              </div>
            </Card>

            <Notice tone="plain">
              <p className="small">{t('sandbox.ethics')}</p>
              <p className="small mt-1">{t('sandbox.localOnly')}</p>
            </Notice>
          </div>
        ) : null}
      </main>

      {/* 专注模式提示（入口在页面顶部，见上方 `<SilenceToggle>`） */}
      {focusMode ? (
        <p className="wb-focushint" role="status">
          专注模式 · 按 Esc 退出
        </p>
      ) : null}

      <span hidden data-testid="sandbox-dirty">{api.dirty ? "1" : "0"}</span>
      <span hidden data-testid="sandbox-event-count">{api.events.length}</span>

      <LockDialog
        open={lockOpen}
        itemCount={items.length}
        onConfirm={handleLock}
        onCancel={() => setLockOpen(false)}
      />

      {/* 读屏播报 */}
      <p className="sr-only" aria-live="polite">
        {api.lastAction ? `最近一次操作：${api.lastAction}` : ''}
      </p>

      {selected ? (
        <p className="sr-only">
          已选中 {symbolLabel(selected.symbolId)}。
        </p>
      ) : null}
    </div>
  );
}

