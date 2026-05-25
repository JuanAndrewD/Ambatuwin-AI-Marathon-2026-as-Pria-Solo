// MagneticButton — element follows the cursor on hover.
// https://www.reactbits.dev/animations/magnet
import React, { useRef } from 'react';

export default function MagneticButton({ children, strength = 0.25, className = '', ...rest }) {
  const ref = useRef(null);

  function onMove(e) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
  }
  function onLeave() {
    if (ref.current) ref.current.style.transform = '';
  }

  return (
    <span
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ display: 'inline-block', willChange: 'transform' }}
    >
      <span ref={ref} className={className} style={{ display: 'inline-block', transition: 'transform 0.25s cubic-bezier(.2,.7,.3,1)' }} {...rest}>
        {children}
      </span>
    </span>
  );
}
