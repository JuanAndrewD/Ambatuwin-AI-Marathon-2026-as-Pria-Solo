// Vertical drag handle to resize a flex/grid neighbour. Lives between two
// panes; reports new width via onResize. Handles touch + mouse.
import React, { useEffect, useRef } from 'react';

export default function ResizeHandle({ side = 'left', onResize, min = 200, max = 600, ariaLabel = 'Resize panel' }) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const ref = useRef(null);

  function onPointerDown(e) {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    // Find the previous (left) or next (right) pane neighbour to read its width.
    const handle = ref.current;
    const neighbour = side === 'left' ? handle.previousElementSibling : handle.nextElementSibling;
    startWRef.current = neighbour?.getBoundingClientRect().width || 0;
    document.body.classList.add('resizing-h');
    handle.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!draggingRef.current) return;
    const dx = e.clientX - startXRef.current;
    const next = side === 'left' ? startWRef.current + dx : startWRef.current - dx;
    const clamped = Math.max(min, Math.min(max, next));
    onResize?.(clamped);
  }

  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.classList.remove('resizing-h');
  }

  useEffect(() => {
    function up() { onPointerUp(); }
    function move(e) { onPointerMove(e); }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  return (
    <div
      ref={ref}
      className={`resize-handle resize-handle-${side}`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize?.(side === 'left' ? 280 : 360)}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="Drag to resize · double-click to reset"
    />
  );
}
