// SpotlightCard — a card with a radial gradient that follows the cursor.
// Inspired by https://www.reactbits.dev/components/spotlight-card
import React, { useRef } from 'react';
import './spotlight-card.css';

export default function SpotlightCard({ children, className = '', spotlightColor = 'rgba(217, 119, 87, 0.18)', ...rest }) {
  const ref = useRef(null);

  function onMouseMove(e) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      className={`bits-spotlight ${className}`}
      onMouseMove={onMouseMove}
      style={{ '--spot-color': spotlightColor }}
      {...rest}
    >
      {children}
    </div>
  );
}
