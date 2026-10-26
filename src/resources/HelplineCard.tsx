import { useState } from 'react';
import { useToast } from '@/lib/toast';
import { cx } from '@/lib/utils';
import { telHref } from '@/resources/helplines';
import type { Helpline } from '@/resources/helplines';

/**
 * 号码复制：优先 Clipboard API，不可用时退回 textarea + execCommand。
 * 两条路都失败时返回 false，由调用方提示「请长按号码手动抄下」。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走降级方案
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export type HelplineVariant = 'primary' | 'emergency' | 'normal';

export function HelplineCard({
  helpline,
  variant = 'normal',
  showVerified = true,
}: {
  helpline: Helpline;
  variant?: HelplineVariant;
  showVerified?: boolean;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyText(helpline.number);
    if (ok) {
      setCopied(true);
      toast.show(`已复制号码 ${helpline.number}`, 'success');
      window.setTimeout(() => setCopied(false), 2200);
    } else {
      toast.show(`复制失败，请手动记住：${helpline.number}`, 'warn');
    }
  };

  return (
    <article
      className={cx(
        'helpline',
        variant === 'primary' && 'helpline--primary',
        variant === 'emergency' && 'helpline--emergency',
      )}
    >
      <div className="helpline__top">
        <h3 className="helpline__name">{helpline.name}</h3>
        <div className="helpline__badges">
          {variant === 'primary' ? (
            <span className="tag tag--alert">优先拨打</span>
          ) : null}
          {variant === 'emergency' ? (
            <span className="tag tag--clay">紧急救助</span>
          ) : null}
          <span className="tag tag--outline">{helpline.hours}</span>
        </div>
      </div>

      <div className="helpline__number-row">
        <a
          className="helpline__number"
          href={telHref(helpline.number)}
          aria-label={`拨打 ${helpline.name}：${helpline.number}`}
        >
          {helpline.number}
        </a>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onCopy}
          aria-label={`复制号码 ${helpline.number}`}
        >
          {copied ? '已复制 ✓' : '复制号码'}
        </button>
      </div>

      <p className="helpline__desc">{helpline.description}</p>

      <div className="helpline__meta">
        <span>
          覆盖：<b>{helpline.region}</b>
        </span>
        <span>
          适合：<b>{helpline.audience}</b>
        </span>
      </div>

      <div className="helpline__foot">
        <span className="helpline__verified">
          {helpline.hours.includes('24') ? '全天可拨' : '非 24 小时，请留意拨打时段'}
        </span>
        {showVerified ? (
          <span className="helpline__verified">资料整理于 {helpline.verifiedAt}</span>
        ) : null}
      </div>
    </article>
  );
}
