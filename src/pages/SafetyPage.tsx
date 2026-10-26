import { useMemo, useState } from 'react';
import { PageHeader, SectionHead } from '@/components/ui/Card';
import { Notice } from '@/components/ui/Primitives';
import { ButtonLink } from '@/components/ui/Button';
import { cx } from '@/lib/utils';
import { HelplineCard } from '@/resources/HelplineCard';
import {
  HELPLINE_DATA_COLLECTED_AT,
  HELPLINES,
  getPrimaryHelplines,
  telHref,
} from '@/resources/helplines';
import type { Helpline } from '@/resources/helplines';
import '@/styles/resources.css';

/* -------------------------------------------------------------------------- */
/*                                   静态内容                                  */
/* -------------------------------------------------------------------------- */

const EMERGENCY_IDS = ['emergency-120', 'emergency-110', 'emergency-119'];

/** 按「现在拨出去大概能接通」排序：优先热线 → 紧急救助 → 其他 24 小时 → 其余 */
function sortByReachability(list: Helpline[]): Helpline[] {
  const primaryIds = getPrimaryHelplines().map((h) => h.id);
  const weight = (h: Helpline): number => {
    const primaryIndex = primaryIds.indexOf(h.id);
    if (primaryIndex >= 0) return primaryIndex; // 0,1,2
    if (EMERGENCY_IDS.includes(h.id)) return 10 + EMERGENCY_IDS.indexOf(h.id);
    if (h.hours.includes('24')) return 30;
    return 40;
  };
  return [...list].sort((a, b) => weight(a) - weight(b));
}

interface Scenario {
  id: string;
  icon: string;
  title: string;
  lead: string;
  steps: string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'self-harm',
    icon: '◍',
    title: '我正想伤害自己',
    lead: '现在最要紧的不是想清楚为什么，而是先把这段时间熬过去。',
    steps: [
      '把身边能伤害自己的东西挪远一点，或者离开现在这个房间，换一个有人经过的地方。',
      '拨 12356 或 010-82951332。接通后只说一句「我现在有伤害自己的念头，能不能陪我说会儿话」就够了，不需要解释前因后果。',
      '如果已经动手了（吃了药、有伤口、意识发飘），先拨 120 或去最近的急诊，这比任何心理热线都优先。',
      '告诉一个具体的人：「我现在情况不好，你能过来 / 能一直跟我说话吗？」说清楚你要他做什么。',
      '把「再撑 10 分钟」当作目标，做完这 10 分钟再决定下一件事。危机里的念头是一波一波的。',
    ],
  },
  {
    id: 'panic',
    icon: '≈',
    title: '惊恐发作，喘不上气',
    lead: '这种感觉非常难受，但通常不会真的造成危险，一般十几分钟到半小时会自己退下去。',
    steps: [
      '先找个能靠住的地方坐下或蹲下，把背贴住墙，让身体先有支撑。',
      '把呼气拉长：吸气 4 拍、呼气 6~8 拍。重点是呼气比吸气长，不用刻意吸很深。',
      '说出眼前看到的三样东西、手能摸到的两样东西，把注意力放回外部。',
      '告诉自己：「这是惊恐反应，它会有峰值，也会退。我不会一直这样。」',
      '如果第一次发生、或伴随胸口剧痛 / 说不出话 / 一侧无力，请按身体急症处理，拨 120。',
    ],
  },
  {
    id: 'violence',
    icon: '◭',
    title: '我正遭遇暴力或威胁',
    lead: '先保证身体安全，再处理情绪和后续。安全优先于一切道理。',
    steps: [
      '正在被打、被威胁、被限制自由 —— 直接拨 110。不要先想着「是不是我也有错」。',
      '如果能安全离开，去有人的地方：邻居家、便利店、派出所、医院。带上手机和证件。',
      '把证据留住：伤处拍照（含日期）、聊天记录、录音（注意当地取证规定）、就诊记录。',
      '拨 12338 妇联维权热线，咨询庇护、法律援助与报警后的流程（多为工作日时段）。',
      '孩子在场时，先把孩子带到安全处，再处理你自己的事。',
    ],
  },
  {
    id: 'loss',
    icon: '○',
    title: '我失去了重要的人',
    lead: '哀伤不是需要被治好的病。它会反复，会在你以为好了的某天突然回来。',
    steps: [
      '允许自己吃不下、睡不着、什么也做不了。这是哀伤的正常反应，不是软弱。',
      '不需要向任何人证明「我已经走出来了」。每个人恢复的节奏不同，没有时间表。',
      '找一个愿意只是听、不急着劝你的人。如果身边没有，拨 12356，跟陌生人说也可以。',
      '把想对他说的话写下来、说出来，哪怕只是对着空房间说。',
      '如果超过一年仍然无法进行日常生活，或出现「想跟ta一起走」的念头，请联系专业帮助。',
    ],
  },
  {
    id: 'hard',
    icon: '·',
    title: '只是很难受，说不清为什么',
    lead: '不需要达到「有资格求助」的标准才能求助。难受本身就够了。',
    steps: [
      '先做一件最小的、让身体舒服一点的事：喝口热水、洗脸、躺平十分钟、出门走一圈。',
      '写下此刻脑子里最响的那句话，不用通顺，不用有理。写出来往往就没有那么压人了。',
      '情绪工具箱里有呼吸、着陆、思维记录等练习，可以现在就做一次。',
      '给一个你信得过的人发消息，不用讲清楚，只说「我最近不太好」。',
      '如果这种状态持续两周以上，影响到吃饭睡觉和工作，去精神心理科或心理门诊做一次评估。',
    ],
  },
];

