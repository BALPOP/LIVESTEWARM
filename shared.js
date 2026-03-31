/* ==========================================
   SHARED JS — Golden Gala Slider + Jackpot Countup + Floating Button Proxies
   ========================================== */

/* ==========================================
   1. POPLUZ GOLDEN GALA SLIDER CONTROLLER
   ========================================== */
(function() {
    'use strict';
    
    /**
     * POPLUZ Golden Gala Slider Controller
     */
    document.addEventListener('DOMContentLoaded', function() {
        const galaSection = document.getElementById('popluzGala');
        
        // Initialize Golden Gala section when POPLUZ button is clicked
        window.addEventListener('popluzSectionShown', function() {
            if (galaSection) {
                galaSection.classList.add('active');
                galaSection.style.display = 'block';
                // Initialize slider after section is shown
                setTimeout(initGgSlider, 200);
            }
        });
        
        // Also initialize if section becomes visible via other means
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const isVisible = mutation.target.style.display === 'block' || 
                                     mutation.target.style.display === '';
                    if (isVisible && mutation.target.id === 'popluzGala') {
                        mutation.target.classList.add('active');
                        setTimeout(initGgSlider, 200);
                    }
                }
            });
        });
        
        if (galaSection) {
            observer.observe(galaSection, { attributes: true, attributeFilter: ['style', 'class'] });
        }
        
        /**
         * ==========================================
         * GOLDEN GALA SLIDER
         * ==========================================
         */
        const ggSlider = document.getElementById('ggSlider');
        const ggDotsContainer = document.getElementById('ggDots');
        let ggCurrentSlide = 0;
        let ggSlideCount = 0;
        let ggAutoSlideInterval;
        
        function initGgSlider() {
            if (!ggSlider || !ggDotsContainer) return;
            
            // Clear existing dots
            ggDotsContainer.innerHTML = '';
            
            const slides = ggSlider.querySelectorAll('.gg-slide');
            ggSlideCount = slides.length;
            
            if (ggSlideCount === 0) return;
            
            // Create dots
            for (let i = 0; i < ggSlideCount; i++) {
                const dot = document.createElement('span');
                dot.className = 'dot' + (i === 0 ? ' active' : '');
                dot.addEventListener('click', () => goToGgSlide(i));
                ggDotsContainer.appendChild(dot);
            }
            
            // Start auto-slide
            startGgAutoSlide();
        }
        
        function goToGgSlide(index) {
            ggCurrentSlide = index;
            ggSlider.style.transform = `translateX(-${index * 100}%)`;
            
            // Update dots
            const dots = ggDotsContainer.querySelectorAll('.dot');
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === index);
            });
        }
        
        function nextGgSlide() {
            ggCurrentSlide = (ggCurrentSlide + 1) % ggSlideCount;
            goToGgSlide(ggCurrentSlide);
        }
        
        function startGgAutoSlide() {
            if (ggAutoSlideInterval) clearInterval(ggAutoSlideInterval);
            ggAutoSlideInterval = setInterval(nextGgSlide, 4000);
        }
        
        function stopGgAutoSlide() {
            clearInterval(ggAutoSlideInterval);
        }
        
        // Pause on hover
        if (ggSlider) {
            ggSlider.addEventListener('mouseenter', stopGgAutoSlide);
            ggSlider.addEventListener('mouseleave', startGgAutoSlide);
        }
        
        // Touch/Swipe functionality
        const ggSliderViewport = document.querySelector('.gg-slider-viewport');
        let ggTouchStartX = 0;
        let ggTouchEndX = 0;
        let ggIsSwiping = false;
        
        function handleGgTouchStart(e) {
            ggTouchStartX = e.touches[0].clientX;
            ggIsSwiping = false;
            stopGgAutoSlide();
        }
        
        function handleGgTouchMove(e) {
            if (!ggTouchStartX) return;
            const currentX = e.touches[0].clientX;
            const diffX = ggTouchStartX - currentX;
            
            // If swipe distance is significant, mark as swiping
            if (Math.abs(diffX) > 10) {
                ggIsSwiping = true;
                // Prevent scrolling while swiping
                e.preventDefault();
            }
        }
        
        function handleGgTouchEnd(e) {
            if (!ggTouchStartX || !ggIsSwiping) {
                ggTouchStartX = 0;
                startGgAutoSlide();
                return;
            }
            
            ggTouchEndX = e.changedTouches[0].clientX;
            const diffX = ggTouchStartX - ggTouchEndX;
            const minSwipeDistance = 50; // Minimum distance for a swipe
            
            if (Math.abs(diffX) > minSwipeDistance) {
                if (diffX > 0) {
                    // Swipe left - next slide
                    nextGgSlide();
                } else {
                    // Swipe right - previous slide
                    ggCurrentSlide = (ggCurrentSlide - 1 + ggSlideCount) % ggSlideCount;
                    goToGgSlide(ggCurrentSlide);
                }
            }
            
            ggTouchStartX = 0;
            ggTouchEndX = 0;
            ggIsSwiping = false;
            startGgAutoSlide();
        }
        
        // Add touch event listeners
        if (ggSliderViewport) {
            ggSliderViewport.addEventListener('touchstart', handleGgTouchStart, { passive: false });
            ggSliderViewport.addEventListener('touchmove', handleGgTouchMove, { passive: false });
            ggSliderViewport.addEventListener('touchend', handleGgTouchEnd);
        }
        
        // Initialize slider if section is already visible
        if (galaSection && galaSection.style.display !== 'none') {
            setTimeout(initGgSlider, 100);
        }
    });
})();

