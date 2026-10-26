/**
 * 心屿 · 心理资源汇总（资源地图数据）
 *
 * ============================================================================
 * ⚠️  上线前必须逐个核验  ⚠️
 * ============================================================================
 * 本文件收录的资源入口均为「机构官网 / 官方专题页」，但域名、具体路径与是否
 * 仍可访问都会变化（机构改名、站点改版、境外站点被网络策略拦截等）。
 * 上线前请逐个点开确认可访问，并确认条目描述与页面现状一致。
 *
 * 数据诚信约定：
 *   - 只写能够确认的官方入口域名，不写搜索结果页、不写短链、不写带跟踪参数的链接；
 *   - 无法确认官方入口的条目（例如仅在微信公众号/小程序内运营的服务、
 *     需要购买的书籍），`url` 留空字符串，页面会显示「未提供外链」，
 *     而**不会**伪造一个链接凑数；
 *   - 书籍条目的 `free` 为 false，`url` 为空，只给出书名/作者/一句话，
 *     请读者自行在书店、图书馆或正规电子书平台检索。
 * ============================================================================
 */

/** 资料整理日期（非人工点开核验的日期） */
export const RESOURCE_DATA_COLLECTED_AT = '2026-10-26';

export interface ResourceItem {
  id: string;
  title: string;
  org: string;
  category: string;
  description: string;
  /** 官方入口；无法确认时为空字符串，页面不渲染链接 */
  url: string;
  lang: 'zh' | 'en';
  free: boolean;
  tags: string[];
}

/** 6 个分类，顺序与资源页展示顺序一致 */
export const RESOURCE_CATEGORIES: string[] = [
  '自助与科普',
  '专业机构与医院',
  '国际权威科普',
  '危机干预',
  '自助工具与练习册',
  '书籍与播客',
];

/** 每个分类的简短导语：说明「这类资源适合什么情况」 */
export const RESOURCE_CATEGORY_INTROS: Record<string, string> = {
  自助与科普: '还没有到要看医生、但想先弄明白自己怎么了的时候，从这里开始读。',
  专业机构与医院: '当困扰持续两周以上、影响到吃饭睡觉和工作学习，值得去找专业评估。',
  国际权威科普: '想看有出处的、系统性的说明，而不是碎片化的经验帖。英文站点，可用浏览器翻译。',
  危机干预: '当出现伤害自己的念头，或身边有人正处在危险里——这些是 24 小时的国际资源。',
  自助工具与练习册: '想自己动手做点练习（认知行为、情绪记录、暴露练习），这些是免费可下载的材料。',
  书籍与播客: '比起刷手机，一本能反复翻的书更适合慢慢读。以下均可在中文渠道获得。',
};

