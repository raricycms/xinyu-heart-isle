/** 心屿 · 简体中文文案表（沙盘模块 v2.0） */
export const zhCN: Record<string, string> = {
  /* --------------------------------- 通用 --------------------------------- */
  'common.cancel': '取消',
  'common.save': '保存',
  'common.delete': '删除',
  'common.close': '关闭',
  'common.back': '返回',
  'common.loading': '加载中…',
  'common.none': '无',
  'common.undo': '撤销',
  'common.redo': '重做',

  /* ------------------------------- 沙盘工作台 ------------------------------ */
  'sandbox.save': '保存沙盘',
  'sandbox.saved': '已保存',
  'sandbox.unsaved': '有未保存的改动',
  'sandbox.lock': '封盘',
  'sandbox.locked': '已封盘',
  'sandbox.lockedHint': '封盘后不能再修改。想继续摆，可以「另存为新会话」。',
  'sandbox.newSession': '新建沙盘',
  'sandbox.confirmDiscard': '当前沙盘还没保存，确定要离开吗？',
  'sandbox.emptyTray': '沙盘还是空的。从下面挑一个放进来，或者先用手推一推沙。',
  /*
   * 年龄门（CONTRACT §7.7：`acknowledgedAge` 未通过时，沙盘页需显示监护人提示）。
   * 文案刻意不提「禁止」「不得」——不吓人、不诊断，只说明一件事：
   * 未满 18 岁建议在监护人知情的情况下使用。
   */
  'sandbox.ageGate.title': '使用前请确认',
  'sandbox.ageGate.body':
    '心屿是自我了解的辅助工具，不提供诊断或治疗。如果你未满 18 岁，建议在监护人知情的情况下使用。',
  'sandbox.ageGate.adult': '我已满 18 岁',
  'sandbox.ageGate.minor': '我未满 18 岁，会和监护人一起用',
  'sandbox.ageGate.hint': '这个选择只存在你自己的设备上，不会上传。',
  'sandbox.ageGate.minorHint': '好的。需要时可以随时回到「危机与求助」看看。',
  'sandbox.surfaceHint': '拖动笔刷在沙面上推、挖、抹。松手才算一笔。',
  'sandbox.reflectionLabel': '想说的一句话（可选）',
  'sandbox.reflectionPlaceholder': '不用写得完整，一个词也行。',
  'sandbox.titlePlaceholder': '给这个沙盘起个名字',

  /* --------------------------------- 模式 --------------------------------- */
  'sandbox.mode.self': '自己摆',
  'sandbox.mode.counselor': '咨询中使用',
  'sandbox.mode.selfHint': '私密模式：不记录接待信息，只留过程。',
  'sandbox.mode.counselorHint': '会显示阶段、时长、档案与导出入口；不会上传任何内容。',
  'sandbox.mode.supervision': '督导复盘',

  /* --------------------------------- 工具栏 -------------------------------- */
  'sandbox.tool.raise': '推沙',
  'sandbox.tool.dig': '挖沙',
  'sandbox.tool.smooth': '抹平',
  'sandbox.tool.rake': '耙纹',
  'sandbox.tool.water': '喷水',
  'sandbox.tool.tunnel': '挖洞',
  'sandbox.tool.flatten': '重新铺沙',
  'sandbox.tool.select': '摆件',
  'sandbox.tool.brushRadius': '笔刷大小',
  'sandbox.tool.strength': '力度',
  'sandbox.tool.focus': '专注模式',
  'sandbox.tool.focusHint': '隐藏工具，只留沙盘。按 Esc 退出。',

  /* -------------------------------- 摆件操作 ------------------------------- */
  'sandbox.item.bringFront': '放到最上',
  'sandbox.item.sendBack': '放到最下',
  'sandbox.item.duplicate': '复制',
  'sandbox.item.remove': '拿掉',
  'sandbox.item.note': '写一句',
  'sandbox.item.notePlaceholder': '例如：这是我妈',
  'sandbox.item.affect': '感受',
  'sandbox.item.affectHint': '只用来整理，不做任何分析。',
  'sandbox.item.bury': '埋进沙里',
  'sandbox.item.scale': '大小',
  'sandbox.item.rotate': '角度',

  /* --------------------------------- 沙具库 -------------------------------- */
  'sandbox.library': '沙具',
  'sandbox.librarySearch': '搜索（例如：树 / 蛇 / 门）',
  'sandbox.libraryEmpty': '没有找到匹配的沙具，换个词试试。',
  'sandbox.libraryAll': '全部',
  'sandbox.libraryCount': '{count} 件',
  'sandbox.favorites': '收藏',
  'sandbox.favoritesAdd': '收藏',
  'sandbox.favoritesRemove': '已收藏',
  'sandbox.favoritesEmpty': '还没有收藏。长按或右键沙具，在预览条里点「收藏」。',
  'sandbox.libraryImportPack': '导入沙具包',

  /* -------------------------------- 场景主题 ------------------------------- */
  'sandbox.scene': '场景',
  'sandbox.scene.beach': '沙滩',
  'sandbox.scene.meadow': '草地',
  'sandbox.scene.night': '夜晚',
  'sandbox.scene.room': '房间',
  'sandbox.scene.void': '虚空',

  /* -------------------------------- 阶段 ---------------------------------- */
  'sandbox.phase': '阶段',
  'sandbox.phase.intro': '开始',
  'sandbox.phase.create': '摆沙',
  'sandbox.phase.reflect': '看',
  'sandbox.phase.connect': '说',
  'sandbox.phase.record': '记',
  'sandbox.phase.dismantle': '收',

  /* --------------------------------- 引导语 -------------------------------- */
  'sandbox.prompts': '可以想一想',
  'sandbox.promptsRefresh': '换一组',
  'sandbox.promptStage.before': '开始前',
  'sandbox.promptStage.during': '摆放中',
  'sandbox.promptStage.after': '结束后',

  /* --------------------------------- 回放 --------------------------------- */
  'replay.title': '回看这次沙盘',
  'replay.subtitle': '过程比画面更重要。你可以拖动时间轴，看它怎么长成现在这样。',
  'replay.play': '播放',
  'replay.pause': '暂停',
  'replay.speed': '速度',
  'replay.timeline': '时间轴',
  'replay.eventCount': '共 {count} 步',
  'replay.jumpStart': '回到开头',
  'replay.jumpEnd': '跳到结尾',
  'replay.stats': '客观记录',
  'replay.statsDisclaimer': '以下只是数字，不代表任何评价，也不是诊断。',
  'replay.annotation': '批注',
  'replay.annotationAdd': '在这一步加批注',
  'replay.annotationPlaceholder': '咨询师/督导用；用户自己也可以写。',
  'replay.annotationEmpty': '还没有批注。',
  'replay.notFound': '找不到这次沙盘，可能已被删除。',
  'replay.noEvents': '这次沙盘没有过程记录（可能是旧版本保存的）。',

  /* --------------------------------- 统计 --------------------------------- */
  'stats.itemCount': '摆件数',
  'stats.duration': '总时长',
  'stats.eventCount': '操作次数',
  'stats.addCount': '放入次数',
  'stats.removeCount': '拿走次数',
  'stats.moveCount': '移动次数',
  'stats.noteCount': '写过注释',
  'stats.strokeCount': '整理沙面',
  'stats.firstItemAt': '第一件摆件',
  'stats.lastActionAt': '最后一次动作',
  'stats.longestPause': '最长停顿',
  'stats.sceneChanges': '换场景',
  'stats.surfaceMoved': '沙面改动比例',
  'stats.wetRatio': '湿润比例',
  'stats.zones': '九宫格分布',
  'stats.zonesHint': '只是位置分布的描述，不代表任何含义。',

  /* --------------------------------- 对比 --------------------------------- */
  'compare.title': '纵向对比',
  'compare.subtitle': '同一段时间里的几次沙盘放在一起看，变化由你自己判断。',
  'compare.selectHint': '选 2~4 次沙盘进行对比',
  'compare.selected': '已选 {count} 次',
  'compare.needTwo': '至少选两次。',
  'compare.change': '与上次相比',
  'compare.sameScene': '同一场景',
  'compare.differentScene': '换了场景',

  /* --------------------------------- 档案 --------------------------------- */
  'clients.title': '本地档案',
  'clients.subtitle': '只存在这台设备上。用化名，不填真实姓名。',
  'clients.add': '新建档案',
  'clients.alias': '化名 / 代号',
  'clients.aliasPlaceholder': '例如：小林、A2',
  'clients.note': '备注',
  'clients.notePlaceholder': '只有你自己能看到。',
  'clients.empty': '还没有档案。如果你只是自己用，不需要建档。',
  'clients.sessionCount': '{count} 次沙盘',
  'clients.lastSession': '最近一次：{date}',
  'clients.delete': '删除档案',
  'clients.archived': '已归档',
  'clients.privacy': '不要填写真实姓名、手机号、身份证号。',

  /* --------------------------------- 报告 --------------------------------- */
  'report.title': '沙盘记录单',
  'report.subtitle': '发给来访者或存入档案的一页纸。不含解读，只含事实。',
  'report.print': '打印 / 存为 PDF',
  'report.exportJson': '导出数据文件',
  'report.exportPng': '导出图片',
  'report.includeEvents': '包含过程记录',
  'report.includeSurface': '包含沙面数据',
  'report.includeThumbnail': '包含图片',
  'report.consent': '我已取得对方同意，可以导出这次记录。',
  'report.consentRequired': '导出前请先确认已取得同意。',
  'report.disclaimer': '本记录仅为过程事实，不含解释与诊断。',

  /* --------------------------------- 设置 --------------------------------- */
  'settings.renderer': '沙盘显示方式',
  'settings.renderer.dom2d': '简洁平面',
  'settings.renderer.iso2d': '立体沙盘（推荐）',
  'settings.renderer.three': '3D 视角（实验）',
  'settings.sound': '沙的声音',
  'settings.reducedMotion': '减少动效',
  'settings.outline': '轮廓增强（看得更清楚）',
  'settings.retention': '归档保留期',
  'settings.retention.forever': '永久保留',
  'settings.retention.days': '{days} 天',

  /* --------------------------------- 封盘 --------------------------------- */
  'lock.title': '要封盘了吗？',
  'lock.desc': '封盘后这个沙盘就不能再改了，过程记录会保留下来。这个动作像把沙盘盖上布。',
  'lock.confirm': '封盘',
  'lock.cancel': '再摆一会儿',

  /* -------------------------------- 提示文案 ------------------------------- */
  'toast.exported': '已导出',

  /* --------------------------------- 边界 --------------------------------- */
  'sandbox.ethics': '系统不会分析你的沙盘，也不会告诉你它"代表什么"。解释权在你手里。',
  'sandbox.localOnly': '所有内容只保存在这台设备的浏览器里，不会上传。',
};
