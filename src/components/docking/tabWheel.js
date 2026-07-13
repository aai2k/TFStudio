export function scrollOverflowingTabs(bar, event) {
  if (bar.scrollWidth <= bar.clientWidth || event.deltaY === 0) return;
  bar.scrollLeft += event.deltaY;
  event.preventDefault();
}

export function attachTabWheelScroll(bar) {
  const handleWheel = event => scrollOverflowingTabs(bar, event);
  bar.addEventListener('wheel', handleWheel, { passive: false });
  return () => bar.removeEventListener('wheel', handleWheel);
}
