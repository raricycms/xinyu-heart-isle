import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { cx } from '@/lib/utils';
import { useI18n } from '@/i18n';
import {
  SYMBOL_PACK_FORMAT,
  importPackFromText,
  removePack,
  type InstalledSymbolPack,
} from './packs';
import { usePacks } from './usePacks';
import '@/styles/sandbox-library.css';

/**
 * 沙具包管理面板。
 *
 * 三条硬约束（都写在界面上，不让用户猜）：
 * 1. 只支持 emoji/字符 或 **内嵌 data URI 图片**，不会联网加载任何资源；
 * 2. 导入完全在本地完成，不上传文件；
 * 3. 删除需要二次确认。
 *
 * `onChanged` 让上层在包变动后刷新沙具列表（本组件也直接读 `usePacks`）。
 */

export interface PackManagerProps {
  /** 包被安装/卸载后的回调（可选） */
  onChanged?: (packs: InstalledSymbolPack[]) => void;
  /** 只读模式：隐藏导入与删除 */
  readOnly?: boolean;
  className?: string;
  /** 是否显示「删除需确认」的 system 提示，默认 true */
  confirmDelete?: boolean;
}

export function PackManager({ onChanged, readOnly = false, className, confirmDelete = true }: PackManagerProps) {
  const { t } = useI18n();
  const packs = usePacks();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [issues, setIssues] = useState<string[]>([]);
  const [okMessage, setOkMessage] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const totalSymbols = useMemo(
    () => packs.reduce((sum, pack) => sum + pack.symbols.length, 0),
    [packs],
  );

  const handleText = useCallback(
    (text: string, fileName: string) => {
      const result = importPackFromText(text);
      if (!result.ok || !result.record) {
        setOkMessage('');
        setIssues(result.issues.length > 0 ? result.issues : ['导入失败，原因未知。']);
        return;
      }
      setIssues([]);
      setOkMessage(`已导入「${result.record.name}」（${result.record.symbols.length} 件，来自 ${fileName}）。`);
      onChanged?.([...packs.filter((pack) => pack.id !== result.record?.id), result.record]);
    },
    [onChanged, packs],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      try {
        const text = await file.text();
        handleText(text, file.name);
      } catch {
        setOkMessage('');
        setIssues(['读取文件失败。可以换一个文件再试。']);
      }
    },
    [handleText],
  );

  const handleDelete = useCallback(
    (pack: InstalledSymbolPack) => {
      if (confirmDelete) {
        const ok = window.confirm(
          `删除沙具包「${pack.name}」？它带来的 ${pack.symbols.length} 件沙具会一起消失，已摆进沙盘的摆件会显示为占位符。`,
        );
        if (!ok) return;
      }
      const removed = removePack(pack.id);
      setOkMessage(removed ? `已删除「${pack.name}」。` : '这个包已经不在了。');
      setIssues([]);
      setPendingDelete(null);
      onChanged?.(packs.filter((item) => item.id !== pack.id));
    },
    [confirmDelete, onChanged, packs],
  );

  return (
    <section className={cx('pack-manager', className)} aria-label={t('sandbox.libraryImportPack')}>
      <div className="row-between">
        <div>
          <strong className="small">沙具包</strong>
          <p className="small muted">
            已装 {packs.length} 个包 · 共 {totalSymbols} 件第三方沙具
          </p>
        </div>
        {!readOnly ? (
          <>
            <input
              id={inputId}
              ref={inputRef}
              className="pack-manager__file-input"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <label className="btn btn--ghost btn--sm" htmlFor={inputId}>
              {t('sandbox.libraryImportPack')}
            </label>
          </>
        ) : null}
      </div>

      {!readOnly ? (
        <div
          className={cx('pack-manager__drop', dragOver && 'is-over')}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void handleFiles(event.dataTransfer?.files ?? null);
          }}
        >
          <span aria-hidden>📥</span>
          <span>把 .json 沙具包拖到这里，或点上面的「{t('sandbox.libraryImportPack')}」</span>
          <span className="small muted">
            格式 {SYMBOL_PACK_FORMAT} · 只支持 emoji 或内嵌图片，不会联网加载，也不会把文件传出去。
          </span>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="pack-manager__issues" role="alert">
          <strong>这个包没能导入：</strong>
          <ul className="mt-2">
            {issues.slice(0, 8).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          {issues.length > 8 ? <p className="mt-2">还有 {issues.length - 8} 条问题未显示。</p> : null}
        </div>
      ) : null}

      {okMessage ? (
        <p className="notice notice--good small" role="status">
          {okMessage}
        </p>
      ) : null}

      {packs.length === 0 ? (
        <p className="pack-empty">
          还没有导入任何沙具包。内置的 327 件沙具已经够用；想要自己的素材时再导入。
        </p>
      ) : (
        <ul className="pack-list">
          {packs.map((pack) => (
            <li key={pack.id} className="pack-item">
              <div className="pack-item__body">
                <span className="pack-item__name">{pack.name}</span>
                <span className="pack-item__meta">
                  <span className="tag tag--teal">{pack.license}</span>
                  <span className="mono">{pack.symbols.length} 件</span>
                  <span>作者：{pack.author}</span>
                  <span className="mono">v{pack.version}</span>
                  <span className="mono muted">id: {pack.id}</span>
                </span>
                {pack.description ? <span className="small muted">{pack.description}</span> : null}
              </div>
              {!readOnly ? (
                <button
                  type="button"
                  className="pack-item__del"
                  aria-label={`删除沙具包「${pack.name}」`}
                  onClick={() => {
                    if (pendingDelete === pack.id) handleDelete(pack);
                    else setPendingDelete(pack.id);
                  }}
                  onBlur={() => setPendingDelete((prev) => (prev === pack.id ? null : prev))}
                >
                  {pendingDelete === pack.id ? '确认删除？' : t('common.delete')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="small muted">
        授权要求：自制的包请填写 SPDX 标识（如 CC0-1.0 / CC-BY-4.0）。
        删除一个包不会影响已保存的沙盘记录，缺图会显示占位符。
      </p>
    </section>
  );
}
