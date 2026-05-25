// SplitText — word-by-word entrance. https://www.reactbits.dev/text-animations/split-text
import React from 'react';
import './split-text.css';

export default function SplitText({ text, className = '', delay = 0, stagger = 0.04 }) {
  const words = String(text).split(' ');
  return (
    <span className={`bits-splittext ${className}`}>
      {words.map((w, i) => (
        <span
          key={i}
          className="bits-splittext-word"
          style={{ animationDelay: `${delay + i * stagger}s` }}
        >
          {w}{i < words.length - 1 ? '\u00A0' : ''}
        </span>
      ))}
    </span>
  );
}
