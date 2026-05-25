import React, { useMemo, useState } from 'react';
import { Search, Layers, Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Box } from 'lucide-react';

const ICONS = { Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Cube: Box, Layers };

export default function ResourcesPane({ catalog, project, onToggleService, onSelectAll, onSelectNone }) {
  const [query, setQuery] = useState('');
  const enabled = useMemo(() => new Set(project?.enabled_services || []), [project]);
  const filtered = useMemo(() => {
    if (!catalog?.services) return [];
    const q = query.trim().toLowerCase();
    if (!q) return catalog.services;
    return catalog.services.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.tagline.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  }, [catalog, query]);

  // group by category
  const grouped = useMemo(() => {
    const m = new Map();
    for (const s of filtered) {
      if (!m.has(s.category)) m.set(s.category, []);
      m.get(s.category).push(s);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const projectRegion = project?.region;

  return (
    <div>
      <div className="resources-toolbar">
        <Search size={14} style={{ color: 'var(--text-faint)' }} />
        <input className="input" placeholder="Search services" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      <div className="side-section">
        Allowed in this project
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onSelectAll}>All</button>
          <button onClick={onSelectNone}>None</button>
        </div>
      </div>

      {grouped.map(([cat, services]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <div className="side-section" style={{ paddingTop: 0 }}>{cat}</div>
          <div className="resource-list">
            {services.map(s => {
              const Icon = ICONS[s.icon] || Box;
              const isEnabled = enabled.has(s.name);
              const inRegion = s.available_in.includes(projectRegion) || s.available_in.includes('GLOBAL');
              return (
                <div
                  key={s.name}
                  className={`resource ${isEnabled ? 'enabled' : ''}`}
                  onClick={() => onToggleService(s.name)}
                  title={inRegion ? '' : `Not natively available in ${projectRegion} — fallback region will be used.`}
                >
                  <div className="ricon"><Icon size={15} /></div>
                  <div className="rmeta">
                    <div className="rname">
                      {s.name}
                      {!inRegion && <span className="kbd" style={{ marginLeft: 6 }}>fallback</span>}
                    </div>
                    <div className="rsub">{s.tagline}</div>
                  </div>
                  <div className="rcheck">{isEnabled && '✓'}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="resource-summary">
        {project ? (
          <>{enabled.size} of {catalog.services.length} services enabled. Architect is locked to this subset.</>
        ) : (
          <>No project selected.</>
        )}
      </div>
    </div>
  );
}