/* ==========================================
   2. JACKPOT COUNTUP ANIMATION
   (Only runs if .jp-amount element exists)
   ========================================== */
(function() {
    'use strict';
    document.addEventListener('DOMContentLoaded', function() {
        const jpAmount = document.querySelector('.jp-amount');
        if (!jpAmount) return;

        const target = parseInt(jpAmount.dataset.target, 10) || 16200;
        let hasAnimated = false;

        function formatNumber(n) {
            return n.toLocaleString('en-US');
        }

        function animateCountUp(el, target, duration) {
            if (hasAnimated) return;
            hasAnimated = true;
            const start = 0;
            const startTime = performance.now();

            function easeOutExpo(t) {
                return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
            }

            function update(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easedProgress = easeOutExpo(progress);
                const current = Math.floor(start + (target - start) * easedProgress);

                el.textContent = formatNumber(current);

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    el.textContent = formatNumber(target);
                }
            }

            requestAnimationFrame(update);
        }

        // Use IntersectionObserver to trigger when visible
        const observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting && !hasAnimated) {
                    animateCountUp(jpAmount, target, 2000);
                }
            });
        }, { threshold: 0.5 });

        observer.observe(jpAmount);
    });
})();

/* ==========================================
   3. HERO AUTO-HIDE ON SCROLL
   (index.html only — collapses hero when user scrolls to number picker)
   ========================================== */
(function() {
    'use strict';
    document.addEventListener('DOMContentLoaded', function() {
        const hero = document.querySelector('.hero-section');
        const selection = document.getElementById('selection');
        if (!hero || !selection) return;

        // Only on index (non gogo-compact pages)
        // But also works on gogo-compact if hero exists

        let hidden = false;
        let userHasScrolled = false; // Gate: ignore until user actually scrolls
        // Set initial max-height so CSS transition works
        const naturalH = hero.scrollHeight;
        hero.style.maxHeight = naturalH + 'px';

        function hideHero() {
            if (hidden || !userHasScrolled) return;
            hidden = true;
            hero.classList.add('hero-hidden');
            hero.style.maxHeight = '0px';
        }

        function showHero() {
            if (!hidden) return;
            hidden = false;
            hero.classList.remove('hero-hidden');
            hero.style.maxHeight = naturalH + 'px';
        }

        // Use IntersectionObserver on the selection section
        var selObs = new IntersectionObserver(function(entries) {
            entries.forEach(function(e) {
                if (e.isIntersecting && e.intersectionRatio >= 0.15) {
                    hideHero();
                }
            });
        }, { threshold: 0.15 });
        selObs.observe(selection);

        // Track scroll — only arm the auto-hide after user scrolls past 80px
        var scrollTick = false;
        window.addEventListener('scroll', function() {
            if (scrollTick) return;
            scrollTick = true;
            requestAnimationFrame(function() {
                scrollTick = false;
                var scrollY = window.scrollY || window.pageYOffset;

                // Arm auto-hide only after real scroll
                if (!userHasScrolled && scrollY > 80) {
                    userHasScrolled = true;
                    // Re-check if selection is already visible
                    var rect = selection.getBoundingClientRect();
                    if (rect.top < window.innerHeight * 0.85) {
                        hideHero();
                    }
                }

                // Restore hero when scrolled back to top
                if (scrollY < 60) {
                    showHero();
                }
            });
        }, { passive: true });
    });
})();

/* ==========================================
   4. FLOATING BUTTON PROXIES
   (Only runs if floating buttons exist — luz/n1/zoe pages)
   ========================================== */
(function() {
    'use strict';
    document.addEventListener('DOMContentLoaded', function() {
        const floatingClear = document.getElementById('floatingClearBtn');
        const floatingSurpresinha = document.getElementById('floatingSurpresinhaBtn');
        const originalClear = document.getElementById('btnClearNumbers');
        const originalSurpresinha = document.getElementById('btnSurpresinha');
        
        if (floatingClear && originalClear) {
            floatingClear.addEventListener('click', function() {
                originalClear.click();
            });
        }
        
        if (floatingSurpresinha && originalSurpresinha) {
            floatingSurpresinha.addEventListener('click', function() {
                originalSurpresinha.click();
            });
        }
    });
})();
