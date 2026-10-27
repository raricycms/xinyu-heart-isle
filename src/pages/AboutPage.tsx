import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, PageHeader, SectionHead } from '@/components/ui/Card';
import { Notice, Tag } from '@/components/ui/Primitives';
import { useI18n } from '@/i18n';
import '@/styles/home.css';

const PRINCIPLES = [
  {
    title: '不做诊断',
    body: '心屿里的所有量表都是自评工具，分数只代表「你最近这些天的自评状态」，不能用来判断你有没有某种障碍。诊断需要专业人员结合访谈、病史和多方信息来判断。',
  },
  {
    title: '不替代专业帮助',
    body: '这里的工具适合自我觉察、情绪急救和日常练习。如果你的困扰持续超过两周、影响到工作学习或人际关系，请把专业帮助放在优先位置。',
  },
  {
    title: '数据不出设备',
    body: '没有账号系统，没有后端服务器，没有埋点统计。你写的每一个字都只保存在当前浏览器的 localStorage 里，我们也看不到。',
  },
  {
    title: '不制造焦虑',
    body: '不使用红色警示轰炸、不推送「你可能得了什么病」、不做病耻感营销。量表结果用中性的语言描述区间，并始终给出可执行的下一步。',
  },
];

export default function AboutPage() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="page">
      <PageHeader
        eyebrow="About & Boundaries"
        title="关于心屿，和它的边界"
        subtitle="一个由「想帮点忙」出发的小工具站。说清楚它不能做什么，比强调它能做什么更重要。"
      />

      <section className="grid grid--2 mb-5">
        {PRINCIPLES.map((p) => (
          <Card key={p.title}>
            <h2 className="card-title">{p.title}</h2>
            <p className="card-desc mt-2" style={{ lineHeight: 1.85 }}>
              {p.body}
            </p>
          </Card>
        ))}
      </section>

      <section className="grid grid--2 mb-5">
        <Card flat>
          <SectionHead title="这个站点包含什么" />
          <div className="prose" style={{ fontSize: 13.5 }}>
            <ul>
              <li>
                <strong>心理量表</strong>：PHQ-9、GAD-7、PSS-10、ISI、RSES 五份常用自评工具，
                带计分、分级与可执行建议。
              </li>
              <li>
                <strong>赛博沙盘</strong>：用象征物摆出内在状态，支持保存与回看，
                适合「说不清楚但很难受」的时候。
              </li>
              <li>
                <strong>情绪工具箱</strong>：呼吸引导、着陆练习、身体扫描、思维记录、
                担忧时间、三件好事等 7 个练习。
              </li>
              <li>
                <strong>资源地图</strong>：危机热线、专业机构、权威科普与自助手册的汇总。
              </li>
              <li>
                <strong>我的记录</strong>：心情签到、作答历史与笔记时间线，可导出 JSON 备份。
              </li>
            </ul>
          </div>
        </Card>

        <Card flat>
          <SectionHead title="技术说明" />
          <div className="prose" style={{ fontSize: 13.5 }}>
            <ul>
              <li>前端：Vite + React + TypeScript，纯静态，无后端、无数据库。</li>
              <li>存储：浏览器 localStorage，可通过「我的记录」页导出 / 导入 JSON。</li>
              <li>没有第三方分析、没有广告、没有 Cookie 追踪。</li>
              <li>
                清空浏览器数据会同时清空记录；换设备不会自动同步，需要用导出 / 导入手动迁移。
              </li>
              <li>本站代码可自行部署在任意静态托管上，一次构建即可长期使用。</li>
            </ul>
            <div className="row wrap mt-3" style={{ gap: 6 }}>
              <Tag tone="teal">无后端</Tag>
              <Tag>localStorage</Tag>
              <Tag>MIT 风格可自托管</Tag>
              <Tag>响应式</Tag>
            </div>
          </div>
        </Card>
      </section>

      {/* ---- 语言 ---- */}
      {/*
        这个开关的来历：`Preferences.locale` 凑齐了字段、默认值、两套
        i18n 字典（中英各 195 键）、18 个组件接入 `useI18n()` —— 但
        `setLocale()` **零处调用**，所以 `en.ts` 在运行时完全不可达，
        用户永远只能看中文。又是「有读没写」，只是藏在 hook 返回值里。

        i18n 的真实范围按包内注释就是「沙盘模块」，其余页面仍是中文，
        这一点在下方说明了 —— 与其假装全站双语，不如把边界摊开。
      */}
      <SectionHead title="语言 / Language" />
      <Card flat className="mb-5">
        <div className="prose" style={{ fontSize: 13.5 }}>
          <p>
            <strong>沙盘模块</strong>已提供中英双语（含工具名、面板、会话报告、
            回放与对比页）。其余页面目前只有中文。
          </p>
          <p className="muted">
            The sandtray module is available in Chinese and English. Other
            sections are Chinese-only for now.
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button
              size="sm"
              variant={locale === 'zh-CN' ? 'primary' : 'quiet'}
              aria-pressed={locale === 'zh-CN'}
              onClick={() => setLocale('zh-CN')}
              data-testid="locale-zh"
            >
              中文
            </Button>
            <Button
              size="sm"
              variant={locale === 'en' ? 'primary' : 'quiet'}
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
              data-testid="locale-en"
            >
              English
            </Button>
          </div>
        </div>
      </Card>

      <SectionHead title="内容和数据的可信度" />
      <div className="stack mb-5">
        <Notice tone="watch" title="量表的中文版本与计分说明">
          本站量表题干与分级基于公开发表的常用版本整理，仅用于自评参考。不同版本的中文措辞、
          计分方式与临界值可能略有差异，学术或临床用途请以原始文献与授权版本为准。
        </Notice>
        <Notice tone="watch" title="热线与资源链接需要核验">
          危机热线号码与机构链接会随时间变动。资源页中每一条都标注了「核验日期」，
          上线或长期运营时应当定期复查。如果你发现某条信息失效，请以官方渠道公布的号码为准。
        </Notice>
        <Notice tone="plain" title="如果你要把它做成正式产品">
          建议补充：专业顾问审核量表与文案、危机干预流程 SOP、内容更新机制、
          隐私政策与免责声明的正式版本、以及（如果未来加入后端）数据合规评估。
        </Notice>
      </div>

      <section className="safety-band">
        <p className="safety-band__text">
          心屿不是危机干预服务，也无法提供实时响应。
          <br />
          如果你现在处于危险之中，请立即联系专业援助。
        </p>
        <ButtonLink to="/safety" variant="danger" size="sm">
          危机与求助
        </ButtonLink>
      </section>
    </div>
  );
}
