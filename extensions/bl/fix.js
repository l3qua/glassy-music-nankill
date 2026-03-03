/**
 * YOUTUBE MUSIC CUSTOM ENHANCEMENTS
 * Tệp JavaScript tổng hợp các tinh chỉnh giao diện cho YouTube Music
 * Made by NanKill, Gemini 3 Pro, Claude
 */

// =========================================================================
// PHẦN 1: YOUTUBE MUSIC - SMOOTH FADE OUT ANIMATIONS
// Mô tả: Thêm hiệu ứng fade out mượt mà khi đóng menu và dialog 
// =========================================================================

(function() {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        @keyframes menuFadeOut {
          0% { opacity: 1; margin-top: 0; }
          100% { opacity: 0; margin-top: -10px; }
        }

        @keyframes popupXuatHienNguoc {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -45%) scale(0.95); }
        }

        .ytm-fade-out-menu {
          animation: menuFadeOut 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
          display: block !important;
          pointer-events: none !important;
        }

        .ytm-fade-out-dialog {
          animation: popupXuatHienNguoc 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
          display: block !important;
          pointer-events: none !important;
        }
    `;
    document.head.appendChild(style);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            const el = mutation.target;
            if (el.nodeType !== 1) return;

            const isMenu = el.matches('tp-yt-iron-dropdown.ytmusic-popup-container');
            const isDialog = el.matches('ytmusic-add-to-playlist-renderer, ytmusic-unified-share-panel-renderer, ytmusic-dialog, ytmusic-engagement-panel-section-list-renderer, tp-yt-paper-dialog');

            if (!isMenu && !isDialog) return;

            // Xác định trạng thái hiện tại: Đang bị ẩn đi?
            // YouTube ẩn element bằng cách gỡ 'opened' VÀ (thêm display: none HOẶC aria-hidden='true')
            const isHidden = !el.hasAttribute('opened') && (el.style.display === 'none' || el.getAttribute('aria-hidden') === 'true');
            const isVisible = !isHidden;

            if (isVisible) {
                // --- NẾU ĐANG MỞ ---
                // 1. Dập ngay hiệu ứng fade-out nếu đang chạy dở
                el.classList.remove('ytm-fade-out-menu', 'ytm-fade-out-dialog', 'ytm-is-fading-out');
                if (el._ytmCloseTimer) clearTimeout(el._ytmCloseTimer);

                // 2. Chờ 50ms để xác nhận là nó "mở thật" (tránh các nhịp nảy chớp nhoáng của framework)
                if (el.dataset.stableOpen !== 'true' && !el._ytmOpenTimer) {
                    el._ytmOpenTimer = setTimeout(() => {
                        el.dataset.stableOpen = 'true'; // Đánh dấu: Đã mở ổn định
                        el._ytmOpenTimer = null;
                    }, 50);
                }
            } else {
                // --- NẾU ĐANG ĐÓNG ---
                // Hủy hẹn giờ mở nếu nó chưa kịp mở xong đã bị đóng lại
                if (el._ytmOpenTimer) {
                    clearTimeout(el._ytmOpenTimer);
                    el._ytmOpenTimer = null;
                }

                // CHỈ chạy animation fade out NẾU trước đó nó đã từng "mở ổn định"
                if (el.dataset.stableOpen === 'true') {
                    el.dataset.stableOpen = 'false'; // Xóa dấu vết để không bị lặp

                    // Kích hoạt animation NGAY LẬP TỨC (0ms delay) -> Hết chớp!
                    el.classList.add('ytm-is-fading-out');
                    if (isMenu) el.classList.add('ytm-fade-out-menu');
                    else el.classList.add('ytm-fade-out-dialog');

                    // Dọn dẹp class sau khi animation chạy xong (300ms)
                    el._ytmCloseTimer = setTimeout(() => {
                        el.classList.remove('ytm-fade-out-menu', 'ytm-fade-out-dialog', 'ytm-is-fading-out');
                    }, 300);
                }
            }
        });
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['opened', 'style', 'aria-hidden'],
        subtree: true
    });
})();

// =========================================================================
// PHẦN 2: YTM IMAGE CROSSFADE (FIXED)
// Mô tả: Xử lý mượt mà Crossfade kể cả khi ảnh load từ RAM Cache
// =========================================================================

(function() {
    'use strict';

    let crossfadeState = 'IDLE'; // 3 trạng thái: IDLE, WAITING, FADING
    let activeDummy = null;      // Lưu trữ ảnh dummy duy nhất đang hoạt động

    // Hàm bắt đầu hiệu ứng mờ dần
    const startFade = (dummy) => {
        crossfadeState = 'FADING';

        // Ép trình duyệt reflow (tính toán lại DOM) để nhận opacity: 1 trước khi chuyển về 0
        void dummy.offsetWidth;

        dummy.style.opacity = '0'; // Bắt đầu làm mờ

        // Dọn dẹp sau khi transition 0.6s kết thúc
        setTimeout(() => {
            dummy.remove();
            if (activeDummy === dummy) {
                activeDummy = null;
                crossfadeState = 'IDLE';
            }
        }, 600);
    };

    // Hàm dọn dẹp event listener cũ để tránh lỗi gọi lặp
    const cleanupListeners = (img) => {
        if (img._cfLoad) {
            img.removeEventListener('load', img._cfLoad);
            img.removeEventListener('error', img._cfLoad);
            img._cfLoad = null;
        }
    };

    const observer = new MutationObserver((mutations) => {
        for (let mut of mutations) {
            if (mut.type === 'attributes' && mut.attributeName === 'src') {
                const img = mut.target;

                if (img.id === 'blyrics-img' || img.id === 'img') {
                    const oldSrc = mut.oldValue;
                    const newSrc = img.src;

                    // Bỏ qua nếu src không hợp lệ hoặc không thực sự thay đổi
                    if (!oldSrc || oldSrc === newSrc || oldSrc.startsWith('data:')) continue;

                    // 1. ĐANG FADE: Nếu đang chiếu hiệu ứng mà ảnh mới(nét) chen vào -> Mặc kệ, không tạo thêm dummy.
                    if (crossfadeState === 'FADING') {
                        continue;
                    }

                    // 2. ĐANG WAITING: Đợi load ảnh mờ mà ảnh nét lại nhào tới -> Giữ nguyên ảnh dummy cũ, chỉ đổi listener sang chờ ảnh nét.
                    if (crossfadeState === 'WAITING') {
                        cleanupListeners(img);
                    }
                    // 3. IDLE: Lúc này mới an toàn để tạo dummy overlay của bài hát cũ
                    else if (crossfadeState === 'IDLE') {
                        activeDummy = document.createElement('img');
                        activeDummy.src = oldSrc;
                        activeDummy.className = 'blyrics-crossfade-dummy style-scope yt-img-shadow';

                        // Set trực tiếp CSS nội tuyến để đảm bảo ăn ngay
                        Object.assign(activeDummy.style, {
                            position: 'absolute',
                            inset: '0',
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            zIndex: '5',
                            pointerEvents: 'none',
                            transition: 'opacity 0.6s ease-in-out',
                            opacity: '1'
                        });

                        img.parentElement.appendChild(activeDummy);
                        crossfadeState = 'WAITING';
                    }

                    // 4. Xử lý trigger: Nếu ảnh đã nằm trong RAM/Cache thì fade luôn, ngược lại thì đợi tải xong.
                    if (img.complete && img.naturalWidth > 0) {
                        startFade(activeDummy);
                    } else {
                        img._cfLoad = () => {
                            startFade(activeDummy);
                            cleanupListeners(img);
                        };
                        img.addEventListener('load', img._cfLoad);
                        img.addEventListener('error', img._cfLoad);
                    }
                }
            }
        }
    });

    function initObserver() {
        const thumbnailContainer = document.querySelector('#song-image');
        if (thumbnailContainer) {
            observer.observe(thumbnailContainer, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src'],
                attributeOldValue: true
            });
            console.log("Crossfade V2 Observer Started!");
        } else {
            setTimeout(initObserver, 1000);
        }
    }

    initObserver();
})();

// =========================================================================
// PHẦN 3: Smooth Scroll cho Lyrics
// Mô tả: Mượt như Apple Music, rất béo
// =========================================================================

/**
 * ════════════════════════════════════════════════════════════════════════
 *  HOW BETTERLYRICS SCROLLS  (animationEngine.ts)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  FLIP technique:
 *   1. style.transition = "none"
 *   2. style.transform  = `translate(0, ${delta}px)`  ← snap to OLD visual pos
 *   3. reflow()
 *   4. style.transition = ""                           ← restore CSS transition
 *   5. style.transform  = "translate(0, 0)"            ← CSS animates delta → 0
 *   6. tabRenderer.scrollTop = newPos                  ← actual DOM scroll
 *
 *  BL also reads `getComputedStyle(el).transitionDuration` after step 3
 *  to throttle how often it allows a new scroll:
 *    nextScrollAllowedTime = transitionDurationMs + Date.now() + 20
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT WE DO
 * ════════════════════════════════════════════════════════════════════════
 *
 *  • Shadow style.transform on the container instance (defineProperty).
 *    Step 2 (non-zero) → capture delta, write translate(0,0) instead.
 *    Step 5 (reset 0)  → fire per-line stagger with the saved delta.
 *
 *  • DO NOT touch --blyrics-lyric-scroll-duration.
 *    BL reads the resulting transition-duration to throttle re-scrolls.
 *    If we zero it out, BL re-scrolls every 20 ms → position drift.
 *
 *  • For each line we play a WAAPI translateY(delta → 0) with composite:'add'
 *    and an increasing delay, creating the Youly-style wave.
 *    While the WAAPI is running we set `transition-property: opacity, filter`
 *    inline to stop the user's CSS `transition: transform 1.66s` from
 *    fighting our animation and causing a snap when WAAPI finishes.
 */

(function () {
  'use strict';

  /* ─── CONFIG ──────────────────────────────────────────────────────── */
  const CFG = {
    staggerStep:  30,    // ms of extra delay per line ahead of active
    duration:    800,    // ms base animation duration
    lookBehind:    8,    // lines before active to include in wave
    lookAhead:    8,    // lines after  active to include in wave
    minDelta:      2,    // px: ignore micro-scrolls
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  };

  /* ─── STATE ───────────────────────────────────────────────────────── */
  let container    = null;
  let pendingDelta = 0;
  let intercepted  = false;
  let domObserver  = null;
  const lineAnims  = new WeakMap();  // line el → running Animation
// Thêm 2 dòng này để quản lý trạng thái bật/tắt
  let isScriptEnabled = true;
  let resizeTimer     = null;

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

    const ref   = getRefIndex(lines);
    const start = Math.max(0, ref - CFG.lookBehind);
    const end   = Math.min(lines.length, ref + CFG.lookAhead);

    let aheadCount = 0;

for (let i = start; i < end; i++) {
      const line  = lines[i];
      const delay = i >= ref ? (aheadCount++) * CFG.staggerStep : 0;

      // Hủy animation cũ nếu có
      lineAnims.get(line)?.cancel();

      // Dùng thuộc tính 'translate' độc lập thay vì 'transform'
      // JS lo việc cuộn, CSS lo việc scale -> 2 bên không đánh nhau
      const anim = line.animate(
        [
          { translate: `0px ${delta}px` },
          { translate: `0px 0px`        },
        ],
        {
          duration:  CFG.duration,
          delay,
          fill:      'backwards',
          easing:    CFG.easing,
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
    const desc  = Object.getOwnPropertyDescriptor(proto, 'transform');

    if (!desc || typeof desc.set !== 'function' || !desc.configurable) {
      console.warn('[BL-Stagger] defineProperty unavailable — using scroll fallback');
      useScrollFallback(el);
      return;
    }

    let _writing = false;

    Object.defineProperty(el.style, 'transform', {
      configurable: true,
      enumerable:   desc.enumerable,
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
      const cur   = parent.scrollTop;
      const delta = cur - lastScroll;
      lastScroll  = cur;
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
      try { delete container.style.transform; } catch (_) {}
    }

    container    = el;
    intercepted  = false;
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
    container    = null;
    intercepted  = false;
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