interface TodoItem {
  id: string;
  text: string;
  hint: string;
}

const FIVE_THINGS: TodoItem[] = [
  {
    id: 't1',
    text: '把危险的东西从身边移开',
    hint: '药、刀、绳子……先交给别人保管，或者锁起来。这个动作比你想的更有用。',
  },
  {
    id: 't2',
    text: '给一个人发一条消息',
    hint: '不用打长篇。发「你现在方便吗，我状态不太好」就行——你不需要一个人扛。',
  },
  {
    id: 't3',
    text: '拨一条热线，让声音陪着你',
    hint: '12356 / 010-82951332 / 400-161-9995，都在上面。不知道说什么，就说「我不知道该说什么」。',
  },
  {
    id: 't4',
    text: '离开现在这个空间',
    hint: '换到有光、有人的地方。身体换了位置，念头常常也会松一点。',
  },
  {
    id: 't5',
    text: '把「撑过今晚」当作唯一目标',
    hint: '别去想下周、明年。危机里只需要处理眼前这一小时。',
  },
];

const SCRIPTS: Array<{ text: string; note: string }> = [
  {
    text: '我现在状态很不好，有伤害自己的念头。你能过来陪我一会儿吗？或者我们一直通着电话也行。',
    note: '发给朋友/家人。把「你要他做什么」说清楚，比只说「我很难受」更容易被接住。',
  },
  {
    text: '我最近持续两周多情绪很低，影响到睡觉和工作了。我想做一个评估，请问应该挂哪个科、怎么预约？',
    note: '打给医院总机或社区医院。这样说，对方通常能直接告诉你挂哪个门诊。',
  },
  {
    text: '我现在有伤害自己的念头，能不能陪我说会儿话？我不需要建议，只是想有人在。',
    note: '打给热线。热线不是咨询，你可以只要求「听着」，这是完全合理的请求。',
  },
];

/* -------------------------------------------------------------------------- */
/*                                    页面                                     */
/* -------------------------------------------------------------------------- */

