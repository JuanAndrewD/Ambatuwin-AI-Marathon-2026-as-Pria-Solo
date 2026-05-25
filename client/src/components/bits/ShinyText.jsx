// ShinyText — sweeping highlight on the text. https://www.reactbits.dev/text-animations/shiny-text
import React from 'react';
import './shiny-text.css';

export default function ShinyText({ children, speed = 4, className = '', as: Tag = 'span' }) {
  return (
    <Tag className={`bits-shiny ${className}`} style={{ animationDuration: `${speed}s` }}>
      {children}
    </Tag>
  );
}
