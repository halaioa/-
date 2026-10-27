// ==UserScript==
// @name         重庆高等教育智慧教育平台 · 自动学习助手
// @namespace    cqooc-auto-study
// @version      1.0.2
// @description  自动播放、静音、2×倍速、自动切换下一课件；可选 PPT 加速；不代答题。
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
 * 说明
 * ----
 * 这个脚本只做“界面自动化”：播放当前视频、设置倍速/静音、课程页面内自动点下一节。
 * 它不会调用平台接口伪造进度，也不会代答弹题、测验或考试。
 * 视频倍速最高按平台播放器自带的 2× 设置；文档/图片课件仍按平台倒计时计时。
 *
 * 适用页面：https://www.cqooc.com/course/detail/courseStudy?id=...
 * 快捷键：Alt+S 开始/暂停，Alt+N 下一节。
 */

(function () {
    'use strict';

    if (window.top !== window.self) return;
    if (window.__CQOOC_AUTO_STUDY_LOADED__) return;
    window.__CQOOC_AUTO_STUDY_LOADED__ = true;

    const VERSION = '1.0.2';
    const LS_KEY = 'cqooc-auto-study-v1';
    const STUDY_PATH = '/course/detail/courseStudy';
    const DEFAULT_CFG = {
        enabled: true,
        rate: 2,
        muted: true,
        autoNext: true,
        autoStart: true,
        alertQuestion: true,
        fastDoc: false,
        nextDelay: 5,
        pos: null
    };

    function normalizeRate(value) {
        const n = Number(value);
        return [1, 1.5, 2].includes(n) ? n : 2;
    }

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
            base.nextDelay = Math.min(15, Math.max(2, Number(saved.nextDelay) || 5));
            if (saved.pos && Number.isFinite(Number(saved.pos.left)) && Number.isFinite(Number(saved.pos.top))) {
                base.pos = { left: Number(saved.pos.left), top: Number(saved.pos.top) };
            }
        } catch (e) {
            console.warn('[CQOOC助手] 读取设置失败', e);
        }
        return base;
    }

    const cfg = loadCfg();
    const state = {
        statusText: cfg.enabled ? '正在初始化…' : '已暂停',
        tone: '',
        lessonTitle: '等待进入课程学习页',
        subText: '',
        progress: 0,
        activeSeconds: 0,
        activeSince: cfg.enabled ? Date.now() : null,
        currentId: null,
        item: null,
        cw: null,
        allDone: false,
        pickTried: false,
        nextTimer: null,
        navigating: false,
        questionFor: null,
        fastDocFor: null,
        titleAlert: false,
        baseTitle: document.title || '',
        lastPlayAttempt: 0,
        resumeAfter: 0,
        overlayFor: null,
        playBlocked: false,
        routeKey: pagePath() + location.search + location.hash,        logs: [],
        lastLogMsg: '',
        lastLogAt: 0,
        lastBeepAt: 0,
        skipUntil: new Map()
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
                        <small>视频连播 · 不代答题 · v${VERSION}</small>
                    </div>
                </div>
                <div class="cq-head-right">
                    <span class="cq-dot" id="cq-dot"></span>
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
                    <label class="cq-setting"><input type="checkbox" id="cq-autostart"> 自动播放</label>
                    <label class="cq-setting" title="实验性：跳过文档/PPT 的平台等待时间"><input type="checkbox" id="cq-fastdoc"> PPT 加速</label>
                    <label class="cq-setting"><input type="checkbox" id="cq-alert"> 弹题提醒</label>
                </div>
                <div class="cq-log" id="cq-log"></div>
                <div class="cq-foot">不调用接口伪造进度 · 文档按平台倒计时 · Alt+S 开关 / Alt+D 诊断</div>
            </div>
        </div>
    `;

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
            status: shadow.getElementById('cq-status'),
            clock: shadow.getElementById('cq-clock'),
            title: shadow.getElementById('cq-title'),
            bar: shadow.getElementById('cq-bar'),
            sub: shadow.getElementById('cq-sub'),
            toggle: shadow.getElementById('cq-toggle'),
            next: shadow.getElementById('cq-next'),
            rate: shadow.getElementById('cq-rate'),
            muted: shadow.getElementById('cq-muted'),
            autoNext: shadow.getElementById('cq-autonext'),
            autoStart: shadow.getElementById('cq-autostart'),
            fastDoc: shadow.getElementById('cq-fastdoc'),
            alert: shadow.getElementById('cq-alert'),
            log: shadow.getElementById('cq-log')
        };

        els.rate.value = String(cfg.rate);
        els.muted.checked = cfg.muted;
        els.autoNext.checked = cfg.autoNext;
        els.autoStart.checked = cfg.autoStart;
        els.fastDoc.checked = cfg.fastDoc;
        els.alert.checked = cfg.alertQuestion;

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

    function bindPanel() {
        els.toggle.addEventListener('click', function () {
            setEnabled(!cfg.enabled);
        });

        els.next.addEventListener('click', function () {
            manualNext();
        });

        els.collapse.addEventListener('click', function (event) {
            event.stopPropagation();
            const collapsed = panel.classList.toggle('collapsed');
            els.collapse.textContent = collapsed ? '+' : '−';
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

        els.alert.addEventListener('change', function () {
            cfg.alertQuestion = els.alert.checked;
            saveCfg();
            log(cfg.alertQuestion ? '已开启弹题提醒' : '已关闭弹题提醒');
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

    function isItemDone(entry) {
        return !!entry && (entry.JD >= 89 || Number(entry.item.JD) >= 89);
    }

    function findNext(vm, currentId) {
        const all = flatLessons(vm);
        if (!all.length) return null;

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
            if (isStudyable(entry) && !isItemDone(entry)) return entry;
        }
        return null;
    }

    function currentType(cw) {
        return cw && cw.dataLeft && cw.dataLeft.ZYMTLX ? String(cw.dataLeft.ZYMTLX) : '';
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

    function isDone(entry, cw) {
        if (!entry) return false;
        if (entry.JD >= 89) return true;
        if (!cw) return false;
        if (cw.kjData && cw.kjData.ID && String(cw.kjData.ID) !== String(entry.ID)) return false;
        if (cw.isEmit && cw.isEmit.end) return true;

        const type = currentType(cw);
        if (type === 'video' || type === 'audio') {
            const media = findMedia();
            if (media && media.ended) return true;
            const total = Number(cw.ZSC);
            const current = Number(cw.dqjd);
            if (total > 0 && Number.isFinite(current) && current >= total - 5) return true;
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
        const pool = visible.length ? visible : nodes;
        pool.sort(function (a, b) { return mediaArea(b) - mediaArea(a); });
        return pool[0] || null;
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

    function attachMedia(media) {
        if (!media || media.__cqoocAutoStudyAttached) return;
        media.__cqoocAutoStudyAttached = true;

        media.addEventListener('ended', function () {
            if (!cfg.enabled) return;
            const vm = getStudyVm();
            const entry = getCurrentItem(vm);
            if (!entry) return;
            scheduleNext(vm, entry, '播放结束', Math.max(3000, cfg.nextDelay * 1000));
        });

        media.addEventListener('play', function () {
            state.playBlocked = false;
            ensureMediaSettings(media);
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
        const result = media.play();
        if (result && result.catch) {
            result.catch(function (err) {
                state.playBlocked = true;
                setStatus('浏览器拦截了自动播放', 'warn', '请手动点一下视频播放按钮');
                log('自动播放被拦截：' + (err && err.name ? err.name : '未知错误'));
            });
        }
    }

    function isDocLike(type) {
        return type === 'doc' || type === 'image';
    }

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

    function manualNext() {
        const vm = getStudyVm();
        if (!vm) {
            log('还没有进入课程学习页');
            return;
        }
        const entry = getCurrentItem(vm);
        const next = findNext(vm, entry ? entry.ID : '');
        if (!next) {
            markAllDone();
            return;
        }
        navigate(vm, next);
    }

    function navigate(vm, entry) {
        if (!vm || !entry || !entry.item || state.navigating) return;

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

    function scheduleNext(vm, entry, reason, delay) {
        if (!cfg.autoNext || state.nextTimer || state.allDone) return;

        state.nextTimer = setTimeout(function () {
            state.nextTimer = null;
            if (!cfg.enabled) return;

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

        setStatus('检测到弹题，已暂停', 'warn', '请手动选择答案，答完后会自动继续');
        state.questionFor = id;

        if (cfg.alertQuestion && first) {
            flashTitle();
            beep();
            log('检测到弹题：脚本不代答，请手动选择');
        }
    }

    /* ------------------------------------------------------------------ */
    /* 主循环                                                             */
    /* ------------------------------------------------------------------ */

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
                setStatus('请进入“课程学习”页面', 'warn', '当前页面：' + pagePath());
                state.lessonTitle = '等待进入课程学习页';
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

            if (entry.LX !== '1') {
                setStatus('当前为测验/作业/讨论', 'warn', '脚本不会代做测验、作业或考试');
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
    }

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
            question: isQuestionVisible(cw)
        };
        console.info('[CQOOC助手] 诊断信息', info);
        log('诊断：Vue=' + info.vue + ' 目录=' + info.menuCount + ' 当前=' + (info.current || '无') +
            ' 类型=' + (info.resourceType || '无') + ' 视频=' + (info.media || '无'));
        return info;
    }

    function bindGlobalEvents() {
        window.addEventListener('popstate', routeChanged);
        window.addEventListener('hashchange', routeChanged);

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

    function init() {
        buildPanel();
        bindGlobalEvents();
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
            tick: tick,
            setEnabled: setEnabled,
            manualNext: manualNext,
            getStudyVm: getStudyVm
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
