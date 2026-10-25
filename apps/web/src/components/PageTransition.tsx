import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Reset the content scroll position when navigating between pages without moving the full layout.
export function PageTransition() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const content = document.getElementById('main');
    content?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
}
