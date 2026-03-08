(function () {
    'use strict';

    /* ─── CONFIG ──────────────────────────────────────────────────────── */
    const CFG = {
        staggerStep: 30,    // ms of extra delay per line ahead of active
        duration: 800,    // ms base animation duration
        lookBehind: 5,    // lines before active to include in wave
        lookAhead: 8,    // lines after  active to include in wave
        minDelta: 2,    // px: ignore micro-scrolls
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    };

    /* ─── STATE ───────────────────────────────────────────────────────── */
    let container = null;
    let pendingDelta = 0;
    let intercepted = false;
    let domObserver = null;
    const lineAnims = new WeakMap();  // line el → running Animation
    // Thêm 2 dòng này để quản lý trạng thái bật/tắt
    let isScriptEnabled = true;
    let resizeTimer = null;

    /* ─── HELPERS ─────────────────────────────────────────────────────── */
    function setScrollOverride(enabled) {
        if (!container) return;
        if (enabled) {
            // Chỉ khi script hoạt động mới ép về 0ms
            container.style.setProperty('--blyrics-lyric-scroll-duration', '0ms', 'important');
        } else {
            // Khi resize, gỡ bỏ hoàn toàn để BetterLyrics dùng transition mặc định (thường là 1.66s)
            container.style.removeProperty('--blyrics-lyric-scroll-duration');
        }
    }

    /* ─── HELPERS ─────────────────────────────────────────────────────── */

    function parseTranslateY(val) {
        if (!val || val === 'none') return 0;
        // translate(Xpx, Ypx)
        const m = val.match(/translate\(\s*-?[\d.]+px\s*,\s*(-?[\d.]+)px\s*\)/);
        if (m) return parseFloat(m[1]);
        // translateY(Ypx)
        const m2 = val.match(/translateY\(\s*(-?[\d.]+)px\s*\)/);
        if (m2) return parseFloat(m2[1]);
        return 0;
    }

    function getLines() {
        if (!container) return [];
        // Thêm .blyrics-footer vào danh sách
        return Array.from(container.querySelectorAll('.blyrics--line, .blyrics-footer'));
    }

    /**
     * Find the active line index.
     * BetterLyrics adds blyrics--animating to both the line div AND its
     * word-level child spans (lineData and parts both get the class).
     * Checking the line div directly is sufficient and cheap.
     */
    function getRefIndex(lines) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].classList.contains('blyrics--animating')) return i;
        }
        // pre-animating: line is set up but hasn't fired yet (early-scroll window)
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].classList.contains('blyrics--pre-animating')) return i;
        }
        // scroll-active class (CURRENT_LYRICS_CLASS in BL source)
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].classList.contains('blyrics-current-lyric')) return i;
        }
        return Math.floor(lines.length / 5);
    }

    /* ─── STAGGER ENGINE ──────────────────────────────────────────────── */

    function applyStagger(delta) {
        if (!isScriptEnabled || Math.abs(delta) < CFG.minDelta) return;

        const lines = getLines();
        if (!lines.length) return;

        const ref = getRefIndex(lines);
        const start = Math.max(0, ref - CFG.lookBehind);
        const end = Math.min(lines.length, ref + CFG.lookAhead);

        let aheadCount = 0;

        for (let i = start; i < end; i++) {
            const line = lines[i];
            const delay = i >= ref ? (aheadCount++) * CFG.staggerStep : 0;

            // Hủy animation cũ nếu có
            lineAnims.get(line)?.cancel();

            // Dùng thuộc tính 'translate' độc lập thay vì 'transform'
            // JS lo việc cuộn, CSS lo việc scale -> 2 bên không đánh nhau
            const anim = line.animate(
                [
                    { translate: `0px ${delta}px` },
                    { translate: `0px 0px` },
                ],
                {
                    duration: CFG.duration,
                    delay,
                    fill: 'backwards',
                    easing: CFG.easing,
                    // Không cần composite: 'add' nữa vì translate độc lập với transform
                }
            );

            lineAnims.set(line, anim);

            const cleanup = () => {
                if (lineAnims.get(line) === anim) {
                    lineAnims.delete(line);
                }
            };
            anim.onfinish = cleanup;
            anim.oncancel = cleanup;
        }
    }

    /* ─── FLIP INTERCEPTOR ────────────────────────────────────────────── */

    function interceptTransform(el) {
        if (intercepted) return;

        const proto = CSSStyleDeclaration.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'transform');

        if (!desc || typeof desc.set !== 'function' || !desc.configurable) {
            console.warn('[BL-Stagger] defineProperty unavailable — using scroll fallback');
            useScrollFallback(el);
            return;
        }

        let _writing = false;

        Object.defineProperty(el.style, 'transform', {
            configurable: true,
            enumerable: desc.enumerable,
            get() {
                return desc.get.call(this);
            },
            set(value) {
                if (!isScriptEnabled || _writing) {
                    desc.set.call(this, value);
                    return;
                }

                const y = parseTranslateY(value);

                if (Math.abs(y) > CFG.minDelta) {
                    // ── FLIP Step 2 ───────────────────────────────────────────────
                    // BL snapping container to old visual position.
                    // Capture delta, write (0,0) instead → container never offsets.
                    pendingDelta = y;
                    _writing = true;
                    desc.set.call(this, 'translate(0px, 0px)');
                    _writing = false;

                } else {
                    // ── FLIP Step 5 ───────────────────────────────────────────────
                    // BL releasing transform back to (0,0).
                    // Write normally, then fire stagger after scrollTop settles.
                    _writing = true;
                    desc.set.call(this, value);
                    _writing = false;

                    if (pendingDelta !== 0) {
                        const delta = pendingDelta;
                        pendingDelta = 0;
                        // rAF so tabRenderer.scrollTop (step 6) has already been committed.
                        requestAnimationFrame(() => applyStagger(delta));
                    }
                }
            },
        });

        intercepted = true;
        console.debug('[BL-Stagger] transform interceptor installed', el);
    }

    /* ─── SCROLL FALLBACK ─────────────────────────────────────────────── */
    // Used only if defineProperty is unavailable (extremely unlikely on Chrome).
    // Less accurate (can't prevent container FLIP) but still adds stagger.

    function useScrollFallback(el) {
        const parent = findScrollParent(el);
        if (!parent) return;
        let lastScroll = parent.scrollTop;
        parent.addEventListener('scroll', () => {
            const cur = parent.scrollTop;
            const delta = cur - lastScroll;
            lastScroll = cur;
            if (Math.abs(delta) > CFG.minDelta) applyStagger(delta);
        }, { passive: true });
    }

    function findScrollParent(el) {
        let p = el.parentElement;
        while (p && p !== document.documentElement) {
            const { overflow, overflowY } = getComputedStyle(p);
            if (/(auto|scroll)/.test(overflow + overflowY)) return p;
            p = p.parentElement;
        }
        return null;
    }

    /* ─── CONTAINER LIFECYCLE ─────────────────────────────────────────── */

    function attach(el) {
        if (el === container) return;

        if (container && intercepted) {
            try { delete container.style.transform; } catch (_) { }
        }

        container = el;
        intercepted = false;
        pendingDelta = 0;
        interceptTransform(el);
        setScrollOverride(true); // Bật override ngay khi tìm thấy container
    }

    function boot() {
        const existing = document.querySelector('.blyrics-container');
        if (existing) attach(existing);

        domObserver?.disconnect();
        domObserver = new MutationObserver(() => {
            const el = document.querySelector('.blyrics-container');
            if (el && el !== container) attach(el);
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
    }

    /* ─── SPA NAVIGATION ──────────────────────────────────────────────── */
    window.addEventListener('yt-navigate-finish', () => {
        container = null;
        intercepted = false;
        pendingDelta = 0;
        boot();
    });

    /* ─── INIT ────────────────────────────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }


    /* ─── RESIZE RECOVERY ────────────────────────────────────────────── */
    window.addEventListener('resize', () => {
        isScriptEnabled = false;
        pendingDelta = 0;
        setScrollOverride(false); // Trả lại quyền scroll mượt cho BetterLyrics

        // Dọn dẹp các hiệu ứng cũ đang chạy dở
        getLines().forEach(line => {
            lineAnims.get(line)?.cancel();
            line.style.translate = '';
        });

        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            isScriptEnabled = true;
            setScrollOverride(true); // Kích hoạt lại hiệu ứng sau khi layout đã ổn định
            console.debug('[BL-Stagger] Re-enabled after resize.');
        }, 1500); // Đợi 1.5 giây để đảm bảo BetterLyrics đã cân chỉnh xong
    });
})();