export const RESOURCES: ResourceItem[] = [
  /* -------------------------------- 自助与科普 ------------------------------- */
  {
    id: 'res-jiandanxinli',
    title: '简单心理',
    org: '简单心理',
    category: '自助与科普',
    description: '中文心理咨询与科普平台，有心理百科、专栏文章，也可检索心理咨询师（付费服务）。',
    url: 'https://www.jiandanxinli.com/',
    lang: 'zh',
    free: true,
    tags: ['科普', '心理咨询', '中文'],
  },
  {
    id: 'res-xinli001',
    title: '壹心理',
    org: '壹心理',
    category: '自助与科普',
    description: '中文心理内容平台，含情绪、亲密关系、亲子等主题的科普文章与免费测试。',
    url: 'https://www.xinli001.com/',
    lang: 'zh',
    free: true,
    tags: ['科普', '情绪', '中文'],
  },
  {
    id: 'res-knowyourself',
    title: 'KnowYourself',
    org: 'KnowYourself',
    category: '自助与科普',
    description:
      '以心理学视角写日常困扰的科普团队，擅长把关系、自我、情绪讲清楚。内容主要在微信公众号发布，本站未能确认其官方网址，故不提供外链。',
    url: '',
    lang: 'zh',
    free: true,
    tags: ['科普', '自我成长', '关系'],
  },
  {
    id: 'res-pauselab',
    title: '暂停实验室',
    org: '暂停实验室',
    category: '自助与科普',
    description:
      '以「情绪减压营」等结构化练习为主的心理自助项目，主打每天十几分钟的正念与书写练习（付费项目，有免费体验内容）。官方主要在微信公众号内运营，本站不提供外链。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['正念', '练习', '付费'],
  },
  {
    id: 'res-psych-cas',
    title: '中国科学院心理研究所',
    org: '中国科学院心理研究所',
    category: '自助与科普',
    description: '国内心理学研究的权威机构，网站有科普文章与心理学知识栏目，适合想了解研究结论的人。',
    url: 'https://psych.ac.cn/',
    lang: 'zh',
    free: true,
    tags: ['科研机构', '科普', '中文'],
  },
  {
    id: 'res-ncmhc',
    title: '国家心理健康和精神卫生防治中心',
    org: '国家心理健康和精神卫生防治中心',
    category: '自助与科普',
    description: '国家层面的心理健康与精神卫生技术支撑机构，会发布心理健康科普与政策解读。',
    url: 'https://www.ncmhc.org.cn/',
    lang: 'zh',
    free: true,
    tags: ['权威', '政策', '科普'],
  },
  {
    id: 'res-nhc',
    title: '国家卫生健康委员会',
    org: '国家卫生健康委员会',
    category: '自助与科普',
    description: '卫生政策与权威健康信息的发布口，可查心理健康相关文件与健康科普。',
    url: 'https://www.nhc.gov.cn/',
    lang: 'zh',
    free: true,
    tags: ['权威', '政策', '中文'],
  },

  /* ------------------------------ 专业机构与医院 ------------------------------ */
  {
    id: 'res-pkuh6',
    title: '北京大学第六医院',
    org: '北京大学第六医院（北京大学精神卫生研究所）',
    category: '专业机构与医院',
    description: '国内精神医学与心理治疗的权威机构之一，提供门诊、住院与心理治疗服务，官网可查就诊指南。',
    url: 'https://www.pkuh6.cn/',
    lang: 'zh',
    free: false,
    tags: ['三甲', '精神科', '北京'],
  },
  {
    id: 'res-smhc',
    title: '上海市精神卫生中心',
    org: '上海市精神卫生中心',
    category: '专业机构与医院',
    description: '上海的精神专科三甲医院，官网有门诊安排、科普文章与心理服务介绍。',
    url: 'https://www.smhc.org.cn/',
    lang: 'zh',
    free: false,
    tags: ['三甲', '精神科', '上海'],
  },
  {
    id: 'res-bjad',
    title: '北京安定医院',
    org: '首都医科大学附属北京安定医院',
    category: '专业机构与医院',
    description: '北京的精神专科三甲医院，设有心理门诊与危机干预相关服务，官网可查预约方式。',
    url: 'https://www.bjad.com.cn/',
    lang: 'zh',
    free: false,
    tags: ['三甲', '精神科', '北京'],
  },
  {
    id: 'res-bhlgh',
    title: '北京回龙观医院',
    org: '北京回龙观医院',
    category: '专业机构与医院',
    description: '北京的大型精神专科医院，设有心理危机干预研究与相关门诊，官网可查就诊信息。',
    url: 'https://www.bhlgh.com/',
    lang: 'zh',
    free: false,
    tags: ['三甲', '精神科', '危机干预', '北京'],
  },
  {
    id: 'res-wchscu',
    title: '四川大学华西医院心理卫生中心',
    org: '四川大学华西医院',
    category: '专业机构与医院',
    description: '西南地区的精神心理专科力量，官网可查心理卫生中心门诊与预约信息。',
    url: 'https://www.wchscu.cn/',
    lang: 'zh',
    free: false,
    tags: ['三甲', '精神科', '成都'],
  },
  {
    id: 'res-cps',
    title: '中国心理学会',
    org: '中国心理学会',
    category: '专业机构与医院',
    description: '国内心理学学术团体，网站有学会动态、分支机构与学术会议信息，可用于判断一个心理服务的专业背景。',
    url: 'https://www.cpsbeijing.org/',
    lang: 'zh',
    free: true,
    tags: ['学术机构', '专业资质', '中文'],
  },

  /* ------------------------------- 国际权威科普 ------------------------------ */
  {
    id: 'res-who-mh',
    title: 'WHO · Mental health',
    org: 'World Health Organization',
    category: '国际权威科普',
    description: '世界卫生组织的心理健康主题页，含各类障碍的概况、事实清单与全球数据。',
    url: 'https://www.who.int/health-topics/mental-health',
    lang: 'en',
    free: true,
    tags: ['权威', '英文', '科普'],
  },
  {
    id: 'res-who-mh-zh',
    title: 'WHO · 心理健康（中文）',
    org: 'World Health Organization',
    category: '国际权威科普',
    description: '同上主题页的中文版本，适合不想读英文的人。',
    url: 'https://www.who.int/zh/health-topics/mental-health',
    lang: 'zh',
    free: true,
    tags: ['权威', '中文', '科普'],
  },
  {
    id: 'res-nimh',
    title: 'NIMH · Health Topics',
    org: 'National Institute of Mental Health (US)',
    category: '国际权威科普',
    description: '美国国立精神卫生研究所的健康主题库，按疾病分类给出症状、治疗与求助路径，写得克制清楚。',
    url: 'https://www.nimh.nih.gov/health',
    lang: 'en',
    free: true,
    tags: ['权威', '英文', '科普'],
  },
  {
    id: 'res-apa',
    title: 'APA · Psychology Topics',
    org: 'American Psychological Association',
    category: '国际权威科普',
    description: '美国心理学会的主题文章库，覆盖抑郁、焦虑、创伤、睡眠等日常议题。',
    url: 'https://www.apa.org/topics',
    lang: 'en',
    free: true,
    tags: ['权威', '英文', '科普'],
  },
  {
    id: 'res-mind-uk',
    title: 'Mind (UK)',
    org: 'Mind',
    category: '国际权威科普',
    description: '英国心理健康慈善机构，信息页把「这是什么感觉 / 能做什么 / 怎么求助」拆得很细，非常好读。',
    url: 'https://www.mind.org.uk/',
    lang: 'en',
    free: true,
    tags: ['慈善机构', '英文', '自助'],
  },
  {
    id: 'res-nhs-mh',
    title: 'NHS · Mental health',
    org: 'National Health Service (UK)',
    category: '国际权威科普',
    description: '英国国家医疗服务体系的心理健康栏目，含自助建议、症状说明与就医路径。',
    url: 'https://www.nhs.uk/mental-health/',
    lang: 'en',
    free: true,
    tags: ['公共卫生', '英文', '自助'],
  },
  {
    id: 'res-nami',
    title: 'NAMI',
    org: 'National Alliance on Mental Illness',
    category: '国际权威科普',
    description: '美国最大的精神疾病互助组织，除科普外还有家属指南与同伴支持资源。',
    url: 'https://www.nami.org/',
    lang: 'en',
    free: true,
    tags: ['互助', '家属', '英文'],
  },

  /* -------------------------------- 危机干预 -------------------------------- */
  {
    id: 'res-samaritans',
    title: 'Samaritans',
    org: 'Samaritans (UK & Ireland)',
    category: '危机干预',
    description: '英国与爱尔兰的 24 小时情绪支持热线与邮件支持，不评判、不劝说，只是听你说。',
    url: 'https://www.samaritans.org/',
    lang: 'en',
    free: true,
    tags: ['24小时', '英文', '危机支持'],
  },
  {
    id: 'res-iasp',
    title: 'IASP',
    org: 'International Association for Suicide Prevention',
    category: '危机干预',
    description: '国际自杀预防协会，提供自杀预防资源、世界预防自杀日信息与各国危机热线名录。',
    url: 'https://www.iasp.info/',
    lang: 'en',
    free: true,
    tags: ['预防', '国际组织', '英文'],
  },
  {
    id: 'res-befrienders',
    title: 'Befrienders Worldwide',
    org: 'Befrienders Worldwide',
    category: '危机干预',
    description: '全球情绪支持组织网络，可按国家检索当地的热线或面谈支持点。',
    url: 'https://befrienders.org/',
    lang: 'en',
    free: true,
    tags: ['热线名录', '国际', '英文'],
  },
  {
    id: 'res-crisistextline',
    title: 'Crisis Text Line',
    org: 'Crisis Text Line',
    category: '危机干预',
    description: '美国等地区的短信危机支持服务：不方便打电话时，可以发短信把当下的事说出来。',
    url: 'https://www.crisistextline.org/',
    lang: 'en',
    free: true,
    tags: ['短信', '英文', '危机支持'],
  },
  {
    id: 'res-988',
    title: '988 Suicide & Crisis Lifeline',
    org: '988 Lifeline (US)',
    category: '危机干预',
    description: '美国全国性的 988 自杀与危机生命线（电话/短信/在线聊天）。注意：非中国境内号码。',
    url: 'https://988lifeline.org/',
    lang: 'en',
    free: true,
    tags: ['24小时', '美国', '英文'],
  },
  {
    id: 'res-sbhk',
    title: '香港撒玛利亚防止自杀会',
    org: 'The Samaritan Befrienders Hong Kong',
    category: '危机干预',
    description: '香港的防止自杀服务机构，提供 24 小时情绪支援热线与辅导服务。',
    url: 'https://www.sbhk.org.hk/',
    lang: 'zh',
    free: true,
    tags: ['24小时', '粤语/中文', '香港'],
  },

  /* ----------------------------- 自助工具与练习册 ---------------------------- */
  {
    id: 'res-cci',
    title: 'CCI · 免费自助手册',
    org: 'Centre for Clinical Interventions (AU)',
    category: '自助工具与练习册',
    description:
      '西澳临床干预中心的免费 PDF 自助手册库，按抑郁、焦虑、社交焦虑、完美主义、睡眠等主题成套，含练习表（英文）。',
    url: 'https://www.cci.health.wa.gov.au/',
    lang: 'en',
    free: true,
    tags: ['CBT', '练习册', '免费PDF', '英文'],
  },
  {
    id: 'res-getselfhelp',
    title: 'Get Self Help',
    org: 'Get Self Help (UK)',
    category: '自助工具与练习册',
    description: '大量 CBT 自助工作表与认知模型图解，适合想弄清「想法—情绪—行为」怎么连起来的人。',
    url: 'https://www.getselfhelp.co.uk/',
    lang: 'en',
    free: true,
    tags: ['CBT', '工作表', '英文'],
  },
  {
    id: 'res-moodjuice',
    title: 'Moodjuice',
    org: 'NHS (Scotland)',
    category: '自助工具与练习册',
    description: '苏格兰 NHS 的自助指南站，把焦虑、抑郁、压力、睡眠等问题做成可自己走一遍的步骤化材料。',
    url: 'https://www.moodjuice.scot.nhs.uk/',
    lang: 'en',
    free: true,
    tags: ['自助指南', 'NHS', '英文'],
  },
  {
    id: 'res-adaa',
    title: 'ADAA · 焦虑与抑郁资源',
    org: 'Anxiety and Depression Association of America',
    category: '自助工具与练习册',
    description: '美国焦虑与抑郁协会的科普与自助资源，含筛查工具、网络讲座与治疗信息。',
    url: 'https://adaa.org/',
    lang: 'en',
    free: true,
    tags: ['焦虑', '筛查', '英文'],
  },
  {
    id: 'res-mindful',
    title: 'Mindful',
    org: 'Mindful (Foundation for Mindful Society)',
    category: '自助工具与练习册',
    description: '正念主题的杂志与练习库，有大量免费的引导冥想脚本与入门说明。',
    url: 'https://www.mindful.org/',
    lang: 'en',
    free: true,
    tags: ['正念', '冥想', '英文'],
  },

  /* -------------------------------- 书籍与播客 ------------------------------- */
  {
    id: 'book-feeling-good',
    title: '《伯恩斯新情绪疗法》',
    org: '戴维·伯恩斯（David D. Burns）',
    category: '书籍与播客',
    description: '认知行为疗法最经典的自助书之一，带完整练习表，适合情绪低落、反复自我否定时慢慢做。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['CBT', '抑郁', '练习'],
  },
  {
    id: 'book-maybe-should-talk',
    title: '《也许你该找个人聊聊》',
    org: '洛莉·戈特利布（Lori Gottlieb）',
    category: '书籍与播客',
    description: '一位心理治疗师自己去做来访者的故事，能让人先看清「心理咨询到底在做什么」。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['心理咨询', '叙事'],
  },
  {
    id: 'book-mindfulness',
    title: '《正念：此刻是一枝花》',
    org: '乔·卡巴金（Jon Kabat-Zinn）',
    category: '书籍与播客',
    description: '正念减压（MBSR）创始人的入门书，短章、好读，适合每天读两页。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['正念', '入门'],
  },
  {
    id: 'book-courage-disliked',
    title: '《被讨厌的勇气》',
    org: '岸见一郎 / 古贺史健',
    category: '书籍与播客',
    description: '用对话体讲阿德勒心理学，对「太在意别人怎么看」这件事给出另一种解释角度。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['阿德勒', '关系', '自我'],
  },
  {
    id: 'book-nvc',
    title: '《非暴力沟通》',
    org: '马歇尔·卢森堡（Marshall B. Rosenberg）',
    category: '书籍与播客',
    description: '讲怎么把「你总是……」换成「我感到……」的书，对亲密关系与家庭冲突很实用。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['沟通', '关系'],
  },
  {
    id: 'book-body-keeps-score',
    title: '《身体从未忘记》',
    org: '贝塞尔·范德考克（Bessel van der Kolk）',
    category: '书籍与播客',
    description: '关于创伤如何留在身体里的系统性综述，适合理解自己那些「说不清来源」的身体反应。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['创伤', '身体', '科普'],
  },
  {
    id: 'book-inferiority',
    title: '《自卑与超越》',
    org: '阿尔弗雷德·阿德勒（Alfred Adler）',
    category: '书籍与播客',
    description: '个体心理学经典，讨论自卑感如何形成、又如何变成向前的动力。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['经典', '自我'],
  },
  {
    id: 'book-complex-ptsd',
    title: '《不原谅也没关系》',
    org: '皮特·沃克（Pete Walker）',
    category: '书籍与播客',
    description: '关于复杂性创伤（CPTSD）与情绪闪回的自助书，明确写了「不必强迫自己原谅」。',
    url: '',
    lang: 'zh',
    free: false,
    tags: ['创伤', 'CPTSD', '自助'],
  },
];

/** 按分类取资源，顺序与 RESOURCE_CATEGORIES 一致 */
export function groupResourcesByCategory(): Array<{
  category: string;
  intro: string;
  items: ResourceItem[];
}> {
  return RESOURCE_CATEGORIES.map((category) => ({
    category,
    intro: RESOURCE_CATEGORY_INTROS[category] ?? '',
    items: RESOURCES.filter((item) => item.category === category),
  }));
}
