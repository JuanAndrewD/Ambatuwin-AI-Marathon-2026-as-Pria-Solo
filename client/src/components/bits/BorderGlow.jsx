// BorderGlow — animated conic gradient running around a card border,
// inspired by https://www.reactbits.dev/components/border-glow
import React from 'react';
import './border-glow.css';

export default function BorderGlow({ children, className = '', as: Tag = 'div', ...rest }) {
  return (
    <Tag className={`bits-borderglow ${className}`} {...rest}>
      <span className="bits-borderglow-ring" aria-hidden />
      <span className="bits-borderglow-inner">{children}</span>
    </Tag>
  );
}
