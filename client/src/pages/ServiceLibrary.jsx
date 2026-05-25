import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search, Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Box, Layers } from 'lucide-react';
import { useNavigate } from '../lib/router';
import { SpotlightCard, TiltCard } from '../components/bits';
import '../styles/landing.css';

const ICONS = { Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Cube: Box, Layers };

export default function ServiceLibrary() {
  const nav = useNavigate();
  const [services, setServices] = useState([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/services-overview').then(r => r.json()).then(d => setServices(d.services || []));
  }, []);

  const grouped = useMemo(() => {
    const filtered = !q.trim() ? services : services.filter(s =>
      [s.name, s.short_name, s.purpose, s.tagline, s.category]
        .filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase())
    );
    const m = new Map();
    for (const s of filtered) {
      if (!m.has(s.category)) m.set(s.category, []);
      m.get(s.category).push(s);
    }
    return Array.from(m.entries());
  }, [services, q]);

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand" onClick={() => nav('/')} style={{ cursor: 'pointer' }}>
          <span className="mark">☁</span>
          ARCHITECT/AI
        </div>
        <div className="links">
          <a onClick={() => nav('/')}>Home</a>
          <a onClick={() => nav('/app')}>Workspace</a>
        </div>
        <button className="cta" onClick={() => nav('/app')}>Open workspace →</button>
      </nav>

      <section className="section" style={{ paddingTop: 60 }}>
        <div className="section-eyebrow">Service library</div>
        <h2 className="section-title">Every AWS building block at your disposal.</h2>
        <p className="section-lede">
          The architect can use any of these. Click a service to see its purpose, when to use it,
          how to wire it in, common pitfalls, sample Terraform, and live regional pricing.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 480, margin: '0 0 36px', background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px' }}>
          <Search size={16} style={{ color: 'var(--text-faint)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search services, categories, purpose…"
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', font: 'inherit', outline: 'none' }}
          />
          <span className="kbd" style={{ fontFamily: 'var(--font-mono)' }}>{services.length} services</span>
        </div>

        {grouped.map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 48 }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, color: 'var(--text)', margin: '0 0 16px', letterSpacing: '-0.01em' }}>
              {cat}
            </h3>
            <div className="svc-grid">
              {items.map(s => {
                const Icon = ICONS[s.icon] || Box;
                return (
                  <TiltCard key={s.name} max={4}>
                    <SpotlightCard className="svc-card" onClick={() => nav(`/services/${s.name}`)} role="button">
                      <div className="svc-icon"><Icon size={18} /></div>
                      <div className="svc-cat">{s.category}</div>
                      <div className="svc-name">{s.short_name || s.name}</div>
                      <div className="svc-desc">{s.purpose || s.tagline}</div>
                      <div className="svc-foot">
                        <span>Available in {s.available_in.length} {s.available_in.includes('GLOBAL') ? '· global' : 'regions'}</span>
                        <ArrowRight size={12} />
                      </div>
                    </SpotlightCard>
                  </TiltCard>
                );
              })}
            </div>
          </div>
        ))}

        {grouped.length === 0 && (
          <div className="muted" style={{ textAlign: 'center', padding: '40px' }}>No services match your search.</div>
        )}
      </section>
    </div>
  );
}
