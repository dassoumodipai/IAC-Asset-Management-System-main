import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import gsap from 'gsap';

// On route changes the page content slides up into place while the sidebar logo spins once.
// Skipped on first paint and for reduced motion.
export function PageTransition() {
  const { pathname } = useLocation();
  const firstPaint = useRef(true);

  useLayoutEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const content = document.getElementById('main');
    const logo = document.querySelector('.brand img');
    const timeline = gsap.timeline();
    if (content)
      timeline.fromTo(
        content,
        { y: 18, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.45,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility',
        },
        0,
      );
    if (logo)
      timeline.fromTo(
        logo,
        { rotation: 0 },
        { rotation: 360, duration: 0.6, ease: 'power2.inOut', clearProps: 'transform' },
        0,
      );
    return () => {
      timeline.progress(1).kill();
    };
  }, [pathname]);

  return null;
}
