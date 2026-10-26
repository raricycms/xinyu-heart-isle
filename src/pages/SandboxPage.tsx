import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Empty, Notice, Tag } from '@/components/ui/Primitives';
import { sandboxStore, STORAGE_KEYS, useCollection } from '@/lib/storage';
import { createId } from '@/lib/id';
import { formatDateTime, nowISO } from '@/lib/date';
import { useToast } from '@/lib/toast';
import { clamp, cx } from '@/lib/utils';
import type { SandboxItem, SandboxSnapshot, SceneId } from '@/lib/types';
import { SCENES } from '@/sandbox/scenes';
import {
  SYMBOLS,
  categoryLabels,
  getSymbolById,
  pickPrompts,
  symbolGlyph,
  symbolLabel,
  symbolsByCategory,
} from '@/sandbox/symbols';
import { SandboxCanvas } from '@/sandbox/SandboxCanvas';
import '@/styles/sandbox.css';

const MAX_Z = 999;

/** 拖拽之外的工具栏操作：新增、缩放、旋转、层级 */
export default function SandboxPage() {
  const snapshots = useCollection<SandboxSnapshot>(STORAGE_KEYS.sandbox);
  const { show } = useToast();

  const [items, setItems] = useState<SandboxItem[]>([]);
  const [sceneId, setSceneId] = useState<SceneId>('beach');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('nature');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [reflection, setReflection] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [promptSeed] = useState(() => new Date().getDate());

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const prompts = useMemo(() => pickPrompts(promptSeed, 3), [promptSeed]);

  const addSymbol = useCallback(
    (symbolId: string) => {
      const symbol = getSymbolById(symbolId);
      if (!symbol) return;
      // 稍微错开落点，避免连续添加时完全重叠
      const nudge = (items.length % 5) * 0.05 - 0.1;
      const next: SandboxItem = {
        id: createId('item'),
        symbolId,
        x: clamp(0.5 + nudge, 0.1, 0.9),
        y: clamp(0.55 + nudge * 0.6, 0.1, 0.9),
        scale: 1,
        rotation: 0,
        z: items.length + 1,
      };
      setItems((prev) => [...prev, next]);
      setSelectedId(next.id);
    },
    [items.length],
  );

  const updateSelected = useCallback(
    (patch: Partial<SandboxItem>) => {
      if (!selectedId) return;
      setItems((prev) =>
        prev.map((item) => (item.id === selectedId ? { ...item, ...patch } : item)),
      );
    },
    [selectedId],
  );

  const bringToFront = useCallback(() => {
    if (!selectedId) return;
    const maxZ = items.reduce((max, item) => Math.max(max, item.z), 0);
    updateSelected({ z: Math.min(maxZ + 1, MAX_Z) });
  }, [items, selectedId, updateSelected]);

  const sendToBack = useCallback(() => {
    if (!selectedId) return;
    const minZ = items.reduce((min, item) => Math.min(min, item.z), Infinity);
    updateSelected({ z: Math.max(minZ - 1, 1) });
  }, [items, selectedId, updateSelected]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setItems((prev) => prev.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  const duplicateSelected = useCallback(() => {
    if (!selected) return;
    const copy: SandboxItem = {
      ...selected,
      id: createId('item'),
      x: clamp(selected.x + 0.05, 0.05, 0.95),
      y: clamp(selected.y + 0.05, 0.05, 0.95),
      z: items.reduce((max, item) => Math.max(max, item.z), 0) + 1,
    };
    setItems((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  }, [items, selected]);

  const resetCanvas = useCallback(() => {
    if (items.length > 0) {
      const ok = window.confirm('新建会清空当前画布上还没保存的摆放，确定吗？');
      if (!ok) return;
    }
    setItems([]);
    setSelectedId(null);
    setReflection('');
    setTitle('');
  }, [items.length]);

  const openSave = useCallback(() => {
    if (items.length === 0) {
      show('先放几个象征物再保存吧。', 'warn');
      return;
    }
    setTitle((prev) => prev || `我的沙盘 ${new Date().getMonth() + 1}/${new Date().getDate()}`);
    setSaveOpen(true);
  }, [items.length, show]);

  const confirmSave = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed) {
      show('给它起个名字吧，之后会更好找。', 'warn');
      return;
    }
    sandboxStore.add({
      id: createId('sandbox'),
      at: nowISO(),
      title: trimmed,
      items: items.map((item) => ({ ...item })),
      sceneId,
      reflection: reflection.trim() || undefined,
      prompts,
    });
    setSaveOpen(false);
    show('沙盘已保存。', 'success');
  }, [items, prompts, reflection, sceneId, show, title]);

  const loadSnapshot = useCallback((snapshot: SandboxSnapshot) => {
    setItems(snapshot.items.map((item) => ({ ...item })));
    setSceneId((snapshot.sceneId as SceneId) ?? 'beach');
    setReflection(snapshot.reflection ?? '');
    setTitle(snapshot.title);
    setSelectedId(null);
    setLibraryOpen(false);
    show(`已打开「${snapshot.title}」。`, 'success');
  }, [show]);

  const removeSnapshot = useCallback(
    (id: string) => {
      const ok = window.confirm('删除这个沙盘快照？删除后无法恢复。');
      if (!ok) return;
      sandboxStore.remove(id);
      show('已删除该快照。');
    },
    [show],
  );

  const editNoteTarget = items.find((item) => item.id === editingId) ?? null;

  return (
    <div className="page page--wide">
      <PageHeader
        eyebrow="Cyber Sand Tray"
        title="赛博沙盘"
        subtitle="把说不清的东西摆出来。不用会画画，也不用解释得通——先摆，意义可以之后再说。"
        action={
          <div className="btn-group">
            <Button variant="ghost" size="sm" onClick={() => setLibraryOpen((v) => !v)}>
              {libraryOpen ? '收起快照' : `快照${snapshots.length > 0 ? `（${snapshots.length}）` : ''}`}
            </Button>
            <Button variant="ghost" size="sm" onClick={resetCanvas}>
              新建
            </Button>
            <Button size="sm" onClick={openSave}>
              保存沙盘
            </Button>
          </div>
        }
      />

      <Notice tone="teal" icon="◍">
        沙盘没有"正确的摆法"。系统不会分析你的作品，也不会给出解释——它只是帮你把内在的画面放到外面，
        让你能看见它。
      </Notice>

      <div className="sandbox-layout mt-4">
        {/* ------------------------------- 素材面板 ------------------------------- */}
        <aside className="sandbox-panel" aria-label="象征物素材库">
          <div className="sandbox-panel__tabs" role="tablist" aria-label="象征物分类">
            {symbolsByCategory().map((group) => (
              <button
                key={group.category}
                type="button"
                role="tab"
                aria-selected={activeCategory === group.category}
                className={cx('sandbox-panel__tab', activeCategory === group.category && 'is-active')}
                onClick={() => setActiveCategory(group.category)}
              >
                {group.label}
              </button>
            ))}
          </div>

          <div className="sandbox-panel__grid">
            {symbolsByCategory()
              .find((group) => group.category === activeCategory)
              ?.items.map((symbol) => (
                <button
                  key={symbol.id}
                  type="button"
                  className="sandbox-symbol"
                  onClick={() => addSymbol(symbol.id)}
                  title={`添加「${symbol.label}」`}
                >
                  <span className="sandbox-symbol__glyph" aria-hidden>
                    {symbol.glyph}
                  </span>
                  <span className="sandbox-symbol__label">{symbol.label}</span>
                </button>
              ))}
          </div>

          <p className="sandbox-panel__count small muted">
            共 {SYMBOLS.length} 个象征物 · {Object.keys(categoryLabels).length} 类
          </p>
        </aside>

        {/* -------------------------------- 画布 -------------------------------- */}
        <section className="sandbox-stage" aria-label="沙盘画布区">
          <div className="sandbox-toolbar">
            <div className="sandbox-toolbar__scenes" role="group" aria-label="场景主题">
              {SCENES.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  className={cx('sandbox-scene-btn', sceneId === scene.id && 'is-active')}
                  onClick={() => setSceneId(scene.id)}
                  title={`切换到「${scene.label}」`}
                >
                  <span className="sandbox-scene-btn__dot" style={{ background: scene.background }} aria-hidden />
                  {scene.label}
                </button>
              ))}
            </div>
            <span className="small muted mono">{items.length} 个摆件</span>
          </div>

          <SandboxCanvas
            items={items}
            sceneId={sceneId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChangeItems={setItems}
            onEditNote={(item) => {
              setSelectedId(item.id);
              setEditingId(item.id);
            }}
          />

          {/* 选中项控制条 */}
          {selected ? (
            <div className="sandbox-inspector" aria-label="摆件调整">
              <span className="sandbox-inspector__name">
                <span aria-hidden>{symbolGlyph(selected.symbolId)}</span>
                {symbolLabel(selected.symbolId)}
              </span>
              <label className="sandbox-inspector__field">
                <span>大小</span>
                <input
                  type="range"
                  className="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={selected.scale}
                  onChange={(e) => updateSelected({ scale: Number(e.target.value) })}
                />
              </label>
              <label className="sandbox-inspector__field">
                <span>角度</span>
                <input
                  type="range"
                  className="range"
                  min={-180}
                  max={180}
                  step={5}
                  value={selected.rotation}
                  onChange={(e) => updateSelected({ rotation: Number(e.target.value) })}
                />
              </label>
              <div className="btn-group">
                <Button variant="quiet" size="sm" onClick={sendToBack} title="放到最底层">
                  下移层
                </Button>
                <Button variant="quiet" size="sm" onClick={bringToFront} title="放到最上层">
                  上移层
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setEditingId(selected.id)}>
                  写注释
                </Button>
                <Button variant="quiet" size="sm" onClick={duplicateSelected}>
                  复制
                </Button>
                <Button variant="danger" size="sm" onClick={deleteSelected}>
                  删除
                </Button>
              </div>
            </div>
          ) : (
            <p className="sandbox-tip small muted">
              点选一个摆件可以调整大小与角度；双击摆件可以写一句注释。
              也可以用方向键微调、Delete 删除。
            </p>
          )}
        </section>

        {/* ------------------------------ 右侧栏 ------------------------------ */}
        <aside className="sandbox-side">
          <Card padSm>
            <SectionHead title="自我探索提示" desc="不急着回答，看看哪句让你停了一下。" />
            <ul className="sandbox-prompts">
              {prompts.map((prompt) => (
                <li key={prompt} className="sandbox-prompts__item">
                  {prompt}
                </li>
              ))}
            </ul>
          </Card>

          <Card padSm>
            <SectionHead title="这次想记下什么" desc="可留空。" />
            <label className="sr-only" htmlFor="sandbox-reflection">
              自我解读
            </label>
            <textarea
              id="sandbox-reflection"
              className="textarea"
              style={{ minHeight: 96 }}
              placeholder="例如：我把它放得很远，因为我不想再看到它。"
              value={reflection}
              maxLength={300}
              onChange={(e) => setReflection(e.target.value)}
            />
          </Card>

          <Card padSm>
            <SectionHead title="我的沙盘" action={<Tag tone="plain">{snapshots.length}</Tag>} />
            {snapshots.length === 0 ? (
              <p className="small muted">
                还没有保存过。摆好之后点右上角「保存沙盘」。
              </p>
            ) : (
              <ul className="sandbox-snapshots">
                {snapshots.slice(0, 6).map((snapshot) => (
                  <li key={snapshot.id} className="sandbox-snapshot">
                    <button
                      type="button"
                      className="sandbox-snapshot__main"
                      onClick={() => loadSnapshot(snapshot)}
                    >
                      <span className="sandbox-snapshot__title">{snapshot.title}</span>
                      <span className="sandbox-snapshot__meta small muted">
                        {formatDateTime(snapshot.at)} · {snapshot.items.length} 个摆件
                      </span>
                    </button>
                    <button
                      type="button"
                      className="sandbox-snapshot__del"
                      aria-label={`删除「${snapshot.title}」`}
                      onClick={() => removeSnapshot(snapshot.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {/* ------------------------------ 快照抽屉 ------------------------------ */}
      {libraryOpen ? (
        <Card className="mt-4">
          <SectionHead
            title="全部快照"
            action={
              <Button variant="quiet" size="sm" onClick={() => setLibraryOpen(false)}>
                收起
              </Button>
            }
          />
          {snapshots.length === 0 ? (
            <Empty
              icon="◌"
              title="还没有快照"
              desc="保存之后会出现在这里，可以随时重新打开继续摆。"
            />
          ) : (
            <div className="grid grid--3">
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className="sandbox-card">
                  <div className="sandbox-card__head">
                    <strong>{snapshot.title}</strong>
                    <Tag tone="plain">{snapshot.items.length} 件</Tag>
                  </div>
                  <p className="small muted">{formatDateTime(snapshot.at)}</p>
                  <div className="sandbox-card__preview" aria-hidden>
                    {snapshot.items.slice(0, 12).map((item) => (
                      <span
                        key={item.id}
                        style={{
                          left: `${item.x * 100}%`,
                          top: `${item.y * 100}%`,
                          fontSize: `${10 + item.scale * 4}px`,
                        }}
                      >
                        {symbolGlyph(item.symbolId)}
                      </span>
                    ))}
                  </div>
                  {snapshot.reflection ? (
                    <p className="small sandbox-card__reflection">{snapshot.reflection}</p>
                  ) : null}
                  <div className="btn-group mt-2">
                    <Button variant="ghost" size="sm" onClick={() => loadSnapshot(snapshot)}>
                      打开
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => removeSnapshot(snapshot.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* ------------------------------- 保存弹层 ------------------------------- */}
      {saveOpen ? (
        <div className="sandbox-modal" role="dialog" aria-modal="true" aria-label="保存沙盘">
          <div className="sandbox-modal__panel">
            <h2 className="card-title">保存这个沙盘</h2>
            <p className="card-desc mt-2">
              起个名字方便之后回看。你的自我解读也会一起保存。
            </p>
            <div className="field mt-4">
              <label className="field-label" htmlFor="sandbox-title">
                标题
              </label>
              <input
                id="sandbox-title"
                className="input"
                value={title}
                maxLength={40}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：周三晚上"
              />
            </div>
            <div className="field mt-3">
              <label className="field-label" htmlFor="sandbox-reflection-2">
                想记下的一句话（可留空）
              </label>
              <textarea
                id="sandbox-reflection-2"
                className="textarea"
                style={{ minHeight: 80 }}
                value={reflection}
                maxLength={300}
                onChange={(e) => setReflection(e.target.value)}
              />
            </div>
            <div className="btn-group mt-4" style={{ justifyContent: 'flex-end' }}>
              <Button variant="quiet" onClick={() => setSaveOpen(false)}>
                取消
              </Button>
              <Button onClick={confirmSave}>保存</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------- 注释弹层 ------------------------------- */}
      {editNoteTarget ? (
        <NoteEditor
          initial={editNoteTarget.note ?? ''}
          label={symbolLabel(editNoteTarget.symbolId)}
          onCancel={() => setEditingId(null)}
          onSave={(note) => {
            setItems((prev) =>
              prev.map((item) =>
                item.id === editNoteTarget.id ? { ...item, note: note.trim() || undefined } : item,
              ),
            );
            setEditingId(null);
            show('注释已更新。', 'success');
          }}
        />
      ) : null}
    </div>
  );
}

function NoteEditor({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="sandbox-modal" role="dialog" aria-modal="true" aria-label={`为「${label}」写注释`}>
      <div className="sandbox-modal__panel">
        <h2 className="card-title">为「{label}」写一句</h2>
        <p className="card-desc mt-2">这句话只有你自己能看到。</p>
        <div className="field mt-4">
          <label className="field-label" htmlFor="sandbox-note">
            注释
          </label>
          <input
            id="sandbox-note"
            className="input"
            value={value}
            maxLength={40}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            placeholder="例如：这是我妈"
          />
        </div>
        <div className="btn-group mt-4" style={{ justifyContent: 'flex-end' }}>
          <Button variant="quiet" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onSave(value)}>确定</Button>
        </div>
      </div>
    </div>
  );
}
