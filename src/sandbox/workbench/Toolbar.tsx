import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/Primitives';
import { SCENES } from '@/sandbox/scenes';
import { RENDERERS } from '@/sandbox/render/types';
import type { RendererKind, SessionMode } from '@/lib/types';
import { useI18n } from '@/i18n';

/**
 * 工作台顶栏：模式 / 场景 / 渲染器 / 历史 / 保存。
 *
 * 交互设计取舍：
 * - 模式切换放在最左（会话前 3 秒最重要的问题：「我自己玩，还是咨询里用」）；
 * - 场景与渲染器是「视图」而不是「内容」，因此不用事件流记录（换渲染器不该出现在回放里）；
 * - 撤销/重做用图标 + tooltip，且实时反映可用状态。
 */

export interface ToolbarProps {
  title: string;
  onTitleChange: (title: string) => void;
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  sceneId: string;
  onSceneChange: (sceneId: string) => void;
  renderer: RendererKind;
  onRendererChange: (renderer: RendererKind) => void;
  dirty: boolean;
  locked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onLock: () => void;
  onNew: () => void;
  sessionCount: number;
  /** 沙声开关（VISION §5.1 P0，`Preferences.soundEnabled`） */
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  /** 减少动效（无障碍）。字段早就存在，此前无写入入口 */
  reducedMotion: boolean;
  onReducedMotionChange: (enabled: boolean) => void;
  /** 轮廓模式（色盲/对比度辅助）。同上 */
  outlineMode: boolean;
  onOutlineModeChange: (enabled: boolean) => void;
}

export function Toolbar({
  title,
  onTitleChange,
  mode,
  onModeChange,
  sceneId,
  onSceneChange,
  renderer,
  onRendererChange,
  dirty,
  locked,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onLock,
  onNew,
  sessionCount,
  soundEnabled,
  onSoundEnabledChange,
  reducedMotion,
  onReducedMotionChange,
  outlineMode,
  onOutlineModeChange,
}: ToolbarProps) {
  const { t } = useI18n();

  return (
    <header className="wb-bar">
      {/*
        沙盘页此前**没有任何 h1** —— a11y 审计报「页面没有任何 h1，语义结构缺失」。
        但这里确实不该有一个可见的大标题：工作台是应用型界面，
        顶栏那个 `<input>` 是用户可以改名的沙盘名称，做成 h1 会
        让读屏在每次改名时重播整页标题。
        折中：加一个视觉隐藏的 h1，只给读屏用户提供页面身份。
      */}
      <h1 className="sr-only">{title.trim() || t('sandbox.newSession')}</h1>
      <div className="wb-bar__left">
        <input
          className="wb-title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t('sandbox.titlePlaceholder')}
          aria-label="沙盘名称"
          maxLength={40}
        />
        <span className={`wb-dirty${dirty ? ' wb-dirty--on' : ''}`} aria-live="polite">
          {dirty ? t('sandbox.unsaved') : t('sandbox.saved')}
        </span>
      </div>

      <div className="wb-bar__center">
        <div className="wb-seg" role="group" aria-label="模式">
          <button
            type="button"
            className={`wb-seg__btn${mode === 'self' ? ' is-active' : ''}`}
            onClick={() => onModeChange('self')}
            aria-pressed={mode === 'self'}
            title={t('sandbox.mode.selfHint')}
          >
            {t('sandbox.mode.self')}
          </button>
          <button
            type="button"
            className={`wb-seg__btn${mode === 'counselor' ? ' is-active' : ''}`}
            onClick={() => onModeChange('counselor')}
            aria-pressed={mode === 'counselor'}
            title={t('sandbox.mode.counselorHint')}
          >
            {t('sandbox.mode.counselor')}
          </button>
        </div>
      </div>

      <div className="wb-bar__right">
        <label className="wb-select" title={t('sandbox.scene')}>
          <span className="sr-only">{t('sandbox.scene')}</span>
          <select
            className="select wb-select__input"
            value={sceneId}
            onChange={(event) => onSceneChange(event.target.value)}
          >
            {SCENES.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.label}
              </option>
            ))}
          </select>
        </label>

        <label className="wb-select" title={t('settings.renderer')}>
          <span className="sr-only">{t('settings.renderer')}</span>
          <select
            className="select wb-select__input"
            data-testid="sandbox-renderer-select"
            value={renderer}
            onChange={(event) => onRendererChange(event.target.value as RendererKind)}
          >
            {RENDERERS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t(entry.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <div className="wb-iconbtn-group">
          {/*
            沙声开关（VISION §5.1 P0）。
            为什么放在这里而不是"设置页"：本项目没有设置页，
            而声音是「一边摆一边听」的即时偏好，放在工作台上就近可及。
            `aria-pressed` 而不是把状态写在 label 里 —— 读屏要能听出当前开关态。
          */}
          <button
            type="button"
            className="wb-iconbtn"
            data-testid="sandbox-sound-toggle"
            aria-pressed={soundEnabled}
            aria-label={t('settings.sound')}
            title={`${t('settings.sound')}：${soundEnabled ? '开' : '关'}`}
            onClick={() => onSoundEnabledChange(!soundEnabled)}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          {/*
            无障碍开关：减少动效 + 轮廓模式。
            这两个字段此前是「只读不写」的幽灵 —— 渲染器、CSS、呼吸练习
            全都实现了对应行为，但**没有任何写入入口**，用户永远打不开。
            放在同一个按钮组里，因为它们是同类的「显示辅助」。
          */}
          <button
            type="button"
            className="wb-iconbtn"
            data-testid="sandbox-reduced-motion-toggle"
            aria-pressed={reducedMotion}
            aria-label={t('settings.reducedMotion')}
            title={`${t('settings.reducedMotion')}：${reducedMotion ? '开' : '关'}`}
            onClick={() => onReducedMotionChange(!reducedMotion)}
          >
            {reducedMotion ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            className="wb-iconbtn"
            data-testid="sandbox-outline-toggle"
            aria-pressed={outlineMode}
            aria-label={t('settings.outline')}
            title={`${t('settings.outline')}：${outlineMode ? '开' : '关'}`}
            onClick={() => onOutlineModeChange(!outlineMode)}
          >
            ◫
          </button>
          <button
            type="button"
            className="wb-iconbtn" data-testid="sandbox-undo"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label={t('common.undo')}
            title={`${t('common.undo')} (Ctrl+Z)`}
          >
            ↶
          </button>
          <button
            type="button"
            className="wb-iconbtn" data-testid="sandbox-redo"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label={t('common.redo')}
            title={`${t('common.redo')} (Ctrl+Shift+Z)`}
          >
            ↷
          </button>
        </div>

        <div className="wb-actions">
          <Button size="sm" variant="quiet" onClick={onNew}>
            {t('sandbox.newSession')}
          </Button>
          {locked ? (
            <Tag tone="clay">{t('sandbox.locked')}</Tag>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onLock} data-testid="sandbox-lock">
                {t('sandbox.lock')}
              </Button>
              <Button size="sm" onClick={onSave} data-testid="sandbox-save">
                {t('sandbox.save')}
              </Button>
            </>
          )}
          {sessionCount > 0 ? (
            <span className="small muted wb-count">已存 {sessionCount}</span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
