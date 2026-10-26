/**
 * 心屿 · `sandplay-session/v1` 数据格式定义
 *
 * 这是**对外契约**：任何第三方工具（校验器、查看器、导入器）都以本文件为准。
 * 规范正文见 `docs/FORMAT.md`，JSON Schema 见 `public/schema/sandplay-session-v1.schema.json`。
 *
 * 三条原则：
 * 1. **向前兼容**：新增字段只能加可选字段，不能改语义；
 * 2. **可校验**：`validateSession` 是唯一判定入口，CLI 与前端共用；
 * 3. **无隐私泄露**：不允许出现真实姓名、手机号等可识别身份字段。
 */

import type {
  SandboxEvent,
  SandboxItem,
  SandSurface,
  SessionAnnotation,
  SessionMeta,
  SessionMode,
  SessionPhase,
} from '@/lib/types';

/** 当前格式标识 */
export const SANDPAY_FORMAT = 'sandplay-session/v1' as const;

/** 导出时可选包含哪些内容 */
export interface ExportOptions {
  /** 是否包含完整事件流（过程）。false 时只导出结果。 */
  includeEvents: boolean;
  /** 是否包含沙面高度场 */
  includeSurface: boolean;
  /** 是否包含缩略图 dataURL */
  includeThumbnail: boolean;
  /** 是否包含摆件上的本地录音/自定义图（体积大、隐私敏感） */
  includeAttachments: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeEvents: true,
  includeSurface: true,
  includeThumbnail: true,
  includeAttachments: false,
};

/**
 * `.sandplay.json` 文件结构。
 *
 * 与内部 `SandSession` 的区别：本结构是**自包含快照**，
 * 顶层带 `format`/`version`/`exportedAt`/`producer`，且 `events` 可为空数组。
 */
export interface SandplayFile {
  format: typeof SANDPAY_FORMAT;
  /** 文件结构版本（本文件为 1） */
  version: 1;
  exportedAt: string;
  producer: {
    app: string;
    version: string;
    homepage?: string;
  };
  session: SandplaySessionBody;
}

/** 会话正文（不含本地 id 之外的实现细节） */
export interface SandplaySessionBody {
  id: string;
  createdAt: string;
  endedAt?: string;
  title: string;
  mode: SessionMode;
  sceneId: string;
  /** 是否封盘 */
  locked: boolean;
  lockedAt?: string;
  /** 是否归档 */
  archived?: boolean;
  /** 摆件最终状态 */
  items: SandplayItem[];
  /** 过程事件流（可空） */
  events: SandplayEvent[];
  /** L2 沙面（可缺省） */
  surface?: SandplaySurface;
  /** 用户自述 */
  reflection?: string;
  /** 引导问题 */
  prompts?: string[];
  /** 元信息（临床记录字段的非诊断子集） */
  meta?: SandplayMeta;
  /** 时间轴标注 */
  annotations?: SandplayAnnotation[];
  /** 缩略图 dataURL */
  thumbnail?: string;
  /** 客观统计摘要（导出时计算，仅供阅读，不参与校验） */
  stats?: Record<string, number | string>;
}

export interface SandplayItem {
  id: string;
  symbolId: string;
  /** 归一化 x 0~1 */
  x: number;
  /** 归一化 y 0~1 */
  y: number;
  scale: number;
  rotation: number;
  z: number;
  note?: string;
  affectLabels?: string[];
  burial?: number;
  /** 仅在 `includeAttachments` 时出现 */
  audioNote?: string;
  imageData?: string;
}

export interface SandplayEvent {
  /** 相对会话开始毫秒 */
  t: number;
  type: string;
  itemId?: string;
  payload?: Record<string, unknown>;
}

export interface SandplaySurface {
  cols: number;
  rows: number;
  /** RLE+Base64 */
  height: string;
  wetness?: string;
  state?: 'dry' | 'wet';
  waterAdded?: number;
}

export interface SandplayMeta {
  alias?: string;
  clientRef?: string;
  therapistRef?: string;
  sessionNo?: number;
  phase?: SessionPhase;
  startedAt?: string;
  endedAt?: string;
  trayW?: number;
  trayD?: number;
  trayH?: number;
  consentPhoto?: boolean;
  consentProcess?: boolean;
}

export interface SandplayAnnotation {
  id: string;
  eventIndex: number;
  t: number;
  text: string;
  author?: 'self' | 'counselor';
  at: string;
}

