// ==UserScript==
// @name         重庆高等教育智慧教育平台 · 自动学习助手（答题测试版）
// @namespace    cqooc-auto-study
// @version      1.3.4
// @description  自动播放/连播/补漏课/讨论回复/卡住刷新；AI 自动答题（密钥门禁）；v1.3.4 取消 AI 学习助手在考试/测验页面不可用的限制。
// @author       local
// @match        https://www.cqooc.com/*
// @match        https://cqooc.com/*
// @match        http://www.cqooc.com/*
// @match        http://cqooc.com/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==

/*
 * ============================================================================
 * 重庆高等教育智慧教育平台 · 自动学习助手
 * 版本：v1.3.4（取消 AI 学习助手在考试/测验/作业页面不可用的限制）
 * ============================================================================
 *
 * 一、这个脚本做什么
 * ----------------------------------------------------------------------------
 * 1. 在课程学习页自动播放视频/音频，设置静音和 1×/1.5×/2× 倍速；
 * 2. 当前课件完成后，自动切换到下一节未完成课件；
 * 3. “补齐漏课”开启时，优先补目录中最早未完成的课件，避免从中间开始后漏掉前面的课；
 * 4. 文档/PPT 默认按平台倒计时等待；开启“PPT 加速”后缩短前端倒计时；
 * 5. 讨论区可复制首条评论发布，或调用 AI 生成可编辑的回答；
 * 6. 视频长时间卡住时，watchdog 会自动刷新页面恢复；
 * 7. AI 学习助手可解释课件、总结重点、回答讨论题；
 * 8. AI 自动答题（v1.1.0）：识别测验/作业/考试页和视频弹题，调用 AI 答题，
 *    支持 assist（只显示）/ fill（自动填入）/ submit（填入并提交）三种模式；
 * 9. 反作弊测试取证：记录答题耗时、填入结果、提交请求/响应与页面反馈，可导出 JSON。
 *
 * 二、自动答题的边界（v1.1.0 新增）
 * ----------------------------------------------------------------------------
 * - 默认关闭、默认 assist：只提取题目并调用 AI 显示答案，不点击、不填写页面；
 * - fill / submit 需要用户在答题面板里手动勾选“已获书面授权的测试环境”，
 *   该确认不持久化，刷新页面后必须重新确认；
 * - 生产域名会显示红色警告；脚本只做页面级点击/输入，不直接调用平台私有接口
 *   伪造答题记录，不隐藏、不绕过平台前端校验；
 * - 只记录反作弊测试所需证据（填答耗时、提交请求/响应、页面反馈），
 *   不记录 API Key、Cookie 或 Authorization 原文。
 *
 * 三、运行链路（从页面加载到自动连播）
 * ----------------------------------------------------------------------------
 * init()
 *   → buildPanel()                 创建 Shadow DOM 面板，避免被平台 CSS 污染
 *   → aaInit()                     创建 AI 自动答题面板，启动 1.5 秒巡检
 *   → bindGlobalEvents()           监听 SPA 路由、视频元素、快捷键
 *   → setInterval(tick, 1000)      每秒读取一次平台 Vue 状态
 *       → getStudyVm()             找到 CourseStudy 组件
 *       → getCurrentItem()         读取当前课件和目录
 *       → getCoursewareVm()        找到当前 Courseware 组件
 *       → isDone()                 判断当前课件是否完成
 *       → autoPlay()               自动播放/恢复播放
 *       → checkVideoHealth()       检查视频卡死并刷新
 *       → scheduleNext()           完成后安排下一节
 *       → navigate()               调用平台自己的 selectJ() 切课件
 *
 *   答题链路（独立答题页 / 学习页弹题）
 *   aaTick() → aaPageKind() → aaExtractQuestions() → aaAskAI() → aaApplyAnswers()
 *           → aaSubmit()（仅 submit 模式且已授权）→ aaEvidence() 记录取证数据
 *
 * 四、关键数据来源
 * ----------------------------------------------------------------------------
 * - 平台是 Vue 2，组件根元素上有 __vue__；
 * - 课程目录：CourseStudy.menuList[].ZLJH[].KJJH[]；
 * - 当前课件：CourseStudy.kjRow；
 * - 课件资源/进度：Courseware.dataLeft、ZSC、dqjd、time；
 * - 目录里的 JD>=89 视为已完成。
 *
 * 五、代码结构
 * ----------------------------------------------------------------------------
 * 1. 配置与状态          DEFAULT_CFG / cfg / aiCfg / state
 * 2. 面板 UI             CSS / HTML / buildPanel / bindPanel / bindDrag
 * 3. Vue 数据读取        getStudyVm / getCoursewareVm / flatLessons / findNext
 * 4. 播放与恢复          findMedia / autoPlay / checkVideoHealth / recoverVideo
 * 5. 文档加速            isDocLike / accelerateDoc
 * 6. 讨论区              discussionText / replyToDiscussion / finishDiscussionReply
 * 7. AI 助手             loadAiCfg / askAI / studyContext
 * 8. AI 自动答题         aaPageKind / aaExtractQuestions / aaAskAI / aaApplyAnswers / aaSubmit
 * 9. 反作弊测试取证      aaEvidence / aaInstrumentNetwork / aaExportEvidence / aaDumpRaw
 * 10. 主循环             tick / aaTick / render / setEnabled
 * 11. 诊断与初始化       diagnose / init / aaInit
 *
 * 六、维护提示
 * ----------------------------------------------------------------------------
 * - 平台改版时优先检查：.course-study-container、.courseware-container、
 *   .courseware-row、menuList 的字段名；
 * - 修改完成判定前先确认 cw.isEmit.end 是否会在切换课件后残留；
 * - 答题页识别不到题目时：打开面板“答”→ 点“提取题目”，在控制台执行
 *   window.__CQOOC_AA__.dump() 查看选项节点，或点“结构快照”导出页面结构；
 *   真实答题页选项是自定义 div：.question-item > .question-title +
 *   .single-option-box > .single-option-item（无原生 input），见 AA_OPTION_ITEM_SELECTOR；
 * - fill / submit 必须保持“默认关闭 + 手动授权确认”的边界，不要改成默认开启；
 * - 版本发布必须新建 vX.Y.Z 目录，不覆盖旧目录。
 * ============================================================================
 */

