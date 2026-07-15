// Auto-hiding scrollbars.
//
// The thumb is invisible by default and only painted while
// `html.scrolling` is present (see index.css). This module toggles that
// class: it reveals the scrollbar the moment anything scrolls, keeps it
// visible while scrolling continues, and fades it out 3s after scrolling
// stops. On first load it also shows briefly (then hides) so the user
// knows the surface is scrollable.
//
// The listener is registered in the capture phase so it catches scroll
// events from ANY scroll container in the app, not just the window.

const HIDE_DELAY_MS = 3000;

let hideTimer: number | undefined;

function reveal(): void {
  const root = document.documentElement;
  root.classList.add('scrolling');
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    root.classList.remove('scrolling');
  }, HIDE_DELAY_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', reveal, { capture: true, passive: true });
  // Briefly show on load so the scrollbar's presence is discoverable.
  reveal();
}
