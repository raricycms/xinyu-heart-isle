/**
 * 心屿 · 危机求助热线数据
 *
 * ============================================================================
 * ⚠️⚠️  上线前必须逐个核验  ⚠️⚠️
 * ============================================================================
 * 热线号码、接听时间、承接机构都会变更（尤其是 400 号码与地方号码）。
 * 本文件里的 `verifiedAt` 目前记录的是「资料整理日期」，**不是**电话拨测日期。
 * 上线前请务必：
 *   1. 逐个拨测号码是否仍是空号 / 是否转语音；
 *   2. 核对接听时间（尤其标注「以接线方公告为准」的条目）；
 *   3. 核对承接机构是否仍然运营该热线；
 *   4. 核验通过后，把该条的 `verifiedAt` 改成真实核验日期。
 * 拿不准的号码宁可删除，也不要留在页面上。
 * ============================================================================
 */

export interface Helpline {
  id: string;
  name: string;
  number: string;
  /** 接听时段。不确定的写「以接线方公告为准」，不要编造 24 小时 */
  hours: string;
  /** 覆盖地区 */
  region: string;
  /** 适合谁打 */
  audience: string;
  /** 一句话说明这条线能提供什么 */
  description: string;
  /** 核验日期（当前为资料整理日期，见文件头说明） */
  verifiedAt: string;
}

/** 资料整理日期（⚠️ 非拨测核验日期，上线前请替换为真实核验日期） */
export const HELPLINE_DATA_COLLECTED_AT = '2026-10-26';

const V = HELPLINE_DATA_COLLECTED_AT;

/**
 * 热线清单。
 * 排序原则：先「心理危机干预」再「紧急救助」再「专项/地区」。
 * 每条都必须在人工拨测后才算可用。
 */
export const HELPLINES: Helpline[] = [
  {
    id: 'cn-12356',
    name: '全国统一心理援助热线',
    number: '12356',
    hours: '24 小时',
    region: '全国',
    audience: '所有人，包括正在经历心理危机的人',
    description:
      '2025 年 1 月 1 日起在全国推行，由各地精神卫生机构等承接接听。情绪崩溃、睡不着、有伤害自己的念头，都可以先拨这一条。',
    verifiedAt: V,
  },
  {
    id: 'bj-crisis-010',
    name: '北京心理危机研究与干预中心',
    number: '010-82951332',
    hours: '24 小时',
    region: '全国（北京号码，外地可拨打）',
    audience: '所有人，尤其是有自伤、自杀念头的人',
    description:
      '国内较早设立的危机干预热线，接线员受过危机干预培训，可提供短时情绪疏导、风险评估与转介建议。',
    verifiedAt: V,
  },
  {
    id: 'hope24-400',
    name: '希望24热线',
    number: '400-161-9995',
    hours: '24 小时',
    region: '全国',
    audience: '所有人',
    description:
      '民间心理危机干预热线，主要面向有自杀意念与情绪危机的人群。接听能力与排队时长以接线方当班情况为准。',
    verifiedAt: V,
  },
  {
    id: 'ccnu-4009',
    name: '教育部华中师范大学心理援助热线',
    number: '4009-678-320',
    hours: '以接线方公告为准（通常为白天至夜间时段）',
    region: '全国',
    audience: '学生、教师、家长及普通公众',
    description:
      '由教育部指导、华中师范大学承接的心理援助热线，提供心理疏导与转介建议。非 24 小时，建议白天拨打。',
    verifiedAt: V,
  },
  {
    id: 'sh-962525',
    name: '上海市心理热线',
    number: '962525',
    hours: '24 小时',
    region: '上海（外地可拨打）',
    audience: '所有人',
    description: '上海市统一心理援助热线，由本地精神卫生专业机构承接接听。',
    verifiedAt: V,
  },
  {
    id: 'gz-02081899120',
    name: '广州市心理援助热线',
    number: '020-81899120',
    hours: '以接线方公告为准',
    region: '广州',
    audience: '所有人',
    description: '广州市心理援助热线，由本地精神卫生专业机构承接。',
    verifiedAt: V,
  },
  {
    id: 'sz-075525629459',
    name: '深圳市心理援助热线',
    number: '0755-25629459',
    hours: '以接线方公告为准',
    region: '深圳',
    audience: '所有人',
    description: '深圳市心理援助热线，由本地精神卫生相关机构承接。',
    verifiedAt: V,
  },
  {
    id: 'emergency-120',
    name: '急救电话 120',
    number: '120',
    hours: '24 小时',
    region: '全国',
    audience: '已经伤害了自己、服药过量、身体出现危险状况',
    description:
      '只要身体已经有危险（出血、服药、意识不清），请先打 120 或直接去最近的急诊——这比找心理咨询更快。',
    verifiedAt: V,
  },
  {
    id: 'emergency-110',
    name: '报警电话 110',
    number: '110',
    hours: '24 小时',
    region: '全国',
    audience: '正在遭遇暴力、被跟踪、无法保证自身安全',
    description:
      '正在被伤害、被限制人身自由，或担心自己马上会做危险的事，都可以打 110，警方可以到场处置。',
    verifiedAt: V,
  },
  {
    id: 'emergency-119',
    name: '消防救援 119',
    number: '119',
    hours: '24 小时',
    region: '全国',
    audience: '火灾、被困、需要紧急救援',
    description: '火灾、被困高处或其他需要紧急救援的情况，请立即拨打 119。',
    verifiedAt: V,
  },
  {
    id: 'acwf-12338',
    name: '全国妇联维权服务热线',
    number: '12338',
    hours: '以接线方公告为准（多为工作日工作时段）',
    region: '全国',
    audience: '遭遇家庭暴力、性别暴力、婚姻家庭权益受损的人',
    description:
      '妇联系统维权服务热线，可提供法律咨询、心理支持与转介。如需立即制止暴力，请优先拨 110。',
    verifiedAt: V,
  },
  {
    id: 'youth-12355',
    name: '12355 青少年服务台',
    number: '12355',
    hours: '各地服务时间不同，以接线方公告为准',
    region: '全国（各地分设）',
    audience: '青少年及其家长',
    description:
      '共青团系统青少年服务台，提供心理疏导、法律咨询与成长支持。各地接听时间与专长方向不完全相同。',
    verifiedAt: V,
  },
];

/**
 * 「最紧急、最该优先展示」的前 3 条（首页安全兜底入口会用）。
 * 只挑心理危机干预热线；120 / 110 属于紧急救助，单独成组、不占这 3 个名额。
 */
const PRIMARY_IDS = ['cn-12356', 'bj-crisis-010', 'hope24-400'] as const;

export function getPrimaryHelplines(): Helpline[] {
  return PRIMARY_IDS.map((id) => HELPLINES.find((h) => h.id === id)).filter(
    (h): h is Helpline => Boolean(h),
  );
}

/** 把号码转成 tel: 链接，去掉空格、括号与连字符 */
export function telHref(number: string): string {
  const cleaned = number.replace(/[^\d+]/g, '');
  return `tel:${cleaned}`;
}
