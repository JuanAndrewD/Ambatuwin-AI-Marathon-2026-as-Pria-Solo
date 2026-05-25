// TiltCard — 3D tilt on cursor move. https://www.reactbits.dev/animations/tilted-card
import React, { useRef } from 'react';

export default function TiltCard({ children, max = 8, className = '', ...rest }) {
  const ref = useRef(null);

  function onMove(e) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rx = (py - 0.5) * -2 * max;
    const ry = (px - 0.5) * 2 * max;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  }
  function onLeave() {
    if (ref.current) ref.current.style.transform = 'perspective(900px) rotateX(0) rotateY(0)';
  }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transition: 'transform 0.18s cubic-bezier(.2,.7,.3,1)', transformStyle: 'preserve-3d', willChange: 'transform' }}
      className={className}
      {...rest}
    >
      {children}
    </div>
  );
}
