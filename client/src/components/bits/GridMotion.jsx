// GridMotion — animated grid of cells, each row scrolling at a different
// speed, inspired by https://www.reactbits.dev/backgrounds/grid-motion
import React, { useMemo } from 'react';
import './grid-motion.css';

const SYMBOLS = [
  '☁️','⚙️','🔐','🌐','📦','🛡️','💾','⚡','📡','🔑','📊','🚀','🧠','🌊','🔭','📐','🧬','🛰️','🏛️','🧪',
  'EC2','S3','RDS','VPC','IAM','KMS','WAF','CDN','SQS','EKS','ALB','NAT','EBS','API','DNS','CLI','ARN','IAC',
];

function buildRow(seed, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(SYMBOLS[(seed * 7 + i * 3) % SYMBOLS.length]);
  }
  return out;
}

export default function GridMotion({ rows = 5, cellsPerRow = 14, className = '' }) {
  const grid = useMemo(() => {
    const r = [];
    for (let i = 0; i < rows; i++) {
      // Duplicate the row content so the marquee animation can loop seamlessly.
      const cells = buildRow(i, cellsPerRow);
      r.push([...cells, ...cells]);
    }
    return r;
  }, [rows, cellsPerRow]);

  return (
    <div className={`bits-gridmotion ${className}`} aria-hidden>
      {grid.map((cells, i) => {
        const direction = i % 2 === 0 ? 'normal' : 'reverse';
        const duration = 30 + (i * 6);
        return (
          <div
            key={i}
            className="bits-gridmotion-row"
            style={{ animationDuration: `${duration}s`, animationDirection: direction }}
          >
            {cells.map((c, j) => (
              <div className="bits-gridmotion-cell" key={`${i}-${j}`}>{c}</div>
            ))}
          </div>
        );
      })}
      <div className="bits-gridmotion-vignette" />
    </div>
  );
}
