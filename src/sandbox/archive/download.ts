/**
 * 心屿 · 本地文件下载工具（档案模块）
 *
 * 为什么单独一个文件：
 * 1. 文件名必须**可预测且安全**（Windows 不允许 `/\:*?"<>|`，也不能以句点结尾）；
 * 2. 编码必须稳定。HANDOVER §4.1 记过一次真实事故：Windows 记事本/Excel 打开
 *    无 BOM 的 UTF-8 中文文件会显示乱码。因此规则固定为：
 *    - **JSON 不加 BOM**（必须能被 `JSON.parse` 直接吃下，也要能被解析器/CLI 读取）；
 *    - **Markdown / CSV 加 BOM**（主要给人用记事本/Excel 打开）。
 * 3. 不引入任何 PDF / 图片库：图片导出直接复用 `session.thumbnail` 的 dataURL，
 *    PDF 走浏览器原生 `window.print()`。
 *
 * 纯前端、零网络：`downloadBlob` 只使用 `Blob` + `URL.createObjectURL` + 隐藏链接点击。
 */

/** UTF-8 BOM（U+FEFF）。给「人要打开」的文本文件用。 */
export const UTF8_BOM = '\uFEFF';

/** 文件名主干的默认最大长度（按 Unicode 码点计） */
export const MAX_FILENAME_LENGTH = 80;

/** Windows 文件名保留字符 */
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|]/g;
/** 控制字符（含换行、制表符） */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
/** Windows 保留设备名（不区分大小写） */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** 本地时区的 `yyyyMMdd-HHmm`，例如 `20261027-0905` */
export function formatStamp(date: Date = new Date()): string {
  const yyyy = date.getFullYear().toString();
  return (
    `${yyyy}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  );
}

/**
 * 把任意标题变成安全的文件名主干。
 *
 * - 去掉 Windows 保留字符 `\ / : * ? " < > |` 与控制字符；
 * - 空白折叠成 `-`；
 * - 去掉首尾的 `.`、`-`（Windows 不接受以句点结尾）；
 * - 保留中文、字母、数字、下划线；
 * - 超过 `maxLength` 个码点时截断（不切断代理对）；
 * - 结果为空时回退 `未命名`。
 */
export function sanitizeFilename(input: string, maxLength = MAX_FILENAME_LENGTH): string {
  const cleaned = (input ?? '')
    .replace(FORBIDDEN_FILENAME_CHARS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .trim();

  const pointSafe = cleaned || '未命名';
  const points = Array.from(pointSafe);
  const limited = points.length > maxLength ? points.slice(0, maxLength).join('') : pointSafe;
  const trimmed = limited.replace(/^[-.]+|[-.]+$/g, '') || '未命名';

  return RESERVED_NAMES.has(trimmed.toLowerCase()) ? `_${trimmed}` : trimmed;
}

/** 单次会话导出文件名：`sandplay-{title}-{yyyyMMdd-HHmm}.sandplay.json` */
export function sandplayFilename(title: string, date: Date = new Date()): string {
  return `sandplay-${sanitizeFilename(title)}-${formatStamp(date)}.sandplay.json`;
}

/** 全量档案导出文件名：`sandplay-archive-{yyyyMMdd-HHmm}.sandplay-archive.json` */
export function archiveFilename(date: Date = new Date()): string {
  return `sandplay-archive-${formatStamp(date)}.sandplay-archive.json`;
}

/** 记录单图片文件名：`sandplay-{title}-{yyyyMMdd-HHmm}.png` */
export function reportImageFilename(title: string, date: Date = new Date()): string {
  return `sandplay-${sanitizeFilename(title)}-${formatStamp(date)}.png`;
}

/* -------------------------------------------------------------------------- */
/*                                   Blob                                     */
/* -------------------------------------------------------------------------- */

/** 是否已经有 BOM（避免重复添加） */
export function hasBom(text: string): boolean {
  return text.startsWith(UTF8_BOM);
}

/** 加 BOM（幂等） */
export function withBom(text: string): string {
  return hasBom(text) ? text : `${UTF8_BOM}${text}`;
}

/** JSON Blob：**不加 BOM**，type 固定为 `application/json` */
export function buildJsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

/** 文本 Blob。`bom = true` 时前置 U+FEFF。 */
export function buildTextBlob(text: string, mime: string, bom = false): Blob {
  return new Blob([bom ? withBom(text) : text], { type: mime });
}

/** Markdown Blob：加 BOM（给人用记事本打开） */
export function buildMarkdownBlob(text: string): Blob {
  return buildTextBlob(text, 'text/markdown', true);
}

/** CSV Blob：加 BOM（Excel 直接双击不乱码） */
export function buildCsvBlob(text: string): Blob {
  return buildTextBlob(text, 'text/csv', true);
}

/**
 * dataURL -> Blob（用于把 `session.thumbnail` 直接存成 png）。
 * 不解析 / 不重绘，只做 base64 解码，因此不依赖 canvas，也不引入图片库。
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const isBase64 = Boolean(match[2]);
  const payload = match[3];
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  触发下载                                   */
/* -------------------------------------------------------------------------- */

/** 是否处在可以触发下载的浏览器环境（单测在 node 下为 false） */
export function canDownload(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/**
 * 触发浏览器下载。返回是否真的触发了（node / 无 DOM 环境返回 false，不抛错）。
 * 使用隐藏 `<a download>`，`revokeObjectURL` 延后释放，避免部分浏览器下载中断。
 */
export function downloadBlob(filename: string, blob: Blob): boolean {
  if (!canDownload()) return false;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFilename(filename, 160);
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  } finally {
    // 立刻 revoke 会让 Safari 取消下载，延迟释放
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

/** 导出 JSON 文件（无 BOM）。返回生成的 Blob，便于调用方断言/复用。 */
export function downloadJson(filename: string, data: unknown): Blob {
  const blob = buildJsonBlob(data);
  downloadBlob(filename, blob);
  return blob;
}

/** 导出 Markdown 文件（带 BOM） */
export function downloadMarkdown(filename: string, text: string): Blob {
  const blob = buildMarkdownBlob(text);
  downloadBlob(filename, blob);
  return blob;
}

/** 导出 CSV 文件（带 BOM） */
export function downloadCsv(filename: string, text: string): Blob {
  const blob = buildCsvBlob(text);
  downloadBlob(filename, blob);
  return blob;
}

/** 导出图片（dataURL）。dataURL 非法时返回 null，不触发下载。 */
export function downloadImage(filename: string, dataUrl: string): Blob | null {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  downloadBlob(filename, blob);
  return blob;
}