/* -------------------------------------------------------------------------- */
/*                                  校验实现                                   */
/* -------------------------------------------------------------------------- */

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: Severity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** 解析出的会话正文（ok 时才非空） */
  data?: SandplaySessionBody;
}

const EVENT_TYPES = new Set<string>([
  'item.add',
  'item.move',
  'item.scale',
  'item.rotate',
  'item.remove',
  'item.note',
  'item.affect',
  'item.layer',
  'item.bury',
  'scene.change',
  'surface.stroke',
  'surface.reset',
  'session.start',
  'session.phase',
  'session.lock',
  'session.save',
  'session.import',
  'annotation.add',
  'reflection.edit',
]);

const MODES = new Set(['self', 'counselor', 'supervision']);
const PHASES = new Set(['intro', 'create', 'reflect', 'connect', 'record', 'dismantle']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isISOish(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && !Number.isNaN(Date.parse(value));
}

/** 隐私红线：字段名命中即报错（防止误把真实身份写进导出文件） */
const FORBIDDEN_FIELDS = ['realName', 'phone', 'idCard', 'email', 'address', 'wechat', 'name'];

/**
 * 全树深度扫描禁用字段。
 *
 * 为什么不能只扫 meta：隐私红线是**产品级承诺**（VISION §5.6），
 * 只要导出的 JSON 里有明文姓名，承诺就破了 —— 不管它藏在哪一层。
 * 递归遍历对象与数组，返回每一处命中的 JSON 路径。
 *
 * 有环保护与深度上限：导入的是外部文件，不能假定它结构良好。
 */
function findForbiddenFields(root: unknown, maxDepth = 32): Array<{ path: string; key: string }> {
  const hits: Array<{ path: string; key: string }> = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isObject(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_FIELDS.includes(key) && value !== undefined && value !== null && value !== '') {
        hits.push({ path: nextPath, key });
      }
      // 只对容器继续下探，避免把普通字符串当路径递归
      if (isObject(value) || Array.isArray(value)) walk(value, nextPath, depth + 1);
    }
  };

  walk(root, 'session', 0);
  return hits;
}

/**
 * 校验一个 `.sandplay.json` 对象。
 *
 * - `strict`（默认 false）：把「可疑但可运行」的问题降级为 warning；
 * - 返回的 `issues` 全量列出，CLI 与 UI 都以它为准。
 */