(function () {
    'use strict';

    // v1.1.4：最早期的启动标记。安装/刷新脚本后在控制台执行 window.__CQOOC_US__，
    // 就能判断 userscript 到底有没有被注入到当前页面。
    const __CQOOC_BOOT__ = {
        tool: 'cqooc-auto-study',
        version: '1.3.4',
        stage: 'boot',
        startedAt: new Date().toISOString(),
        url: location.href,
        topFrame: window.top === window.self,
        aaReady: false,
        error: ''
    };
    window.__CQOOC_US__ = __CQOOC_BOOT__;
    try {
        console.info('[CQOOC助手] userscript 已注入 v' + __CQOOC_BOOT__.version + '（stage=boot）');
    } catch (e) {}

    // 防止在 iframe 或重复注入时执行两次。
    if (window.top !== window.self) {
        __CQOOC_BOOT__.stage = 'skip-iframe';
        return;
    }
    if (window.__CQOOC_AUTO_STUDY_LOADED__) {
        __CQOOC_BOOT__.stage = 'skip-duplicate';
        return;
    }
    window.__CQOOC_AUTO_STUDY_LOADED__ = true;

    // v1.1.4：早期占位 API。即使后续初始化失败，控制台命令也不会再报
    // “Cannot read properties of undefined”，而是给出启动阶段/错误信息。
    window.__CQOOC_AA__ = window.__CQOOC_AA__ || {
        version: '1.3.4',
        ready: false,
        state: {},
        cfg: {},
        open: function () {
            console.warn('[CQOOC答题] 脚本尚未初始化完成，请执行 window.__CQOOC_US__ 查看 stage/error');
            return false;
        },
        uiCheck: function () { return window.__CQOOC_US__; },
        extract: function () { return []; }
    };

    const VERSION = '1.3.4';
    // 主配置、已回复讨论、AI 配置使用不同的 localStorage key，互不覆盖。
    const LS_KEY = 'cqooc-auto-study-v1';
    const REPLIED_KEY = 'cqooc-auto-replied-v1';
    const AI_CFG_KEY = 'cqooc-ai-config-v1';
    const AI_DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
    const AI_DEFAULT_MODEL = 'deepseek-chat';
    const STUDY_PATH = '/course/detail/courseStudy';
    // 默认配置。字段含义：
    // enabled      总开关；首次安装默认开启
    // rate         播放倍速，只允许 1 / 1.5 / 2
    // muted        是否静音（静音更容易通过浏览器自动播放策略）
    // autoNext     当前课件完成后是否自动下一节
    // autoStart    进入课件后是否自动播放
    // alertQuestion 检测到弹题时是否改标题并响一声
    // fastDoc      PPT/文档加速（实验性，默认关闭）
    // fillGaps     自动连播时优先补最早未完成课件
    // autoReply    进入讨论区自动复制评论并发布（实验性，默认关闭）
    // autoRecover  视频卡死时自动刷新（默认开启）
    // nextDelay    完成到切下一节的等待秒数
    // pos          面板位置
    const DEFAULT_CFG = {
        enabled: true,
        rate: 2,
        muted: true,
        autoNext: true,
        autoStart: true,
        alertQuestion: true,
        fastDoc: false,
        fillGaps: true,
        autoReply: false,
        autoRecover: true,
        nextDelay: 5,
        pos: null
    };

    /**
     * 只允许平台播放器支持的倍速，防止用户输入 3× 导致平台报错。
     * @param {*} value 任意输入
     * @returns {number} 1 / 1.5 / 2
     */
    function normalizeRate(value) {
        const n = Number(value);
        return [1, 1.5, 2].includes(n) ? n : 2;
    }

    /**
     * 读取主配置，并对每个字段做类型/范围兜底。
     * 旧版本 localStorage 缺少字段时，使用 DEFAULT_CFG 的默认值。
     */
    function loadCfg() {
        const base = Object.assign({}, DEFAULT_CFG);
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return base;
            const saved = JSON.parse(raw);
            if (!saved || typeof saved !== 'object') return base;
            base.enabled = !!saved.enabled;
            base.rate = normalizeRate(saved.rate);
            base.muted = saved.muted !== false;
            base.autoNext = saved.autoNext !== false;
            base.autoStart = saved.autoStart !== false;
            base.alertQuestion = saved.alertQuestion !== false;
            base.fastDoc = saved.fastDoc === true;
            base.fillGaps = saved.fillGaps !== false;
            base.autoReply = saved.autoReply === true;
            base.autoRecover = saved.autoRecover !== false;
            base.nextDelay = Math.min(15, Math.max(2, Number(saved.nextDelay) || 5));
            if (saved.pos && Number.isFinite(Number(saved.pos.left)) && Number.isFinite(Number(saved.pos.top))) {
                base.pos = { left: Number(saved.pos.left), top: Number(saved.pos.top) };
            }
        } catch (e) {
            console.warn('[CQOOC助手] 读取设置失败', e);
        }
        return base;
    }

    /**
     * 读取 AI 配置。API Key 只存在本机 localStorage，不参与主配置。
     */
    function loadAiCfg() {
        const base = {
            endpoint: AI_DEFAULT_ENDPOINT,
            model: AI_DEFAULT_MODEL,
            apiKey: ''
        };
        try {
            const raw = localStorage.getItem(AI_CFG_KEY);
            const saved = raw ? JSON.parse(raw) : null;
            if (!saved || typeof saved !== 'object') return base;
            if (saved.endpoint) base.endpoint = String(saved.endpoint);
            if (saved.model) base.model = String(saved.model);
            if (saved.apiKey) base.apiKey = String(saved.apiKey);
        } catch (e) {}
        return base;
    }

    /**
     * 保存 AI 配置。只保存 endpoint/model/apiKey，不保存对话内容。
     */
    function saveAiCfg(ai) {
        try {
            localStorage.setItem(AI_CFG_KEY, JSON.stringify({
                endpoint: ai.endpoint,
                model: ai.model,
                apiKey: ai.apiKey
            }));
        } catch (e) {
            console.warn('[CQOOC助手] 保存 AI 配置失败', e);
        }
    }

    const cfg = loadCfg();
    const aiCfg = loadAiCfg();

    /**
     * 读取“已经自动回复过的讨论 ID”，用于避免刷新页面后重复发帖。
     * 只保留最近 300 条，防止 localStorage 无限增长。
     */
    function loadRepliedIds() {
        try {
            const raw = localStorage.getItem(REPLIED_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list.slice(-300) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * 标记某个讨论已回复，并持久化。
     * @param {string} id 讨论课件 ID
     */
    function markReplied(id) {
        try {
            const list = loadRepliedIds();
            if (list.indexOf(String(id)) === -1) {
                list.push(String(id));
                localStorage.setItem(REPLIED_KEY, JSON.stringify(list.slice(-300)));
            }
        } catch (e) {}
    }

    // 运行期状态。这里只放“页面状态”，不放配置。
    const state = {
        statusText: cfg.enabled ? '正在初始化…' : '已暂停', // 面板第一行状态
        tone: '',                                           // 状态点颜色：''/on/warn/err
        lessonTitle: '等待进入课程学习页',
        subText: '',
        progress: 0,
        activeSeconds: 0,
        activeSince: cfg.enabled ? Date.now() : null,        // 本次开启时间
        currentId: null,                                     // 当前课件 ID，用于检测切换
        item: null,                                          // 当前目录项（含 LX/JD）
        cw: null,                                            // 当前 Courseware 组件
        allDone: false,
        pickTried: false,
        nextTimer: null,                                     // 下一节定时器
        navigating: false,                                   // 防止重复调用 selectJ
        questionFor: null,                                   // 弹题所属课件，避免重复响铃
        fastDocFor: null,                                    // PPT 加速只对当前课件执行一次
        titleAlert: false,
        baseTitle: document.title || '',
        lastPlayAttempt: 0,                                  // play() 节流
        resumeAfter: 0,                                      // 用户手动操作后的暂停窗口
        overlayFor: null,                                    // 视频遮罩只点一次
        playBlocked: false,
        playFailCount: 0,                                    // 连续 play() 失败次数
        stallSince: 0,                                       // 卡顿起始时间
        pausedSince: 0,                                      // 暂停起始时间
        lastMediaTime: -1,                                   // 上一次媒体时间
        mediaErrorAt: 0,                                     // 媒体错误起始时间
        lastMediaError: null,                                // 最近一次视频错误详情
        lessonChangedAt: 0,                                  // 当前课件切换时间（完成判定冷静期）
        lessonMediaEl: null,                                 // 当前课件对应的媒体元素
        lessonMediaPlayed: 0,                                // 当前媒体实际播放到的最大时间
        switchTimes: [],                                     // 最近一次切换课件的时间点（频繁切换保护）
        autoNextBlockedUntil: 0,                             // 频繁切换后暂停自动下一节
        finishCalledFor: null,                               // 已主动调用 finishLesson 的课件 ID
        lastRecoverAt: 0,                                    // 上次自动刷新时间
        recoverCount: 0,
        goodPlaySince: 0,
        routeKey: pagePath() + location.search + location.hash,
        replyTried: new Set(),                               // 本次页面内已尝试过的讨论
        replied: new Set(loadRepliedIds()),                  // 历史已回复讨论
        replying: false,
        aiBusy: false,
        aiAnswer: '',
        logs: [],
        lastLogMsg: '',
        lastLogAt: 0,
        lastBeepAt: 0,
        skipUntil: new Map()                                 // 切换失败的课件冷却表
    };

    let host = null;
    let shadow = null;
    let panel = null;
    let els = {};
    let audioCtx = null;

    /* ------------------------------------------------------------------ */
    /* 面板                                                               */
    /* ------------------------------------------------------------------ */

    const CSS = `
        :host {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            color: #17233d;
        }
        * { box-sizing: border-box; }
        .cq-panel {
            width: 100%;
            background: #fff;
            border: 1px solid rgba(2, 86, 202, .14);
            border-radius: 14px;
            box-shadow: 0 18px 50px rgba(9, 30, 66, .22), 0 2px 8px rgba(9, 30, 66, .08);
            overflow: hidden;
            pointer-events: auto;
            user-select: none;
        }
        .cq-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 12px;
            color: #fff;
            background: linear-gradient(135deg, #0256ca, #2f80ed);
            cursor: grab;
            touch-action: none;
        }
        .cq-head:active { cursor: grabbing; }
        .cq-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .cq-logo {
            width: 26px; height: 26px; flex: 0 0 26px;
            display: grid; place-items: center;
            border-radius: 8px;
            background: rgba(255, 255, 255, .18);
            border: 1px solid rgba(255, 255, 255, .28);
            font-size: 14px; font-weight: 700;
        }
        .cq-brand-text { min-width: 0; line-height: 1.2; }
        .cq-brand-text b {
            display: block; font-size: 12.5px; font-weight: 700;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cq-brand-text small {
            display: block; margin-top: 2px; font-size: 10px;
            color: rgba(255, 255, 255, .78);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cq-head-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
        .cq-dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: #cbd5e1;
            box-shadow: 0 0 0 3px rgba(255, 255, 255, .16);
        }
        .cq-dot.on { background: #4ade80; }
        .cq-dot.warn { background: #fbbf24; }
        .cq-dot.err { background: #f87171; }
        .cq-collapse {
            width: 22px; height: 22px; padding: 0;
            border: 0; border-radius: 6px;
            color: #fff; background: rgba(255, 255, 255, .16);
            cursor: pointer; font-size: 14px; line-height: 1;
        }
        .cq-collapse:hover { background: rgba(255, 255, 255, .26); }
        .cq-body { padding: 11px 12px 12px; }
        .cq-status {
            padding: 9px 10px;
            border: 1px solid #e8eef8;
            border-radius: 9px;
            background: #f8fbff;
        }
        .cq-status-top {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; margin-bottom: 5px;
        }
        .cq-status-text { font-size: 12px; font-weight: 700; color: #0256ca; }
        .cq-status-time { font: 11px/1 Consolas, "Courier New", monospace; color: #94a3b8; }
        .cq-title {
            margin: 2px 0 7px;
            font-size: 12px; font-weight: 600; color: #334155;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cq-bar {
            height: 6px; overflow: hidden;
            border-radius: 999px; background: #e8eef7;
        }
        .cq-bar > i {
            display: block; width: 0; height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #0256ca, #38bdf8);
            transition: width .35s ease;
        }
        .cq-sub {
            margin-top: 6px; min-height: 15px;
            font-size: 11px; color: #64748b;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cq-actions { display: flex; gap: 8px; margin: 10px 0 8px; }
        .cq-btn {
            min-height: 34px; padding: 7px 10px;
            border: 0; border-radius: 8px;
            font: 600 12px/1.2 inherit;
            cursor: pointer;
            transition: background .15s ease, color .15s ease, opacity .15s ease;
        }
        .cq-btn:active { transform: translateY(1px); }
        .cq-primary { flex: 1; color: #fff; background: #0256ca; }
        .cq-primary:hover { background: #0148aa; }
        .cq-primary.on { color: #0256ca; background: #e8f1ff; border: 1px solid #b9d2ff; }
        .cq-primary.on:hover { background: #dbe9ff; }
        .cq-ghost { flex: 0 0 auto; color: #334155; background: #f1f5f9; }
        .cq-ghost:hover { background: #e2e8f0; }
        .cq-settings {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 7px 8px;
            padding: 8px 9px;
            border: 1px dashed #dbe5f1;
            border-radius: 9px;
            background: #fcfdff;
        }
        .cq-setting {
            display: flex; align-items: center; gap: 5px;
            min-width: 0; font-size: 11.5px; color: #475569;
            cursor: pointer;
        }
        .cq-setting.cq-rate-setting { justify-content: space-between; }
        .cq-setting input[type="checkbox"] {
            width: 14px; height: 14px; margin: 0;
            accent-color: #0256ca; cursor: pointer;
        }
        .cq-setting select {
            height: 25px; min-width: 64px; padding: 0 5px;
            border: 1px solid #d7e2f0; border-radius: 6px;
            color: #334155; background: #fff;
            font-size: 11.5px; outline: none; cursor: pointer;
        }
        .cq-setting select:focus { border-color: #0256ca; }
        .cq-log {
            height: 76px; margin-top: 8px; padding: 6px 8px;
            overflow: auto; overscroll-behavior: contain;
            border: 1px solid #eef2f7; border-radius: 8px;
            background: #f8fafc;
            font: 10.5px/1.5 Consolas, "Courier New", monospace;
            color: #64748b; user-select: text;
        }
        .cq-log div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cq-foot {
            margin-top: 8px;
            font-size: 10px; line-height: 1.4;
            color: #94a3b8; text-align: center;
        }
        .cq-ai-open {
            height: 22px; padding: 0 7px;
            border: 1px solid rgba(255, 255, 255, .32);
            border-radius: 6px;
            color: #fff; background: rgba(255, 255, 255, .16);
            cursor: pointer; font-size: 10px; font-weight: 700;
        }
        .cq-ai-open:hover { background: rgba(255, 255, 255, .28); }
        .cq-ai-mask {
            position: fixed; inset: 0;
            display: none; align-items: center; justify-content: center;
            padding: 16px;
            background: rgba(15, 23, 42, .48);
            z-index: 2147483647;
            pointer-events: auto;
        }
        .cq-ai-mask.show { display: flex; }
        .cq-ai-dialog {
            width: min(620px, 100%);
            max-height: 88vh; overflow: auto;
            background: #fff;
            border: 1px solid #dbe5f1;
            border-radius: 14px;
            box-shadow: 0 24px 80px rgba(9, 30, 66, .35);
            color: #17233d;
            font: 12px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        }
        .cq-ai-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 11px 14px;
            color: #fff;
            background: linear-gradient(135deg, #0256ca, #2f80ed);
        }
        .cq-ai-head b { font-size: 13px; }
        .cq-ai-head button {
            width: 24px; height: 24px; padding: 0;
            border: 0; border-radius: 6px;
            color: #fff; background: rgba(255, 255, 255, .18);
            cursor: pointer; font-size: 16px; line-height: 1;
        }
        .cq-ai-body { padding: 13px 14px 15px; }
        .cq-ai-note {
            padding: 8px 9px; margin-bottom: 10px;
            border: 1px solid #fde68a; border-radius: 8px;
            background: #fffbeb;
            color: #92400e; font-size: 11px;
        }
        .cq-ai-grid {
            display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
            margin-bottom: 8px;
        }
        .cq-ai-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .cq-ai-field.full { grid-column: 1 / -1; }
        .cq-ai-field span { color: #64748b; font-size: 10.5px; }
        .cq-ai-field input, .cq-ai-field textarea {
            width: 100%; padding: 7px 8px;
            border: 1px solid #d7e2f0; border-radius: 7px;
            color: #17233d; background: #fff;
            font: 11.5px/1.45 inherit;
            outline: none;
        }
        .cq-ai-field textarea { resize: vertical; min-height: 70px; }
        .cq-ai-field input:focus, .cq-ai-field textarea:focus { border-color: #0256ca; }
        .cq-ai-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
        .cq-ai-actions button {
            padding: 6px 9px;
            border: 1px solid #d7e2f0; border-radius: 7px;
            color: #334155; background: #f8fafc;
            cursor: pointer; font: 600 11px/1.2 inherit;
        }
        .cq-ai-actions button:hover { background: #eef4ff; border-color: #b9d2ff; }
        .cq-ai-actions button.primary { color: #fff; background: #0256ca; border-color: #0256ca; }
        .cq-ai-actions button:disabled { opacity: .55; cursor: wait; }
        .cq-ai-answer {
            min-height: 72px; max-height: 260px; overflow: auto;
            margin-top: 10px; padding: 9px 10px;
            border: 1px solid #e8eef8; border-radius: 8px;
            background: #f8fbff;
            color: #334155; white-space: pre-wrap; word-break: break-word;
            font-size: 12px; user-select: text;
        }
        .cq-ai-status { margin-top: 6px; color: #64748b; font-size: 10.5px; }
        .cq-ai-status.err { color: #dc2626; }
        .cq-panel.cq-circle {
            width: 56px; height: 56px; min-height: 56px; padding: 0;
            border-radius: 50%; overflow: hidden; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
        }
        .cq-panel.cq-circle .cq-head {
            width: 100%; height: 100%; padding: 0; margin: 0;
            border: 0; border-radius: 50%;
            background: transparent; box-shadow: none;
            display: flex; align-items: center; justify-content: center;
        }
        .cq-panel.cq-circle .cq-body,
        .cq-panel.cq-circle .cq-brand-text,
        .cq-panel.cq-circle .cq-head-right { display: none; }
        .cq-panel.cq-circle .cq-logo { width: 48px; height: 48px; margin: 0; font-size: 22px; border-radius: 50%; }
        .cq-panel.collapsed .cq-body { display: none; }
        @media (max-width: 480px) {
            .cq-settings { grid-template-columns: 1fr; }
            .cq-log { height: 56px; }
        }
    `;

    const HTML = `
        <div class="cq-panel" id="cq-panel">
            <div class="cq-head" id="cq-head" title="按住拖动">
                <div class="cq-brand">
                    <div class="cq-logo">渝</div>
                    <div class="cq-brand-text">
                        <b>重庆高教 · 自动学习</b>
                        <small>视频连播 · 答题测试 · v${VERSION}</small>
                    </div>
                </div>
                <div class="cq-head-right">
                    <button type="button" class="cq-ai-open" id="cq-ai-open" title="AI 学习助手">AI</button>
                    <span class="cq-dot" id="cq-dot"></span>
                    <button type="button" class="cq-collapse" id="cq-mincircle" title="最小化为圆形悬浮窗">○</button>
                    <button type="button" class="cq-collapse" id="cq-collapse" title="收起/展开">−</button>
                </div>
            </div>
            <div class="cq-body">
                <div class="cq-status">
                    <div class="cq-status-top">
                        <span class="cq-status-text" id="cq-status">已暂停</span>
                        <span class="cq-status-time" id="cq-clock">00:00</span>
                    </div>
                    <div class="cq-title" id="cq-title">等待进入课程学习页</div>
                    <div class="cq-bar"><i id="cq-bar"></i></div>
                    <div class="cq-sub" id="cq-sub">打开课程后会自动识别当前课件</div>
                </div>
                <div class="cq-actions">
                    <button type="button" class="cq-btn cq-primary" id="cq-toggle">开始自动学习</button>
                    <button type="button" class="cq-btn cq-ghost" id="cq-reply" style="display:none">回复讨论</button>
                    <button type="button" class="cq-btn cq-ghost" id="cq-next">下一节</button>
                </div>
                <div class="cq-settings">
                    <label class="cq-setting cq-rate-setting">倍速
                        <select id="cq-rate">
                            <option value="1">1×</option>
                            <option value="1.5">1.5×</option>
                            <option value="2">2×</option>
                        </select>
                    </label>
                    <label class="cq-setting"><input type="checkbox" id="cq-muted"> 静音播放</label>
                    <label class="cq-setting"><input type="checkbox" id="cq-autonext"> 自动下一节</label>
                    <label class="cq-setting" title="自动优先补完目录中前面漏掉的课件"><input type="checkbox" id="cq-fillgaps"> 补齐漏课</label>
                    <label class="cq-setting"><input type="checkbox" id="cq-autostart"> 自动播放</label>
                    <label class="cq-setting" title="实验性：跳过文档/PPT 的平台等待时间"><input type="checkbox" id="cq-fastdoc"> PPT 加速</label>
                    <label class="cq-setting" title="实验性：复制首条评论并自动发布到讨论区，风险自负"><input type="checkbox" id="cq-autoreply"> 自动回讨论</label>
                    <label class="cq-setting" title="视频长时间卡住时自动刷新页面恢复播放"><input type="checkbox" id="cq-recover"> 卡住刷新</label>
                    <label class="cq-setting"><input type="checkbox" id="cq-alert"> 弹题提醒</label>
                </div>
                <div class="cq-log" id="cq-log"></div>
                <div class="cq-foot">不调用接口伪造进度 · Alt+S 开关 / Alt+D 诊断 / Alt+V 视频诊断 / Alt+A 答题</div>
            </div>
        </div>
        <div class="cq-ai-mask" id="cq-ai-mask">
            <div class="cq-ai-dialog" role="dialog" aria-modal="true">
                <div class="cq-ai-head">
                    <b>AI 学习助手</b>
                    <button type="button" id="cq-ai-close" title="关闭">×</button>
                </div>
                <div class="cq-ai-body">
                    <div class="cq-ai-note">可用于课程理解、笔记整理、讨论与考试/作业页面提问。自动答题请使用“答”面板（受密钥/授权管理）。</div>
                    <div class="cq-ai-grid">
                        <label class="cq-ai-field full"><span>API 地址（OpenAI 兼容）</span><input id="cq-ai-endpoint" type="text" autocomplete="off"></label>
                        <label class="cq-ai-field"><span>模型</span><input id="cq-ai-model" type="text" autocomplete="off"></label>
                        <label class="cq-ai-field"><span>API Key（仅保存在本机）</span><input id="cq-ai-key" type="password" autocomplete="off" placeholder="sk-..."></label>
                    </div>
                    <label class="cq-ai-field"><span>问题 / 需求</span><textarea id="cq-ai-prompt" placeholder="例如：用通俗语言解释当前课件的核心概念，并给一个例子。"></textarea></label>
                    <div class="cq-ai-actions">
                        <button type="button" id="cq-ai-explain">解释当前课件</button>
                        <button type="button" id="cq-ai-summary">总结本节</button>
                        <button type="button" id="cq-ai-draft">回答讨论题</button>
                        <button type="button" id="cq-ai-copy">复制回答</button>
                        <button type="button" class="primary" id="cq-ai-send">发送</button>
                    </div>
                    <div class="cq-ai-status" id="cq-ai-status">未配置 API Key。填写后即可调用。</div>
                    <div class="cq-ai-answer" id="cq-ai-answer">AI 回答会显示在这里。</div>
                </div>
            </div>
        </div>
    `;

    /**
     * 创建悬浮面板。
     * 使用 Shadow DOM 的原因：平台是 Vue + Ant Design，全局 CSS 会污染按钮/输入框；
     * Shadow DOM 把面板样式隔离，同时仍能通过 shadowRoot 访问自己的元素。
     */
    /**
     * 最小化为圆形悬浮窗 / 恢复。
     * 视频学习页可点面板右上角“○”，面板会缩成 56px 圆形，点击圆形恢复。
     */
    function setCirclePanel(on) {
        if (!panel || !host) return;
        panel.classList.toggle('cq-circle', !!on);
        host.style.width = on ? '56px' : 'min(340px,calc(100vw - 24px))';
        if (on) {
            host.style.height = '56px';
            if (!cfg.pos) {
                host.style.right = 'auto';
                host.style.bottom = 'auto';
                host.style.left = Math.max(8, window.innerWidth - 74) + 'px';
                host.style.top = Math.max(8, window.innerHeight - 120) + 'px';
            }
        } else {
            host.style.height = '';
            if (!cfg.pos) {
                host.style.left = '';
                host.style.top = '';
                host.style.right = '18px';
                host.style.bottom = '18px';
            }
        }
        if (els.minCircle) {
            els.minCircle.textContent = on ? '□' : '○';
            els.minCircle.title = on ? '恢复面板' : '最小化为圆形悬浮窗';
        }
        log(on ? '面板已最小化为圆形悬浮窗（点击圆形恢复）' : '面板已恢复');
    }

    function buildPanel() {
        host = document.createElement('div');
        host.id = 'cqooc-auto-study-host';
        host.style.cssText = [
            'position:fixed',
            'z-index:2147483647',
            'width:min(340px,calc(100vw - 24px))',
            'pointer-events:none'
        ].join(';');

        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>' + CSS + '</style>' + HTML;
        (document.body || document.documentElement).appendChild(host);

        panel = shadow.getElementById('cq-panel');
        els = {
            head: shadow.getElementById('cq-head'),
            dot: shadow.getElementById('cq-dot'),
            collapse: shadow.getElementById('cq-collapse'),
            minCircle: shadow.getElementById('cq-mincircle'),
            status: shadow.getElementById('cq-status'),
            clock: shadow.getElementById('cq-clock'),
            title: shadow.getElementById('cq-title'),
            bar: shadow.getElementById('cq-bar'),
            sub: shadow.getElementById('cq-sub'),
            toggle: shadow.getElementById('cq-toggle'),
            reply: shadow.getElementById('cq-reply'),
            next: shadow.getElementById('cq-next'),
            rate: shadow.getElementById('cq-rate'),
            muted: shadow.getElementById('cq-muted'),
            autoNext: shadow.getElementById('cq-autonext'),
            fillGaps: shadow.getElementById('cq-fillgaps'),
            autoStart: shadow.getElementById('cq-autostart'),
            fastDoc: shadow.getElementById('cq-fastdoc'),
            autoReply: shadow.getElementById('cq-autoreply'),
            recover: shadow.getElementById('cq-recover'),
            alert: shadow.getElementById('cq-alert'),
            log: shadow.getElementById('cq-log'),
            aiOpen: shadow.getElementById('cq-ai-open'),
            aiMask: shadow.getElementById('cq-ai-mask'),
            aiClose: shadow.getElementById('cq-ai-close'),
            aiEndpoint: shadow.getElementById('cq-ai-endpoint'),
            aiModel: shadow.getElementById('cq-ai-model'),
            aiKey: shadow.getElementById('cq-ai-key'),
            aiPrompt: shadow.getElementById('cq-ai-prompt'),
            aiExplain: shadow.getElementById('cq-ai-explain'),
            aiSummary: shadow.getElementById('cq-ai-summary'),
            aiDraft: shadow.getElementById('cq-ai-draft'),
            aiCopy: shadow.getElementById('cq-ai-copy'),
            aiSend: shadow.getElementById('cq-ai-send'),
            aiStatus: shadow.getElementById('cq-ai-status'),
            aiAnswer: shadow.getElementById('cq-ai-answer')
        };

        els.rate.value = String(cfg.rate);
        els.muted.checked = cfg.muted;
        els.autoNext.checked = cfg.autoNext;
        els.fillGaps.checked = cfg.fillGaps;
        els.autoStart.checked = cfg.autoStart;
        els.fastDoc.checked = cfg.fastDoc;
        els.autoReply.checked = cfg.autoReply;
        els.recover.checked = cfg.autoRecover;
        els.alert.checked = cfg.alertQuestion;

        els.aiEndpoint.value = aiCfg.endpoint;
        els.aiModel.value = aiCfg.model;
        els.aiKey.value = aiCfg.apiKey;

        if (cfg.pos) {
            requestAnimationFrame(function () {
                placeAt(cfg.pos.left, cfg.pos.top);
            });
        } else {
            host.style.right = '18px';
            host.style.bottom = '18px';
        }

        bindPanel();
    }

    /**
     * 绑定面板上的所有交互：总开关、设置项、AI 弹窗、拖动。
     * 所有事件只修改 cfg/state，真正的页面动作由 tick()/AI 函数执行。
     */
    function bindPanel() {
        els.toggle.addEventListener('click', function () {
            setEnabled(!cfg.enabled);
        });

        els.next.addEventListener('click', function () {
            manualNext();
        });

        els.reply.addEventListener('click', function () {
            replyToDiscussion(true);
        });

        els.collapse.addEventListener('click', function (event) {
            event.stopPropagation();
            const collapsed = panel.classList.toggle('collapsed');
            els.collapse.textContent = collapsed ? '+' : '−';
        });

        if (els.minCircle) {
            els.minCircle.addEventListener('click', function (event) {
                event.stopPropagation();
                setCirclePanel(!panel.classList.contains('cq-circle'));
            });
        }
        els.head.addEventListener('click', function (event) {
            if (!panel.classList.contains('cq-circle')) return;
            if (event.target.closest && event.target.closest('button')) return;
            setCirclePanel(false);
        });

        els.rate.addEventListener('change', function () {
            cfg.rate = normalizeRate(els.rate.value);
            saveCfg();
            const media = findMedia();
            if (media) applyMediaSettings(media);
            log('播放倍速设为 ' + cfg.rate + '×');
        });

        els.muted.addEventListener('change', function () {
            cfg.muted = els.muted.checked;
            saveCfg();
            const media = findMedia();
            if (media) {
                applyMediaSettings(media);
                if (!cfg.muted && media.paused && cfg.enabled && !isQuestionVisible(null)) {
                    const p = media.play();
                    if (p && p.catch) p.catch(function () {});
                }
            }
            log(cfg.muted ? '已开启静音播放' : '已关闭静音播放');
        });

        els.autoNext.addEventListener('change', function () {
            cfg.autoNext = els.autoNext.checked;
            saveCfg();
            log(cfg.autoNext ? '已开启自动下一节' : '已关闭自动下一节');
        });

        els.fillGaps.addEventListener('change', function () {
            cfg.fillGaps = els.fillGaps.checked;
            saveCfg();
            log(cfg.fillGaps ? '已开启补齐漏课' : '已关闭补齐漏课');
        });

        els.autoStart.addEventListener('change', function () {
            cfg.autoStart = els.autoStart.checked;
            saveCfg();
            log(cfg.autoStart ? '已开启自动播放' : '已关闭自动播放');
        });

        els.fastDoc.addEventListener('change', function () {
            cfg.fastDoc = els.fastDoc.checked;
            state.fastDocFor = null;
            saveCfg();
            log(cfg.fastDoc ? '已开启 PPT 加速（会跳过平台等待时间）' : '已关闭 PPT 加速');
        });

        els.autoReply.addEventListener('change', function () {
            cfg.autoReply = els.autoReply.checked;
            saveCfg();
            log(cfg.autoReply ? '已开启自动回复讨论（复制首条评论）' : '已关闭自动回复讨论');
        });

        els.recover.addEventListener('change', function () {
            cfg.autoRecover = els.recover.checked;
            saveCfg();
            log(cfg.autoRecover ? '已开启卡住自动刷新' : '已关闭卡住自动刷新');
        });

        els.alert.addEventListener('change', function () {
            cfg.alertQuestion = els.alert.checked;
            saveCfg();
            log(cfg.alertQuestion ? '已开启弹题提醒' : '已关闭弹题提醒');
        });

        els.aiOpen.addEventListener('click', openAiModal);
        els.aiClose.addEventListener('click', closeAiModal);
        els.aiMask.addEventListener('click', function (event) {
            if (event.target === els.aiMask) closeAiModal();
        });

        els.aiEndpoint.addEventListener('change', saveAiFromInputs);
        els.aiModel.addEventListener('change', saveAiFromInputs);
        els.aiKey.addEventListener('change', saveAiFromInputs);

        els.aiExplain.addEventListener('click', function () {
            askAI('请用通俗语言解释当前课件的核心概念、重点和易错点，并给一个贴近课程内容的例子。', '解释课件');
        });
        els.aiSummary.addEventListener('click', function () {
            askAI('请总结当前课件/本节内容的重点，按“核心概念、关键结论、复习提示”三点输出。', '总结本节');
        });
        els.aiDraft.addEventListener('click', function () {
            if (!currentIsDiscussion()) {
                setAiStatus('当前不是讨论区，不能回答讨论题。', true);
                return;
            }
            askAI('请回答上面的讨论题目。先给出核心观点，再给一段 150 字左右、观点明确、可以直接编辑后发布的讨论回复。不要复制其他同学的原文。', '讨论回答');
        });
        els.aiSend.addEventListener('click', function () {
            const prompt = els.aiPrompt.value.trim();
            if (!prompt) {
                setAiStatus('先输入问题或需求。', true);
                return;
            }
            askAI(prompt, '提问');
        });
        els.aiCopy.addEventListener('click', function () {
            const text = els.aiAnswer.textContent || '';
            if (!text || text === 'AI 回答会显示在这里。') {
                setAiStatus('还没有可复制的回答。', true);
                return;
            }
            copyText(text);
        });
        els.aiPrompt.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                els.aiSend.click();
            }
        });

        bindDrag();
    }

    function bindDrag() {
        let drag = null;

        els.head.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) return;
            if (event.target.closest('button, select, input, label, a')) return;

            const rect = host.getBoundingClientRect();
            drag = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top
            };

            host.style.left = rect.left + 'px';
            host.style.top = rect.top + 'px';
            host.style.right = 'auto';
            host.style.bottom = 'auto';

            try { els.head.setPointerCapture(event.pointerId); } catch (e) {}
            event.preventDefault();
        });

        els.head.addEventListener('pointermove', function (event) {
            if (!drag || event.pointerId !== drag.pointerId) return;
            placeAt(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
        });

        function endDrag(event) {
            if (!drag || (event && event.pointerId !== drag.pointerId)) return;
            drag = null;
            saveCfg();
        }

        els.head.addEventListener('pointerup', endDrag);
        els.head.addEventListener('pointercancel', endDrag);

        window.addEventListener('resize', function () {
            if (cfg.pos) placeAt(cfg.pos.left, cfg.pos.top);
        });
    }

    function openAiModal() {
        if (!els.aiMask) return;
        els.aiEndpoint.value = aiCfg.endpoint;
        els.aiModel.value = aiCfg.model;
        els.aiKey.value = aiCfg.apiKey;
        els.aiDraft.style.display = currentIsDiscussion() ? '' : 'none';
        els.aiMask.classList.add('show');
        // v1.1.3：Shadow 内不可见时同样切换为页面级挂载。
        try {
            const aiDialog = els.aiMask.querySelector('.cq-ai-dialog');
            if (!aaOverlayVisible(els.aiMask, aiDialog)) {
                aaMountOverlayForVisibility(els.aiMask);
                els.aiMask.classList.add('show');
                console.info('[CQOOC答题] AI 弹窗已切换为页面级挂载');
            }
        } catch (e) {}

        if (!aiCfg.apiKey) {
            setAiStatus('未配置 API Key。填写后即可调用。Key 仅保存在本机浏览器。', false);
        } else if (isExamContext()) {
            setAiStatus('已配置。考试/测验/作业页面也可以提问；自动答题请用“答”面板。', false);
        } else {
            setAiStatus('已配置。可以解释课件、总结重点或生成讨论草稿。', false);
        }
    }

    function closeAiModal() {
        if (els.aiMask) els.aiMask.classList.remove('show');
    }

    function saveAiFromInputs() {
        aiCfg.endpoint = (els.aiEndpoint.value || '').trim() || AI_DEFAULT_ENDPOINT;
        aiCfg.model = (els.aiModel.value || '').trim() || AI_DEFAULT_MODEL;
        aiCfg.apiKey = (els.aiKey.value || '').trim();
        saveAiCfg(aiCfg);
        setAiStatus(aiCfg.apiKey ? '配置已保存（Key 仅保存在本机）' : '未配置 API Key', !aiCfg.apiKey);
    }

    function currentIsDiscussion() {
        return !!(state.item && state.item.LX === '3');
    }

    /**
     * 判断当前是否考试类页面（测验 LX=2、作业 LX=5、考试 LX=6，或 homeworkTest 路由）。
     * v1.3.4 起不再禁用 AI 学习助手，仅在状态提示里说明。
     */
    function isExamContext() {
        if (pagePath().indexOf('/homeworkTest') !== -1) return true;
        const type = state.item && state.item.LX;
        return type === '2' || type === '5' || type === '6';
    }

    /**
     * AI 可用范围：非学习页（测验/作业/考试等）直接允许；
     * 学习页仍只允许普通课件（LX=1）和讨论区（LX=3）。
     */
    function aiAllowed() {
        if (!isStudyPage()) return true;
        return !!(state.item && (state.item.LX === '1' || state.item.LX === '3'));
    }

    /**
     * 读取当前讨论题正文（.conv-content），没有就用标题。
     * 只用于学习/讨论题回答，不用于考试。
     */
    function discussionPromptText() {
        const node = document.querySelector('.course-courseQaDiscussion-container .conv-content') ||
            document.querySelector('.course-courseQaDiscussion-container .bigTitle');
        if (!node) return '';
        return (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    }

    /**
     * 拼出给 AI 的课程上下文：章节、小节、当前课件、资源类型；
     * 如果当前是讨论区，再追加讨论题正文。
     */
    function studyContext() {
        const vm = getStudyVm();
        const entry = getCurrentItem(vm);
        let chapter = '';
        let section = '';

        if (entry && vm && vm.menuList) {
            const c = vm.menuList[entry.zIdx];
            const s = c && c.ZLJH ? c.ZLJH[entry.jIdx] : null;
            chapter = c && c.ZJMC ? c.ZJMC : '';
            section = s && s.ZJMC ? s.ZJMC : '';
        }

        const type = state.cw ? currentType(state.cw) : '';
        const lines = [
            '平台：重庆高等教育智慧教育平台',
            '章节：' + (chapter || '未知'),
            '小节：' + (section || '未知'),
            '当前内容：' + (entry && entry.MC ? entry.MC : '未选择'),
            '内容类型：' + (type || (entry && entry.LX === '3' ? '讨论' : '未知'))
        ];

        if (entry && entry.LX === '3') {
            const prompt = discussionPromptText();
            if (prompt) lines.push('讨论题目/正文：' + prompt);
        }

        return lines.join('\n');
    }

    function setAiBusy(busy) {
        state.aiBusy = busy;
        [els.aiExplain, els.aiSummary, els.aiDraft, els.aiSend, els.aiCopy].forEach(function (button) {
            if (button) button.disabled = busy;
        });
        els.aiSend.textContent = busy ? '请求中…' : '发送';
    }

    function setAiStatus(message, isError) {
        if (!els.aiStatus) return;
        els.aiStatus.textContent = message;
        els.aiStatus.classList.toggle('err', !!isError);
    }

    function setAiAnswer(text) {
        state.aiAnswer = text || '';
        els.aiAnswer.textContent = text || 'AI 回答会显示在这里。';
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                setAiStatus('回答已复制到剪贴板。', false);
            }).catch(function () {
                setAiStatus('复制失败，请手动选中回答复制。', true);
            });
        } else {
            setAiStatus('当前浏览器不支持自动复制，请手动选中回答复制。', true);
        }
    }

    /**
     * 调用 OpenAI 兼容的 /chat/completions 接口。
     * 安全边界：
     * - 考试/测验/作业上下文直接拒绝，不发送问题；
     * - 只把“课程上下文 + 用户问题”发给用户自己配置的接口；
     * - API Key 从本机 inputs/localStorage 读取，不写日志。
     *
     * @param {string} prompt 学习需求
     * @param {string} label  日志里的动作名
     */
    function askAI(prompt, label) {
        if (state.aiBusy) return;

        aiCfg.endpoint = (els.aiEndpoint.value || '').trim() || AI_DEFAULT_ENDPOINT;
        aiCfg.model = (els.aiModel.value || '').trim() || AI_DEFAULT_MODEL;
        aiCfg.apiKey = (els.aiKey.value || '').trim();
        saveAiCfg(aiCfg);

        if (!aiAllowed()) {
            setAiStatus('请先进入课件或讨论区再使用 AI。', true);
            return;
        }
        if (!aiCfg.apiKey) {
            setAiStatus('没有 API Key，先填写并保存。', true);
            return;
        }

        const systemPrompt = [
            '你是中文课程学习辅导助手，服务对象是正在学习重庆高等教育智慧教育平台课程的学生。',
            '帮助理解课程内容、整理知识点、解释概念、生成可编辑的答案或讨论草稿；可以结合当前页面题目给出作答参考。',
            '回答要简洁、分点、结合当前课程上下文，不要编造平台没有的课程信息。'
        ].join('\n');

        const userPrompt = '【课程上下文】\n' + studyContext() + '\n\n【学习需求】\n' + prompt;

        setAiBusy(true);
        setAiStatus(label + '：请求中…', false);
        setAiAnswer('');

        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 60000);

        fetch(aiCfg.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + aiCfg.apiKey
            },
            body: JSON.stringify({
                model: aiCfg.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.4,
                max_tokens: 900,
                stream: false
            }),
            signal: controller.signal
        }).then(function (response) {
            return response.text().then(function (raw) {
                clearTimeout(timer);
                let data = null;
                try { data = JSON.parse(raw); } catch (e) {}

                if (!response.ok) {
                    const detail = data && data.error && data.error.message
                        ? data.error.message
                        : raw.slice(0, 200);
                    throw new Error('HTTP ' + response.status + '：' + detail);
                }

                const content = data && data.choices && data.choices[0] &&
                    (data.choices[0].message ? data.choices[0].message.content : data.choices[0].text);
                if (!content) throw new Error('接口返回里没有 choices[0].message.content');
                setAiAnswer(String(content).trim());
                setAiStatus(label + '：完成', false);
            });
        }).catch(function (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') {
                setAiStatus('请求超时（60 秒），请检查网络或接口地址。', true);
            } else if (err instanceof TypeError) {
                setAiStatus('网络/CORS 错误：检查 API 地址是否允许浏览器跨域调用。', true);
            } else {
                setAiStatus('调用失败：' + (err && err.message ? err.message : err), true);
            }
        }).finally(function () {
            setAiBusy(false);
        });
    }

    function placeAt(left, top) {
        const rect = host.getBoundingClientRect();
        const width = rect.width || 340;
        const height = rect.height || 320;
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);
        const x = Math.max(margin, Math.min(Number(left) || margin, maxLeft));
        const y = Math.max(margin, Math.min(Number(top) || margin, maxTop));

        host.style.left = x + 'px';
        host.style.top = y + 'px';
        host.style.right = 'auto';
        host.style.bottom = 'auto';
        cfg.pos = { left: x, top: y };
    }

    function saveCfg() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({
                enabled: cfg.enabled,
                rate: cfg.rate,
                muted: cfg.muted,
                autoNext: cfg.autoNext,
                autoStart: cfg.autoStart,
                alertQuestion: cfg.alertQuestion,
                fastDoc: cfg.fastDoc,
                fillGaps: cfg.fillGaps,
                autoReply: cfg.autoReply,
                autoRecover: cfg.autoRecover,
                nextDelay: cfg.nextDelay,
                pos: cfg.pos
            }));
        } catch (e) {
            console.warn('[CQOOC助手] 保存设置失败', e);
        }
    }

    /* ------------------------------------------------------------------ */
    /* 小工具                                                             */
    /* ------------------------------------------------------------------ */

    function clampPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatClock(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
        return pad2(m) + ':' + pad2(s);
    }

    function formatMediaTime(seconds) {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n < 0) return '--:--';
        const total = Math.floor(n);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
        return m + ':' + pad2(s);
    }

    function setText(el, value) {
        if (el && el.textContent !== value) el.textContent = value;
    }

    function log(message) {
        const now = Date.now();
        if (state.lastLogMsg === message && now - state.lastLogAt < 3000) return;
        state.lastLogMsg = message;
        state.lastLogAt = now;

        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        state.logs.unshift(time + '  ' + message);
        while (state.logs.length > 7) state.logs.pop();
        renderLog();
        console.log('[CQOOC助手] ' + message);
    }

    function renderLog() {
        if (!els.log) return;
        els.log.textContent = '';
        state.logs.forEach(function (line) {
            const row = document.createElement('div');
            row.textContent = line;
            els.log.appendChild(row);
        });
        els.log.scrollTop = 0;
    }

    function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function isTypingTarget(target) {
        if (!target || !target.tagName) return false;
        const tag = target.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }

    /* ------------------------------------------------------------------ */
    /* Vue 实例与课程数据                                                 */
    /* ------------------------------------------------------------------ */

    /**
     * 深度遍历 Vue 组件树，找到 name === 'CourseStudy' 的实例。
     * 平台是 Vue 2，组件根 DOM 上会有 __vue__，这是最稳定的入口。
     */
    function findVmInTree(vm, depth) {
        if (!vm || depth > 24) return null;
        try {
            if (vm.$options && vm.$options.name === 'CourseStudy') return vm;
            const children = vm.$children || [];
            for (let i = 0; i < children.length; i++) {
                const found = findVmInTree(children[i], depth + 1);
                if (found) return found;
            }
        } catch (e) {}
        return null;
    }

    /**
     * 获取当前课程学习页的 CourseStudy 实例。
     * 优先从 .course-study-container.__vue__ 拿；页面刚加载时再退回 #app 递归查找。
     * 找不到就返回 null，tick() 会显示“页面加载中”，不会误操作。
     */
    function getStudyVm() {
        try {
            const elements = Array.from(document.querySelectorAll('.course-study-container'));
            const el = elements.find(isVisible) || elements[0];
            if (el && el.__vue__) {
                if (el.__vue__.$options && el.__vue__.$options.name === 'CourseStudy') return el.__vue__;
                const nested = findVmInTree(el.__vue__, 0);
                if (nested) return nested;
            }
            const app = document.querySelector('#app');
            if (app && app.__vue__) return findVmInTree(app.__vue__, 0);
        } catch (e) {}
        return null;
    }

    /**
     * 获取右侧 Courseware 组件（视频/文档/图片播放器）。
     * cwReady 判断时还会校验 cw.kjData.ID 是否等于当前目录项，防止拿到上一节的旧实例。
     */
    function getCoursewareVm(vm) {
        try {
            const elements = Array.from(document.querySelectorAll('.courseware-container'));
            const el = elements.find(isVisible) || elements[0];
            if (el && el.__vue__) return el.__vue__;
            if (vm) {
                const children = vm.$children || [];
                for (let i = 0; i < children.length; i++) {
                    if (children[i].$options && children[i].$options.name === 'Courseware') return children[i];
                }
            }
        } catch (e) {}
        return null;
    }

    /**
     * 把平台的三级目录拍平成数组。
     * 输出字段：
     * - item：平台原始对象（保留 JD 等响应式字段）
     * - zIdx/jIdx/iIdx：章节/小节/课件下标，selectJ 和 processFun 需要
     * - ID/LX/JD/MC：常用字段的快照，方便筛选
     */
    function flatLessons(vm) {
        const out = [];
        if (!vm || !Array.isArray(vm.menuList)) return out;

        vm.menuList.forEach(function (chapter, zIdx) {
            const sections = Array.isArray(chapter.ZLJH) ? chapter.ZLJH : [];
            sections.forEach(function (section, jIdx) {
                const lessons = Array.isArray(section.KJJH) ? section.KJJH : [];
                lessons.forEach(function (lesson, iIdx) {
                    if (!lesson || !lesson.ID) return;
                    out.push({
                        item: lesson,
                        ID: String(lesson.ID),
                        LX: String(lesson.LX),
                        JD: Number(lesson.JD) || 0,
                        MC: lesson.MC || '',
                        zIdx: zIdx,
                        jIdx: jIdx,
                        iIdx: iIdx
                    });
                });
            });
        });
        return out;
    }

    /**
     * 获取当前课件在目录中的完整条目。
     * 如果 menuList 还没加载完，vm.kjRow 可能只有 ID，此时返回一个兜底对象。
     */
    function getCurrentItem(vm) {
        if (!vm || !vm.kjRow || !vm.kjRow.ID) return null;
        const id = String(vm.kjRow.ID);
        const found = flatLessons(vm).find(function (entry) { return entry.ID === id; });
        if (found) return found;

        return {
            item: vm.kjRow,
            ID: id,
            LX: String(vm.kjRow.LX || ''),
            JD: Number(vm.kjRow.JD) || 0,
            MC: vm.kjRow.MC || '',
            zIdx: vm.kjRow.zIdx,
            jIdx: vm.kjRow.jIdx,
            iIdx: vm.kjRow.iIdx
        };
    }

    function isSkipped(id) {
        const until = state.skipUntil.get(String(id));
        if (!until) return false;
        if (Date.now() >= until) {
            state.skipUntil.delete(String(id));
            return false;
        }
        return true;
    }

    function isStudyable(entry) {
        return !!entry &&
            entry.LX === '1' &&
            !entry.item.isIconSuo &&
            String(entry.item.ZT) !== '4' &&
            !isSkipped(entry.ID);
    }

    function isDiscussion(entry) {
        return !!entry && entry.LX === '3';
    }

    /**
     * 自动连播可跳转的条目：
     * - 课件（LX=1）：原有逻辑；
     * - 讨论区（LX=3）：仅在开启“自动回讨论”时纳入，回复成功后继续下一节。
     * 讨论区没有课件完成度，靠 state.replied / replyTried 判定是否处理过。
     */
    function isNavigable(entry) {
        if (!entry) return false;
        if (entry.LX === '1') return isStudyable(entry);
        if (entry.LX === '3') return cfg.autoReply === true && !isSkipped(entry.ID);
        return false;
    }

    function isItemDone(entry) {
        if (!entry) return false;
        if (entry.JD >= 89 || Number(entry.item && entry.item.JD) >= 89) return true;
        if (entry.LX === '3') {
            if (state.replied.has(entry.ID)) return true;
            if (cfg.autoReply && state.replyTried.has(entry.ID)) return true;
        }
        return false;
    }

    /**
     * 选择下一节。
     * mode === 'after'：手动“下一节”，按当前顺序往后找；
     * 其他情况：自动连播，若 fillGaps 开启则优先补目录中最早未完成的课件。
     * 只返回 LX === '1'（课件）、未完成、未锁定、未被冷却的条目。
     */
    function findNext(vm, currentId, mode) {
        const all = flatLessons(vm);
        if (!all.length) return null;

        const candidates = all.filter(function (entry) {
            if (currentId && entry.ID === String(currentId)) return false;
            return isNavigable(entry) && !isItemDone(entry);
        });
        if (!candidates.length) return null;

        // 自动连播时优先补目录中最早未完成的课件，避免从中间开始后跳过前面的课。
        if (cfg.fillGaps && mode !== 'after') return candidates[0];

        let index = -1;
        if (currentId) {
            index = all.findIndex(function (entry) { return entry.ID === String(currentId); });
        }

        let order;
        if (index >= 0) {
            order = all.slice(index + 1).concat(all.slice(0, index));
        } else {
            order = all.slice();
        }

        for (let i = 0; i < order.length; i++) {
            const entry = order[i];
            if (currentId && entry.ID === String(currentId)) continue;
            if (isNavigable(entry) && !isItemDone(entry)) return entry;
        }
        return null;
    }

    function currentType(cw) {
        return cw && cw.dataLeft && cw.dataLeft.ZYMTLX ? String(cw.dataLeft.ZYMTLX) : '';
    }

    /**
     * 平台 2026-10-29 新版 216.e904bd69.js 的 Courseware 组件在 data 里把
     * _throttleFinishLesson 初始化为 null，但 mounted 没有赋值；
     * 视频最后 5 秒 timeupdate 会执行 this._throttleFinishLesson()，导致
     * "Uncaught TypeError: this._throttleFinishLesson is not a function"。
     * 这里按平台原设计补一个 5 秒节流的 finishLesson 包装，避免结尾报错。
     */
    function patchCoursewareVm(cw) {
        if (!cw || cw.__cqoocThrottlePatched) return;
        try {
            if (typeof cw._throttleFinishLesson !== 'function') {
                let last = 0;
                cw._throttleFinishLesson = function () {
                    const now = Date.now();
                    if (now - last < 5000) return;
                    last = now;
                    try {
                        if (typeof cw.finishLesson === 'function') cw.finishLesson();
                    } catch (e) {
                        console.warn('[CQOOC助手] 兜底 finishLesson 失败', e);
                    }
                };
                cw.__cqoocThrottlePatched = true;
                log('检测到平台组件缺少 _throttleFinishLesson，已补上（规避视频结尾 TypeError）');
            }
        } catch (e) {}
    }

    /**
     * 视频/音频接近结尾时主动调用平台 finishLesson：平台自身 timeupdate
     * 因上面的异常可能无法上报完成，这里兜底一次（每个课件只调用一次）。
     */
    function ensureVideoFinished(cw, entry) {
        if (!cw || !entry) return;
        const type = currentType(cw);
        if (type !== 'video' && type !== 'audio') return;
        const total = Number(cw.ZSC);
        const current = Number(cw.dqjd);
        if (!(total > 0) || !Number.isFinite(current) || current < total - 5) return;
        if (cw.isEmit && cw.isEmit.end) return;
        if (state.finishCalledFor === String(entry.ID)) return;
        state.finishCalledFor = String(entry.ID);
        try {
            if (typeof cw.finishLesson === 'function') {
                cw.finishLesson();
                log('视频已接近结尾，主动调用 finishLesson 上报完成（规避平台 _throttleFinishLesson 异常）');
            }
        } catch (e) {}
    }

    function getProgress(entry, cw) {
        if (!entry) return 0;
        if (entry.JD >= 89) return 100;
        if (!cw) return clampPercent(entry.JD);

        const type = currentType(cw);
        if (type === 'video' || type === 'audio') {
            const total = Number(cw.ZSC);
            const current = Number(cw.dqjd);
            if (total > 0 && Number.isFinite(current)) return clampPercent((current / total) * 100);
        } else if (type === 'doc' || type === 'image' || type === 'swf' || type === 'other') {
            const total = Number(cw.ZSC);
            const left = Number(cw.time);
            if (total > 0 && Number.isFinite(left)) return clampPercent(((total - left) / total) * 100);
        }
        return clampPercent(entry.JD);
    }

    function buildSubText(entry, cw) {
        if (!entry) return '打开课程后会自动识别当前课件';
        if (entry.LX !== '1') return '当前不是课件，脚本已暂停自动操作';

        const type = currentType(cw);
        if (!type) return '课件资源加载中…';

        if (type === 'video' || type === 'audio') {
            const total = Number(cw.ZSC);
            const current = Number(cw.dqjd);
            const parts = [type === 'video' ? '视频' : '音频', cfg.rate + '×'];
            if (total > 0) parts.push(formatMediaTime(current) + ' / ' + formatMediaTime(total));
            if (cfg.muted) parts.push('静音');
            return parts.join(' · ');
        }

        if (type === 'doc') {
            const left = Number(cw.time);
            if (Number.isFinite(left) && left > 0) return '文档 · 完成倒计时 ' + Math.ceil(left) + 's';
            return '文档 · 等待平台计时';
        }

        if (type === 'image') {
            const left = Number(cw.time);
            if (Number.isFinite(left) && left > 0) return '图片 · 完成倒计时 ' + Math.ceil(left) + 's';
            return '图片 · 等待平台计时';
        }

        if (type === 'swf') return 'Flash/其他课件 · 不自动操作';
        return '其他课件 · 不自动操作';
    }

    function countdownFinished() {
        const root = document.querySelector('.courseware-container');
        if (!root) return false;

        const tip = root.querySelector('.countdown-tip');
        if (tip && /[：:\s]0\s*s?/i.test(tip.textContent || '')) return true;

        const nodes = Array.from(root.querySelectorAll('.countdown'));
        return nodes.length > 0 && nodes.every(function (node) {
            return String(node.textContent || '').trim() === '0';
        });
    }

    /**
     * 判断当前课件是否“真的完成”。
     * 重要：不能用 cw.isEmit.end 单独判断。
     * 平台切换视频时 isEmit.end 可能是上一节残留的 true，会误把半截视频判完成。
     * 现在是：
     * - 目录 JD >= 89；
     * - 视频：video.ended 或 dqjd 接近 ZSC；
     * - 文档/图片：time <= 0 或页面 .countdown 全部为 0。
     */
    function isDone(entry, cw) {
        if (!entry) return false;
        if (entry.JD >= 89) return true;
        if (entry.LX === '3') {
            return state.replied.has(entry.ID) || (cfg.autoReply && state.replyTried.has(entry.ID));
        }
        if (!cw) return false;
        if (cw.kjData && cw.kjData.ID && String(cw.kjData.ID) !== String(entry.ID)) return false;

        const type = currentType(cw);
        if (type === 'video' || type === 'audio') {
            // 切课件后的冷静期：等新播放器真正可见/初始化，避免旧播放器残留误判。
            if (Date.now() - (state.lessonChangedAt || 0) < 3000) return false;

            const media = (state.lessonMediaEl && isVisible(state.lessonMediaEl))
                ? state.lessonMediaEl
                : findMedia();
            if (media && media === state.lessonMediaEl) {
                const played = state.lessonMediaPlayed;
                const t = Number(media.currentTime) || 0;
                if (media.ended && (played > 1 || t > 1)) return true;
            }

            const total = Number(cw.ZSC);
            const current = Number(cw.dqjd);
            // 平台进度也要有“本课件实际播放过”的证据，避免沿用上一节/旧播放器的进度。
            if (total > 0 && Number.isFinite(current) && current >= total - 5 &&
                state.lessonMediaPlayed >= Math.min(5, Math.max(1, total * 0.05))) return true;
            return false;
        }

        if (type === 'doc' || type === 'image' || type === 'swf' || type === 'other') {
            const left = Number(cw.time);
            if (Number.isFinite(left) && left <= 0) return true;
            if (countdownFinished()) return true;
        }

        return false;
    }

    /* ------------------------------------------------------------------ */
    /* 页面状态                                                           */
    /* ------------------------------------------------------------------ */

    function pagePath() {
        const hash = location.hash || '';
        if (hash.indexOf('#/') === 0) {
            return hash.slice(1).split('?')[0];
        }
        return location.pathname;
    }

    function isStudyPage() {
        const path = pagePath().replace(/\/+$/, '');
        return path === STUDY_PATH;
    }

    function updateView(entry, cw) {
        state.item = entry;
        state.cw = cw;
        state.lessonTitle = entry ? (entry.MC || '未命名课件') : '等待进入课程学习页';
        state.progress = getProgress(entry, cw);
        state.subText = buildSubText(entry, cw);
    }

    function setStatus(text, tone, subText) {
        state.statusText = text;
        state.tone = tone || '';
        if (typeof subText === 'string') state.subText = subText;
    }

    function onCurrentChanged(entry) {
        const id = String(entry.ID);
        if (state.currentId === id) return;

        state.currentId = id;
        state.allDone = false;
        state.questionFor = null;
        state.fastDocFor = null;
        state.playBlocked = false;
        state.playFailCount = 0;
        state.stallSince = 0;
        state.pausedSince = 0;
        state.lastMediaTime = -1;
        state.mediaErrorAt = 0;
        state.lastMediaError = null;
        state.lessonChangedAt = Date.now();
        state.lessonMediaEl = null;
        state.lessonMediaPlayed = 0;
        state.overlayFor = null;
        state.resumeAfter = 0;
        if (state.nextTimer) {
            clearTimeout(state.nextTimer);
            state.nextTimer = null;
        }
        restoreTitle();
        log('当前课件：' + (entry.MC || id));
    }

    /* ------------------------------------------------------------------ */
    /* 播放控制                                                           */
    /* ------------------------------------------------------------------ */

    function mediaArea(el) {
        const rect = el.getBoundingClientRect();
        return Math.max(0, rect.width) * Math.max(0, rect.height);
    }

    /**
     * 在当前 .courseware-container 里找可见的 video/audio。
     * 页面可能同时存在隐藏的旧播放器，所以优先取有尺寸的元素，再按面积排序。
     */
    function findMedia() {
        const root = document.querySelector('.courseware-container');
        let nodes;
        if (root) {
            nodes = Array.from(root.querySelectorAll('video, audio'));
        } else {
            nodes = Array.from(document.querySelectorAll('#dplayer video, .dplayer video, audio#audio'));
        }
        if (!nodes.length) return null;

        const visible = nodes.filter(isVisible);
        // 关键：切课件瞬间，上一节隐藏的 video 可能还在 DOM 里且已 ended，
        // 若回退到隐藏播放器会误判“本节完成”，进而快速连切、视频反复中断加载。
        if (!visible.length) return null;
        visible.sort(function (a, b) { return mediaArea(b) - mediaArea(a); });
        const media = visible[0] || null;
        if (media && state.lessonMediaEl !== media) {
            state.lessonMediaEl = media;
            state.lessonMediaPlayed = 0;
        }
        return media;
    }

    function ensureMediaSettings(media) {
        if (!media) return;
        try {
            if (cfg.muted !== media.muted) media.muted = cfg.muted;
            if (Math.abs(Number(media.playbackRate) - cfg.rate) > 0.01) {
                media.playbackRate = cfg.rate;
            }
        } catch (e) {}
    }

    /**
     * 给媒体元素绑定必要事件：
     * - ended：立即安排下一节；
     * - playing：重置失败/卡顿计数；
     * - error：记录错误起始时间，交给 watchdog；
     * - ratechange：DPlayer 切源后可能把倍速重置为 1，这里重新设回去。
     */
    function attachMedia(media) {
        if (!media || media.__cqoocAutoStudyAttached) return;
        media.__cqoocAutoStudyAttached = true;

        media.addEventListener('ended', function () {
            if (!cfg.enabled) return;
            const vm = getStudyVm();
            const entry = getCurrentItem(vm);
            if (!entry) return;
            ensureVideoFinished(getCoursewareVm(vm), entry);
            scheduleNext(vm, entry, '播放结束', Math.max(3000, cfg.nextDelay * 1000));
        });

        media.addEventListener('play', function () {
            state.playBlocked = false;
            ensureMediaSettings(media);
        });

        media.addEventListener('playing', function () {
            state.playBlocked = false;
            state.playFailCount = 0;
            state.stallSince = 0;
            state.pausedSince = 0;
            state.mediaErrorAt = 0;
            state.lastMediaError = null;
            state.lastMediaTime = Number(media.currentTime) || 0;
            if (state.lessonMediaEl === media) {
                state.lessonMediaPlayed = Math.max(state.lessonMediaPlayed, Number(media.currentTime) || 0);
            }
        });

        media.addEventListener('timeupdate', function () {
            if (state.lessonMediaEl === media) {
                const t = Number(media.currentTime) || 0;
                if (t > state.lessonMediaPlayed) state.lessonMediaPlayed = t;
            }
        });

        media.addEventListener('error', function () {
            const err = media.error;
            state.lastMediaError = {
                code: err ? err.code : 0,
                message: err && err.message ? String(err.message).slice(0, 200) : '',
                src: String(media.currentSrc || media.src || '').slice(0, 300),
                at: Date.now()
            };
            if (!state.mediaErrorAt) state.mediaErrorAt = Date.now();
            log('视频加载失败：code=' + state.lastMediaError.code +
                (state.lastMediaError.message ? '，' + state.lastMediaError.message : ''));
            setStatus('视频加载失败（code ' + state.lastMediaError.code + '）', 'err',
                'Alt+V 查看视频诊断；可先关闭“卡住刷新”再手动刷新页面');
        });

        media.addEventListener('ratechange', function () {
            if (!cfg.enabled) return;
            if (Math.abs(Number(media.playbackRate) - cfg.rate) > 0.01) {
                setTimeout(function () { ensureMediaSettings(media); }, 0);
            }
        });
    }

    function scanMedia(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches && root.matches('video, audio')) attachMedia(root);
        if (root.querySelectorAll) {
            root.querySelectorAll('video, audio').forEach(attachMedia);
        }
    }

    /**
     * 自动播放当前视频/音频。
     * - 先点一次视频遮罩，确保平台自己的 videoPlaying 状态被打开；
     * - 再设置静音/倍速并调用 play()；
     * - AbortError 是切源时的正常中断，不计失败；
     * - NotAllowedError 才是浏览器拦截自动播放，需要用户点一次。
     */
    function autoPlay(cw) {
        if (!cfg.autoStart) return;

        const type = currentType(cw);
        if (type !== 'video' && type !== 'audio') return;

        const overlayButton = document.querySelector('.video-overlay .play-btn');
        if (overlayButton && state.overlayFor !== state.currentId) {
            state.overlayFor = state.currentId;
            overlayButton.click();
        }

        const media = findMedia();
        if (!media) return;

        attachMedia(media);
        ensureMediaSettings(media);

        if (media.ended || !media.paused) return;
        if (Date.now() < state.resumeAfter) return;
        if (Date.now() - state.lastPlayAttempt < 4000) return;

        state.lastPlayAttempt = Date.now();

        function onPlayError(err) {
            const name = err && err.name ? err.name : '未知错误';

            if (name === 'AbortError') {
                // 切换视频源/刷新地址时很常见，不是播放能力问题，稍后重试即可。
                return;
            }

            if (name === 'NotAllowedError') {
                state.playBlocked = true;
                setStatus('浏览器拦截了自动播放', 'warn', '请手动点一下视频播放按钮');
                log('自动播放被拦截：NotAllowedError');
                return;
            }

            state.playFailCount += 1;
            log('播放失败：' + name + '（第 ' + state.playFailCount + ' 次）');
            if (state.playFailCount >= 4) {
                recoverVideo(media, 'play() ' + name);
            }
        }

        let result;
        try {
            result = media.play();
        } catch (err) {
            onPlayError(err);
            return;
        }
        if (result && result.catch) result.catch(onPlayError);
    }

    /**
     * 视频健康检查，每秒由 tick() 调用。
     * 触发条件：
     * - media.error 持续 8 秒；
     * - 正在播放但 readyState < 2 超过 15 秒；
     * - 播放中的 currentTime 45 秒不动；
     * - 暂停/未开始超过 30 秒（且不是弹题/用户手动暂停窗口）。
     * 触发后交给 recoverVideo()，最多自动刷新 3 次。
     */
    function checkVideoHealth(cw, entry) {
        if (!cfg.autoRecover) return;

        patchCoursewareVm(cw);
        ensureVideoFinished(cw, entry);

        const media = findMedia();
        if (!media) return;

        const now = Date.now();

        if (media.error) {
            if (!state.mediaErrorAt) state.mediaErrorAt = now;
            const code = media.error.code;
            // 错误码 4（MEDIA_ERR_SRC_NOT_SUPPORTED）通常是视频源/网络/CDN 问题，
            // 自动刷新只会反复失败，这里只提示，不刷新。
            if (code === 4) {
                setStatus('视频源加载失败（code 4）', 'err',
                    '脚本不会自动刷新；请检查网络/平台资源，Alt+V 查看视频诊断');
                return;
            }
            if (now - state.mediaErrorAt > 8000) recoverVideo(media, '媒体错误 code ' + code);
            return;
        }
        state.mediaErrorAt = 0;

        if (!media.paused && !media.ended && media.readyState < 2) {
            if (!state.stallSince) state.stallSince = now;
            else if (now - state.stallSince > 15000) recoverVideo(media, '缓冲卡住');
            return;
        }
        if (media.readyState >= 2) state.stallSince = 0;

        if (media.paused && !media.ended && cfg.autoStart && !state.playBlocked &&
            now > state.resumeAfter && !isQuestionVisible(null)) {
            if (!state.pausedSince) state.pausedSince = now;
            else if (now - state.pausedSince > 30000) recoverVideo(media, '长时间未开始播放');
        } else {
            state.pausedSince = 0;
        }

        if (!media.paused && !media.ended) {
            const current = Number(media.currentTime);
            if (state.lastMediaTime >= 0 && Math.abs(current - state.lastMediaTime) < 0.05) {
                if (!state.stallSince) state.stallSince = now;
                else if (now - state.stallSince > 45000) recoverVideo(media, '播放进度卡住');
            } else {
                state.lastMediaTime = current;
                state.stallSince = 0;
            }

            if (current > 30) {
                try {
                    if (Number(sessionStorage.getItem('cqooc-recover-count') || 0) > 0) {
                        sessionStorage.removeItem('cqooc-recover-count');
                        log('视频播放正常，刷新计数已重置');
                    }
                } catch (e) {}
            }
        }
    }

    /**
     * 视频卡死后的恢复动作：location.reload()。
     * 用 sessionStorage 记录连续刷新次数，最多 3 次；
     * 视频正常播放到 30 秒后会自动清零，避免正常使用被误计数。
     */
    function recoverVideo(media, reason) {
        if (!cfg.autoRecover) {
            setStatus('视频卡住，请刷新页面', 'warn', reason);
            return;
        }

        const now = Date.now();
        if (now - state.lastRecoverAt < 60000) return;

        let count = 0;
        try {
            count = Number(sessionStorage.getItem('cqooc-recover-count') || 0);
        } catch (e) {}

        if (count >= 3) {
            setStatus('视频仍无法播放，请手动刷新', 'err', '已自动刷新 3 次');
            log('已自动刷新 3 次仍失败，停止自动刷新');
            return;
        }

        state.lastRecoverAt = now;
        try {
            sessionStorage.setItem('cqooc-recover-count', String(count + 1));
        } catch (e) {}

        log('视频无法播放（' + reason + '），自动刷新恢复');
        setStatus('视频卡住，正在刷新…', 'warn', reason);

        setTimeout(function () {
            try { location.reload(); } catch (e) {}
        }, 900);
    }

    /**
     * 只有文档和图片走“PPT 加速”；视频不在这里处理。
     */
    function isDocLike(type) {
        return type === 'doc' || type === 'image';
    }

    /**
     * PPT/文档加速（实验性，默认关闭）。
     * 平台文档用 cw.time 从 ZSC 每秒递减，减到 0 调 finishLesson；
     * 这里把 time 改成 1，让平台自己的倒计时在 1 秒后走完并提交。
     * 5 秒后如果还没完成，再调用页面自己的 finishLesson() 兜底。
     * 注意：这会跳过平台要求的学习时长，默认关闭。
     */
    function accelerateDoc(entry, cw) {
        if (!cfg.fastDoc || !entry || !cw || !isDocLike(currentType(cw))) return;
        if (state.fastDocFor === entry.ID) return;

        const left = Number(cw.time);
        if (!Number.isFinite(left) || left <= 1) return;

        state.fastDocFor = entry.ID;
        log('PPT 加速：等待课件初始化…');

        setTimeout(function () {
            if (!cfg.fastDoc) return;
            const vm = getStudyVm();
            const current = getCurrentItem(vm);
            const nowCw = getCoursewareVm(vm);
            if (!current || current.ID !== entry.ID || !nowCw) return;
            if (nowCw.kjData && nowCw.kjData.ID && String(nowCw.kjData.ID) !== String(entry.ID)) return;
            if (!isDocLike(currentType(nowCw))) return;

            const remain = Number(nowCw.time);
            if (Number.isFinite(remain) && remain > 1) {
                nowCw.time = 1;
                log('PPT 加速：倒计时已缩短，等待平台完成');
            }

            setTimeout(function () {
                if (!cfg.fastDoc) return;
                const vm2 = getStudyVm();
                const cur2 = getCurrentItem(vm2);
                const cw2 = getCoursewareVm(vm2);
                if (!cur2 || cur2.ID !== entry.ID || !cw2) return;
                if (isDone(cur2, cw2)) return;
                if (typeof cw2.finishLesson === 'function') {
                    cw2.finishLesson();
                    log('PPT 加速：调用页面完成');
                }
            }, 5000);
        }, 1500);
    }

    function discussionText() {
        const replies = Array.from(document.querySelectorAll('.reply-card .reply-content'));
        const node = replies.find(function (item) {
            return (item.innerText || '').trim().length >= 5;
        });
        if (!node) return '';
        return (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800);
    }

    function clickDiscussionReply() {
        const links = Array.from(document.querySelectorAll('.reply-section-header .action-link, .reply-actions .action-link'));
        const link = links.find(function (item) {
            return (item.innerText || '').indexOf('回复') !== -1;
        });
        if (!link) return false;
        link.click();
        return true;
    }

    /**
     * 讨论区处理完（或回复失败）后继续下一节。
     * 与 finishDiscussionReply 等价，但允许失败路径复用。
     */
    function scheduleDiscussionContinue(entry, reason, delay) {
        if (!cfg.autoNext || !entry) return;
        if (state.nextTimer) return;
        const vm = getStudyVm();
        const current = getCurrentItem(vm);
        if (!current || current.ID !== String(entry.ID)) return;

        state.nextTimer = setTimeout(function () {
            state.nextTimer = null;
            if (!cfg.enabled) return;
            const nowVm = getStudyVm();
            const now = getCurrentItem(nowVm);
            if (!now || now.ID !== String(entry.ID)) return;
            const next = findNext(nowVm, now.ID);
            if (next) {
                log((reason || '讨论区已处理') + '，准备下一节');
                navigate(nowVm, next);
            } else {
                markAllDone();
            }
        }, Math.max(2500, delay || cfg.nextDelay * 1000));
    }

    function finishDiscussionReply(entry) {
        scheduleDiscussionContinue(entry, '讨论已回复', 2500);
    }

    /**
     * 讨论区自动回复。
     * 流程：
     * 1. 从 .reply-card .reply-content 取第一条已有回复；
     * 2. 没有就点“展开回复”再取；
     * 3. 找“回复”入口，打开底部 textarea；
     * 4. 写入内容，点“发布回复”；
     * 5. 发布成功后按 autonext 规则切下一节。
     * manual=true 时会弹出确认框；autoReply 自动执行时不会弹。
     */
    function replyToDiscussion(manual) {
        if (state.replying) return;
        if (!manual && (!cfg.enabled || !cfg.autoReply)) return;

        const vm = getStudyVm();
        const entry = getCurrentItem(vm);
        if (!entry || entry.LX !== '3') {
            log('当前不是讨论区，无法回复');
            return;
        }
        if (!manual && state.replied.has(entry.ID)) {
            if (cfg.autoNext) scheduleDiscussionContinue(entry, '讨论已处理', 3000);
            return;
        }

        state.replyTried.add(entry.ID);
        state.replying = true;

        let text = discussionText();
        if (!text) {
            const toggle = document.querySelector('.reply-toggle');
            if (toggle && (toggle.innerText || '').indexOf('展开') !== -1) {
                toggle.click();
                setTimeout(function () {
                    text = discussionText();
                    if (!text) {
                        state.replying = false;
                        log('暂无评论可复制，请先展开回复或自己输入');
                        return;
                    }
                    fillAndSend();
                }, 700);
                return;
            }
            state.replying = false;
            log('暂无评论可复制，请自己输入或等有人回复');
            if (cfg.autoNext) scheduleDiscussionContinue(entry, '讨论区暂无可复制评论', 8000);
            return;
        }

        function fail(message) {
            state.replying = false;
            log(message);
            if (cfg.autoNext) scheduleDiscussionContinue(entry, '讨论回复失败，继续下一节', 8000);
        }

        function fillAndSend() {
            const textarea = document.querySelector('.course-courseQaDiscussion-reply textarea');
            if (!textarea) {
                fail('未找到回复框，可能讨论区未开放');
                return;
            }

            const value = (manual ? text : '看了大家的讨论，我也认为：' + text).slice(0, 1000);
            if (manual) {
                const preview = value.length > 220 ? value.slice(0, 220) + '…' : value;
                if (!window.confirm('将复制以下内容并发布为讨论回复：\n\n' + preview)) {
                    state.replying = false;
                    return;
                }
            }

            try {
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                setter.call(textarea, value);
            } catch (e) {
                textarea.value = value;
            }
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.focus();
            log('已填入讨论回复，准备发布');

            setTimeout(function () {
                const publish = document.querySelector('.course-courseQaDiscussion-reply .publish-btn');
                if (!publish) {
                    fail('未找到“发布回复”按钮');
                    return;
                }
                publish.click();
                state.replying = false;
                state.replied.add(entry.ID);
                markReplied(entry.ID);
                log('已发布讨论回复');
                finishDiscussionReply(entry);
            }, 600);
        }

        if (document.querySelector('.course-courseQaDiscussion-reply textarea')) {
            fillAndSend();
            return;
        }

        if (!clickDiscussionReply()) {
            fail('未找到“回复”入口，可能讨论区未开放');
            return;
        }

        setTimeout(function () {
            if (!document.querySelector('.course-courseQaDiscussion-reply textarea')) {
                fail('回复框没有出现，请手动点一次“回复”');
                return;
            }
            fillAndSend();
        }, 900);
    }

    function manualNext() {
        const vm = getStudyVm();
        if (!vm) {
            log('还没有进入课程学习页');
            return;
        }
        const entry = getCurrentItem(vm);
        const next = findNext(vm, entry ? entry.ID : '', 'after');
        if (!next) {
            markAllDone();
            return;
        }
        navigate(vm, next);
    }

    /**
     * 调用平台自己的 CourseStudy.selectJ() 切换课件。
     * 不直接改 URL，而是复用它自己的选中逻辑，确保右侧 Courseware 会重新加载。
     * 5 秒内没有真正切过去，就把目标加入 skipUntil 冷却 30 秒，避免死循环。
     */
    function navigate(vm, entry) {
        if (!vm || !entry || !entry.item || state.navigating) return;

        // 频繁切换保护：60 秒内切 5 次说明完成判定异常或视频加载失败，
        // 暂停自动下一节 2 分钟，避免把剩余课件全部“跳”过去。
        const nowTs = Date.now();
        state.switchTimes = (state.switchTimes || []).filter(function (t) { return nowTs - t < 60000; });
        state.switchTimes.push(nowTs);
        if (state.switchTimes.length >= 5) {
            state.switchTimes = [];
            state.autoNextBlockedUntil = nowTs + 120000;
            log('检测到 60 秒内频繁切换课件，已暂停自动下一节 2 分钟：视频可能加载失败，按 Alt+V 查看视频诊断');
            setStatus('频繁切换已暂停自动下一节', 'warn', '视频可能加载失败：Alt+V 诊断 / 关闭“卡住刷新”后手动刷新');
            return;
        }

        state.navigating = true;
        const target = entry.item;
        const targetId = String(target.ID);

        try {
            const chapter = vm.menuList[entry.zIdx];
            const section = chapter && chapter.ZLJH ? chapter.ZLJH[entry.jIdx] : null;
            if (chapter && !chapter.expand) vm.clcekSet(chapter);
            if (section && !section.expand) vm.clcekSetSecond(null, section, entry.zIdx);
        } catch (e) {}

        const payload = Object.assign({}, target, {
            zIdx: entry.zIdx,
            jIdx: entry.jIdx,
            iIdx: entry.iIdx
        });

        try {
            if (vm.menuAct) vm.menuAct.kj = target.ID;
            const result = vm.selectJ ? vm.selectJ(undefined, payload) : null;
            if (result && result.catch) {
                result.catch(function (err) { log('切换课件失败：' + (err && err.message ? err.message : err)); });
            }
            log('切换到：' + (target.MC || targetId));

            setTimeout(function () {
                state.navigating = false;
                const nowVm = getStudyVm();
                const now = getCurrentItem(nowVm);
                if (!now || now.ID !== targetId) {
                    state.skipUntil.set(targetId, Date.now() + 30000);
                    log('切换尚未生效，30 秒后重试');
                } else {
                    setTimeout(function () {
                        const row = document.querySelector('.courseware-row.active');
                        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
                    }, 500);
                }
            }, 5000);
        } catch (e) {
            log('页面切换调用失败，尝试点击目录');
            fallbackClick(entry);
            state.navigating = false;
        }
    }

    function fallbackClick(entry) {
        if (!entry || !entry.item) return;
        const name = String(entry.item.MC || '').trim();
        const rows = Array.from(document.querySelectorAll('.courseware-row'));
        const target = rows.find(function (row) {
            const icon = row.querySelector('.file-icon');
            const title = row.querySelector('.courseware-name');
            return icon && icon.textContent.indexOf('课件') !== -1 &&
                title && title.textContent.trim() === name;
        });
        if (target) {
            target.scrollIntoView({ block: 'center' });
            target.click();
        } else {
            log('未在目录中找到目标课件，请手动点击');
        }
    }

    /**
     * 当前课件完成后，延迟切下一节。
     * 延迟是为了等平台把 finish 请求上报完，避免刚完成就切走导致进度没记上。
     * 定时器触发时会再次确认 currentId 没变、isDone 仍为 true，防止用户中途手动切课。
     */
    function scheduleNext(vm, entry, reason, delay) {
        if (!cfg.autoNext || state.nextTimer || state.allDone) return;
        if (Date.now() < (state.autoNextBlockedUntil || 0)) return;

        state.nextTimer = setTimeout(function () {
            state.nextTimer = null;
            if (!cfg.enabled) return;
            if (Date.now() < (state.autoNextBlockedUntil || 0)) return;

            const nowVm = getStudyVm();
            if (!nowVm) return;
            const current = getCurrentItem(nowVm);
            if (!current || !entry || current.ID !== entry.ID) return;

            const nowCw = getCoursewareVm(nowVm);
            if (!isDone(current, nowCw)) {
                log('检测到尚未真正完成，继续等待');
                return;
            }

            const next = findNext(nowVm, current.ID);
            if (!next) {
                markAllDone();
                return;
            }
            log((reason || '完成') + '，准备下一节');
            navigate(nowVm, next);
        }, Math.max(1500, delay || cfg.nextDelay * 1000));
    }

    function markAllDone() {
        if (state.allDone) return;
        state.allDone = true;
        setStatus('全部课件已完成', 'on', '没有找到未完成的课件');
        log('全部课件已完成');
        beep();
    }

    function restoreTitle() {
        if (!state.titleAlert) return;
        document.title = state.baseTitle || document.title;
        state.titleAlert = false;
    }

    function flashTitle() {
        if (!state.titleAlert) {
            state.baseTitle = document.title || '';
            state.titleAlert = true;
        }
        document.title = '⚠ 需要答题 · ' + (state.baseTitle || '课程学习');
    }

    function beep() {
        const now = Date.now();
        if (now - state.lastBeepAt < 1500) return;
        state.lastBeepAt = now;
        try {
            const AudioCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtor) return;
            audioCtx = audioCtx || new AudioCtor();
            if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.value = 0.06;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.22);
        } catch (e) {}
    }

    /* ------------------------------------------------------------------ */
    /* AI 自动答题（v1.1.0 · 反作弊测试模式）                              */
    /* ------------------------------------------------------------------ */
    /*
     * 设计目标
     * --------
     * 1. 自动识别答题页（测验 / 作业 / 考试）以及视频弹题；
     * 2. 从页面 DOM 提取题目：单选题、多选题、判断题、填空题、简答题；
     * 3. 调用 OpenAI 兼容接口（默认 DeepSeek）批量作答，返回严格 JSON；
     * 4. 三种模式：
     *    assist  只把 AI 答案显示在面板里，不写页面（默认）；
     *    fill    自动把答案填入页面，但不点提交；
     *    submit  填入后点击页面自己的提交按钮（需要本会话勾选授权确认）；
     * 5. 为《考试 AI 检测测试方案》记录证据：答题耗时、填入结果、提交请求/响应、
     *    页面反馈、AI 延迟，可导出 JSON。
     *
     * 安全边界（不要删除）
     * --------------------
     * - 默认关闭、默认 assist，不碰页面；
     * - fill / submit 必须在面板里手动勾选“我确认已获授权”，且该确认不持久化，
     *   每次刷新页面都要重新确认；
     * - 生产域名（www.cqooc.com）会显示红色警告；脚本不隐藏、不绕过平台前端校验，
     *   只做页面级点击/输入，不直接调用平台私有接口伪造记录；
     * - 不记录 API Key，不把课程页面内容写进 localStorage。
     */

    const AA_CFG_KEY = 'cqooc-auto-answer-v1';
    const AA_PRODUCTION_HOST = /^(www\.)?cqooc\.com$/i;
    // 授权密钥只以“加盐 SHA-256 哈希”形式保存，源码与 localStorage 都不保存明文；
    // 密钥正确才解锁答题功能（这只是本机便利校验，不是安全机制）。
    const AA_AUTH_SALT = 'cqooc-aa-auth-v2';
    const AA_AUTH_HASH = 'ec105ef54d3ebd5529ebba5ac4745e12cf735d30be7a902a93190f5db799344f';
    const AA_DEFAULT_CFG = {
        enabled: false,        // 自动答题总开关（默认关闭）
        mode: 'assist',        // assist | fill | submit
        scope: 'all',          // all | quiz | exam | popup
        autoRun: false,        // 进入答题页后是否自动执行当前模式
        autoFill: true,        // AI 作答后自动填入（assist 模式也填入）
        authorized: false,     // 授权确认（密钥验证通过才会置 true）
        authVerified: false,   // 本次页面是否已通过密钥验证（密钥正确才可用答题功能）
        authToken: '',         // 密钥验证通过后保存的哈希标记（只存本机，不含明文）
        authPersist: false,    // 是否已持久化验证（由 authToken 推导）
        modeLocked: false,     // 固定当前答题模式（锁定后不可切换）
        batchSize: 8,          // 每次请求 AI 的题目数
        delayMin: 1200,        // 每题填入间隔下限（毫秒）
        delayMax: 3500,        // 每题填入间隔上限（毫秒）
        maxQuestions: 80,      // 单页最多识别题目数
        captureEvidence: true, // 是否记录反作弊检测证据
        selectors: {           // 高级：页面改版导致识别失败时手动指定
            block: '',
            group: '',
            option: '',
            stem: '',
            submit: ''
        }
    };

    /**
     * 读取自动答题配置；对字段做类型/范围兜底。
     * authorized 不持久化：每次页面加载都要求重新确认。
     */
    function loadAaCfg() {
        const base = JSON.parse(JSON.stringify(AA_DEFAULT_CFG));
        base.authorized = false;
        try {
            const raw = localStorage.getItem(AA_CFG_KEY);
            const saved = raw ? JSON.parse(raw) : null;
            if (!saved || typeof saved !== 'object') return base;
            base.enabled = saved.enabled === true;
            base.mode = ['assist', 'fill', 'submit'].indexOf(saved.mode) >= 0 ? saved.mode : 'assist';
            base.scope = ['all', 'quiz', 'exam', 'popup'].indexOf(saved.scope) >= 0 ? saved.scope : 'all';
            base.autoRun = saved.autoRun === true;
            base.autoFill = saved.autoFill !== false;
            base.modeLocked = saved.modeLocked === true;
            base.batchSize = Math.max(1, Math.min(20, Number(saved.batchSize) || 8));
            base.delayMin = Math.max(0, Math.min(20000, Number(saved.delayMin) || 1200));
            base.delayMax = Math.max(base.delayMin, Math.min(30000, Number(saved.delayMax) || 3500));
            base.maxQuestions = Math.max(1, Math.min(200, Number(saved.maxQuestions) || 80));
            base.captureEvidence = saved.captureEvidence !== false;
            base.authToken = typeof saved.authToken === 'string' ? saved.authToken : '';
            base.authVerified = base.authToken === AA_AUTH_HASH;
            base.authPersist = base.authVerified;
            base.authorized = base.authVerified;
            if (saved.selectors && typeof saved.selectors === 'object') {
                ['block', 'group', 'option', 'stem', 'submit'].forEach(function (k) {
                    if (typeof saved.selectors[k] === 'string') base.selectors[k] = saved.selectors[k];
                });
            }
        } catch (e) {
            console.warn('[CQOOC答题] 读取配置失败', e);
        }
        return base;
    }

    /**
     * 保存自动答题配置。authorized 只存在内存里，不写入 localStorage。
     */
    function saveAaCfg() {
        try {
            localStorage.setItem(AA_CFG_KEY, JSON.stringify({
                enabled: aaCfg.enabled,
                mode: aaCfg.mode,
                scope: aaCfg.scope,
                autoRun: aaCfg.autoRun,
                autoFill: aaCfg.autoFill !== false,
                batchSize: aaCfg.batchSize,
                delayMin: aaCfg.delayMin,
                delayMax: aaCfg.delayMax,
                maxQuestions: aaCfg.maxQuestions,
                captureEvidence: aaCfg.captureEvidence,
                modeLocked: aaCfg.modeLocked === true,
                authToken: aaCfg.authToken || '',
                authPersist: aaCfg.authPersist === true,
                selectors: aaCfg.selectors
            }));
        } catch (e) {
            console.warn('[CQOOC答题] 保存配置失败', e);
        }
    }

    const aaCfg = loadAaCfg();

    // 运行期状态：题目、答案、证据、流程进度。
    const aaState = {
        status: '自动答题未启用',
        pageKind: '',            // quiz / homework / exam / ''
        scopeAllowed: false,
        questions: [],           // [{index,type,stem,options,input,root,...}]
        answers: [],             // [{index,answer,brief,confidence}]
        busy: false,
        stage: 'idle',
        pageKey: '',
        signature: '',
        filled: 0,
        fillFailed: 0,
        submitted: false,
        submitFeedback: '',
        lastError: '',
        evidence: [],
        logs: [],
        popupHandled: '',
        popupBusy: false,
        runToken: 0
    };

    let aaModal = null;          // 遮罩层
    let aaEls = {};              // 面板内元素索引

    /* ---------------------------- 通用小工具 ---------------------------- */

    function aaHost() {
        return location.hostname || '';
    }

    function aaIsProductionHost() {
        return AA_PRODUCTION_HOST.test(aaHost());
    }

    function aaNow() {
        return Date.now();
    }

    function aaRand(min, max) {
        const lo = Math.max(0, Number(min) || 0);
        const hi = Math.max(lo, Number(max) || lo);
        return Math.round(lo + Math.random() * (hi - lo));
    }

    function aaSleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, Math.max(0, Number(ms) || 0));
        });
    }

    function aaText(el) {
        if (!el) return '';
        return String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function aaNormText(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[\s，。、；：:,.()（）【】\[\]<>《》"'“”‘’\-_/\\]/g, '');
    }

    function aaPath() {
        return pagePath() + location.search + location.hash;
    }

    function aaKindLabel(kind) {
        return ({ quiz: '测验', homework: '作业', exam: '考试' })[kind] || '未知页面';
    }

    function aaModeLabel(mode) {
        return ({ assist: 'assist 只显示答案', fill: 'fill 自动填入不提交', submit: 'submit 填入并提交' })[mode || aaCfg.mode] || '未知模式';
    }

    function aaTypeLabel(type) {
        return ({ single: '单选', multi: '多选', judge: '判断', fill: '填空', short: '简答', essay: '主观题' })[type] || '未知';
    }

    /**
     * 自动答题日志：写入面板 + 控制台。最多保留 60 条。
     */
    function aaLog(message, tone) {
        const text = String(message == null ? '' : message);
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        aaState.logs.unshift(time + '  ' + text);
        while (aaState.logs.length > 60) aaState.logs.pop();
        if (tone === 'err') aaState.lastError = text;
        console.log('[CQOOC答题] ' + text);
        aaRenderLog();
        aaRenderStatus();
    }

    /**
     * 写入反作弊测试证据。只记录字符串/数字，便于 JSON 导出。
     */
    function aaEvidence(entry) {
        if (!aaCfg.captureEvidence || !entry) return;
        try {
            aaState.evidence.push(Object.assign({ at: aaNow() }, entry));
            while (aaState.evidence.length > 150) aaState.evidence.shift();
        } catch (e) {}
    }

    /* ---------------------------- 页面识别 ---------------------------- */

    /**
     * 判断当前页面类型。
     * - 课程学习页里的测验/作业/考试课件按 state.item.LX 判断（2=测验，5=作业，6=考试）；
     * - 独立的答题页按路由判断，路由识别不到时用 DOM 兜底。
     */
    function aaPageKind() {
        if (isStudyPage()) {
            const lx = state.item && String(state.item.LX);
            if (lx === '2') return 'quiz';
            if (lx === '5') return 'homework';
            if (lx === '6') return 'exam';
            return '';
        }

        const path = (pagePath() + location.search).toLowerCase();
        if (/homeworktest|homework|zuoye/.test(path)) return 'homework';
        if (/exampaper|exam|kaoshi/.test(path)) return 'exam';
        if (/quiz|ceyan/.test(path)) return 'quiz';
        if (/(^|\/)test(\/|$|\?)/.test(path) || /testid=/.test(path)) return 'quiz';

        // DOM 兜底：先看主文档，再看 shadow root / 同源 iframe。
        const body = aaRootText(document).slice(0, 20000);
        if (aaOptionNodes(document).length >= 2) {
            if (/考试|交卷/.test(body)) return 'exam';
            if (/作业|提交作业/.test(body)) return 'homework';
            if (/测验|单选题|多选题|判断题/.test(body)) return 'quiz';
        }
        let roots = [];
        try { roots = aaRootDocs(); } catch (e) { roots = []; }
        for (let i = 1; i < roots.length; i++) {
            let text = '';
            let optionCount = 0;
            try {
                text = aaRootText(roots[i].root).slice(0, 12000);
                optionCount = aaOptionNodes(roots[i].root).length;
            } catch (e) { continue; }
            if (optionCount >= 2 || /单选题|多选题|判断题|请作答/.test(text)) {
                if (/考试|交卷/.test(text)) return 'exam';
                if (/作业|提交作业/.test(text)) return 'homework';
                return 'quiz';
            }
        }
        return '';
    }

    function aaScopeAllows(kind) {
        if (!kind) return false;
        if (aaCfg.scope === 'all') return true;
        if (aaCfg.scope === 'quiz') return kind === 'quiz' || kind === 'homework';
        if (aaCfg.scope === 'exam') return kind === 'exam';
        return false;
    }

    function aaPopupAllowed() {
        return aaCfg.enabled && (aaCfg.scope === 'all' || aaCfg.scope === 'popup');
    }

    /* ---------------------------- 题目提取 ---------------------------- */

    /**
     * 收集可访问的 DOM 根：主文档 → open shadow root → 同源 iframe 文档。
     * 有些平台把题目渲染在组件 shadow DOM 或同源 iframe 里，主文档直接查不到。
     */
    function aaRootDocs() {
        const roots = [];
        const seen = [];
        const addDoc = function (doc, depth) {
            if (!doc || seen.indexOf(doc) >= 0 || depth > 2) return;
            seen.push(doc);
            roots.push({ kind: 'document', doc: doc, root: doc });
            let all = [];
            try { all = Array.prototype.slice.call(doc.querySelectorAll('*')); } catch (e) { all = []; }
            for (let i = 0; i < all.length && i < 4000; i++) {
                if (all[i].id === 'cqooc-auto-study-host') continue;
                if (all[i].closest && all[i].closest('#cqooc-auto-study-host')) continue;
                const sr = all[i].shadowRoot;
                if (sr && sr.mode === 'open' && seen.indexOf(sr) < 0) {
                    seen.push(sr);
                    roots.push({ kind: 'shadow', doc: doc, root: sr, host: all[i] });
                }
            }
            let frames = [];
            try { frames = Array.prototype.slice.call(doc.querySelectorAll('iframe, frame')); } catch (e) { frames = []; }
            for (let j = 0; j < frames.length && j < 8; j++) {
                let innerDoc = null;
                try { innerDoc = frames[j].contentDocument; } catch (e) { innerDoc = null; }
                if (innerDoc && innerDoc.documentElement) addDoc(innerDoc, depth + 1);
            }
        };
        addDoc(document, 0);
        return roots;
    }

    /** 文档/元素根上的可见文本（shadow root 与 iframe document 都适用）。 */
    function aaRootText(root) {
        if (!root) return '';
        try {
            if (root.body) return root.body.innerText || root.body.textContent || '';
            return root.innerText || root.textContent || '';
        } catch (e) {
            return '';
        }
    }

    /** 兼容 shadow / iframe 的可见性判断（isVisible 使用主窗口 getComputedStyle）。 */
    function aaVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        let rect = null;
        try { rect = el.getBoundingClientRect(); } catch (e) { rect = null; }
        if (!rect || rect.width < 2 || rect.height < 2) return false;
        let style = null;
        try {
            const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
            style = view.getComputedStyle(el);
        } catch (e) {
            style = null;
        }
        if (!style) return true;
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    // 真实答题页（cqooc /course/detail/homeworkTest/...）的选项是自定义 div：
    //   .question-item > .question-title + ... > .single-option-box > .single-option-item
    // 页面没有原生 input[type=radio/checkbox]，所以不能只靠 Ant Design 类名。
    const AA_OPTION_ITEM_SELECTOR = [
        '.single-option-item', '.multiple-option-item', '.judge-option-item',
        '.option-item', '[class*="option-item"]', '[class*="choice-item"]'
    ].join(', ');

    const AA_OPTION_FALLBACK_SELECTOR = [
        '[role="radio"]', '[role="checkbox"]',
        '[class*="single-option"]', '[class*="option"]', '[class*="choice"]',
        '[class*="radio"]', '[class*="checkbox"]'
    ].join(', ');

    const AA_STEM_SELECTOR = [
        '.question-title', '.question-stem', '.stem',
        '.single-select-title', '.multiple-select-title', '.judge-select-title',
        '[class*="select-title"]', '[class*="question-title"]', '[class*="stem"]'
    ].join(', ');

    /** 选项文本：真实页面可能把字母圈和内容分开渲染，用 __cqAaText 缓存兜底文本。 */
    function aaOptionText(node) {
        if (!node) return '';
        return node.__cqAaText || aaText(node);
    }

    /** 计算一个选项的完整文本（含兄弟节点 / 父级兜底）。 */
    function aaOptionTextFor(node) {
        const own = aaText(node);
        if (own.length >= 2 && !/^[A-Za-z][.、:：)）]?$/.test(own)) return own;

        let extra = '';
        let sib = node.nextElementSibling;
        for (let k = 0; sib && k < 2; k++, sib = sib.nextElementSibling) {
            let isOption = false;
            try {
                isOption = !!(sib.matches && sib.matches(AA_OPTION_ITEM_SELECTOR + ', ' + AA_OPTION_FALLBACK_SELECTOR));
            } catch (e) {}
            if (isOption) break;
            const t = aaText(sib);
            if (t.length >= 1) { extra = t; break; }
        }
        let text = (own + ' ' + extra).replace(/\s+/g, ' ').trim();
        if (text.length >= 2) return text;

        let cur = node;
        for (let d = 0; d < 3; d++) {
            cur = cur.parentElement;
            if (!cur) break;
            let count = 0;
            try { count = cur.querySelectorAll(AA_OPTION_ITEM_SELECTOR + ', ' + AA_OPTION_FALLBACK_SELECTOR).length; } catch (e) {}
            if (count > 1) break;
            const t = aaText(cur);
            if (t.length >= 2) return t;
        }
        return own;
    }

    /**
     * 选项节点查找（v1.1.2）：
     * 1) 原生 input 锚点（通用组件）；
     * 2) 真实平台的自定义选项 div（single-option-item / option-item 等）；
     * 3) 宽松兜底选择器；
     * 4) 高级设置里的自定义选项选择器。
     * 返回的元素会缓存 __cqAaText，后续提取/点击统一走 aaOptionText()。
     */
    function aaOptionNodes(root) {
        const scope = root || document;
        const custom = (aaCfg.selectors.option || '').trim();
        if (custom) {
            try {
                return Array.prototype.slice.call(scope.querySelectorAll(custom)).map(function (el) {
                    if (!el.__cqAaText) el.__cqAaText = aaOptionTextFor(el);
                    return el;
                });
            } catch (e) {}
        }
        const doc = scope.ownerDocument || scope.document || document;
        const nodes = [];
        const push = function (el) {
            if (!el || el.nodeType !== 1) return;
            if (el.closest && el.closest('#cqooc-auto-study-host')) return;
            if (nodes.indexOf(el) < 0) nodes.push(el);
        };

        // 1) 原生 input 锚点
        let inputs = [];
        try {
            inputs = Array.prototype.slice.call(scope.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
        } catch (e) { inputs = []; }
        inputs.forEach(function (input) {
            if (input.closest && input.closest('#cqooc-auto-study-host')) return;
            let host = input.closest ? input.closest('label') : null;
            if (!host) {
                let cur = input.parentElement;
                for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
                    if (!cur || cur === doc.body || cur === doc.documentElement) break;
                    const text = aaText(cur);
                    if (text.length >= 1 && text.length <= 300) { host = cur; break; }
                }
            }
            if (!host) host = input.parentElement;
            if (host) {
                if (!host.__cqAaText) host.__cqAaText = aaOptionTextFor(host);
                push(host);
            }
        });

        // 2) 自定义 div 选项
        if (!nodes.length) {
            let tier = [];
            try { tier = Array.prototype.slice.call(scope.querySelectorAll(AA_OPTION_ITEM_SELECTOR)); } catch (e) { tier = []; }
            if (!tier.length) {
                try { tier = Array.prototype.slice.call(scope.querySelectorAll(AA_OPTION_FALLBACK_SELECTOR)); } catch (e) { tier = []; }
            }
            tier.forEach(function (el) {
                if (el.closest && el.closest('#cqooc-auto-study-host')) return;
                const text = aaOptionTextFor(el);
                if (text.length < 1 || text.length > 200) return;
                let nested = null;
                try { nested = el.querySelector(AA_OPTION_ITEM_SELECTOR); } catch (e) {}
                if (nested) return;
                if (!aaVisible(el)) return;
                el.__cqAaText = text;
                push(el);
            });
        }

        // 只保留最内层的选项：包含其它选项节点的父节点丢掉。
        return nodes.filter(function (el, index) {
            for (let j = 0; j < nodes.length; j++) {
                if (j === index || nodes[j] === el) continue;
                if (el.contains && el.contains(nodes[j])) return false;
            }
            return true;
        });
    }


    function aaInputsOf(node) {
        return Array.prototype.slice.call(node.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    }

    function aaStripOptionLabel(text) {
        return String(text || '')
            .replace(/^\s*([A-Za-z])\s*[.、:：)）]\s*/, '')
            .replace(/^\s*([A-Za-z])\s+/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function aaOptionLetter(node, index) {
        const text = aaOptionText(node);
        const m = text.match(/^\s*([A-Za-z])\s*[.、:：)）]/) || text.match(/^\s*([A-Za-z])\s+/);
        return m ? m[1].toUpperCase() : String.fromCharCode(65 + index);
    }

    /**
     * 清洗题干：去掉题号、“单选题”等题型前缀、分值括号、末尾空括号。
     */
    function aaCleanStem(text) {
        let s = String(text || '').replace(/\s+/g, ' ').trim();
        s = s.replace(/^[（(【\[]?\s*\d{1,3}\s*[.、)）\]】]\s*/, '');
        s = s.replace(/^(单选题|多选题|判断题|不定项选择题|单项选择题|多项选择题|填空题|简答题|名词解释|论述题|计算题|问答题|案例分析题|简答|填空|判断)\s*[:：]?\s*/, '');
        s = s.replace(/[（(]\s*\d+(\.\d+)?\s*分\s*[)）]/g, '');
        s = s.replace(/\s*[（(]\s*[)）]\s*$/g, '');
        s = s.replace(/^(请|根据).{0,4}(回答|作答)[:：]\s*/, '');
        return s.replace(/\s{2,}/g, ' ').trim().slice(0, 500);
    }

    /**
     * 从原始题干里解析“原题编号”：例如 “12、...”“（3）...”“第 5 题” → 12 / 3 / 5。
     * 平台按题型分区时编号可能重复（单选 1、判断 1），展示时配合题型区分。
     */
    function aaQuestionNo(text, fallback) {
        const m = String(text || '').match(/^\s*[（(【\[]?\s*(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[.、,，:：)）\]】]/);
        if (m) {
            const n = Number(m[1]);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return Number(fallback) || 0;
    }

    /** 一组节点最近的公共祖先。 */
    function aaCommonAncestor(nodes) {
        if (!nodes || !nodes.length) return null;
        let cur = nodes[0];
        while (cur && cur.parentElement) {
            let containsAll = true;
            for (let i = 0; i < nodes.length; i++) {
                if (!cur.contains || !cur.contains(nodes[i])) { containsAll = false; break; }
            }
            if (containsAll) return cur;
            cur = cur.parentElement;
        }
        return null;
    }

    /**
     * 找选项组：优先按 input 的 name 分组（单选/多选最常见，最稳），
     * 没有 name 时按“最近的、至少包含 2 个选项的祖先”分组。
     */
    function aaFindOptionGroups(root) {
        const scope = root || document;
        const doc = scope.ownerDocument || scope.document || document;
        const custom = (aaCfg.selectors.group || '').trim();
        if (custom) {
            try {
                return Array.prototype.slice.call(scope.querySelectorAll(custom))
                    .map(function (g) { return { root: g, count: aaOptionNodes(g).length }; })
                    .filter(function (g) { return g.count >= 2; });
            } catch (e) {}
        }

        const nodes = aaOptionNodes(scope);
        const groups = [];
        const grouped = [];
        const byName = {};

        nodes.forEach(function (node) {
            const input = node.querySelector ? node.querySelector('input[type="radio"], input[type="checkbox"]') : null;
            const name = input && input.name;
            if (!name) return;
            if (!byName[name]) byName[name] = [];
            byName[name].push(node);
        });
        Object.keys(byName).forEach(function (name) {
            const list = byName[name];
            if (list.length < 2) return;
            const common = aaCommonAncestor(list);
            groups.push({ root: common || list[0].parentElement, count: list.length, nodes: list });
            list.forEach(function (n) { if (grouped.indexOf(n) < 0) grouped.push(n); });
        });

        nodes.forEach(function (node) {
            if (grouped.indexOf(node) >= 0) return;
            let cur = node.parentElement;
            let best = null;
            for (let depth = 0; cur && depth < 9; depth++, cur = cur.parentElement) {
                if (!cur || cur === doc.body || cur === doc.documentElement) break;
                const inside = aaOptionNodes(cur);
                if (inside.length >= 2) { best = { root: cur, count: inside.length }; break; }
            }
            if (!best) return;
            let duplicated = false;
            for (let i = 0; i < groups.length; i++) {
                const gr = groups[i].root;
                if (!gr) continue;
                if (gr === best.root || (gr.contains && gr.contains(best.root)) || (best.root.contains && best.root.contains(gr))) {
                    duplicated = true;
                    break;
                }
            }
            if (duplicated) return;
            const insideNodes = aaOptionNodes(best.root);
            groups.push({ root: best.root, count: insideNodes.length, nodes: insideNodes });
            insideNodes.forEach(function (n) { if (grouped.indexOf(n) < 0) grouped.push(n); });
        });

        return groups;
    }

    /**
     * 向上找题目容器：优先用平台真实类名 .question-title / .stem 取题干，
     * 取不到时用“容器文本 - 选项文本”兜底；最后尝试选项组前面的兄弟节点。
     */
    function aaQuestionContainer(groupRoot, optionTexts) {
        const doc = groupRoot.ownerDocument || document;
        let cur = groupRoot;
        for (let depth = 0; cur && depth < 8; depth++, cur = cur.parentElement) {
            if (!cur || cur === doc.body || cur === doc.documentElement) break;
            const insideCount = aaOptionNodes(cur).length;
            if (depth > 0 && insideCount > optionTexts.length) break;

            const stemSel = (aaCfg.selectors.stem || '').trim();
            let stemText = '';
            const stemSelectors = stemSel ? [stemSel, AA_STEM_SELECTOR] : [AA_STEM_SELECTOR];
            for (let s = 0; s < stemSelectors.length && !stemText; s++) {
                try {
                    const sn = cur.querySelector(stemSelectors[s]);
                    if (sn) stemText = aaText(sn);
                } catch (e) {}
            }
            if (!stemText) {
                let remain = aaText(cur);
                optionTexts.forEach(function (t) { if (t) remain = remain.split(t).join(' '); });
                stemText = remain;
            }
            const stem = aaCleanStem(stemText);
            if (stem.length >= 4 && stem.length <= 800) {
                return { root: cur, stem: stem, no: aaQuestionNo(stemText) };
            }
        }

        // 题干在选项组前面的兄弟节点里
        let prev = groupRoot.previousElementSibling;
        for (let k = 0; prev && k < 4; k++, prev = prev.previousElementSibling) {
            const raw = aaText(prev);
            const text = aaCleanStem(raw);
            if (text.length >= 4 && text.length <= 500) {
                return { root: groupRoot, stem: text, no: aaQuestionNo(raw) };
            }
        }
        return null;
    }

    function aaQuestionClassText(el) {
        let cls = '';
        let cur = el;
        for (let d = 0; cur && d < 4; d++, cur = cur.parentElement) {
            try {
                cls += ' ' + String((typeof cur.className === 'string' ? cur.className : (cur.getAttribute && cur.getAttribute('class'))) || '');
            } catch (e) {}
        }
        return cls;
    }

    /** 收集页面上的题型分区标题（一、单选题 / 二、多选题 / 三、填空题 / 四、判断题）。 */
    function aaSectionTypeMap(scope) {
        const map = { '单选题': 'single', '多选题': 'multi', '判断题': 'judge', '填空题': 'fill', '简答题': 'short' };
        const items = [];
        try {
            const all = scope.querySelectorAll('div, p, span, h1, h2, h3, h4, h5, h6, b, strong');
            for (let i = 0; i < all.length && i < 4000; i++) {
                const el = all[i];
                if (el.children.length > 3) continue;
                const text = aaText(el).trim();
                if (!text || text.length > 24) continue;
                const m = text.match(/^(?:[一二三四五六七八九十]+\s*[、.,]\s*)?(单选题|多选题|判断题|填空题|简答题)/);
                if (m) items.push({ el: el, type: map[m[1]] });
            }
        } catch (e) {}
        return items;
    }

    /** 找某道题所属题型分区：DOM 顺序中位于它之前、最近的题型标题。 */
    function aaSectionTypeFor(questionRoot, sectionItems) {
        if (!questionRoot || !sectionItems || !sectionItems.length) return '';
        let best = '';
        for (let i = 0; i < sectionItems.length; i++) {
            const item = sectionItems[i];
            if (!item.el || item.el === questionRoot) continue;
            try {
                const pos = questionRoot.compareDocumentPosition(item.el);
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) best = item.type;
            } catch (e) {}
        }
        return best;
    }

    function aaDetectQuestionType(groupNodes, groupRoot, stem, sectionType) {
        const inputs = [];
        groupNodes.forEach(function (n) { inputs.push.apply(inputs, aaInputsOf(n)); });
        if (!inputs.length && groupRoot && groupRoot.querySelectorAll) {
            try {
                inputs.push.apply(inputs, Array.prototype.slice.call(groupRoot.querySelectorAll('input[type="radio"], input[type="checkbox"]')));
            } catch (e) {}
        }
        if (inputs.some(function (i) { return i.type === 'checkbox'; })) return 'multi';

        const classText = aaQuestionClassText(groupRoot);
        if (/multiple|multi-option|duoxuan|checkbox/i.test(classText)) return 'multi';
        if (/judge|truefalse|panduan|pd-question/i.test(classText)) return 'judge';

        const texts = groupNodes.map(function (n) {
            return aaStripOptionLabel(aaOptionText(n))
                .replace(/[。.,，；;：:]+$/g, '')
                .replace(/[\s"“”]/g, '');
        });
        const judgeWords = /^(正确|错误|对|错|是|否|true|false|√|×|✔|✘|t|f|○|✗)$/i;
        if (texts.length === 2 && texts.every(function (t) { return judgeWords.test(t); })) return 'judge';

        const stemText = String(stem || '') + ' ' + aaText(groupRoot);
        if (texts.length === 2 && /判断|对错|正确还是错误|是否正确|正确与否|判断题/.test(stemText)) return 'judge';

        // 真实答题页按“一、单选题 / 二、多选题 / 三、填空题 / 四、判断题”分区，
        // 选项文本可能只有图标或 A/B 字母，用分区标题兜底。
        if (sectionType === 'multi') return 'multi';
        if (sectionType === 'judge' && texts.length <= 2) return 'judge';
        if (sectionType === 'single') return 'single';
        return 'single';
    }

    function aaIsRichEditor(el) {
        if (!el || !el.tagName) return false;
        const tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return false;
        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
        const cls = String(el.className || '') + ' ' + String(el.getAttribute('data-placeholder') || '');
        return /ql-editor|ProseMirror|w-e-text|wangEditor|editor-content|rich-text/i.test(cls);
    }

    function aaFindTextInputs(root) {
        const scope = root || document;
        let list = [];
        try {
            list = Array.prototype.slice.call(scope.querySelectorAll(
                'textarea, input[type="text"], input.ant-input, .ant-input, .el-textarea__inner, .el-input__inner, ' +
                '[contenteditable="true"], .ql-editor, .ProseMirror, .w-e-text, ' +
                '[class*="textarea"], [class*="editor-content"], [class*="rich-text"]'
            ));
        } catch (e) { list = []; }
        return list.filter(function (el) {
            if (!el || el.disabled || el.readOnly) return false;
            const type = (el.getAttribute && el.getAttribute('type')) || '';
            if (type && type !== 'text') return false;
            if (el.closest && el.closest('.ant-select, .ant-input-search, .ant-pagination, .ant-modal-close, .el-select, .el-date-editor, .el-pagination')) return false;
            const placeholder = (el.getAttribute && el.getAttribute('placeholder')) || '';
            if (/搜索|search/i.test(placeholder)) return false;
            const cls = String(el.className || '');
            if (/search|pagination/i.test(cls)) return false;
            return aaVisible(el) || !el.getClientRects;
        });
    }

    function aaIsUiNoiseText(text) {
        const t = String(text || '').trim();
        if (!t) return true;
        if (/^[A-Za-z\s,，.。;；:：|/\\]+$/.test(t)) return true;
        if (/默认字号|默认字体|默认行高|正文默认|请填写您的答案|请填写作业内容|请输入答案|展开更多|收起/.test(t) && t.length < 80) return true;
        if (t.length < 10) return true;
        return false;
    }

    /**
     * 富文本编辑器（wangEditor/Slate）题目：从编辑器往前找真正的题干。
     * 平台作业页的工具栏里有“默认字号 / 默认字体 / 默认行高”，
     * 直接取容器文字很容易把工具栏当题干；这里按 DOM 顺序收集编辑器前面的文本，
     * 过滤工具栏/占位符，取靠近编辑器的题目正文。
     */
    function aaEssayStemFromEditor(input) {
        if (!input) return '';
        const doc = input.ownerDocument || document;
        const candidates = [];

        // 1) 逐层向上，收集编辑器前面的兄弟元素（最近的在前面）
        let node = input;
        for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
            let sib = node.previousElementSibling;
            let guard = 0;
            while (sib && guard < 20) {
                candidates.push(sib);
                sib = sib.previousElementSibling;
                guard++;
            }
        }

        // 2) 按 DOM 顺序排序，过滤 UI 噪音，保留题目正文
        candidates.sort(function (a, b) {
            if (a === b) return 0;
            try {
                return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
            } catch (e) {
                return 0;
            }
        });

        const parts = [];
        candidates.forEach(function (el) {
            // 跳过包含编辑器的容器本身，避免把答案/工具栏混进来
            if (el.contains && el.contains(input)) return;
            const raw = aaText(el);
            if (!raw || aaIsUiNoiseText(raw)) return;
            const text = aaCleanStem(raw);
            if (!text || aaIsUiNoiseText(text)) return;
            if (text.length > 1200) return;
            if (parts.indexOf(text) >= 0) return;
            parts.push(text);
        });

        // 3) 取最后几段（最靠近编辑器）作为题干；至少包含 8 个字符
        let stem = parts.slice(-3).join(' ').trim();
        stem = stem
            .replace(/←?\s*返回列表/g, '')
            .replace(/作答结束倒计时[:：]?\s*[\d:：]+/g, '')
            .replace(/当前页面值[:：]?/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (stem.length > 1200) stem = stem.slice(-1200);
        return stem;
    }

    function aaTextQuestionContainer(input, optionGroups) {
        const doc = input.ownerDocument || document;
        let cur = input.parentElement;
        const inGroup = function (el) {
            return optionGroups.some(function (g) { return g.root === el || g.root.contains(el); });
        };
        const classMatch = function (el) {
            const cls = String((el && el.className) || '');
            return /(question|exam|paper|homework|test|item|timu|subject|q-)/i.test(cls);
        };
        for (let depth = 0; cur && depth < 9; depth++, cur = cur.parentElement) {
            if (!cur || cur === doc.body || cur === doc.documentElement) break;
            if (inGroup(cur)) return null;
            if (classMatch(cur)) {
                let remain = aaText(cur);
                const own = aaText(input);
                if (own) remain = remain.split(own).join(' ');
                const stem = aaCleanStem(remain);
                if (stem.length >= 3) return { root: cur, stem: stem, no: aaQuestionNo(remain) };
            }
            if (depth >= 1 && aaText(cur).length > 10 &&
                cur.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], .ql-editor, .ProseMirror, .w-e-text').length === 1) {
                const remain = aaText(cur);
                const stem = aaCleanStem(remain.split(aaText(input)).join(' '));
                if (stem.length >= 3) return { root: cur, stem: stem, no: aaQuestionNo(remain) };
            }
        }
        return null;
    }

    /**
     * 从页面（或指定容器，例如弹题弹窗）提取题目，按 DOM 顺序返回。
     * 返回的题目对象带 DOM 引用，只在内存里使用，导出时会转成纯数据。
     */
    function aaExtractFromRoot(root) {
        const scope = root || document;
        const questions = [];

        const sectionItems = aaSectionTypeMap(scope);
        const pushChoice = function (nodes, info, typeRoot) {
            if (!nodes || nodes.length < 2 || !info) return;
            const sectionType = aaSectionTypeFor(info.root, sectionItems);
            const type = aaDetectQuestionType(nodes, typeRoot || info.root, info.stem, sectionType);
            const options = nodes.map(function (n, i) {
                let text = aaStripOptionLabel(aaOptionText(n));
                if (type === 'judge' && !text) text = i === 0 ? '正确' : '错误';
                return { letter: aaOptionLetter(n, i), text: text, node: n };
            });
            questions.push({
                kind: 'choice',
                type: type,
                stem: info.stem,
                no: info.no || 0,
                root: info.root,
                element: nodes[0],
                options: options
            });
        };

        // 高级设置：题目容器选择器。设置后按容器逐个解析。
        const blockSel = (aaCfg.selectors.block || '').trim();
        if (blockSel) {
            let blocks = [];
            try { blocks = Array.prototype.slice.call(scope.querySelectorAll(blockSel)); } catch (e) {}
            blocks.forEach(function (block) {
                const nodes = aaOptionNodes(block);
                if (nodes.length >= 2) {
                    const stemSel = (aaCfg.selectors.stem || '').trim();
                    let rawStem = '';
                    if (stemSel) {
                        try {
                            const sn = block.querySelector(stemSel);
                            if (sn) rawStem = aaText(sn);
                        } catch (e) {}
                    }
                    if (!rawStem) {
                        let remain = aaText(block);
                        nodes.map(function (n) { return aaOptionText(n); }).forEach(function (t) {
                            if (t) remain = remain.split(t).join(' ');
                        });
                        rawStem = remain;
                    }
                    const stem = aaCleanStem(rawStem);
                    if (stem.length >= 2) {
                        pushChoice(nodes, { root: block, stem: stem, no: aaQuestionNo(rawStem) }, block);
                    }
                    return;
                }
                const textInputs = aaFindTextInputs(block);
                textInputs.forEach(function (input, inputIndex) {
                    const rawStem = aaText(block).split(aaText(input)).join(' ');
                    const stem = aaCleanStem(rawStem);
                    if (stem.length < 2) return;
                    const placeholder = (input.getAttribute && (input.getAttribute('placeholder') || input.getAttribute('data-placeholder'))) || '';
                    const rich = aaIsRichEditor(input);
                    let realStem = stem;
                    if (rich) {
                        const essayStem = aaEssayStemFromEditor(input);
                        if (essayStem.length >= 8) realStem = essayStem;
                    }
                    questions.push({
                        kind: 'text',
                        type: rich ? 'essay'
                            : ((input.tagName === 'TEXTAREA' || Number(input.rows || 0) > 2) ? 'short' : 'fill'),
                        stem: (textInputs.length > 1 && placeholder && !rich) ? realStem + '（' + placeholder + '）' : realStem,
                        no: aaQuestionNo(rawStem),
                        root: block,
                        input: input,
                        blankIndex: inputIndex + 1,
                        options: []
                    });
                });
            });
            return aaFinalizeQuestions(questions);
        }

        // 默认：按选项组 + 文本输入框识别。
        const groups = aaFindOptionGroups(scope);
        groups.forEach(function (g) {
            const nodes = aaOptionNodes(g.root).filter(function (el) { return g.root.contains(el); });
            if (nodes.length < 2) return;
            const optionTexts = nodes.map(function (n) { return aaOptionText(n); });
            const info = aaQuestionContainer(g.root, optionTexts);
            if (!info) return;
            pushChoice(nodes, info, g.root);
        });

        // 文本输入框：同一容器里的多个空（如 第一【】/第二【】）拆成多道填空。
        const textGroups = [];
        aaFindTextInputs(scope).forEach(function (input) {
            if (groups.some(function (g) { return g.root.contains(input); })) return;
            if (questions.some(function (q) { return q.input === input; })) return;
            const container = aaTextQuestionContainer(input, groups);
            if (!container) return;
            let group = null;
            for (let i = 0; i < textGroups.length; i++) {
                if (textGroups[i].root === container.root) { group = textGroups[i]; break; }
            }
            if (!group) {
                group = { root: container.root, stem: container.stem, no: container.no, inputs: [] };
                textGroups.push(group);
            }
            group.inputs.push(input);
        });

        textGroups.forEach(function (group) {
            group.inputs.forEach(function (input, inputIndex) {
                const placeholder = (input.getAttribute && (input.getAttribute('placeholder') || input.getAttribute('data-placeholder'))) || '';
                const rich = aaIsRichEditor(input);
                let stem = group.stem;
                if (rich) {
                    const essayStem = aaEssayStemFromEditor(input);
                    if (essayStem.length >= 8) stem = essayStem;
                }
                if (group.inputs.length > 1 && !rich) {
                    stem = aaCleanStem(stem + '（' + (placeholder || ('第' + (inputIndex + 1) + '空')) + '）');
                }
                questions.push({
                    kind: 'text',
                    type: rich ? 'essay'
                        : ((input.tagName === 'TEXTAREA' || Number(input.rows || 0) > 2) ? 'short' : 'fill'),
                    stem: stem,
                    no: group.no || 0,
                    root: group.root,
                    input: input,
                    blankIndex: inputIndex + 1,
                    options: []
                });
            });
        });

        return aaFinalizeQuestions(questions);
    }

    /**
     * 页面级题目提取：先主文档；主文档没有题目时，再依次尝试 open shadow root
     * 与同源 iframe 文档。指定 root（例如弹题弹窗）时只在该容器内提取。
     */
    function aaExtractQuestions(root) {
        if (root) return aaExtractFromRoot(root);
        let questions = aaExtractFromRoot(document);
        if (questions.length) return questions;
        let roots = [];
        try { roots = aaRootDocs(); } catch (e) { roots = []; }
        for (let i = 1; i < roots.length; i++) {
            try {
                const host = roots[i].host;
                if (host && host.closest && host.closest('#cqooc-auto-study-host')) continue;
                questions = aaExtractFromRoot(roots[i].root);
                if (questions.length) return questions;
            } catch (e) {}
        }
        return [];
    }

    /**
     * 题目排序（按 DOM 顺序）、去重、编号、截断。
     */
    function aaFinalizeQuestions(questions) {
        const list = questions.slice();
        list.sort(function (a, b) {
            const ea = a.element || a.input;
            const eb = b.element || b.input;
            if (!ea || !eb || ea === eb) return 0;
            try {
                const pos = ea.compareDocumentPosition(eb);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
            } catch (e) {}
            return 0;
        });

        const seen = [];
        const out = [];
        list.forEach(function (q) {
            // 选择题按题目容器去重；文本题按输入框去重（支持一个题目容器里多个空）。
            const key = q.kind === 'choice' ? q.root : (q.input || q.root);
            if (seen.indexOf(key) >= 0) return;
            seen.push(key);
            q.index = out.length + 1;
            q.stem = aaCleanStem(q.stem);
            if (!q.no) q.no = q.index;
            out.push(q);
        });
        return out.slice(0, Math.max(1, Math.min(200, Number(aaCfg.maxQuestions) || 80)));
    }

    /**
     * 题目指纹：页面刷新/答题进度变化时用于判断“是不是同一批题”。
     */
    function aaQuestionSignature(questions) {
        const text = questions.map(function (q) {
            return q.index + '|' + q.type + '|' + q.stem + '|' +
                q.options.map(function (o) { return o.letter + o.text; }).join('/');
        }).join('||');
        let hash = 5381;
        for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
        return String(hash) + ':' + questions.length;
    }

    /* ---------------------------- AI 作答 ---------------------------- */

    function aaSyncAiCfg() {
        if (els.aiEndpoint) {
            aiCfg.endpoint = (els.aiEndpoint.value || '').trim() || AI_DEFAULT_ENDPOINT;
            aiCfg.model = (els.aiModel.value || '').trim() || AI_DEFAULT_MODEL;
            aiCfg.apiKey = (els.aiKey.value || '').trim();
        }
        if (aaEls.endpoint) {
            const ep = (aaEls.endpoint.value || '').trim() || aiCfg.endpoint;
            const model = (aaEls.model.value || '').trim() || aiCfg.model;
            const key = (aaEls.key.value || '').trim() || aiCfg.apiKey;
            aiCfg.endpoint = ep;
            aiCfg.model = model;
            aiCfg.apiKey = key;
        }
        return aiCfg;
    }

    function aaSystemPrompt() {
        return [
            '你是中文课程答题引擎，服务对象正在做重庆高等教育智慧教育平台的测验/作业/考试。',
            '你的任务：给出每题最可能的正确答案，用于平台反作弊检测测试。',
            '只输出 JSON，禁止输出 Markdown 代码块之外的任何解释。',
            '输出格式：{"answers":[{"index":1,"answer":["A"],"brief":"简短理由","confidence":0.8}]}',
            '规则：',
            '1. 单选题 answer 为单个选项字母组成的数组；多选题为多个字母组成的数组；',
            '2. 判断题 answer 为选项字母（必须来自题目选项字母，不要输出“正确/错误”文字）；',
            '3. 填空题/简答题 answer 为字符串，直接给出可填入的答案文本；',
            '4. 论述题/主观题（type 为 essay）：answer 为完整段落，题目有“不少于200字”等字数要求时必须写够（建议 250-400 字），可分点论述，不要只给关键词；',
            '5. 必须回答所有题目；不确定时给出最可能的答案，并把 confidence 调低；',
            '6. 选项字母必须来自题目给出的选项；不要编造题目以外的选项；',
            '7. 如果题目信息不完整，在 brief 里说明，但仍然给出 answer。'
        ].join('\n');
    }

    function aaUserPrompt(questions) {
        return JSON.stringify({
            page: {
                url: aaPath(),
                kind: aaState.pageKind,
                title: document.title || ''
            },
            questions: questions.map(function (q) {
                return {
                    index: q.index,
                    type: q.type,
                    stem: q.stem,
                    options: q.options.map(function (o) { return { letter: o.letter, text: o.text }; })
                };
            })
        });
    }

    /**
     * 从 AI 返回文本里提取 {"answers":[...]}。允许前面带 ```json 代码块。
     */
    function aaExtractJsonAnswers(content) {
        const text = String(content || '').trim();
        const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        let data = null;
        try {
            data = JSON.parse(cleaned);
        } catch (e) {
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try { data = JSON.parse(cleaned.slice(start, end + 1)); } catch (e2) {}
            }
        }
        if (!data || !Array.isArray(data.answers)) {
            throw new Error('AI 返回格式不对（需要 {"answers":[...]}）');
        }
        return data.answers;
    }

    /**
     * 单次 AI 请求。返回原始 answers 数组 + 耗时 + HTTP 状态。
     */
    function aaAskAIOnce(batch) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 90000);
        const started = aaNow();
        const body = {
            model: aiCfg.model,
            messages: [
                { role: 'system', content: aaSystemPrompt() },
                { role: 'user', content: aaUserPrompt(batch) }
            ],
            temperature: 0.2,
            max_tokens: 4000,
            stream: false
        };

        return fetch(aiCfg.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + aiCfg.apiKey
            },
            body: JSON.stringify(body),
            signal: controller.signal
        }).then(function (response) {
            return response.text().then(function (raw) {
                clearTimeout(timer);
                let data = null;
                try { data = JSON.parse(raw); } catch (e) {}
                if (!response.ok) {
                    const detail = data && data.error && data.error.message
                        ? data.error.message
                        : String(raw || '').slice(0, 200);
                    throw new Error('HTTP ' + response.status + '：' + detail);
                }
                const content = data && data.choices && data.choices[0] &&
                    (data.choices[0].message ? data.choices[0].message.content : data.choices[0].text);
                if (!content) throw new Error('接口返回里没有 choices[0].message.content');
                return {
                    answers: aaExtractJsonAnswers(content),
                    latencyMs: aaNow() - started,
                    status: response.status
                };
            });
        }).catch(function (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') throw new Error('AI 请求超时（90 秒）');
            if (err instanceof TypeError) throw new Error('网络/CORS 错误：确认 API 地址允许浏览器跨域调用');
            throw err;
        });
    }

    /**
     * 批量作答：按 batchSize 分批请求，失败自动重试一次。
     */
    async function aaAskAI(questions) {
        aaSyncAiCfg();
        if (!aiCfg.apiKey) throw new Error('未配置 API Key（可在本面板或 AI 助手弹窗填写）');
        if (!aiCfg.model) throw new Error('未配置模型名');

        const batchSize = Math.max(1, Math.min(20, Number(aaCfg.batchSize) || 8));
        const rawAnswers = [];
        for (let i = 0; i < questions.length; i += batchSize) {
            const batch = questions.slice(i, i + batchSize);
            let lastError = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const result = await aaAskAIOnce(batch);
                    rawAnswers.push.apply(rawAnswers, result.answers);
                    aaEvidence({
                        type: 'ai-call',
                        batch: Math.floor(i / batchSize) + 1,
                        count: batch.length,
                        latencyMs: result.latencyMs,
                        status: result.status,
                        model: aiCfg.model
                    });
                    aaLog('AI 第 ' + (Math.floor(i / batchSize) + 1) + ' 批完成（' + result.latencyMs + 'ms）');
                    lastError = null;
                    break;
                } catch (e) {
                    lastError = e;
                    aaLog('AI 调用失败（第 ' + (attempt + 1) + ' 次）：' + (e && e.message ? e.message : e), 'err');
                    await aaSleep(1200);
                }
            }
            if (lastError) throw lastError;
        }
        return aaNormalizeAnswers(rawAnswers, questions);
    }

    function aaNormalizeAnswers(rawAnswers, questions) {
        const list = [];
        (rawAnswers || []).forEach(function (item) {
            if (!item || typeof item !== 'object') return;
            const index = Number(item.index != null ? item.index : item.i);
            if (!Number.isFinite(index)) return;
            let answer = item.answer != null ? item.answer : item.a;
            if (answer == null) answer = '';
            list.push({
                index: index,
                answer: answer,
                brief: String(item.brief || item.reason || '').slice(0, 240),
                confidence: Number(item.confidence) || null
            });
        });
        return questions.map(function (q) {
            const found = list.filter(function (x) { return x.index === q.index; })[0];
            return found || { index: q.index, answer: '', brief: 'AI 未返回该题', confidence: 0 };
        });
    }

    function aaPreviewAnswers(answers) {
        return (answers || []).map(function (a) {
            let val = a.answer;
            if (Array.isArray(val)) val = val.join('');
            return a.index + ':' + String(val == null || val === '' ? '（空）' : val).slice(0, 24);
        }).join(' | ').slice(0, 400);
    }

    /* ---------------------------- 答案回填 ---------------------------- */

    /**
     * 把 AI 答案解析成要点击的选项。优先按字母，其次按选项文本，最后按判断词。
     */
    function aaPickOptions(question, answer) {
        const options = question.options || [];
        if (!options.length) return [];

        let raw = Array.isArray(answer) ? answer.join(',') : String(answer == null ? '' : answer);
        // 兼容 AI 直接返回 "AC" 这种连写字母。
        if (/^[A-Za-z]{2,}$/.test(raw.trim())) raw = raw.trim().split('').join(',');
        let letters = raw.split(/[,，、;；\s]+/)
            .map(function (x) { return String(x).trim().toUpperCase(); })
            .filter(function (x) { return /^[A-Z]$/.test(x); });

        let picked = [];
        letters.forEach(function (letter) {
            const opt = options.filter(function (o) { return o.letter === letter; })[0];
            if (opt && picked.indexOf(opt) === -1) picked.push(opt);
        });

        if (!picked.length && raw.trim()) {
            const ansNorm = aaNormText(raw);
            if (ansNorm.length >= 1) {
                picked = options.filter(function (o) {
                    const optNorm = aaNormText(o.text);
                    if (!optNorm) return false;
                    return ansNorm === optNorm || ansNorm.indexOf(optNorm) >= 0 ||
                        (optNorm.indexOf(ansNorm) >= 0 && ansNorm.length >= 2);
                });
            }
        }

        if (!picked.length && question.type === 'judge' && options.length === 2) {
            const ansNorm = aaNormText(raw);
            if (/^(正确|对|是|true|√|t|yes)$/.test(ansNorm)) picked = [options[0]];
            else if (/^(错误|错|否|false|×|f|no)$/.test(ansNorm)) picked = [options[1]];
        }

        if (question.type !== 'multi') picked = picked.slice(0, 1);
        return picked;
    }

    /**
     * 点击一个选项。Ant Design Vue 的 radio/checkbox 点击 input 即可触发
     * v-model；如果 input.click 没生效，再补发 input/change 事件。
     */
    /** 派发完整鼠标事件序列（部分自定义组件只监听 mousedown/mouseup/pointer 事件）。 */
    function aaFirePointerClick(target) {
        if (!target || typeof target.dispatchEvent !== 'function') return;
        const view = (target.ownerDocument && target.ownerDocument.defaultView) || window;
        const names = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        names.forEach(function (name) {
            try {
                let evt = null;
                if (name.indexOf('pointer') === 0 && view.PointerEvent) {
                    evt = new view.PointerEvent(name, { bubbles: true, cancelable: true, view: view });
                } else {
                    const Mouse = view.MouseEvent || MouseEvent;
                    evt = new Mouse(name, { bubbles: true, cancelable: true, view: view });
                }
                target.dispatchEvent(evt);
            } catch (e) {
                try {
                    const EventCtor = view.Event || Event;
                    target.dispatchEvent(new EventCtor(name, { bubbles: true }));
                } catch (e2) {}
            }
        });
    }

    /** 判断自定义选项是否已选中（class / aria-checked / 内部选中标记）。 */
    function aaOptionLooksChecked(node) {
        if (!node) return false;
        try {
            if (node.getAttribute && /true/i.test(String(node.getAttribute('aria-checked') || ''))) return true;
            if (node.getAttribute && /true/i.test(String(node.getAttribute('aria-selected') || ''))) return true;
            const self = String(node.className || '');
            if (/(^|[\s_-])(active|checked|selected|current|on)([\s_-]|$)|is-(checked|active)|radio-checked|checkbox-checked/i.test(self)) return true;
            const parent = node.parentElement ? String(node.parentElement.className || '') : '';
            if (/(^|[\s_-])(active|checked|selected|current)([\s_-]|$)|is-(checked|active)|radio-checked|checkbox-checked/i.test(parent)) return true;
            if (node.querySelector && node.querySelector('[aria-checked="true"], [aria-selected="true"], .checked, .is-checked, .active, .selected, [class*="checked"], [class*="selected"]')) return true;
            const inner = node.firstElementChild;
            if (inner) {
                const innerCls = String(inner.className || '');
                if (/(^|[\s_-])(active|checked|selected)([\s_-]|$)/i.test(innerCls)) return true;
            }
        } catch (e) {}
        return false;
    }

    /**
     * 点击一个选项，返回“是否检测到选中状态”。
     * 自定义 div 选项会依次尝试：选项本身 → 内部字母/内容节点 → 父级；
     * 每层都派发 pointerdown/mousedown/pointerup/mouseup/click，尽量命中平台监听。
     */
    /**
     * 点击选项并等待 Vue 更新选中态。
     * 真实页面的选中 class（.single-option-item.selected）是 nextTick 异步更新的，
     * 同步检查会误判“未选中”，旧逻辑于是重复点击多个目标——多选题会被偶数次点击取消。
     * 这里每个目标只点一次，等 130ms 再检查，命中即停。
     */
    async function aaApplyOptionClick(option) {
        const node = option && option.node;
        if (!node) return false;
        const input = node.querySelector ? node.querySelector('input[type="radio"], input[type="checkbox"]') : null;
        if (input) {
            if (input.checked) return true;
            try { input.click(); } catch (e) {}
            if (!input.checked) {
                input.checked = true;
                try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
                try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
            }
            return !!input.checked;
        }
        if (aaOptionLooksChecked(node)) return true;

        const targets = [];
        const add = function (el) {
            if (el && el.nodeType === 1 && targets.indexOf(el) < 0) targets.push(el);
        };
        add(node);
        try {
            const content = node.querySelector('.index, .title, span, i, label, b, em, p');
            if (content && content !== node) add(content);
        } catch (e) {}
        if (node.firstElementChild && node.firstElementChild !== node) add(node.firstElementChild);
        add(node.parentElement);

        for (let i = 0; i < targets.length; i++) {
            aaFirePointerClick(targets[i]);
            await aaSleep(130);
            if (aaOptionLooksChecked(node)) return true;
        }
        await aaSleep(200);
        return aaOptionLooksChecked(node);
    }

    function aaEscapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function aaIsSlateEditor(el) {
        if (!el) return false;
        try {
            if (el.closest && el.closest('[data-slate-editor]')) return true;
            if (el.closest) {
                const area = el.closest('[data-w-e-textarea]');
                if (area && area.querySelector('[data-slate-editor]')) return true;
            }
        } catch (e) {}
        return false;
    }

    function aaEditorText(el) {
        return String((el && el.textContent) || '');
    }

    function aaSelectEditorContents(el) {
        try {
            el.focus();
            const doc = el.ownerDocument || document;
            const sel = doc.getSelection ? doc.getSelection() : null;
            if (!sel) return false;
            const range = doc.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * wangEditor v5 / Slate：直接改 textContent 会绕过 Slate 的模型，导致编辑器
     * 「内容看得见但无法修改」。优先用 paste 事件让 Slate 自己插数据。
     */
    function aaInsertSlateViaPaste(el, text) {
        try {
            const lines = String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (!lines.length) return false;
            const html = lines.map(function (p) { return '<p>' + aaEscapeHtml(p) + '</p>'; }).join('');
            const before = aaEditorText(el);
            aaSelectEditorContents(el);
            let ev;
            const fakeData = {
                types: ['text/html', 'text/plain'],
                getData: function (type) {
                    return String(type || '').indexOf('html') >= 0 ? html : String(text);
                }
            };
            try {
                const dt = new DataTransfer();
                dt.setData('text/plain', String(text));
                dt.setData('text/html', html);
                ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
            } catch (e) {
                ev = new Event('paste', { bubbles: true, cancelable: true });
                try { Object.defineProperty(ev, 'clipboardData', { value: fakeData }); } catch (e2) {
                    return false;
                }
            }
            el.dispatchEvent(ev);
            const after = aaEditorText(el);
            return after.indexOf(lines[0].slice(0, 12)) >= 0 && after !== before;
        } catch (e) {
            return false;
        }
    }

    /**
     * Slate 原生 beforeinput：insertText / insertParagraph，让编辑器按自己的模型写入。
     */
    function aaInsertSlateViaBeforeInput(el, text) {
        try {
            const lines = String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (!lines.length) return false;
            const before = aaEditorText(el);
            if (!aaSelectEditorContents(el)) return false;
            const fire = function (inputType, data) {
                let ev;
                try {
                    ev = new InputEvent('beforeinput', {
                        bubbles: true, cancelable: true, inputType: inputType,
                        data: data == null ? null : String(data)
                    });
                } catch (e) {
                    ev = new Event('beforeinput', { bubbles: true, cancelable: true });
                    try {
                        Object.defineProperty(ev, 'inputType', { value: inputType });
                        Object.defineProperty(ev, 'data', { value: data });
                    } catch (e2) {}
                }
                return el.dispatchEvent(ev);
            };
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) fire('insertParagraph', null);
                fire('insertText', lines[i]);
            }
            const after = aaEditorText(el);
            return after.indexOf(lines[0].slice(0, 12)) >= 0 && after !== before;
        } catch (e) {
            return false;
        }
    }

    /**
     * 在 DOM 祖先的 Vue 实例树里找 wangEditor 实例（Vue2 平台常见 this.editor）。
     * 找到后优先用编辑器自己的 setHtml/insertText，保证 Slate 内部状态一致、填完还能改。
     */
    function aaFindWangEditor(el) {
        const looksLikeEditor = function (obj) {
            if (!obj || typeof obj !== "object") return false;
            const hasApi = typeof obj.getHtml === "function" || typeof obj.setHtml === "function" ||
                typeof obj.insertText === "function";
            return hasApi && (Array.isArray(obj.children) || typeof obj.apply === "function");
        };
        const seen = [];
        const scan = function (vm, depth) {
            if (!vm || depth > 7 || seen.length > 400) return null;
            if (seen.indexOf(vm) >= 0) return null;
            seen.push(vm);
            const pool = [vm, vm.$data, vm.$props, vm.editor, vm.editorRef,
                vm.$refs && vm.$refs.editor, vm.$refs && vm.$refs.wangEditor];
            for (let i = 0; i < pool.length; i++) {
                if (looksLikeEditor(pool[i])) return pool[i];
            }
            const kids = Array.isArray(vm.$children) ? vm.$children : [];
            for (let i = 0; i < kids.length; i++) {
                const found = scan(kids[i], depth + 1);
                if (found) return found;
            }
            return null;
        };
        let node = el;
        for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
            try {
                const vm = node.__vue__ || (node.__vueParentComponent && (node.__vueParentComponent.proxy || node.__vueParentComponent));
                if (vm) {
                    const found = scan(vm, 0);
                    if (found) return found;
                }
            } catch (e) {}
        }
        return null;
    }

    function aaSetWangEditorHtml(editor, text) {
        try {
            const lines = String(text).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (!lines.length) return false;
            const html = lines.map(function (p) { return "<p>" + aaEscapeHtml(p) + "</p>"; }).join("");
            if (typeof editor.setHtml === "function") {
                editor.setHtml(html);
            } else if (typeof editor.insertText === "function") {
                if (typeof editor.clear === "function") editor.clear();
                editor.insertText(String(text));
            } else {
                return false;
            }
            let out = "";
            if (typeof editor.getText === "function") out = editor.getText();
            else if (typeof editor.getHtml === "function") out = editor.getHtml();
            return String(out || "").indexOf(lines[0].slice(0, 8)) >= 0;
        } catch (e) {
            return false;
        }
    }
    /**
     * 富文本写入：Slate/wangEditor 必须走它自己的实例/事件，绝不能直接覆盖 DOM；
     * 全部方法失败时放弃强制写入，避免把编辑器弄成不可编辑。
     */
    function aaSetRichEditorValue(el, text) {
        const slate = aaIsSlateEditor(el);
        if (slate) {
            try { el.focus(); } catch (e) {}
            const editor = aaFindWangEditor(el);
            if (editor && aaSetWangEditorHtml(editor, text)) {
                aaLog('已通过编辑器 API 写入主观题，可继续手动修改');
                return true;
            }
            if (aaInsertSlateViaPaste(el, text)) {
                aaLog('已通过 paste 事件写入主观题，可继续手动修改');
                return true;
            }
            if (aaInsertSlateViaBeforeInput(el, text)) {
                aaLog('已通过 beforeinput 事件写入主观题，可继续手动修改');
                return true;
            }
            try {
                if (aaSelectEditorContents(el)) {
                    const doc = el.ownerDocument || document;
                    if (doc.execCommand && doc.execCommand('insertText', false, text)) return true;
                }
            } catch (e) {}
            aaLog('富文本编辑器写入失败：为避免编辑器无法修改，未使用强制覆盖；可点“复制答案”手动粘贴', 'err');
            return false;
        }

        // 普通 contenteditable：优先 execCommand（会触发原生 input，编辑器状态正常）
        try {
            el.focus();
            aaSelectEditorContents(el);
            const doc = el.ownerDocument || document;
            if (doc.execCommand && doc.execCommand('insertText', false, text)) return true;
        } catch (e) {}
        // 没有 execCommand 的环境（如测试/旧浏览器）才回退 DOM 写入
        try {
            el.textContent = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (e) {
            return false;
        }
    }

    function aaSetValue(el, value) {
        if (!el) return false;
        const text = String(value == null ? '' : value);
        try {
            if (el.isContentEditable || aaIsRichEditor(el)) {
                return aaSetRichEditorValue(el, text);
            }
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(el, text);
            else el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return el.value === text;
        } catch (e) {
            return false;
        }
    }

    /**
     * 回填全部答案；每题之间随机等待，模拟人工节奏（也用于 T5 节奏检测测试）。
     */
    async function aaApplyAnswers(answers, token, questionsOverride) {
        const list = (questionsOverride && questionsOverride.length) ? questionsOverride : aaState.questions;
        const single = !!(questionsOverride && questionsOverride.length);
        let filled = 0;
        let failed = 0;
        let unverified = 0;
        const report = [];

        for (let i = 0; i < list.length; i++) {
            if (token !== aaState.runToken) break;
            const q = list[i];
            const answer = (answers || []).filter(function (a) { return a.index === q.index; })[0];
            let status = 'failed';
            let applied = '';

            try {
                if (!answer || answer.answer == null || answer.answer === '' ||
                    (Array.isArray(answer.answer) && !answer.answer.length)) {
                    failed++;
                    report.push({ index: q.index, no: q.no, type: q.type, status: 'empty' });
                } else if (q.kind === 'text') {
                    const text = Array.isArray(answer.answer) ? answer.answer.join('') : String(answer.answer);
                    if (aaSetValue(q.input, text)) {
                        filled++;
                        status = 'filled';
                        applied = text.slice(0, 80);
                    } else {
                        failed++;
                    }
                } else {
                    const picked = aaPickOptions(q, answer.answer);
                    if (!picked.length) {
                        failed++;
                    } else {
                        let verified = true;
                        for (let j = 0; j < picked.length; j++) {
                            if (!(await aaApplyOptionClick(picked[j]))) verified = false;
                            await aaSleep(aaRand(160, 360));
                        }
                        if (!verified) {
                            await aaSleep(220);
                            verified = picked.every(function (o) { return aaOptionLooksChecked(o.node); });
                        }
                        if (!verified) {
                            // 对仍未选中的选项再点一次（只点选项本身，避免多选题被反复切换）。
                            for (let j = 0; j < picked.length; j++) {
                                if (!aaOptionLooksChecked(picked[j].node)) {
                                    aaFirePointerClick(picked[j].node);
                                    await aaSleep(220);
                                }
                            }
                            verified = picked.every(function (o) { return aaOptionLooksChecked(o.node); });
                        }
                        applied = picked.map(function (o) { return o.letter; }).join(',');
                        if (verified) {
                            filled++;
                            status = 'filled';
                        } else {
                            filled++;
                            unverified++;
                            status = 'filled-unverified';
                            aaLog('第' + (q.no || q.index) + '题已点击，但未检测到选中状态，请人工确认', 'warn');
                        }
                    }
                }
            } catch (e) {
                failed++;
                aaLog('第' + (q.no || q.index) + '题填入失败：' + (e && e.message ? e.message : e), 'err');
            }

            report.push({ index: q.index, no: q.no, type: q.type, status: status, applied: applied, confidence: answer && answer.confidence });
            if (!single) {
                aaState.filled = filled;
                aaState.fillFailed = failed;
            }
            const merged = (aaState.fillReport || []).filter(function (r) { return r.index !== q.index; });
            merged.push(report[report.length - 1]);
            aaState.fillReport = merged;
            aaRenderQuestions();
            aaRenderStatus();

            if (i < list.length - 1) {
                await aaSleep(aaRand(aaCfg.delayMin, aaCfg.delayMax));
            }
        }

        if (!single) aaState.fillReport = report;
        return { filled: filled, failed: failed, unverified: unverified, report: report };
    }

    /** 把已经拿到的 AI 答案填入页面，不再请求 AI。 */
    async function aaFillExistingAnswers() {
        if (!aaAuthUnlocked()) {
            aaLog('答题功能已锁定：请先输入正确授权密钥', 'err');
            return null;
        }
        if (!aaCfg.authorized) {
            aaLog('填入前请先在“设置/测试”里勾选“我确认已获授权”', 'err');
            return null;
        }
        if (!aaState.answers || !aaState.answers.length) {
            aaLog('还没有 AI 答案，先点“AI 作答并填入”', 'err');
            return null;
        }
        if (aaState.busy) {
            aaLog('已有任务在运行，先点“停止”', 'err');
            return null;
        }
        const token = ++aaState.runToken;
        aaState.busy = true;
        aaState.stage = 'filling';
        try {
            const report = await aaApplyAnswers(aaState.answers, token);
            if (token !== aaState.runToken) throw new Error('任务已停止');
            aaLog('填入完成：成功 ' + report.filled + ' 题，失败 ' + report.failed + ' 题', report.failed ? 'warn' : 'on');
            aaState.stage = 'filled';
            return report;
        } catch (e) {
            aaLog('填入失败：' + (e && e.message ? e.message : e), 'err');
            return null;
        } finally {
            aaState.busy = false;
            aaRender();
            aaRenderStatus();
        }
    }

    /** 只填入某一道题（答题面板里每题旁边的“填入本题”）。 */
    function aaFillSingleQuestion(q) {
        if (!q) return;
        if (!aaAuthUnlocked()) {
            aaLog('答题功能已锁定：请先输入正确授权密钥', 'err');
            aaRenderStatus();
            return;
        }
        if (!aaCfg.authorized) {
            aaLog('填入前请先在“设置/测试”里勾选“我确认已获授权”', 'err');
            aaRenderStatus();
            return;
        }
        const answer = (aaState.answers || []).filter(function (a) { return a.index === q.index; })[0];
        if (!answer) {
            aaLog('第' + (q.no || q.index) + '题还没有 AI 答案，先点“AI 作答”', 'err');
            return;
        }
        aaApplyAnswers(aaState.answers, aaState.runToken, [q]).then(function (result) {
            const ok = result.filled > 0;
            aaLog('第' + (q.no || q.index) + '题：' + (ok ? '已填入' : '填入失败') +
                (result.unverified ? '（未检测到选中，请人工确认）' : ''), ok ? 'on' : 'err');
            aaRenderQuestions();
            aaRenderStatus();
        });
    }

    /* ---------------------------- 提交 ---------------------------- */

    function aaFindSubmitButton() {
        const custom = (aaCfg.selectors.submit || '').trim();
        if (custom) {
            try {
                const el = document.querySelector(custom);
                if (el && isVisible(el)) return el;
            } catch (e) {}
        }
        const wanted = ['提交试卷', '交卷', '提交答案', '提交作业', '保存并提交', '提交', '确定提交', '完成答题', '提交考试'];
        const nodes = document.querySelectorAll('button, [role="button"], .ant-btn, a');
        let best = null;
        let bestScore = -1;
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!isVisible(el) || el.disabled) continue;
            if (el.closest && el.closest('#cqooc-auto-study-host')) continue;
            const text = aaText(el).replace(/\s+/g, '');
            if (!text || text.length > 12) continue;
            if (/取消|返回|上一步|重置|保存草稿/.test(text)) continue;
            let score = -1;
            wanted.forEach(function (word, index) {
                if (text === word) score = Math.max(score, 100 - index);
            });
            if (score < 0 && /^提交|^交卷/.test(text)) score = 30;
            if (score < 0) continue;
            if (score > bestScore) { bestScore = score; best = el; }
        }
        return best;
    }

    function aaFindConfirmButton(root) {
        const scope = root || document;
        const nodes = scope.querySelectorAll('button, [role="button"], .ant-btn');
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (!isVisible(el) || el.disabled) continue;
            if (el.closest && el.closest('#cqooc-auto-study-host')) continue;
            const text = aaText(el).replace(/\s+/g, '');
            if (/^(确定|确认|确认提交|继续|知道了|是)$/.test(text)) return el;
        }
        return null;
    }

    function aaReadFeedback() {
        const patterns = [/提交成功/, /已提交/, /交卷成功/, /成绩[：:]?\s*\d+/, /得分[：:]?\s*\d+/, /未通过/, /已保存/];
        const nodes = document.querySelectorAll('.ant-message, .ant-notification, .ant-modal, .ant-result, [class*="message"], [class*="result"]');
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!isVisible(node)) continue;
            const text = aaText(node);
            if (text && text.length < 300 && patterns.some(function (p) { return p.test(text); })) return text;
        }
        const body = (document.body && document.body.innerText) || '';
        const match = body.slice(0, 4000).match(/提交成功|已提交|交卷成功|成绩[：:]?\s*\d+|得分[：:]?\s*\d+|未通过/);
        return match ? match[0] : '';
    }

    /**
     * 点击提交按钮（只在 submit 模式 + 已授权时调用）。
     * 记录提交请求/响应证据，供反作弊检测测试比对。
     */
    async function aaSubmit(token) {
        if (!aaCfg.authorized) throw new Error('未完成授权确认，不能自动提交');
        const button = aaFindSubmitButton();
        if (!button) throw new Error('没有找到提交按钮（可在高级设置里指定提交按钮选择器）');

        aaEvidence({
            type: 'submit-click',
            text: aaText(button),
            filled: aaState.filled,
            failed: aaState.fillFailed,
            questions: aaState.questions.length
        });
        try { button.click(); } catch (e) {}
        aaState.submitted = true;
        aaLog('已点击“' + aaText(button) + '”，等待页面反馈…', 'warn');

        await aaSleep(1500);
        for (let i = 0; i < 3; i++) {
            if (token !== aaState.runToken) break;
            const confirm = aaFindConfirmButton();
            if (!confirm) break;
            aaEvidence({ type: 'confirm-click', text: aaText(confirm) });
            try { confirm.click(); } catch (e) {}
            await aaSleep(1200);
        }

        await aaSleep(2000);
        const feedback = aaReadFeedback();
        aaState.submitFeedback = feedback;
        aaEvidence({ type: 'submit-feedback', text: feedback || '（未读取到页面反馈）' });
        aaLog(feedback ? '页面反馈：' + feedback : '未读取到提交反馈，请人工查看页面', feedback ? 'on' : 'warn');
        return feedback;
    }

    /* ---------------------------- 网络证据 ---------------------------- */

    /**
     * 包装 fetch / XHR，记录与答题相关的请求和响应（提交、判分、保存等）。
     * 不记录 AI 请求，不记录 Cookie / Authorization 原文。
     */
    function aaInstrumentNetwork() {
        if (window.__CQOOC_AA_NET__) return;
        window.__CQOOC_AA_NET__ = true;

        const interesting = function (url) {
            return /(exam|test|homework|paper|question|answer|submit|zuoye|kaoshi|kaoti|save)/i.test(String(url || ''));
        };
        const mask = function (value) {
            return String(value == null ? '' : value)
                .replace(/(api[_-]?key|token|authorization|cookie)\s*[:=]\s*[^,}&"']+/gi, '$1:***');
        };

        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function') {
            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                const method = (init && init.method) || (input && input.method) || 'GET';
                const startedAt = aaNow();
                const request = init && init.body ? mask(String(init.body)).slice(0, 600) : '';
                const promise = originalFetch.apply(this, arguments);
                if (interesting(url)) {
                    promise.then(function (response) {
                        const clone = response.clone ? response.clone() : response;
                        if (clone && clone.text) {
                            clone.text().then(function (text) {
                                aaEvidence({
                                    type: 'fetch',
                                    url: String(url).slice(0, 300),
                                    method: method,
                                    status: response.status,
                                    durationMs: aaNow() - startedAt,
                                    request: request,
                                    response: mask(text).slice(0, 800)
                                });
                            }).catch(function () {});
                        }
                    }).catch(function (err) {
                        aaEvidence({
                            type: 'fetch-error',
                            url: String(url).slice(0, 300),
                            method: method,
                            durationMs: aaNow() - startedAt,
                            error: String((err && err.message) || err)
                        });
                    });
                }
                return promise;
            };
        }

        try {
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__cqAaMeta = { method: method, url: url, startedAt: aaNow() };
                return originalOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (body) {
                const meta = this.__cqAaMeta;
                if (meta && interesting(meta.url)) {
                    this.addEventListener('loadend', function () {
                        aaEvidence({
                            type: 'xhr',
                            url: String(meta.url).slice(0, 300),
                            method: meta.method,
                            status: this.status,
                            durationMs: aaNow() - meta.startedAt,
                            request: body ? mask(String(body)).slice(0, 600) : '',
                            response: mask(this.responseText || '').slice(0, 800)
                        });
                    });
                }
                return originalSend.apply(this, arguments);
            };
        } catch (e) {
            console.warn('[CQOOC答题] XHR 包装失败', e);
        }
    }

    /* ---------------------------- 弹题 ---------------------------- */

    function aaPopupRoot() {
        const nodes = document.querySelectorAll('.wt-modal, .ant-modal-content, .ant-modal, [class*="modal"], [class*="dialog"]');
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node || !isVisible(node)) continue;
            if (node.closest && node.closest('#cqooc-auto-study-host')) continue;
            const text = aaText(node);
            if (!/请先回答|请作答|回答.{0,8}继续|答题后继续|课后练习|弹题/.test(text)) continue;
            if (aaOptionNodes(node).length < 2 && !node.querySelector('textarea, input[type="text"]')) continue;
            return node;
        }
        return null;
    }

    function aaPopupSignature(root) {
        return aaPath() + '|' + aaText(root).slice(0, 160);
    }

    /**
     * 处理视频弹题：assist 只给答案；fill/submit 自动选项并点“确定/继续”。
     * 返回 Promise<boolean>，true 表示“已处理（成功或已记录失败）”。
     */
    async function aaHandlePopup(force) {
        if (!aaPopupAllowed() || !aaAuthUnlocked()) return false;
        const root = aaPopupRoot();
        if (!root) return false;
        const signature = aaPopupSignature(root);
        if (!force && aaState.popupHandled === signature) return true;
        if (aaState.popupBusy) return true;

        aaState.popupBusy = true;
        try {
            const questions = aaExtractQuestions(root);
            if (!questions.length) {
                aaLog('弹题识别失败：没有找到题目或选项', 'err');
                aaState.popupHandled = signature;
                return true;
            }
            aaState.pageKind = aaPageKind() || 'quiz';
            aaState.questions = questions;
            aaState.answers = [];
            aaRenderQuestions();
            aaLog('检测到弹题（' + questions.length + ' 题），模式 ' + aaCfg.mode);

            const answers = await aaAskAI(questions);
            aaState.answers = answers;
            aaRenderQuestions();
            aaLog('弹题答案：' + aaPreviewAnswers(answers));

            if (aaCfg.mode !== 'assist') {
                if (!aaCfg.authorized) {
                    aaLog('已阻止自动作答：请先在答题面板勾选“我确认已获授权”', 'err');
                } else {
                    const report = await aaApplyAnswers(answers, aaState.runToken);
                    aaLog('弹题已填入 ' + report.filled + ' 题，正在点确认…');
                    await aaSleep(800);
                    const confirm = aaFindConfirmButton(root);
                    if (confirm) {
                        try { confirm.click(); } catch (e) {}
                        aaLog('弹题已点击“' + aaText(confirm) + '”');
                    }
                    aaEvidence({
                        type: 'popup-answer',
                        count: questions.length,
                        filled: report.filled,
                        failed: report.failed,
                        answers: aaPreviewAnswers(answers)
                    });
                }
            } else {
                aaEvidence({ type: 'popup-assist', count: questions.length, answers: aaPreviewAnswers(answers) });
            }
            aaState.popupHandled = signature;
            return true;
        } catch (e) {
            aaLog('弹题作答失败：' + ((e && e.message) || e), 'err');
            aaState.popupHandled = signature;
            return true;
        } finally {
            aaState.popupBusy = false;
            aaRenderStatus();
        }
    }

    /* ---------------------------- 主流程 ---------------------------- */

    /**
     * 答题主流程。
     * @param {string} trigger 触发来源：auto / manual / popup
     * @param {string} action  assist / fill / submit；省略时用配置里的模式
     */
    async function aaPipeline(trigger, action) {
        if (aaState.busy) {
            aaLog('已有答题任务在运行，先点“停止”或等待完成');
            return null;
        }
        if (!aaAuthUnlocked()) {
            aaState.status = '答题功能已锁定：请先在“设置/测试”输入正确授权密钥';
            aaLog(aaState.status, 'err');
            aaRenderStatus();
            return null;
        }
        action = action || aaCfg.mode;
        if (action === 'assist' && aaCfg.autoFill !== false) {
            // 取消“assist 只显示”的默认限制：作答后直接填入（授权/密钥门禁仍然生效）。
            action = 'fill';
            aaLog('已开启“AI 作答后自动填入”：assist 自动按 fill 执行');
        }
        if (action === 'fill' || action === 'submit') {
            if (!aaCfg.authorized) {
                aaState.status = '已阻止：自动填答/提交需要先勾选授权确认';
                aaLog(aaState.status, 'err');
                aaRenderStatus();
                return null;
            }
        }

        let questions = aaState.questions.length ? aaState.questions : aaExtractQuestions(document);
        if (!questions.length) {
            aaState.status = '没有识别到题目';
            aaLog('没有识别到题目：请确认当前在答题页，或在高级设置里填写自定义选择器', 'err');
            aaRenderStatus();
            return null;
        }
        if (action === 'assist') questions = aaExtractQuestions(document).length ? aaExtractQuestions(document) : questions;

        const token = ++aaState.runToken;
        aaState.busy = true;
        aaState.stage = 'asking';
        aaState.questions = questions;
        aaState.answers = [];
        aaState.filled = 0;
        aaState.fillFailed = 0;
        aaState.submitted = false;
        aaState.status = 'AI 作答中…';
        aaState.pageKind = aaPageKind();
        aaLog('开始作答：' + questions.length + ' 题，模式 ' + aaModeLabel(action) + '（' + trigger + '）');
        aaRender();
        aaRenderStatus();

        try {
            let answers = aaState.answers.length ? aaState.answers : null;
            if (!answers) answers = await aaAskAI(questions);
            if (token !== aaState.runToken) throw new Error('任务已停止');
            aaState.answers = answers;
            aaState.stage = 'answered';
            aaRenderQuestions();
            aaLog('AI 作答完成：' + aaPreviewAnswers(answers));

            if (action === 'assist') {
                aaState.stage = 'assist';
                aaState.status = 'AI 已给出答案（assist 模式不写入页面）';
                aaEvidence({
                    type: 'assist-result',
                    pageKind: aaState.pageKind,
                    total: questions.length,
                    answers: aaPreviewAnswers(answers)
                });
                aaLog('assist 模式：只显示答案，没有点击或填写页面');
                return { mode: 'assist', answers: answers };
            }

            aaState.stage = 'filling';
            const report = await aaApplyAnswers(answers, token);
            if (token !== aaState.runToken) throw new Error('任务已停止');
            aaEvidence({
                type: 'fill-report',
                action: action,
                pageKind: aaState.pageKind,
                total: questions.length,
                filled: report.filled,
                failed: report.failed,
                report: report.report
            });
            aaLog('填入完成：成功 ' + report.filled + ' 题，失败 ' + report.failed + ' 题', report.failed ? 'warn' : 'on');

            if (action === 'submit') {
                if (!report.filled) {
                    aaState.status = '没有成功填入任何答案，已取消提交';
                    aaLog(aaState.status, 'err');
                    return { mode: 'submit', filled: 0, submitted: false };
                }
                aaState.stage = 'submitting';
                aaState.status = '正在提交…';
                aaRenderStatus();
                await aaSubmit(token);
                aaState.stage = 'done';
                aaState.status = '已提交，测试证据已记录（可点“导出证据”）';
                return { mode: 'submit', filled: report.filled, unverified: report.unverified, submitted: true, feedback: aaState.submitFeedback };
            }

            aaState.stage = 'filled';
            aaState.status = '已自动填入 ' + report.filled + ' 题，未提交；请人工核对';
            return { mode: 'fill', filled: report.filled, failed: report.failed, unverified: report.unverified };
        } catch (e) {
            aaState.stage = 'error';
            aaState.status = '答题失败：' + ((e && e.message) || e);
            aaLog(aaState.status, 'err');
            aaRenderStatus();
            return null;
        } finally {
            aaState.busy = false;
            aaRender();
            aaRenderStatus();
        }
    }

    /**
     * 自动答题巡检：每 1.5 秒判断当前页面、识别题目、按需自动执行。
     */
    function aaTick() {
        try {
            aaEnsureHost();
            const kind = aaPageKind();
            if (kind) aaInstrumentNetwork();
            aaState.pageKind = kind;
            aaState.scopeAllowed = aaScopeAllows(kind);
            const pageKey = aaPath();
            if (pageKey !== aaState.pageKey) {
                const firstRun = !aaState.pageKey;
                aaState.pageKey = pageKey;
                // 首次巡检只记录 pageKey，不清空；答题流程运行中也不清空，避免把题目表清掉。
                if (!firstRun && !aaState.busy) {
                    aaState.signature = '';
                    aaState.questions = [];
                    aaState.answers = [];
                    aaState.filled = 0;
                    aaState.fillFailed = 0;
                    aaState.submitted = false;
                    aaState.submitFeedback = '';
                    aaState.popupHandled = '';
                    aaState.stage = 'idle';
                }
            }

            if (!kind) {
                aaState.status = aaCfg.enabled ? '当前不是答题页（等待进入测验/作业/考试）' : '自动答题未启用';
                aaRenderStatus();
                return;
            }
            if (!aaState.scopeAllowed) {
                aaState.status = aaKindLabel(kind) + ' 不在当前作用范围内';
                aaRenderStatus();
                return;
            }

            const questions = aaExtractQuestions(document);
            if (!questions.length) {
                if (!aaState.busy) {
                    aaState.status = aaCfg.enabled
                        ? '识别不到题目：点“提取题目”或“结构快照”，把结果反馈给开发者补选择器'
                        : '等待题目加载…';
                }
                aaRenderStatus();
                return;
            }

            const signature = aaQuestionSignature(questions);
            const changed = signature !== aaState.signature;
            if (changed && !aaState.busy) {
                aaState.signature = signature;
                aaState.questions = questions;
                aaState.answers = [];
                aaState.filled = 0;
                aaState.fillFailed = 0;
                aaState.submitted = false;
                aaRenderQuestions();
            }
            if (!aaState.busy) {
                aaState.status = '识别到 ' + questions.length + ' 题（' + aaKindLabel(kind) + '）' +
                    (aaCfg.enabled ? ' · ' + aaModeLabel() : ' · 自动答题未启用');
            }
            aaRenderStatus();

            if (aaCfg.enabled && aaCfg.authVerified && aaCfg.autoRun && changed && !aaState.busy && !aaState.submitted) {
                aaPipeline('auto', aaCfg.mode);
            }
        } catch (e) {
            console.warn('[CQOOC答题] 巡检异常', e);
        }
    }

    function aaStop() {
        aaState.runToken++;
        aaState.busy = false;
        aaState.stage = 'stopped';
        aaState.status = '已请求停止（当前等待中的请求返回后会结束）';
        aaLog('用户停止答题流程');
        aaRenderStatus();
    }

    /* ---------------------------- 调试与导出 ---------------------------- */

    function aaPlainQuestions() {
        return aaState.questions.map(function (q) {
            return {
                index: q.index,
                no: q.no,
                type: q.type,
                kind: q.kind,
                stem: q.stem,
                options: (q.options || []).map(function (o) { return { letter: o.letter, text: o.text }; })
            };
        });
    }

    function aaExportEvidence() {
        const data = {
            tool: 'cqooc-auto-study',
            version: VERSION,
            exportedAt: new Date().toISOString(),
            host: aaHost(),
            productionHost: aaIsProductionHost(),
            url: location.href,
            pageKind: aaState.pageKind,
            config: {
                mode: aaCfg.mode,
                scope: aaCfg.scope,
                autoRun: aaCfg.autoRun,
                authorized: aaCfg.authorized,
                delayMin: aaCfg.delayMin,
                delayMax: aaCfg.delayMax
            },
            questions: aaPlainQuestions(),
            answers: aaState.answers,
            filled: aaState.filled,
            fillFailed: aaState.fillFailed,
            fillReport: aaState.fillReport || [],
            submitted: aaState.submitted,
            submitFeedback: aaState.submitFeedback,
            evidence: aaState.evidence
        };
        const text = JSON.stringify(data, null, 2);
        try {
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cqooc-anti-cheat-evidence-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(function () {
                try { URL.revokeObjectURL(url); a.remove(); } catch (e) {}
            }, 1500);
        } catch (e) {
            console.warn('[CQOOC答题] 导出下载失败', e);
        }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        } catch (e) {}
        aaLog('证据已导出（JSON 文件 + 尝试写入剪贴板）');
        return data;
    }

    /**
     * 输出原始识别数据，页面改版导致识别失败时用来定位选择器。
     */
    function aaDumpRaw() {
        const roots = aaRootDocs().map(function (r) { return r.kind + ':' + aaOptionNodes(r.root).length; });
        const extracted = aaExtractQuestions(document);
        const info = {
            version: VERSION,
            url: aaPath(),
            pageKind: aaPageKind(),
            productionHost: aaIsProductionHost(),
            roots: roots,
            optionNodes: aaOptionNodes(document).length,
            optionSample: aaOptionNodes(document).slice(0, 12).map(function (n) {
                return { tag: n.tagName, className: aaShortClass(n), text: aaOptionText(n).slice(0, 100) };
            }),
            nativeRadios: document.querySelectorAll('input[type="radio"]').length,
            nativeChecks: document.querySelectorAll('input[type="checkbox"]').length,
            questionCount: extracted.length,
            questionTypes: extracted.map(function (q) { return q.type; }),
            questions: extracted.slice(0, 120).map(function (q) {
                return {
                    index: q.index,
                    no: q.no,
                    type: q.type,
                    stem: q.stem.slice(0, 160),
                    options: (q.options || []).map(function (o) { return o.letter + '. ' + o.text.slice(0, 100); })
                };
            }),
            textInputs: aaFindTextInputs(document).slice(0, 10).map(function (n) {
                return { tag: n.tagName, className: aaShortClass(n), placeholder: (n.getAttribute && n.getAttribute('placeholder')) || '' };
            }),
            selectors: aaCfg.selectors,
            submitCandidates: Array.prototype.slice.call(document.querySelectorAll('button, .ant-btn, .el-button, [role="button"]'))
                .filter(aaVisible)
                .slice(0, 20)
                .map(function (n) { return aaText(n).slice(0, 30); })
        };
        console.info('[CQOOC答题] 原始识别数据', info);
        return info;
    }

    function aaShortClass(el) {
        if (!el) return '';
        let cls = '';
        try {
            cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
        } catch (e) { cls = ''; }
        return String(cls).split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    }

    function aaSanitizeHtml(el, max) {
        if (!el || !el.outerHTML) return '';
        let html = String(el.outerHTML)
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/src="data:[^"]{40,}"/gi, 'src="data:..."')
            .replace(/\s(style)="[^"]{160,}"/gi, '')
            .replace(/\s+/g, ' ');
        return html.slice(0, max || 1500);
    }

    /**
     * 生成“页面结构快照”：原生 radio/checkbox、我们识别到的选项节点、提取结果、
     * 文本输入框、疑似容器 class、HTML 片段整理成文本，输出到控制台、剪贴板并下载 txt。
     * 识别不到选择题/判断题时，把这个 txt 发给开发者即可精确定位选择器。
     */
    function aaCopyStructure() {
        const lines = [];
        const push = function (s) { lines.push(String(s)); };
        push('CQOOC 答题结构快照 v' + VERSION);
        push('url: ' + location.href);
        push('pageKind: ' + aaPageKind());
        push('iframes: ' + document.querySelectorAll('iframe').length);
        const roots = aaRootDocs();
        roots.forEach(function (entry, index) {
            const root = entry.root;
            let inputs = [];
            let texts = [];
            let samples = [];
            let optionNodes = [];
            let extracted = [];
            try { inputs = Array.prototype.slice.call(root.querySelectorAll('input[type="radio"], input[type="checkbox"]')); } catch (e) {}
            try { texts = Array.prototype.slice.call(root.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')); } catch (e) {}
            try {
                samples = Array.prototype.slice.call(root.querySelectorAll(
                    '[class*="question"], [class*="exam"], [class*="paper"], [class*="radio"], ' +
                    '[class*="checkbox"], [class*="option"], [class*="choice"], [class*="stem"]'
                ));
            } catch (e) {}
            try { optionNodes = aaOptionNodes(root); } catch (e) {}
            try { extracted = aaExtractFromRoot(root); } catch (e) {}
            push('');
            push('[' + entry.kind + '#' + index + '] radio/checkbox=' + inputs.length +
                ' textInput=' + texts.length + ' optionNodes=' + optionNodes.length +
                ' extract=' + extracted.length + ' types=' + extracted.map(function (q) { return q.type; }).join(','));
            inputs.slice(0, 12).forEach(function (input, i) {
                const host = (input.closest && input.closest('label')) || input.parentElement;
                push('  I' + (i + 1) + ' name=' + (input.name || '') + ' type=' + input.type +
                    ' hostClass=' + aaShortClass(host) + ' text=' + aaText(host).slice(0, 100));
            });
            optionNodes.slice(0, 12).forEach(function (el, i) {
                push('  O' + (i + 1) + ' class=' + aaShortClass(el) + ' text=' + aaOptionText(el).slice(0, 120));
            });
            extracted.slice(0, 20).forEach(function (q, i) {
                push('  Q' + (i + 1) + ' [no=' + (q.no || q.index) + ' ' + q.type + '] ' + q.stem.slice(0, 120));
            });
            const typeSamples = {};
            extracted.forEach(function (q) {
                if (q && q.type && !typeSamples[q.type]) typeSamples[q.type] = q;
            });
            Object.keys(typeSamples).forEach(function (type) {
                try {
                    const q = typeSamples[type];
                    const el = q.root || q.input;
                    if (el && el.parentElement) {
                        push('  sampleHTML[' + type + ']=' + aaSanitizeHtml(el.parentElement, 1600));
                    }
                } catch (e) {}
            });
            texts.slice(0, 8).forEach(function (el, i) {
                push('  T' + (i + 1) + ' tag=' + el.tagName + ' class=' + aaShortClass(el) +
                    ' placeholder=' + ((el.getAttribute && el.getAttribute('placeholder')) || ''));
            });
            const classSet = {};
            samples.slice(0, 80).forEach(function (el) { classSet[aaShortClass(el)] = 1; });
            push('  classes=' + Object.keys(classSet).filter(Boolean).slice(0, 30).join(' | '));

            let sampleEl = null;
            if (inputs.length) sampleEl = inputs[0];
            else if (optionNodes.length) sampleEl = optionNodes[0];
            else if (texts.length) sampleEl = texts[0];
            else {
                try { sampleEl = root.querySelector('.question-item, [class*="question-item"], [class*="question-box"]'); } catch (e) {}
            }
            if (sampleEl) {
                let block = sampleEl;
                for (let k = 0; k < 3 && block.parentElement; k++) block = block.parentElement;
                push('  sampleHTML=' + aaSanitizeHtml(block, 1800));
            }
        });
        const text = lines.join('\n');
        try { console.info('[CQOOC答题] 结构快照\n' + text); } catch (e) {}
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        } catch (e) {}
        try {
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cqooc-page-structure-' + Date.now() + '.txt';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(function () {
                try { URL.revokeObjectURL(url); a.remove(); } catch (e) {}
            }, 1200);
        } catch (e) {
            console.warn('[CQOOC答题] 快照下载失败', e);
        }
        aaLog('结构快照已生成：控制台 + 剪贴板 + cqooc-page-structure-*.txt');
        return text;
    }

    /* -------------------- 弹窗可见性兜底（v1.1.3） -------------------- */

    let aaUiFallbackUsed = false;

    /** 把面板样式注入主文档 head，供“页面级弹窗”兜底使用。 */
    function aaInjectFallbackStyle() {
        if (document.getElementById('cqooc-aa-fallback-style')) return;
        try {
            const style = document.createElement('style');
            style.id = 'cqooc-aa-fallback-style';
            style.textContent = CSS + AA_STYLE;
            (document.head || document.documentElement).appendChild(style);
        } catch (e) {
            console.warn('[CQOOC答题] 注入兜底样式失败', e);
        }
    }

    /** 弹窗是否真的可见（display 非 none 且宽高 > 2）。 */
    function aaOverlayVisible(mask, dialog) {
        if (!mask) return false;
        try {
            const view = (mask.ownerDocument && mask.ownerDocument.defaultView) || window;
            const style = view.getComputedStyle(mask);
            if (style && style.display === 'none') return false;
            const rect = mask.getBoundingClientRect();
            if (!rect || rect.width < 2 || rect.height < 2) return false;
            if (dialog) {
                const drect = dialog.getBoundingClientRect();
                if (!drect || drect.width < 2 || drect.height < 2) return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * 兜底挂载：把弹窗移出 Shadow DOM，挂到 body 或当前全屏元素下。
     * 用于页面层级、CSP、Shadow 兼容、平台全屏等导致弹窗不可见的情况。
     */
    function aaMountOverlayForVisibility(mask) {
        if (!mask) return false;
        aaInjectFallbackStyle();
        const target = document.fullscreenElement || document.webkitFullscreenElement ||
            document.body || document.documentElement;
        if (!target) return false;
        try {
            if (mask.parentNode !== target) target.appendChild(mask);
            aaUiFallbackUsed = true;
            return mask.parentNode === target;
        } catch (e) {
            console.warn('[CQOOC答题] 兜底挂载弹窗失败', e);
            return false;
        }
    }

    /** 面板宿主被平台重渲染移除 / 进入全屏时，自动挂回去。 */
    function aaEnsureHost() {
        if (!host) return;
        try {
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl && !fsEl.contains(host)) { fsEl.appendChild(host); return; }
            if (!host.parentNode) {
                (document.body || document.documentElement).appendChild(host);
                console.info('[CQOOC答题] 面板宿主已被移除，已重新挂载');
            }
        } catch (e) {}
    }

    /** UI 自检：面板/弹窗/兜底/全屏状态，排查“弹窗不弹出”时执行。 */
    function aaUiCheck() {
        const maskParent = aaModal && aaModal.parentNode
            ? (aaModal.parentNode === document.body ? 'body'
                : (aaModal.parentNode.nodeType === 11 ? 'shadow'
                    : (aaModal.parentNode.id || aaModal.parentNode.tagName)))
            : 'null';
        let dialogSize = null;
        try {
            const dialog = aaModal && aaModal.querySelector('.cq-aa-win');
            const rect = dialog && dialog.getBoundingClientRect();
            if (rect) dialogSize = [Math.round(rect.width), Math.round(rect.height)];
        } catch (e) {}
        let maskDisplay = '';
        try {
            maskDisplay = aaModal ? window.getComputedStyle(aaModal).display : '';
        } catch (e) {}
        const info = {
            version: VERSION,
            hostAttached: !!(host && host.parentNode),
            hostParent: host && host.parentNode ? (host.parentNode.id || host.parentNode.tagName) : '',
            hasShadow: !!(host && host.shadowRoot),
            hasButton: !!(host && host.shadowRoot && host.shadowRoot.getElementById('cq-aa-open')),
            maskParent: maskParent,
            maskShown: !!(aaModal && aaModal.classList.contains('show')),
            maskDisplay: maskDisplay,
            fallbackUsed: aaUiFallbackUsed,
            fallbackStyle: !!document.getElementById('cqooc-aa-fallback-style'),
            fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
            pageKind: aaState.pageKind || aaPageKind(),
            dialogSize: dialogSize
        };
        console.info('[CQOOC答题] UI 自检', info);
        return info;
    }

    /* ---------------------------- 面板 UI ---------------------------- */

    const AA_STYLE = `
        .cq-aa-win {
            position: fixed;
            right: 18px;
            top: 84px;
            width: min(400px, calc(100vw - 24px));
            max-height: min(72vh, 760px);
            display: none;
            flex-direction: column;
            background: #fff;
            border: 1px solid #dbe5f1;
            border-radius: 12px;
            box-shadow: 0 18px 60px rgba(9, 30, 66, .35);
            color: #17233d;
            font: 12px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            z-index: 2147483647;
            pointer-events: auto;
            overflow: hidden;
        }
        .cq-aa-win.show { display: flex; }
        .cq-aa-win.mini { width: auto; max-height: none; }
        .cq-aa-win.mini .cq-aa-win-tabs,
        .cq-aa-win.mini .cq-aa-win-body { display: none; }
        .cq-aa-win-head {
            display: flex; align-items: center; justify-content: space-between;
            gap: 8px; padding: 7px 10px;
            color: #fff;
            background: linear-gradient(135deg, #0256ca, #2f80ed);
            cursor: move;
            user-select: none;
            flex: 0 0 auto;
        }
        .cq-aa-win-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .cq-aa-win-title b { font-size: 12.5px; white-space: nowrap; }
        .cq-aa-win-sub {
            font-size: 10px; opacity: .88;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cq-aa-win-tools { display: flex; gap: 6px; flex: 0 0 auto; }
        .cq-aa-win-tools button {
            width: 22px; height: 22px; padding: 0;
            border: 0; border-radius: 6px;
            color: #fff; background: rgba(255, 255, 255, .18);
            cursor: pointer; font-size: 14px; line-height: 1;
        }
        .cq-aa-win-tools button:hover { background: rgba(255, 255, 255, .32); }
        .cq-aa-win-tabs {
            display: flex; gap: 4px; padding: 6px 8px 0;
            background: #f8fbff; border-bottom: 1px solid #e8eef8;
            flex: 0 0 auto;
        }
        .cq-aa-tab {
            flex: 1; padding: 6px 4px;
            border: 0; border-radius: 7px 7px 0 0;
            background: transparent; color: #334155;
            cursor: pointer; font: 600 11px/1.3 inherit;
            white-space: nowrap;
        }
        .cq-aa-tab.active { background: #fff; color: #0256ca; box-shadow: inset 0 -2px 0 #0256ca; }
        .cq-aa-tab i { font-style: normal; color: #94a3b8; font-weight: 400; }
        .cq-aa-win-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
        .cq-aa-pane {
            flex: 1 1 auto; min-height: 0;
            display: flex; flex-direction: column; gap: 6px;
            padding: 8px 9px;
            overflow: auto;
        }
        .cq-aa-pane-actions { display: flex; flex-wrap: wrap; gap: 6px; flex: 0 0 auto; }
        .cq-aa-pane-actions button {
            padding: 5px 8px;
            border: 1px solid #d7e2f0; border-radius: 7px;
            background: #f8fafc; color: #334155;
            cursor: pointer; font: 600 10.5px/1.2 inherit;
        }
        .cq-aa-pane-actions button:hover { background: #eef4ff; border-color: #b9d2ff; }
        .cq-aa-pane-actions button.primary { color: #fff; background: #0256ca; border-color: #0256ca; }
        .cq-aa-pane-actions button:disabled { opacity: .55; cursor: wait; }
        .cq-aa-statusbar {
            display: flex; flex-wrap: wrap; gap: 10px;
            padding: 5px 7px; border-radius: 7px;
            background: #f1f7ff; color: #1e3a8a;
            font-size: 10.5px; font-weight: 600;
            flex: 0 0 auto;
        }
        .cq-aa-statusbar span { white-space: nowrap; }
        .cq-aa-auth-key { display: flex; gap: 6px; align-items: center; margin-top: 2px; }
        .cq-aa-auth-key input {
            flex: 1; min-width: 0; height: 24px; padding: 0 6px;
            border: 1px solid #d7e2f0; border-radius: 6px;
            font: 10.5px/24px inherit; color: #334155; outline: none;
        }
        .cq-aa-auth-key input:focus { border-color: #0256ca; }
        .cq-aa-auth-key span { font-size: 10px; color: #94a3b8; white-space: nowrap; }
        .cq-aa-auth-key span.ok { color: #047857; font-weight: 600; }
        .cq-aa-warn {
            padding: 6px 8px; border: 1px solid #fecaca; border-radius: 7px;
            color: #991b1b; background: #fef2f2;
            font-size: 10px; line-height: 1.45;
            flex: 0 0 auto;
        }
        .cq-aa-list {
            flex: 1 1 auto; min-height: 84px; overflow: auto;
            padding: 4px;
            border: 1px solid #e8eef8; border-radius: 7px;
            background: #f8fbff;
        }
        .cq-aa-empty { color: #94a3b8; font-size: 10.5px; padding: 8px; }
        .cq-aa-q {
            margin-bottom: 5px;
            border: 1px solid #eef2f7; border-radius: 7px;
            background: #fff;
            font-size: 10.5px; color: #334155;
        }
        .cq-aa-q > summary {
            list-style: none; cursor: pointer;
            padding: 5px 6px;
            display: flex; justify-content: space-between; gap: 6px; align-items: center;
        }
        .cq-aa-q > summary::-webkit-details-marker { display: none; }
        .cq-aa-q > summary b { color: #0256ca; font-size: 10.5px; }
        .cq-aa-q > summary span { color: #047857; font-weight: 600; white-space: nowrap; }
        .cq-aa-q > summary span.err { color: #dc2626; }
        .cq-aa-q > summary span.warn { color: #b45309; }
        .cq-aa-q-body { padding: 0 6px 6px; }
        .cq-aa-q-stem { line-height: 1.45; word-break: break-word; }
        .cq-aa-q-opts { margin-top: 2px; color: #64748b; word-break: break-word; }
        .cq-aa-q-answer { margin-top: 3px; color: #047857; word-break: break-word; }
        .cq-aa-q-answer.warn { color: #b45309; }
        .cq-aa-q-actions { margin-top: 4px; display: flex; gap: 5px; }
        .cq-aa-q-actions button {
            padding: 3px 7px;
            border: 1px solid #d7e2f0; border-radius: 6px;
            background: #f8fafc; cursor: pointer;
            font: 600 10px/1.2 inherit; color: #334155;
        }
        .cq-aa-q-actions button:hover { background: #eef4ff; }
        .cq-aa-log {
            height: 56px; padding: 4px 6px;
            overflow: auto; overscroll-behavior: contain;
            border: 1px solid #eef2f7; border-radius: 7px;
            background: #f8fafc;
            font: 10px/1.5 Consolas, "Courier New", monospace;
            color: #64748b; user-select: text;
            flex: 0 0 auto;
        }
        .cq-aa-log div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cq-aa-hint { color: #94a3b8; font-size: 9.5px; flex: 0 0 auto; }
        .cq-aa-win .cq-ai-grid { margin-bottom: 0; }
        .cq-aa-win .cq-ai-field input,
        .cq-aa-win .cq-ai-field select { padding: 5px 6px; font-size: 10.5px; }
        .cq-aa-win .cq-ai-field span { font-size: 9.5px; }
        .cq-aa-win .cq-ai-status { margin-top: 2px; font-size: 10px; color: #64748b; }
        .cq-aa-win .cq-ai-status.err { color: #dc2626; }
    `;

    const AA_HTML = `
        <div class="cq-aa-win" id="cq-aa-win" role="dialog" aria-label="AI 自动答题">
            <div class="cq-aa-win-head" id="cq-aa-win-head" title="按住拖动">
                <div class="cq-aa-win-title">
                    <b>AI 自动答题</b>
                    <span class="cq-aa-win-sub" id="cq-aa-win-sub">未识别页面</span>
                </div>
                <div class="cq-aa-win-tools">
                    <button type="button" id="cq-aa-min" title="收起/展开">−</button>
                    <button type="button" id="cq-aa-close" title="关闭">×</button>
                </div>
            </div>
            <div class="cq-aa-win-tabs" id="cq-aa-tabs">
                <button type="button" class="cq-aa-tab active" data-tab="choice">选择题/判断题 <i id="cq-aa-count-choice">0</i></button>
                <button type="button" class="cq-aa-tab" data-tab="fill">填空/主观题 <i id="cq-aa-count-fill">0</i></button>
                <button type="button" class="cq-aa-tab" data-tab="tools">设置/测试</button>
            </div>
            <div class="cq-aa-win-body" id="cq-aa-win-body">
                <div class="cq-aa-pane" data-pane="choice">
                    <div class="cq-aa-pane-actions">
                        <button type="button" id="cq-aa-answer">AI 作答</button>
                        <button type="button" class="primary" id="cq-aa-fill">填入全部</button>
                        <button type="button" id="cq-aa-stop">停止</button>
                    </div>
                    <div class="cq-aa-statusbar">
                        <span id="cq-aa-page">页面：未识别</span>
                        <span id="cq-aa-count">题目：0</span>
                    </div>
                    <div class="cq-aa-list" id="cq-aa-choice-list"><div class="cq-aa-empty">提取题目后在这里显示。</div></div>
                </div>
                <div class="cq-aa-pane" data-pane="fill" style="display:none">
                    <div class="cq-aa-pane-actions">
                        <button type="button" class="primary" id="cq-aa-fill-answer">AI 作答并填入</button>
                        <button type="button" id="cq-aa-fill-all">填入全部</button>
                        <button type="button" id="cq-aa-fill-stop">停止</button>
                        <button type="button" id="cq-aa-extract">重新提取</button>
                        <button type="button" id="cq-aa-export">导出证据</button>
                        <button type="button" id="cq-aa-copy">结构快照</button>
                    </div>
                    <div class="cq-aa-list" id="cq-aa-fill-list"><div class="cq-aa-empty">填空题/主观题会显示在这里。</div></div>
                </div>
                <div class="cq-aa-pane" data-pane="tools" style="display:none">
                    <div class="cq-aa-warn" id="cq-aa-warn">仅限已获授权的测试环境。默认 assist 只显示答案；fill / submit 需要勾选授权确认。</div>
                    <div class="cq-ai-grid cq-aa-grid">
                        <label class="cq-ai-field"><span>答题模式</span><select id="cq-aa-mode">
                            <option value="assist">assist · 只显示答案</option>
                            <option value="fill">fill · 自动填入不提交</option>
                            <option value="submit">submit · 填入并提交（需授权）</option>
                        </select></label>
                        <label class="cq-ai-field"><span>适用页面</span><select id="cq-aa-scope">
                            <option value="all">全部（测验/作业/考试/弹题）</option>
                            <option value="quiz">仅测验/作业</option>
                            <option value="exam">仅考试</option>
                            <option value="popup">仅视频弹题</option>
                        </select></label>
                        <label class="cq-ai-field"><span>每批题数（1-20）</span><input id="cq-aa-batch" type="number" min="1" max="20"></label>
                        <label class="cq-ai-field"><span>填入间隔（毫秒）</span><input id="cq-aa-delay" type="text" placeholder="1200-3500"></label>
                        <label class="cq-ai-field full"><span>API 地址（OpenAI 兼容）</span><input id="cq-aa-endpoint" type="text" autocomplete="off"></label>
                        <label class="cq-ai-field"><span>模型</span><input id="cq-aa-model" type="text" autocomplete="off"></label>
                        <label class="cq-ai-field"><span>API Key（仅保存在本机）</span><input id="cq-aa-key" type="password" autocomplete="off" placeholder="sk-..."></label>
                    </div>
                    <div class="cq-aa-checks">
                        <label><input type="checkbox" id="cq-aa-autorun"> 进入答题页后自动执行当前模式</label>
                        <label><input type="checkbox" id="cq-aa-autofill"> AI 作答后自动填入（assist 也填，可关闭）</label>
                        <label><input type="checkbox" id="cq-aa-modelock"> 固定当前答题模式（锁定后不能切换）</label>
                        <label><input type="checkbox" id="cq-aa-evidence"> 记录反作弊检测证据（提交请求/响应、耗时）</label>
                        <label id="cq-aa-auth-wrap"><input type="checkbox" id="cq-aa-auth"> 我确认：当前仅在已获书面授权的测试环境使用自动填答/提交</label>
                        <div class="cq-aa-auth-key">
                            <input type="text" id="cq-aa-auth-key" placeholder="授权密钥（密钥正确才解锁答题功能）" autocomplete="off">
                            <span id="cq-aa-auth-key-status">未验证：答题功能已锁定</span>
                        </div>
                    </div>
                    <details class="cq-aa-advanced">
                        <summary>高级：自定义 CSS 选择器（识别不到题目时再用）</summary>
                        <div class="cq-ai-grid">
                            <label class="cq-ai-field"><span>题目容器</span><input id="cq-aa-sel-block" placeholder="留空自动识别"></label>
                            <label class="cq-ai-field"><span>选项组</span><input id="cq-aa-sel-group" placeholder="留空自动识别"></label>
                            <label class="cq-ai-field"><span>选项</span><input id="cq-aa-sel-option" placeholder="例如 .single-option-item"></label>
                            <label class="cq-ai-field"><span>题干</span><input id="cq-aa-sel-stem" placeholder="留空自动识别"></label>
                            <label class="cq-ai-field"><span>提交按钮</span><input id="cq-aa-sel-submit" placeholder="留空自动查找"></label>
                        </div>
                    </details>
                    <div class="cq-aa-pane-actions">
                        <button type="button" id="cq-aa-submit">提交（需授权）</button>
                        <button type="button" id="cq-aa-clear">清空识别结果</button>
                    </div>
                    <div class="cq-ai-status" id="cq-aa-logstatus">自动答题未启用</div>
                    <div class="cq-aa-log" id="cq-aa-log"></div>
                    <div class="cq-ai-status" id="cq-aa-status">自动答题未启用</div>
                    <div class="cq-aa-hint">拖动标题栏移动 · Alt+A 开关 · Alt+Shift+E 导出证据 · window.__CQOOC_AA__.uiCheck()</div>
                </div>
            </div>
        </div>
    `;

    /**
     * 创建答题窗口（可拖动、可最小化，不遮挡页面操作）。
     * 窗口直接挂在 Shadow DOM，必要时可兜底挂到 body。
     */
    function aaBuildUi() {
        if (!shadow || aaModal) return;

        const style = document.createElement('style');
        style.textContent = AA_STYLE;
        shadow.appendChild(style);

        const headRight = shadow.querySelector('.cq-head-right');
        if (headRight && !shadow.getElementById('cq-aa-open')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cq-ai-open';
            button.id = 'cq-aa-open';
            button.title = 'AI 自动答题（可拖动窗口）';
            button.textContent = '答';
            headRight.insertBefore(button, headRight.firstChild);
            button.addEventListener('click', aaOpenModal);
        }

        const settings = shadow.querySelector('.cq-settings');
        if (settings && !shadow.getElementById('cq-aa-enable')) {
            const label = document.createElement('label');
            label.className = 'cq-setting';
            label.title = 'AI 自动答题总开关（测试用，默认关闭）';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = 'cq-aa-enable';
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(' 自动答题'));
            settings.appendChild(label);
            checkbox.addEventListener('change', function () {
                aaCfg.enabled = checkbox.checked;
                saveAaCfg();
                aaLog(aaCfg.enabled ? '已开启自动答题（测试模式）' : '已关闭自动答题');
                aaTick();
                aaRenderStatus();
            });
        }

        const win = document.createElement('div');
        win.innerHTML = AA_HTML;
        const winEl = win.firstElementChild;
        shadow.appendChild(winEl);
        aaModal = winEl;

        const ids = ['win', 'win-head', 'win-sub', 'win-body', 'tabs', 'count-choice', 'count-fill',
            'choice-list', 'fill-list', 'page', 'count', 'status', 'warn', 'mode', 'scope', 'batch', 'delay',
            'endpoint', 'model', 'key', 'autorun', 'autofill', 'modelock', 'evidence', 'auth', 'auth-wrap', 'auth-key', 'auth-key-status', 'fill-answer', 'fill-all', 'fill-stop',
            'sel-block', 'sel-group', 'sel-option', 'sel-stem', 'sel-submit',
            'extract', 'answer', 'fill', 'submit', 'stop', 'export', 'copy', 'clear',
            'min', 'close', 'logstatus', 'log'];
        aaEls = {};
        ids.forEach(function (name) {
            aaEls[name.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] =
                winEl.querySelector('#cq-aa-' + name) || shadow.getElementById('cq-aa-' + name);
        });
        // 兼容读法：cq-aa-win 的元素 id 就是 cq-aa-win，上面已经用 #cq-aa-win 取到。
        aaEls.win = winEl;
        aaEls.winHead = winEl.querySelector('#cq-aa-win-head');
        aaEls.winSub = winEl.querySelector('#cq-aa-win-sub');
        aaEls.tabs = winEl.querySelector('#cq-aa-tabs');
        aaEls.countChoice = winEl.querySelector('#cq-aa-count-choice');
        aaEls.countFill = winEl.querySelector('#cq-aa-count-fill');
        aaEls.choiceList = winEl.querySelector('#cq-aa-choice-list');
        aaEls.fillList = winEl.querySelector('#cq-aa-fill-list');
        aaEls.authWrap = winEl.querySelector('#cq-aa-auth-wrap');
        aaEls.modeLock = winEl.querySelector('#cq-aa-modelock');

        aaBindUi();
        aaSyncUi();
        aaApplyWinPosition();
    }

    function aaWinPosKey() {
        return 'cqooc-aa-win-pos-v1';
    }

    function aaLoadWinPos() {
        try {
            const raw = localStorage.getItem(aaWinPosKey());
            const pos = raw ? JSON.parse(raw) : null;
            if (pos && Number.isFinite(Number(pos.left)) && Number.isFinite(Number(pos.top))) {
                return { left: Number(pos.left), top: Number(pos.top) };
            }
        } catch (e) {}
        return null;
    }

    function aaSaveWinPos(left, top) {
        try {
            localStorage.setItem(aaWinPosKey(), JSON.stringify({ left: Math.round(left), top: Math.round(top) }));
        } catch (e) {}
    }

    function aaApplyWinPosition() {
        if (!aaModal) return;
        const pos = aaLoadWinPos();
        if (pos) {
            aaModal.style.right = 'auto';
            aaModal.style.left = Math.max(4, Math.min(window.innerWidth - 80, pos.left)) + 'px';
            aaModal.style.top = Math.max(4, Math.min(window.innerHeight - 60, pos.top)) + 'px';
        }
    }

    function aaOn(el, event, handler) {
        if (el) el.addEventListener(event, handler);
    }

    function aaBindWinDrag() {
        const head = aaEls.winHead;
        if (!head || !aaModal) return;
        let drag = null;
        head.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) return;
            if (event.target.closest && event.target.closest('button')) return;
            const rect = aaModal.getBoundingClientRect();
            drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            aaModal.style.right = 'auto';
            aaModal.style.left = rect.left + 'px';
            aaModal.style.top = rect.top + 'px';
            try { head.setPointerCapture(event.pointerId); } catch (e) {}
            event.preventDefault();
        });
        head.addEventListener('pointermove', function (event) {
            if (!drag || event.pointerId !== drag.id) return;
            const width = aaModal.offsetWidth || 400;
            const left = Math.max(4, Math.min(window.innerWidth - width - 4, event.clientX - drag.dx));
            const top = Math.max(4, Math.min(window.innerHeight - 60, event.clientY - drag.dy));
            aaModal.style.left = left + 'px';
            aaModal.style.top = top + 'px';
        });
        const end = function (event) {
            if (!drag || (event && event.pointerId !== drag.id)) return;
            drag = null;
            try {
                aaSaveWinPos(parseFloat(aaModal.style.left) || 0, parseFloat(aaModal.style.top) || 0);
            } catch (e) {}
        };
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
    }

    function aaSelectTab(name) {
        if (!aaEls.tabs) return;
        const tabs = aaEls.tabs.querySelectorAll('.cq-aa-tab');
        Array.prototype.forEach.call(tabs, function (tab) {
            tab.classList.toggle('active', tab.getAttribute('data-tab') === name);
        });
        if (aaModal) {
            const panes = aaModal.querySelectorAll('.cq-aa-pane');
            Array.prototype.forEach.call(panes, function (pane) {
                pane.style.display = pane.getAttribute('data-pane') === name ? 'flex' : 'none';
            });
        }
    }

    /** 简化版 SHA-256（hex 输出）；授权密钥只做哈希比对，源码/存储中不保存明文。 */
    function aaSha256Hex(input) {
        const str = String(input || '');
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            let code = str.charCodeAt(i);
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
            else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
            else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
        const bitLen = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) bytes.push(0);
        const hi = Math.floor(bitLen / 0x100000000);
        const lo = bitLen >>> 0;
        bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
        bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
        const K = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ];
        const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
        for (let offset = 0; offset < bytes.length; offset += 64) {
            const w = new Array(64);
            for (let i = 0; i < 16; i++) {
                w[i] = (bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3];
            }
            for (let i = 16; i < 64; i++) {
                const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
            }
            let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (let i = 0; i < 64; i++) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = (e & f) ^ (~e & g);
                const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const t2 = (S0 + maj) >>> 0;
                h = g; g = f; f = e; e = (d + t1) >>> 0;
                d = c; c = b; b = a; a = (t1 + t2) >>> 0;
            }
            H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
            H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
        }
        return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
    }

    function aaAuthKeyHash(value) {
        return aaSha256Hex(AA_AUTH_SALT + ':' + String(value == null ? '' : value).trim());
    }

    function aaAuthKeyValid() {
        return !!(aaEls.authKey && aaAuthKeyHash(aaEls.authKey.value) === AA_AUTH_HASH);
    }

    function aaAuthUnlocked() {
        return aaCfg.authVerified === true;
    }

    function aaSyncAuthKeyStatus() {
        if (!aaEls.authKeyStatus) return;
        if (aaCfg.authVerified) {
            aaEls.authKeyStatus.textContent = '密钥验证通过：答题功能已解锁';
            aaEls.authKeyStatus.className = 'ok';
        } else if (aaCfg.authToken === AA_AUTH_HASH) {
            aaEls.authKeyStatus.textContent = '已保存验证：答题功能已解锁';
            aaEls.authKeyStatus.className = 'ok';
        } else if (aaAuthKeyValid()) {
            aaEls.authKeyStatus.textContent = '密钥正确：将自动解锁';
            aaEls.authKeyStatus.className = 'ok';
        } else {
            aaEls.authKeyStatus.textContent = '未验证：答题功能已锁定';
            aaEls.authKeyStatus.className = '';
        }
        if (aaCfg.authToken && aaEls.authKey && !aaEls.authKey.value) {
            aaEls.authKey.placeholder = '已验证（密钥不保存，清缓存后需重输）';
        }
    }

    function aaBindUi() {
        aaOn(aaEls.close, 'click', aaCloseModal);
        aaOn(aaEls.min, 'click', function () {
            if (aaModal) aaModal.classList.toggle('mini');
        });
        aaBindWinDrag();
        if (aaEls.tabs) {
            aaEls.tabs.addEventListener('click', function (event) {
                const tab = event.target.closest ? event.target.closest('.cq-aa-tab') : null;
                if (!tab) return;
                aaSelectTab(tab.getAttribute('data-tab'));
            });
        }

        aaOn(aaEls.mode, 'change', function () {
            aaCfg.mode = aaEls.mode.value;
            saveAaCfg();
            aaLog('答题模式：' + aaModeLabel());
            aaRenderStatus();
        });
        aaOn(aaEls.scope, 'change', function () {
            aaCfg.scope = aaEls.scope.value;
            saveAaCfg();
            aaTick();
            aaLog('作用范围：' + aaCfg.scope);
        });
        aaOn(aaEls.batch, 'change', function () {
            aaCfg.batchSize = Math.max(1, Math.min(20, Number(aaEls.batch.value) || 8));
            aaEls.batch.value = aaCfg.batchSize;
            saveAaCfg();
        });
        aaOn(aaEls.delay, 'change', function () {
            const match = String(aaEls.delay.value || '').match(/(\d+)\D+(\d+)/);
            if (match) {
                aaCfg.delayMin = Math.max(0, Number(match[1]) || 0);
                aaCfg.delayMax = Math.max(aaCfg.delayMin, Number(match[2]) || aaCfg.delayMin);
            } else {
                const one = Math.max(0, Number(aaEls.delay.value) || 0);
                aaCfg.delayMin = one;
                aaCfg.delayMax = one;
            }
            aaEls.delay.value = aaCfg.delayMin + '-' + aaCfg.delayMax;
            saveAaCfg();
        });

        const syncAi = function () {
            aiCfg.endpoint = (aaEls.endpoint.value || '').trim() || AI_DEFAULT_ENDPOINT;
            aiCfg.model = (aaEls.model.value || '').trim() || AI_DEFAULT_MODEL;
            aiCfg.apiKey = (aaEls.key.value || '').trim();
            saveAiCfg(aiCfg);
            if (els.aiEndpoint) els.aiEndpoint.value = aiCfg.endpoint;
            if (els.aiModel) els.aiModel.value = aiCfg.model;
            if (els.aiKey) els.aiKey.value = aiCfg.apiKey;
            aaLog('AI 配置已保存（Key 仅保存在本机）');
        };
        aaOn(aaEls.endpoint, 'change', syncAi);
        aaOn(aaEls.model, 'change', syncAi);
        aaOn(aaEls.key, 'change', syncAi);

        aaOn(aaEls.autofill, 'change', function () {
            aaCfg.autoFill = aaEls.autofill.checked;
            saveAaCfg();
            aaLog(aaCfg.autoFill ? '已开启：AI 作答后自动填入' : '已关闭：assist 只显示答案');
        });
        aaOn(aaEls.autorun, 'change', function () {
            aaCfg.autoRun = aaEls.autorun.checked;
            saveAaCfg();
            if (aaCfg.autoRun && !aaCfg.authorized) {
                aaLog('已开启自动执行；fill/submit 仍需勾选授权确认', 'warn');
            }
            aaTick();
        });
        aaOn(aaEls.evidence, 'change', function () {
            aaCfg.captureEvidence = aaEls.evidence.checked;
            saveAaCfg();
        });
        const verifyKeyFromInput = function () {
            if (aaAuthKeyValid()) {
                aaCfg.authVerified = true;
                aaCfg.authToken = AA_AUTH_HASH;
                aaCfg.authPersist = true;
                aaCfg.authorized = true;
                if (aaEls.auth) aaEls.auth.checked = true;
                saveAaCfg();
                aaLog('密钥验证通过：答题功能已解锁（仅本机校验，不保存明文密钥）', 'on');
                if (aaIsProductionHost()) {
                    aaLog('注意：当前是生产域名，自动提交可能违反平台规则；建议只在测试环境做提交用例', 'err');
                }
            } else {
                aaCfg.authVerified = false;
                aaCfg.authToken = '';
                aaCfg.authPersist = false;
                aaCfg.authorized = false;
                if (aaEls.auth) aaEls.auth.checked = false;
                saveAaCfg();
                aaLog('密钥不正确：答题功能保持锁定', 'err');
            }
            aaSyncAuthKeyStatus();
            aaRenderStatus();
        };
        aaOn(aaEls.auth, 'change', function () {
            if (!aaCfg.authVerified) {
                if (aaEls.auth) aaEls.auth.checked = false;
                aaCfg.authorized = false;
                aaLog('请先在“授权密钥”里输入正确密钥，答题功能才会解锁', 'err');
                aaSyncAuthKeyStatus();
                aaRenderStatus();
                return;
            }
            if (!aaEls.auth.checked) {
                aaCfg.authVerified = false;
                aaCfg.authToken = '';
                aaCfg.authPersist = false;
                aaCfg.authorized = false;
                saveAaCfg();
                aaLog('已取消授权：答题功能已重新锁定', 'warn');
                aaSyncAuthKeyStatus();
                aaRenderStatus();
                return;
            }
            aaCfg.authorized = true;
            saveAaCfg();
            aaSyncAuthKeyStatus();
            aaRenderStatus();
        });
        aaOn(aaEls.authKey, 'change', verifyKeyFromInput);
        aaOn(aaEls.authKey, 'keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                verifyKeyFromInput();
            }
        });
        aaOn(aaEls.authKey, 'keyup', aaSyncAuthKeyStatus);
        aaOn(aaEls.modeLock, 'change', function () {
            aaCfg.modeLocked = aaEls.modeLock.checked;
            saveAaCfg();
            aaLog(aaCfg.modeLocked ? ('答题模式已固定为：' + aaModeLabel()) : '答题模式已解除固定');
            aaRenderStatus();
        });

        const selectors = { block: 'selBlock', group: 'selGroup', option: 'selOption', stem: 'selStem', submit: 'selSubmit' };
        Object.keys(selectors).forEach(function (key) {
            aaOn(aaEls[selectors[key]], 'change', function () {
                aaCfg.selectors[key] = (aaEls[selectors[key]].value || '').trim();
                saveAaCfg();
                aaLog('选择器已更新：' + key);
                aaTick();
            });
        });

        aaOn(aaEls.extract, 'click', function () {
            const questions = aaExtractQuestions(document);
            aaState.pageKind = aaPageKind();
            aaState.signature = aaQuestionSignature(questions);
            aaState.questions = questions;
            aaState.answers = [];
            aaState.fillReport = [];
            aaRenderQuestions();
            aaState.status = questions.length ? ('提取到 ' + questions.length + ' 题') : '没有提取到题目，试试高级选择器或 dump()';
            aaLog(aaState.status);
            aaRenderStatus();
        });
        aaOn(aaEls.answer, 'click', function () {
            const action = aaCfg.mode === 'assist' ? 'assist' : aaCfg.mode;
            aaPipeline('manual', action);
        });
        aaOn(aaEls.fill, 'click', function () { aaFillExistingAnswers(); });
        aaOn(aaEls.fillAnswer, 'click', function () { aaPipeline('manual', 'fill'); });
        aaOn(aaEls.fillAll, 'click', function () { aaFillExistingAnswers(); });
        aaOn(aaEls.fillStop, 'click', aaStop);
        aaOn(aaEls.submit, 'click', function () { aaPipeline('manual', 'submit'); });
        aaOn(aaEls.stop, 'click', aaStop);
        aaOn(aaEls.export, 'click', aaExportEvidence);
        aaOn(aaEls.copy, 'click', aaCopyStructure);
        aaOn(aaEls.clear, 'click', function () {
            aaState.questions = [];
            aaState.answers = [];
            aaState.filled = 0;
            aaState.fillFailed = 0;
            aaState.fillReport = [];
            aaState.submitted = false;
            aaState.signature = '';
            aaState.status = '已清空本次识别结果（不影响页面已填内容）';
            aaRenderQuestions();
            aaRenderStatus();
        });
    }

    function aaSyncUi() {
        if (!aaEls.mode) return;
        aaEls.mode.value = aaCfg.mode;
        aaEls.scope.value = aaCfg.scope;
        aaEls.batch.value = aaCfg.batchSize;
        aaEls.delay.value = aaCfg.delayMin + '-' + aaCfg.delayMax;
        aaEls.endpoint.value = aiCfg.endpoint;
        aaEls.model.value = aiCfg.model;
        aaEls.key.value = aiCfg.apiKey;
        aaEls.autorun.checked = aaCfg.autoRun;
        aaEls.evidence.checked = aaCfg.captureEvidence;
        if (aaEls.auth) aaEls.auth.checked = aaCfg.authorized;
        if (aaEls.modeLock) aaEls.modeLock.checked = aaCfg.modeLocked === true;
        if (aaEls.autofill) aaEls.autofill.checked = aaCfg.autoFill !== false;
        aaSyncAuthKeyStatus();
        if (aaEls.selBlock) aaEls.selBlock.value = aaCfg.selectors.block;
        if (aaEls.selGroup) aaEls.selGroup.value = aaCfg.selectors.group;
        if (aaEls.selOption) aaEls.selOption.value = aaCfg.selectors.option;
        if (aaEls.selStem) aaEls.selStem.value = aaCfg.selectors.stem;
        if (aaEls.selSubmit) aaEls.selSubmit.value = aaCfg.selectors.submit;
        const enable = shadow && shadow.getElementById('cq-aa-enable');
        if (enable) enable.checked = aaCfg.enabled;
        if (aaEls.authWrap) aaEls.authWrap.classList.toggle('danger', aaIsProductionHost());
        if (aaEls.warn) {
            aaEls.warn.textContent = aaIsProductionHost()
                ? '当前主机 ' + aaHost() + ' 是生产域名。自动填答/提交仅限已获授权的测试用途；未授权请只使用 assist 模式或关闭本功能。'
                : '当前主机 ' + aaHost() + '。仅限你已获授权的测试环境；默认 assist 不写页面，fill/submit 需要手动勾选授权确认。';
        }
    }

    function aaOpenModal() {
        if (!aaModal) {
            console.error('[CQOOC答题] 答题窗口尚未创建（aaModal=null）');
            return;
        }
        try {
            aaInstrumentNetwork();
            aaSyncUi();
            aaModal.classList.remove('mini');
            aaModal.classList.add('show');
            if (!aaOverlayVisible(aaModal, null)) {
                aaMountOverlayForVisibility(aaModal);
                aaModal.classList.add('show');
                console.info('[CQOOC答题] 答题窗口在 Shadow 内不可见，已切换为页面级挂载');
            }
            aaTick();
            aaRender();
            console.info('[CQOOC答题] 已打开答题窗口（可拖动，不遮挡页面操作；Alt+A 关闭）');
        } catch (err) {
            console.error('[CQOOC答题] 打开答题窗口失败', err);
            try {
                aaMountOverlayForVisibility(aaModal);
                aaModal.classList.add('show');
            } catch (e) {}
        }
    }

    function aaCloseModal() {
        if (aaModal) aaModal.classList.remove('show');
    }

    /** 渲染题目列表：选择题/判断题一栏、填空题一栏，按原题号显示。 */
    function aaRenderQuestions() {
        const choiceQs = (aaState.questions || []).filter(function (q) { return q.kind === 'choice'; });
        const fillQs = (aaState.questions || []).filter(function (q) { return q.kind === 'text'; });
        setText(aaEls.countChoice, choiceQs.length);
        setText(aaEls.countFill, fillQs.length);
        setText(aaEls.count, '题目：' + (aaState.questions || []).length);
        aaRenderQuestionList(aaEls.choiceList, choiceQs, '还没有识别到选择题/判断题。');
        aaRenderQuestionList(aaEls.fillList, fillQs, '还没有识别到填空题/主观题。');
        aaRenderStatus();
    }

    function aaRenderQuestionList(wrap, list, emptyText) {
        if (!wrap) return;
        wrap.textContent = '';
        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'cq-aa-empty';
            empty.textContent = emptyText || '提取题目后在这里显示。';
            wrap.appendChild(empty);
            return;
        }
        list.forEach(function (q) {
            const answer = (aaState.answers || []).filter(function (a) { return a.index === q.index; })[0];
            const report = (aaState.fillReport || []).filter(function (r) { return r.index === q.index; })[0];
            const details = document.createElement('details');
            details.className = 'cq-aa-q';

            const summary = document.createElement('summary');
            const title = document.createElement('b');
            title.textContent = '第' + (q.no || q.index) + '题 · ' + aaTypeLabel(q.type);
            const stateEl = document.createElement('span');
            let stateText = '未作答';
            let stateClass = '';
            if (report) {
                if (report.status === 'filled') { stateText = '已填入'; }
                else if (report.status === 'filled-unverified') { stateText = '已填·未验证'; stateClass = 'warn'; }
                else if (report.status === 'empty') { stateText = 'AI 答案为空'; stateClass = 'err'; }
                else { stateText = '填入失败'; stateClass = 'err'; }
            } else if (answer) {
                const value = Array.isArray(answer.answer) ? answer.answer.join(',') : String(answer.answer == null ? '' : answer.answer);
                stateText = value ? 'AI 已作答' : 'AI 空';
            }
            stateEl.textContent = stateText;
            if (stateClass) stateEl.className = stateClass;
            summary.appendChild(title);
            summary.appendChild(stateEl);
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'cq-aa-q-body';
            const stem = document.createElement('div');
            stem.className = 'cq-aa-q-stem';
            stem.textContent = q.stem.slice(0, 300);
            body.appendChild(stem);

            if (q.options && q.options.length) {
                const opts = document.createElement('div');
                opts.className = 'cq-aa-q-opts';
                opts.textContent = q.options.map(function (o) { return o.letter + '. ' + o.text; }).join('  ');
                body.appendChild(opts);
            }
            if (answer) {
                const value = Array.isArray(answer.answer) ? answer.answer.join(',') : String(answer.answer == null ? '' : answer.answer);
                const ansEl = document.createElement('div');
                ansEl.className = 'cq-aa-q-answer' + (report && report.status === 'filled-unverified' ? ' warn' : '');
                ansEl.textContent = 'AI 答案：' + (value || '（空）');
                body.appendChild(ansEl);
            }
            if (q.kind === 'text' && q.input) {
                const currentValue = q.input.value != null ? q.input.value : (q.input.textContent || '');
                if (currentValue) {
                    const cur = document.createElement('div');
                    cur.className = 'cq-aa-q-answer';
                    cur.textContent = '当前页面值：' + String(currentValue).slice(0, 120);
                    body.appendChild(cur);
                }
            }

            const actions = document.createElement('div');
            actions.className = 'cq-aa-q-actions';
            const fillBtn = document.createElement('button');
            fillBtn.type = 'button';
            fillBtn.textContent = '填入本题';
            fillBtn.disabled = !aaAuthUnlocked();
            fillBtn.addEventListener('click', function (event) {
                try { event.preventDefault(); event.stopPropagation(); } catch (e) {}
                aaFillSingleQuestion(q);
            });
            actions.appendChild(fillBtn);

            if (answer) {
                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.textContent = '复制答案';
                copyBtn.addEventListener('click', function (event) {
                    try { event.preventDefault(); event.stopPropagation(); } catch (e) {}
                    const value = Array.isArray(answer.answer) ? answer.answer.join('') : String(answer.answer == null ? '' : answer.answer);
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(value);
                        } else {
                            const ta = document.createElement('textarea');
                            ta.value = value;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            ta.remove();
                        }
                        aaLog('已复制第' + (q.no || q.index) + '题答案，可手动粘贴到编辑器');
                    } catch (e) {
                        aaLog('复制失败：' + (e && e.message ? e.message : e), 'err');
                    }
                });
                actions.appendChild(copyBtn);
            }
            body.appendChild(actions);
            details.appendChild(body);
            wrap.appendChild(details);
        });
    }

    function aaRenderLog() {
        if (!aaEls.log) return;
        aaEls.log.textContent = '';
        aaState.logs.slice(0, 20).forEach(function (line) {
            const row = document.createElement('div');
            row.textContent = line;
            aaEls.log.appendChild(row);
        });
        aaEls.log.scrollTop = 0;
    }

    function aaRenderStatus() {
        if (!aaEls.status) return;
        const enabledText = aaCfg.enabled ? ('已启用 · ' + aaCfg.mode) : '自动答题未启用';
        setText(aaEls.page, '页面：' + (aaState.pageKind ? aaKindLabel(aaState.pageKind) : '非答题页'));
        setText(aaEls.count, '题目：' + aaState.questions.length);
        setText(aaEls.status, aaState.status || enabledText);
        setText(aaEls.logstatus, (aaState.busy ? '运行中 · ' : '') + enabledText +
            (aaCfg.authorized ? ' · 已授权' : ' · 未授权') +
            (aaCfg.captureEvidence ? ' · 证据 ' + aaState.evidence.length + ' 条' : ''));
        setText(aaEls.winSub, (aaState.pageKind ? aaKindLabel(aaState.pageKind) : '未识别页面') +
            ' · 已识别 ' + aaState.questions.length + ' 题');
        const locked = !aaAuthUnlocked();
        if (locked) setText(aaEls.status, '答题功能已锁定：请输入正确授权密钥解锁');
        if (aaEls.answer) aaEls.answer.disabled = locked;
        if (aaEls.fill) aaEls.fill.disabled = locked;
        if (aaEls.submit) aaEls.submit.disabled = locked;
        if (aaEls.fillAnswer) aaEls.fillAnswer.disabled = locked;
        if (aaEls.fillAll) aaEls.fillAll.disabled = locked;
        if (aaEls.answer) aaEls.answer.textContent = aaCfg.mode === 'assist' ? 'AI 作答' : 'AI 作答并填入';
        if (aaEls.auth) aaEls.auth.checked = aaCfg.authorized && !locked;
        if (aaEls.modeLock) aaEls.modeLock.checked = aaCfg.modeLocked === true;
        if (aaEls.mode) {
            aaEls.mode.value = aaCfg.mode;
            aaEls.mode.disabled = aaCfg.modeLocked === true;
        }
        aaSyncAuthKeyStatus();
        if (aaEls.scope) aaEls.scope.value = aaCfg.scope;
        if (aaEls.autorun) aaEls.autorun.checked = aaCfg.autoRun;
        if (aaEls.autofill) aaEls.autofill.checked = aaCfg.autoFill !== false;
        if (aaEls.evidence) aaEls.evidence.checked = aaCfg.captureEvidence;
        const enable = shadow && shadow.getElementById('cq-aa-enable');
        if (enable) enable.checked = aaCfg.enabled;
    }



    function aaRender() {
        aaRenderStatus();
    }

    /**
     * 自动答题初始化：建 UI、包网络、启动巡检、暴露调试 API。
     */
    function aaInit() {
        try {
            aaBuildUi();
        } catch (e) {
            console.error('[CQOOC答题] 创建答题 UI 失败（面板仍可用，可执行 __CQOOC_AA__.uiCheck() 排查）', e);
        }
        // 网络取证延迟到答题页/打开答题窗口时再启用，避免影响学习页视频播放。
        setInterval(aaTick, 1500);
        setTimeout(aaTick, 800);

        if (cfg.enabled && isStudyPage()) {
            // 学习页不自动答题，只等待弹题；这里不额外打日志，避免干扰。
        }

        // 注意：aaInstrumentNetwork() 已改为“只在答题页/打开答题窗口时启用”，
        // 避免在学习页包装 fetch/XHR 影响视频播放。
        window.__CQOOC_AA__ = {
            version: VERSION,
            cfg: aaCfg,
            state: aaState,
            extract: aaExtractQuestions,
            ask: function () { return aaPipeline('manual', 'assist'); },
            fill: function () { return aaPipeline('manual', 'fill'); },
            submit: function () { return aaPipeline('manual', 'submit'); },
            auto: function () { return aaPipeline('auto', aaCfg.mode); },
            popup: aaHandlePopup,
            tick: aaTick,
            stop: aaStop,
            dump: aaDumpRaw,
            copyStructure: aaCopyStructure,
            findSubmit: aaFindSubmitButton,
            pageKind: aaPageKind,
            exportEvidence: aaExportEvidence,
            evidence: function () { return aaState.evidence.slice(); },
            open: aaOpenModal,
            close: aaCloseModal,
            uiCheck: aaUiCheck,
            mountFallback: function () {
                const ok = aaMountOverlayForVisibility(aaModal);
                if (aaModal) aaModal.classList.add('show');
                return ok;
            }
        };

        window.__CQOOC_AA__.ready = true;
        if (window.__CQOOC_US__) {
            window.__CQOOC_US__.aaReady = true;
            window.__CQOOC_US__.stage = 'ready';
        }
        aaLog('自动答题模块已加载（' + (aaCfg.enabled ? '已启用' : '默认关闭') + '，' + aaModeLabel() + '）' +
            (aaIsProductionHost() ? '；当前为生产域名' : ''));
        console.info('[CQOOC答题] v' + VERSION + ' 入口：面板“答”/Alt+A；答题窗口可拖动、可最小化，Alt+Shift+E 导出证据');
        console.info('[CQOOC答题] 注入自检：window.__CQOOC_US__ =', window.__CQOOC_US__);
    }

    /* ------------------------------------------------------------------ */
    /* 弹题检测                                                           */
    /* ------------------------------------------------------------------ */

    function isQuestionVisible(cw) {
        if (cw && cw.spVisible) return true;

        const nodes = document.querySelectorAll('.wt-modal, .ant-modal-content');
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!isVisible(node)) continue;
            const text = node.innerText || node.textContent || '';
            if (/请先回答|请作答|回答.{0,8}继续|答题后继续/.test(text)) return true;
        }
        return false;
    }

    function onQuestion(entry) {
        const id = entry ? entry.ID : 'unknown';
        const first = state.questionFor !== id;

        state.questionFor = id;

        // 自动答题开启且配置了 AI 接口时，把弹题交给 AI 答题引擎；否则保留原来的“响铃提醒”。
        if (first && aaPopupAllowed() && aiCfg.apiKey && aaAuthUnlocked()) {
            setStatus('检测到弹题，答题助手处理中', 'warn', '模式：' + aaModeLabel());
            log('检测到弹题：交给 AI 答题助手处理（' + aaCfg.mode + '）');
            setTimeout(function () { aaHandlePopup(false); }, 600);
            return;
        }

        setStatus('检测到弹题，已暂停', 'warn', '请手动选择答案，答完后会自动继续');

        if (cfg.alertQuestion && first) {
            flashTitle();
            beep();
            log('检测到弹题：自动答题未启用，请手动选择');
        }
    }

    /* ------------------------------------------------------------------ */
    /* 主循环                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * 主循环：每秒执行一次。
     * 执行顺序很重要：先确认页面/目录/当前课件，再判断弹题、课件类型、是否完成，
     * 最后才自动播放和安排下一节。任何一步拿不到数据都直接 return，
     * 避免在页面还没加载完时误判“全部完成”或误切课件。
     */
    function tick() {
        try {
            if (!cfg.enabled) {
                setStatus('已暂停', '');
                state.activeSeconds = 0;
                render();
                return;
            }

            if (!state.activeSince) state.activeSince = Date.now();
            state.activeSeconds = (Date.now() - state.activeSince) / 1000;

            if (!isStudyPage()) {
                const answerKind = aaPageKind();
                if (answerKind) {
                    state.lessonTitle = '答题页（' + aaKindLabel(answerKind) + '）';
                    setStatus(
                        '答题页 · ' + aaKindLabel(answerKind),
                        aaCfg.enabled ? 'warn' : '',
                        '自动答题：' + (aaCfg.enabled ? aaModeLabel() : '未启用（点面板“答”按钮）')
                    );
                } else {
                    setStatus('请进入“课程学习”页面', 'warn', '当前页面：' + pagePath());
                    state.lessonTitle = '等待进入课程学习页';
                }
                state.progress = 0;
                render();
                return;
            }

            const vm = getStudyVm();
            if (!vm) {
                setStatus('页面加载中…', 'warn', '正在等待课程组件');
                render();
                return;
            }

            if (!Array.isArray(vm.menuList) || !vm.menuList.length) {
                setStatus('目录加载中…', 'warn', '等待课程章节数据');
                render();
                return;
            }

            const entry = getCurrentItem(vm);
            if (!entry) {
                updateView(null, null);
                setStatus('正在查找未完成课件…', 'warn');
                if (cfg.autoNext) pickFirst(vm);
                render();
                return;
            }

            const cw = getCoursewareVm(vm);
            patchCoursewareVm(cw);
            const cwReady = !!(cw && cw.kjData && String(cw.kjData.ID) === String(entry.ID));

            if (state.currentId !== String(entry.ID)) onCurrentChanged(entry);
            updateView(entry, cwReady ? cw : null);

            if (state.allDone) {
                setStatus('全部课件已完成', 'on', '没有找到未完成的课件');
                render();
                return;
            }

            const question = isQuestionVisible(cwReady ? cw : null);
            if (question) {
                onQuestion(entry);
                render();
                return;
            }

            if (state.questionFor) {
                state.questionFor = null;
                restoreTitle();
                log('弹题已处理，继续学习');
            }

            if (entry.LX === '3') {
                setStatus(
                    '当前为讨论区',
                    'on',
                    cfg.autoReply ? '准备复制首条评论并回复…' : '可点“回复讨论”复制首条评论'
                );

                if (cfg.autoReply && !state.replyTried.has(entry.ID) && !state.replied.has(entry.ID)) {
                    state.replyTried.add(entry.ID);
                    setTimeout(function () {
                        if (!cfg.autoReply) return;
                        const nowVm = getStudyVm();
                        const current = getCurrentItem(nowVm);
                        if (!current || current.ID !== entry.ID || state.replied.has(entry.ID)) return;
                        replyToDiscussion(false);
                    }, 1200);
                }

                if (state.replied.has(entry.ID)) {
                    scheduleDiscussionContinue(entry, '讨论已处理', 3000);
                } else if (cfg.autoReply && state.replyTried.has(entry.ID) && !state.replying && !state.nextTimer) {
                    scheduleDiscussionContinue(entry, '讨论回复已尝试，继续下一节', 8000);
                }

                render();
                return;
            }

            if (entry.LX !== '1') {
                const inlineKind = aaPageKind();
                if (aaCfg.enabled && aaScopeAllows(inlineKind)) {
                    setStatus(
                        '当前为' + aaKindLabel(inlineKind),
                        'warn',
                        '自动答题已启用：' + aaModeLabel() + ' · 题目 ' + aaState.questions.length + ' 道'
                    );
                } else {
                    setStatus('当前为测验/作业', 'warn', '自动答题未启用（脚本不会代做）');
                }
                render();
                return;
            }

            if (!cwReady) {
                setStatus('课件加载中…', 'warn', '等待资源与计时初始化');
                render();
                return;
            }

            const type = currentType(cw);
            if (!type) {
                setStatus('课件资源加载中…', 'warn');
                render();
                return;
            }

            if (cfg.fastDoc && isDocLike(type)) {
                accelerateDoc(entry, cw);
            }

            if (isDone(entry, cw)) {
                state.progress = 100;
                setStatus('本节已完成，准备下一节', 'on');
                if (cfg.autoNext) {
                    scheduleNext(vm, entry, '本节完成', Math.max(2000, cfg.nextDelay * 1000));
                }
                render();
                return;
            }

            if (cfg.autoStart) autoPlay(cw);
            if (type === 'video' || type === 'audio') checkVideoHealth(cw, entry);
            setStatus(cfg.autoStart ? '自动学习中' : '等待播放', 'on');
            render();
        } catch (err) {
            console.error('[CQOOC助手] tick 异常', err);
            setStatus('脚本异常，请查看控制台', 'err');
            render();
        }
    }

    function pickFirst(vm) {
        if (state.pickTried) return;
        if (!vm || !Array.isArray(vm.menuList) || !vm.menuList.length) return;
        state.pickTried = true;
        const entry = findNext(vm, '');
        if (entry) navigate(vm, entry);
    }

    /**
     * 把 state/cfg 渲染到 Shadow DOM。每秒调用一次，但只在文本变化时写 DOM。
     */
    function render() {
        if (!els.status) return;

        setText(els.status, state.statusText);
        setText(els.clock, formatClock(state.activeSeconds));
        setText(els.title, state.lessonTitle);
        setText(els.sub, state.subText);

        const percent = clampPercent(state.progress);
        els.bar.style.width = percent.toFixed(1) + '%';

        els.dot.className = 'cq-dot' + (state.tone ? ' ' + state.tone : '');
        els.toggle.textContent = cfg.enabled ? '暂停自动学习' : '开始自动学习';
        els.toggle.classList.toggle('on', cfg.enabled);
        els.reply.style.display = state.item && state.item.LX === '3' ? '' : 'none';
    }

    /**
     * 开关自动学习。
     * 开启：重置计时/完成标记，立即 tick 一次；
     * 关闭：清下一节定时器、暂停当前媒体、恢复被改过的标题。
     */
    function setEnabled(enabled) {
        cfg.enabled = !!enabled;
        saveCfg();

        if (cfg.enabled) {
            state.activeSince = Date.now();
            state.activeSeconds = 0;
            state.allDone = false;
            state.pickTried = false;
            state.lastPlayAttempt = 0;
            state.resumeAfter = 0;
            state.playBlocked = false;
            log('已开启自动学习');
            tick();
        } else {
            state.activeSince = null;
            state.activeSeconds = 0;
            if (state.nextTimer) {
                clearTimeout(state.nextTimer);
                state.nextTimer = null;
            }
            const media = findMedia();
            if (media && !media.paused) {
                try { media.pause(); } catch (e) {}
            }
            restoreTitle();
            setStatus('已暂停', '', '点击“开始自动学习”继续');
            log('已暂停');
            render();
        }
    }

    /* ------------------------------------------------------------------ */
    /* 路由与事件                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * SPA 路由变化时清理当前课件的临时状态。
     * 注意：只清 currentId/定时器/弹题标题，不清 cfg 和已回复记录。
     */
    function routeChanged() {
        const key = pagePath() + location.search + location.hash;
        if (key === state.routeKey) return;
        state.routeKey = key;
        state.currentId = null;
        state.pickTried = false;
        state.allDone = false;
        state.fastDocFor = null;
        state.overlayFor = null;
        state.playBlocked = false;
        state.resumeAfter = 0;
        if (state.nextTimer) {
            clearTimeout(state.nextTimer);
            state.nextTimer = null;
        }
        restoreTitle();
        log('页面已切换');
    }

    /**
     * 输出诊断信息，用于排查“面板有了但不工作”：
     * 是否在课程页、是否找到 Vue、目录数量、当前课件、资源类型、视频元素、是否弹题。
     * 同时暴露到 window.__CQOOC_AUTO_STUDY__.diagnose()。
     */
    /**
     * 视频诊断：输出当前媒体元素状态、错误码、源地址、恢复计数等。
     * 学习页按 Alt+V（或执行 window.__CQOOC_AUTO_STUDY__.videoDiag()）即可导出。
     */
    function videoDiag() {
        const media = findMedia();
        const vm = getStudyVm();
        const cw = getCoursewareVm(vm);
        let protocol = '';
        try {
            protocol = new URL((media && (media.currentSrc || media.src)) || '').protocol;
        } catch (e) {}
        let recoverCount = 0;
        try { recoverCount = Number(sessionStorage.getItem('cqooc-recover-count') || 0); } catch (e) {}
        const info = {
            version: VERSION,
            time: new Date().toISOString(),
            url: pagePath() + location.search + location.hash,
            studyPage: isStudyPage(),
            resourceType: cw ? currentType(cw) : null,
            hasMedia: !!media,
            readyState: media ? media.readyState : null,
            networkState: media ? media.networkState : null,
            paused: media ? media.paused : null,
            ended: media ? media.ended : null,
            currentTime: media ? Math.round(Number(media.currentTime) || 0) : null,
            duration: media ? Math.round(Number(media.duration) || 0) : null,
            playbackRate: media ? media.playbackRate : null,
            muted: media ? media.muted : null,
            src: media ? String(media.currentSrc || media.src || '').slice(0, 300) : '',
            protocol: protocol,
            error: media && media.error ? { code: media.error.code, message: media.error.message } : null,
            lastMediaError: state.lastMediaError || null,
            recoverCount: recoverCount,
            autoRecover: cfg.autoRecover,
            playBlocked: state.playBlocked,
            stallSince: state.stallSince,
            pausedSince: state.pausedSince
        };
        console.info('[CQOOC助手] 视频诊断', info);
        log('视频诊断：media=' + info.hasMedia + ' readyState=' + info.readyState +
            ' error=' + JSON.stringify(info.error) + ' 刷新次数=' + info.recoverCount);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(JSON.stringify(info, null, 2));
            }
        } catch (e) {}
        return info;
    }

    function diagnose() {
        const vm = getStudyVm();
        const cw = getCoursewareVm(vm);
        const entry = getCurrentItem(vm);
        const media = findMedia();
        const info = {
            version: VERSION,
            url: pagePath() + location.search + location.hash,
            studyPage: isStudyPage(),
            vue: !!vm,
            menuCount: vm && Array.isArray(vm.menuList) ? vm.menuList.length : 0,
            current: entry ? entry.ID + ' / ' + entry.MC : null,
            currentType: entry ? entry.LX : null,
            cwId: cw && cw.kjData ? cw.kjData.ID : null,
            resourceType: currentType(cw) || null,
            media: media ? media.tagName + ' paused=' + media.paused : null,
            enabled: cfg.enabled,
            fastDoc: cfg.fastDoc,
            fillGaps: cfg.fillGaps,
            autoReply: cfg.autoReply,
            autoRecover: cfg.autoRecover,
            question: isQuestionVisible(cw),
            mediaReadyState: media ? media.readyState : null,
            mediaError: media && media.error ? { code: media.error.code, message: media.error.message } : null,
            lastMediaError: state.lastMediaError || null,
            autoAnswer: {
                enabled: aaCfg.enabled,
                mode: aaCfg.mode,
                scope: aaCfg.scope,
                authorized: aaCfg.authorized,
                pageKind: aaPageKind(),
                questions: aaState.questions.length
            }
        };
        console.info('[CQOOC助手] 诊断信息', info);
        log('诊断：Vue=' + info.vue + ' 目录=' + info.menuCount + ' 当前=' + (info.current || '无') +
            ' 类型=' + (info.resourceType || '无') + ' 视频=' + (info.media || '无'));
        return info;
    }

    function bindGlobalEvents() {
        window.addEventListener('popstate', routeChanged);
        window.addEventListener('hashchange', routeChanged);

        document.addEventListener('visibilitychange', function () {
            if (document.hidden && cfg.enabled) {
                log('页面进入后台，浏览器可能限速；建议不要最小化');
            }
        });

        document.addEventListener('pointerdown', function (event) {
            const target = event.target;
            if (target && target.closest && target.closest('.courseware-container')) {
                state.resumeAfter = Date.now() + 12000;
            }
        }, true);

        window.addEventListener('keydown', function (event) {
            if (!event.altKey || isTypingTarget(event.target)) return;
            if (event.key === 's' || event.key === 'S') {
                event.preventDefault();
                setEnabled(!cfg.enabled);
            } else if (event.key === 'n' || event.key === 'N') {
                event.preventDefault();
                manualNext();
            } else if (event.key === 'd' || event.key === 'D') {
                event.preventDefault();
                diagnose();
            } else if (event.key === 'v' || event.key === 'V') {
                event.preventDefault();
                videoDiag();
            } else if (event.key === 'a' || event.key === 'A') {
                event.preventDefault();
                if (aaModal && aaModal.classList.contains('show')) aaCloseModal();
                else aaOpenModal();
            } else if (event.shiftKey && (event.key === 'e' || event.key === 'E')) {
                event.preventDefault();
                aaExportEvidence();
            }
        });

        const observer = new MutationObserver(function (mutations) {
            for (let i = 0; i < mutations.length; i++) {
                const added = mutations[i].addedNodes;
                for (let j = 0; j < added.length; j++) scanMedia(added[j]);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    /**
     * 初始化入口：
     * buildPanel → bindGlobalEvents → 启动 tick/routeChanged 定时器 → 暴露调试 API。
     * document-end 时 body 已存在；如果脚本被提前注入，则等 DOMContentLoaded。
     */
    function init() {
        if (window.__CQOOC_US__) window.__CQOOC_US__.stage = 'init';
        buildPanel();
        if (window.__CQOOC_US__) window.__CQOOC_US__.stage = 'panel-built';
        bindGlobalEvents();
        if (window.__CQOOC_US__) window.__CQOOC_US__.stage = 'events-bound';
        aaInit();
        if (window.__CQOOC_US__) window.__CQOOC_US__.stage = 'ready';
        document.querySelectorAll('video, audio').forEach(attachMedia);

        setInterval(tick, 1000);
        setInterval(routeChanged, 800);
        setTimeout(tick, 600);

        log('脚本已加载 v' + VERSION + (cfg.enabled ? '（自动运行已开启）' : ''));
        if (cfg.enabled) {
            state.activeSince = Date.now();
            state.activeSeconds = 0;
        }
        render();

        window.__CQOOC_AUTO_STUDY__ = {
            version: VERSION,
            cfg: cfg,
            state: state,
            diagnose: diagnose,
            videoDiag: videoDiag,
            tick: tick,
            setEnabled: setEnabled,
            manualNext: manualNext,
            getStudyVm: getStudyVm,
            findMedia: findMedia,
            isDone: isDone,
            findNext: findNext,
            isNavigable: isNavigable,
            isItemDone: isItemDone,
            patchCoursewareVm: patchCoursewareVm,
            ensureVideoFinished: ensureVideoFinished,
            autoAnswer: window.__CQOOC_AA__ || null
        };
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    } catch (e) {
        __CQOOC_BOOT__.stage = 'init-error';
        __CQOOC_BOOT__.error = String((e && e.stack) || e);
        console.error('[CQOOC助手] 脚本初始化失败：', e);
        console.error('[CQOOC助手] 自检信息：window.__CQOOC_US__ =', window.__CQOOC_US__);
    }
})();