export default function SafetyPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const { primary, emergency, rest } = useMemo(() => {
    const sorted = sortByReachability(HELPLINES);
    const primaryList = sorted.filter((h) => h.id === 'cn-12356' || h.id === 'bj-crisis-010' || h.id === 'hope24-400');
    const emergencyList = sorted.filter((h) => EMERGENCY_IDS.includes(h.id));
    const restList = sorted.filter(
      (h) => !primaryList.includes(h) && !emergencyList.includes(h),
    );
    return { primary: primaryList, emergency: emergencyList, rest: restList };
  }, []);

  const doneCount = FIVE_THINGS.filter((t) => checked[t.id]).length;

  const toggle = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="page safety-page">
      <PageHeader
        eyebrow="Safety First"
        title="危机与求助"
        subtitle="这一页放在最前面，因为它比站内其他任何内容都重要。"
      />

      {/* ------------------------------- 首屏 ------------------------------- */}
      <section className="safety-hero fade-up" aria-labelledby="safety-hero-title">
        <h2 className="safety-hero__title" id="safety-hero-title">
          如果你现在有伤害自己的念头，
          <br />
          请先停下来，联系下面任意一条线。
        </h2>
        <p className="safety-hero__sub">
          你不需要先证明自己「够严重」，也不需要先想明白发生了什么。
          打通电话、说一句「我现在很不好」，就已经是在救自己了。
        </p>

        <div className="safety-quickdial">
          {getPrimaryHelplines().map((h) => (
            <a
              key={h.id}
              className="quickdial"
              href={telHref(h.number)}
              aria-label={`拨打 ${h.name}：${h.number}`}
            >
              <span className="quickdial__label">{h.name}</span>
              <span className="quickdial__number">{h.number}</span>
            </a>
          ))}
        </div>

        <div className="safety-hero__actions">
          <a className="btn btn--lg" href="#five-things">
            我现在能做的 5 件事
          </a>
          <a className="btn btn--ghost btn--lg" href="#helplines">
            查看全部热线
          </a>
          <ButtonLink to="/toolbox" variant="quiet" size="lg">
            先做一次呼吸练习
          </ButtonLink>
        </div>
      </section>

      <nav className="safety-index" aria-label="本页目录">
        <a className="tag tag--outline" href="#helplines">
          全部热线
        </a>
        <a className="tag tag--outline" href="#scenarios">
          按情况查找
        </a>
        <a className="tag tag--outline" href="#five-things">
          现在能做的 5 件事
        </a>
        <a className="tag tag--outline" href="#scripts">
          怎么开口求助
        </a>
        <a className="tag tag--outline" href="#limits">
          本页能做什么、不能做什么
        </a>
      </nav>

      <Notice tone="alert" title="如果身体已经有危险，请先打 120">
        出血、服药过量、意识不清、胸口剧痛 —— 这些是医学急症，请直接拨 120
        或去最近的急诊。心理热线不能替代急救。
      </Notice>

      {/* ------------------------------ 全部热线 ----------------------------- */}
      <section className="res-section" id="helplines" aria-labelledby="helplines-title">
        <SectionHead
          title={<span id="helplines-title">心理危机热线（优先拨打）</span>}
          desc="按「现在拨出去大概能接通」排序。号码与接听时间均可能变更，请以接线方公告为准。"
        />
        <div className="helplines">
          {primary.map((h) => (
            <HelplineCard key={h.id} helpline={h} variant="primary" />
          ))}
        </div>

        <div className="mt-5">
          <SectionHead
            title="紧急救助"
            desc="身体安全受威胁时，这几条比心理热线更优先。"
          />
          <div className="helplines">
            {emergency.map((h) => (
              <HelplineCard key={h.id} helpline={h} variant="emergency" />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <SectionHead
            title="地区与专项热线"
            desc="地方热线与专项服务，接听时段各不相同，请留意标注。"
          />
          <div className="helplines">
            {rest.map((h) => (
              <HelplineCard key={h.id} helpline={h} />
            ))}
          </div>
        </div>

        <p className="res-verify-note">
          本页热线资料整理于 {HELPLINE_DATA_COLLECTED_AT}。热线号码、承接机构与接听时间都会变更，
          我们无法实时核对。如果你拨打的号码已停用，请改拨 12356 或 120。
        </p>
      </section>

      {/* ------------------------------ 分场景 ------------------------------ */}
      <section className="res-section" id="scenarios" aria-labelledby="scenarios-title">
        <SectionHead
          title={<span id="scenarios-title">按现在的情况找</span>}
          desc="每一种情况下面都写了具体动作，不只是「去求助」。"
        />
        <div className="scenarios">
          {SCENARIOS.map((s) => (
            <article className="scenario" key={s.id}>
              <div className="scenario__head">
                <span className="scenario__icon" aria-hidden>
                  {s.icon}
                </span>
                <h3 className="scenario__title">{s.title}</h3>
              </div>
              <p className="helpline__desc mb-3">{s.lead}</p>
              <ul className="scenario__list">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* --------------------------- 现在能做的 5 件事 -------------------------- */}
      <section className="res-section" id="five-things" aria-labelledby="five-title">
        <SectionHead
          title={<span id="five-title">现在可以做的 5 件事</span>}
          desc={
            doneCount === 0
              ? '不用按顺序。挑一件此刻最不费力的开始，点一下打勾。'
              : `已经做了 ${doneCount} / ${FIVE_THINGS.length} 件。做完一件就已经不一样了。`
          }
          action={
            doneCount > 0 ? (
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => setChecked({})}
              >
                清空勾选
              </button>
            ) : undefined
          }
        />
        <div className="checklist">
          {FIVE_THINGS.map((item) => {
            const done = Boolean(checked[item.id]);
            return (
              <button
                type="button"
                key={item.id}
                className={cx('checklist__item', done && 'checklist__item--done')}
                onClick={() => toggle(item.id)}
                aria-pressed={done}
              >
                <span className="checklist__box" aria-hidden>
                  ✓
                </span>
                <span className="checklist__text">
                  {item.text}
                  <small>{item.hint}</small>
                </span>
              </button>
            );
          })}
        </div>
        <p className="small muted mt-3">
          勾选状态只存在这个页面里，刷新就会清空，也不会记录任何内容。
        </p>
      </section>

      {/* ------------------------------ 求助话术 ----------------------------- */}
      <section className="res-section" id="scripts" aria-labelledby="scripts-title">
        <SectionHead
          title={<span id="scripts-title">不知道怎么开口？这几句可以直接照念</span>}
          desc="危机里组织语言很难。选一句，照着说或照抄发出去都可以。"
        />
        <div className="scripts">
          {SCRIPTS.map((s, i) => (
            <div className="script" key={s.text}>
              <p className="script__text">{s.text}</p>
              <p className="script__note">
                第 {i + 1} 句 · {s.note}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ 边界声明 ----------------------------- */}
      <section id="limits">
        <div className="safety-disclaimer">
          <p>
            <strong>本站不是危机干预服务，也不提供实时响应。</strong>
            心屿是一个纯本地的自助工具站点：没有客服、没有值班人员、没有任何人能看到你在这里的操作。
            你在这里写下的内容不会离开你的浏览器，我们也不可能主动联系你。
          </p>
          <p className="mt-3">
            因此，如果你正处在危险中，<strong>不要等待本站的任何回应</strong>，请直接拨
            12356 / 010-82951332 / 400-161-9995，或 120 / 110。
          </p>
          <p className="mt-3">
            这一页能做的，是把可能帮到你的号码和步骤放在一起，让你在最慌的时候不用再搜索一遍。
            它不能替代专业帮助，也不构成任何诊断或治疗建议。
          </p>
        </div>
        <div className="btn-group mt-4">
          <ButtonLink to="/resources" variant="ghost">
            去看更多心理资源
          </ButtonLink>
          <ButtonLink to="/about" variant="quiet">
            了解本站的边界
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