export function validateSandplayFile(input: unknown, strict = false): ValidationResult {
  const issues: ValidationIssue[] = [];
  /*
   * `error` 恒为 error，与 `strict` 无关 —— 这些是**格式硬错误**
   * （缺字段、类型不对、违反隐私红线），任何模式下都不该放过。
   *
   * 这里原来写的是 `severity: strict ? 'error' : 'error'` —— 一个左右相同的三元。
   * 不影响行为，但它是**误导性死代码**：读代码的人会以为 `strict` 对
   * 这 50 处调用有影响，从而误判 `--strict` 的语义边界。
   * 真正被 `strict` 影响的是下面的 `warn`（可疑项升级为 error）。
   */
  const error = (path: string, message: string) => {
    issues.push({ path, message, severity: 'error' });
  };
  const warn = (path: string, message: string) => {
    issues.push({ path, message, severity: strict ? 'error' : 'warning' });
  };

  if (!isObject(input)) {
    error('$', '顶层必须是一个 JSON 对象。');
    return { ok: false, issues };
  }

  if (input.format !== SANDPAY_FORMAT) {
    error('format', `format 必须是 "${SANDPAY_FORMAT}"，实际是 ${JSON.stringify(input.format)}。`);
  }
  if (input.version !== 1) {
    error('version', `version 必须是 1，实际是 ${JSON.stringify(input.version)}。`);
  }
  if (!isISOish(input.exportedAt)) {
    error('exportedAt', 'exportedAt 必须是合法的 ISO 时间字符串。');
  }
  if (!isObject(input.producer)) {
    error('producer', 'producer 必须是对象。');
  } else {
    if (typeof input.producer.app !== 'string' || !input.producer.app) {
      error('producer.app', 'producer.app 必须是非空字符串。');
    }
    if (typeof input.producer.version !== 'string' || !input.producer.version) {
      error('producer.version', 'producer.version 必须是非空字符串。');
    }
  }

  const session = input.session;
  if (!isObject(session)) {
    error('session', 'session 必须是对象。');
    return { ok: false, issues };
  }

  // ------------------------------ 会话基础字段 ------------------------------
  if (typeof session.id !== 'string' || !session.id) error('session.id', '必须是非空字符串。');
  if (!isISOish(session.createdAt)) error('session.createdAt', '必须是合法的 ISO 时间字符串。');
  if (session.endedAt !== undefined && !isISOish(session.endedAt)) {
    error('session.endedAt', '如果存在，必须是合法的 ISO 时间字符串。');
  }
  if (typeof session.title !== 'string') error('session.title', '必须是字符串。');
  if (typeof session.mode !== 'string' || !MODES.has(session.mode)) {
    error('session.mode', `必须是 self / counselor / supervision 之一。`);
  }
  if (typeof session.sceneId !== 'string' || !session.sceneId) {
    error('session.sceneId', '必须是非空字符串。');
  }
  if (typeof session.locked !== 'boolean') error('session.locked', '必须是布尔值。');

  // -------------------------------- 摆件 --------------------------------
  if (!Array.isArray(session.items)) {
    error('session.items', '必须是数组。');
  } else {
    const seen = new Set<string>();
    session.items.forEach((raw, index) => {
      const path = `session.items[${index}]`;
      if (!isObject(raw)) {
        error(path, '必须是对象。');
        return;
      }
      if (typeof raw.id !== 'string' || !raw.id) error(`${path}.id`, '必须是非空字符串。');
      else if (seen.has(raw.id)) error(`${path}.id`, `id "${raw.id}" 重复。`);
      else seen.add(raw.id);

      if (typeof raw.symbolId !== 'string' || !raw.symbolId) {
        error(`${path}.symbolId`, '必须是非空字符串。');
      }
      for (const key of ['x', 'y'] as const) {
        if (!isFiniteNumber(raw[key])) error(`${path}.${key}`, '必须是有限数字。');
        else if ((raw[key] as number) < 0 || (raw[key] as number) > 1) {
          error(`${path}.${key}`, '归一化坐标必须在 0~1 之间。');
        }
      }
      if (!isFiniteNumber(raw.scale)) error(`${path}.scale`, '必须是有限数字。');
      else if ((raw.scale as number) < 0.1 || (raw.scale as number) > 4) {
        warn(`${path}.scale`, '缩放超出常见范围 0.1~4。');
      }
      if (!isFiniteNumber(raw.rotation)) error(`${path}.rotation`, '必须是有限数字。');
      if (!isFiniteNumber(raw.z)) warn(`${path}.z`, '建议提供数字层级。');
      if (raw.note !== undefined && typeof raw.note !== 'string') {
        error(`${path}.note`, '如果存在，必须是字符串。');
      }
      if (raw.affectLabels !== undefined) {
        if (!Array.isArray(raw.affectLabels) || raw.affectLabels.some((v) => typeof v !== 'string')) {
          error(`${path}.affectLabels`, '如果存在，必须是字符串数组。');
        }
      }
      if (raw.burial !== undefined) {
        if (!isFiniteNumber(raw.burial) || (raw.burial as number) < 0 || (raw.burial as number) > 1) {
          error(`${path}.burial`, '如果存在，必须是 0~1 的数字。');
        }
      }
    });
  }

  // -------------------------------- 事件 --------------------------------
  if (!Array.isArray(session.events)) {
    error('session.events', '必须是数组（可以为空数组）。');
  } else {
    let lastT = -1;
    session.events.forEach((raw, index) => {
      const path = `session.events[${index}]`;
      if (!isObject(raw)) {
        error(path, '必须是对象。');
        return;
      }
      if (!isFiniteNumber(raw.t)) {
        error(`${path}.t`, '必须是有限数字（相对会话开始的毫秒）。');
      } else if ((raw.t as number) < lastT) {
        warn(`${path}.t`, '事件时间戳应单调递增，这里比上一条小。');
      } else {
        lastT = raw.t as number;
      }
      if (typeof raw.type !== 'string' || !EVENT_TYPES.has(raw.type)) {
        error(`${path}.type`, `未知事件类型 ${JSON.stringify(raw.type)}。`);
      }
      if (raw.itemId !== undefined && typeof raw.itemId !== 'string') {
        error(`${path}.itemId`, '如果存在，必须是字符串。');
      }
      if (raw.payload !== undefined && !isObject(raw.payload)) {
        error(`${path}.payload`, '如果存在，必须是对象。');
      }
    });
  }

  // -------------------------------- 沙面 --------------------------------
  if (session.surface !== undefined) {
    const surface = session.surface;
    if (!isObject(surface)) {
      error('session.surface', '如果存在，必须是对象。');
    } else {
      if (!isFiniteNumber(surface.cols) || (surface.cols as number) <= 0) {
        error('session.surface.cols', '必须是正整数。');
      }
      if (!isFiniteNumber(surface.rows) || (surface.rows as number) <= 0) {
        error('session.surface.rows', '必须是正整数。');
      }
      if (typeof surface.height !== 'string' || !surface.height) {
        error('session.surface.height', '必须是非空的 RLE+Base64 字符串。');
      }
      if (surface.wetness !== undefined && typeof surface.wetness !== 'string') {
        error('session.surface.wetness', '如果存在，必须是字符串。');
      }
      if (
        surface.state !== undefined &&
        surface.state !== 'dry' &&
        surface.state !== 'wet'
      ) {
        error('session.surface.state', '如果存在，必须是 dry 或 wet。');
      }
    }
  }

  // -------------------------------- 元信息 --------------------------------
  if (session.meta !== undefined) {
    if (!isObject(session.meta)) {
      error('session.meta', '如果存在，必须是对象。');
    } else {
      const meta = session.meta;
      if (meta.phase !== undefined && (typeof meta.phase !== 'string' || !PHASES.has(meta.phase))) {
        error('session.meta.phase', '如果存在，必须是 intro/create/reflect/connect/record/dismantle 之一。');
      }
      for (const key of ['consentPhoto', 'consentProcess'] as const) {
        if (meta[key] !== undefined && typeof meta[key] !== 'boolean') {
          error(`session.meta.${key}`, '如果存在，必须是布尔值。');
        }
      }
      // 隐私检查（meta 层，路径提示更具体，放在深度扫描之前以便给出更好的报错）
      for (const key of Object.keys(meta)) {
        if (FORBIDDEN_FIELDS.includes(key)) {
          error(`session.meta.${key}`, '不允许可识别身份字段（隐私红线）。请使用化名 alias / clientRef。');
        }
      }
    }
  }

  // -------------------------- 隐私红线（全树深度扫描） --------------------------
  //
  // 历史缺陷：这段检查以前**只扫 session.meta**，于是
  //   items[0].name = '李某某'
  // 能顺利通过校验并被导出 —— 恰恰是隐私红线最该拦住的场景。
  // 现在对整棵 session 树做深度遍历，任何层级的禁用字段都报错。
  // 例外：events[].payload 里的 `item` 快照会重复出现同名字段，
  // 这里也一并扫描，因为导出文件里它们同样是明文。
  for (const hit of findForbiddenFields(session)) {
    if (hit.path.startsWith('session.meta.')) continue; // 上面已报过，避免重复
    error(hit.path, '不允许可识别身份字段（隐私红线）。请使用化名 alias / clientRef。');
  }

  // -------------------------------- 标注 --------------------------------
  if (session.annotations !== undefined) {
    if (!Array.isArray(session.annotations)) {
      error('session.annotations', '如果存在，必须是数组。');
    } else {
      session.annotations.forEach((raw, index) => {
        const path = `session.annotations[${index}]`;
        if (!isObject(raw)) {
          error(path, '必须是对象。');
          return;
        }
        if (typeof raw.id !== 'string' || !raw.id) error(`${path}.id`, '必须是非空字符串。');
        if (!isFiniteNumber(raw.eventIndex)) error(`${path}.eventIndex`, '必须是数字。');
        if (typeof raw.text !== 'string') error(`${path}.text`, '必须是字符串。');
      });
    }
  }

  if (session.reflection !== undefined && typeof session.reflection !== 'string') {
    error('session.reflection', '如果存在，必须是字符串。');
  }

  const ok = issues.every((issue) => issue.severity !== 'error');
  return {
    ok,
    issues,
    data: ok ? (session as unknown as SandplaySessionBody) : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*                              内部模型 <-> 文件                               */
/* -------------------------------------------------------------------------- */

import type { SandSession } from '@/lib/types';

const APP_VERSION = '2.0.0';

/** 内部会话 -> 导出文件（按选项裁剪） */
export function toSandplayFile(
  session: SandSession,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  stats?: Record<string, number | string>,
): SandplayFile {
  const items: SandplayItem[] = session.items.map((item) => {
    const out: SandplayItem = {
      id: item.id,
      symbolId: item.symbolId,
      x: item.x,
      y: item.y,
      scale: item.scale,
      rotation: item.rotation,
      z: item.z,
    };
    if (item.note) out.note = item.note;
    if (item.affectLabels?.length) out.affectLabels = item.affectLabels;
    if (item.burial !== undefined) out.burial = item.burial;
    if (options.includeAttachments) {
      if (item.audioNote) out.audioNote = item.audioNote;
      if (item.imageData) out.imageData = item.imageData;
    }
    return out;
  });

  const events: SandplayEvent[] = options.includeEvents
    ? session.events.map((event) => ({
        t: event.t,
        type: event.type,
        ...(event.itemId ? { itemId: event.itemId } : {}),
        ...(event.payload ? { payload: event.payload } : {}),
      }))
    : [];

  const body: SandplaySessionBody = {
    id: session.id,
    createdAt: session.at,
    title: session.title,
    mode: session.mode,
    sceneId: session.sceneId,
    locked: session.locked,
    items,
    events,
  };

  if (session.endedAt) body.endedAt = session.endedAt;
  if (session.lockedAt) body.lockedAt = session.lockedAt;
  if (session.archived) body.archived = session.archived;
  if (options.includeSurface && session.surface) {
    body.surface = {
      cols: session.surface.cols,
      rows: session.surface.rows,
      height: session.surface.height,
      ...(session.surface.wetness ? { wetness: session.surface.wetness } : {}),
      ...(session.surface.state ? { state: session.surface.state } : {}),
      ...(session.surface.waterAdded !== undefined ? { waterAdded: session.surface.waterAdded } : {}),
    };
  }
  if (session.reflection) body.reflection = session.reflection;
  if (session.prompts?.length) body.prompts = session.prompts;
  if (session.meta) body.meta = { ...session.meta };
  if (session.annotations?.length) {
    body.annotations = session.annotations.map((a) => ({
      id: a.id,
      eventIndex: a.eventIndex,
      t: a.t,
      text: a.text,
      ...(a.author ? { author: a.author } : {}),
      at: a.at,
    }));
  }
  if (options.includeThumbnail && session.thumbnail) body.thumbnail = session.thumbnail;
  if (stats) body.stats = stats;

  return {
    format: SANDPAY_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    producer: { app: '心屿 Xinyu', version: APP_VERSION },
    session: body,
  };
}

/** 导出文件 -> 内部会话（校验通过后调用） */
export function fromSandplayFile(
  file: SandplayFile,
  options: { generateId?: () => string } = {},
): SandSession {
  const body = file.session;
  const events: SandboxEvent[] = body.events.map((event) => ({
    t: event.t,
    type: event.type as SandboxEvent['type'],
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.payload ? { payload: event.payload } : {}),
  }));

  const items: SandboxItem[] = body.items.map((item) => ({
    id: item.id,
    symbolId: item.symbolId,
    x: item.x,
    y: item.y,
    scale: item.scale,
    rotation: item.rotation,
    z: item.z,
    ...(item.note ? { note: item.note } : {}),
    ...(item.affectLabels?.length ? { affectLabels: item.affectLabels } : {}),
    ...(item.burial !== undefined ? { burial: item.burial } : {}),
    ...(item.audioNote ? { audioNote: item.audioNote } : {}),
    ...(item.imageData ? { imageData: item.imageData } : {}),
  }));

  const surface: SandSurface | undefined = body.surface
    ? {
        cols: body.surface.cols,
        rows: body.surface.rows,
        height: body.surface.height,
        ...(body.surface.wetness ? { wetness: body.surface.wetness } : {}),
        ...(body.surface.state ? { state: body.surface.state } : {}),
        ...(body.surface.waterAdded !== undefined ? { waterAdded: body.surface.waterAdded } : {}),
      }
    : undefined;

  const annotations: SessionAnnotation[] | undefined = body.annotations?.map((a) => ({
    id: a.id,
    eventIndex: a.eventIndex,
    t: a.t,
    text: a.text,
    ...(a.author ? { author: a.author } : {}),
    at: a.at,
  }));

  return {
    schemaVersion: 2,
    id: options.generateId ? options.generateId() : body.id,
    at: body.createdAt,
    title: body.title,
    endedAt: body.endedAt,
    mode: body.mode,
    sceneId: body.sceneId,
    items,
    events,
    surface,
    reflection: body.reflection,
    prompts: body.prompts,
    locked: body.locked,
    lockedAt: body.lockedAt,
    meta: body.meta as SessionMeta | undefined,
    annotations,
    archived: body.archived,
    thumbnail: body.thumbnail,
  };
}

/** 解析 JSON 文本并校验（CLI 与 UI 共用入口） */
export function parseSandplayFile(text: string, strict = false): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          message: `不是合法的 JSON：${cause instanceof Error ? cause.message : String(cause)}`,
          severity: 'error',
        },
      ],
    };
  }
  return validateSandplayFile(parsed, strict);
}
