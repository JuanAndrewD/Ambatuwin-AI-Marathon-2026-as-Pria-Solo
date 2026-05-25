import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Box, Layers } from 'lucide-react';
import { useNavigate } from '../lib/router';
import { BorderGlow } from '../components/bits';
import '../styles/landing.css';

const ICONS = { Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Cube: Box, Layers };

export default function ServiceDetail({ name }) {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null); setData(null);
    fetch(`/api/services/${encodeURIComponent(name)}`)
      .then(r => r.ok ? r.json() : r.json().then(j => { throw new Error(j.error); }))
      .then(setData)
      .catch(e => setError(e.message));
  }, [name]);

  if (error) {
    return (
      <div className="landing">
        <Header onBack={() => nav('/services')} />
        <div className="svc-detail">
          <div className="muted">Service not found: {name}</div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="landing">
        <Header onBack={() => nav('/services')} />
        <div className="svc-detail muted"><div className="shimmer" style={{ height: 200 }} /></div>
      </div>
    );
  }

  const Icon = ICONS[data.summary?.icon] || Box;
  const doc = data.doc;
  const pricing = data.pricing || [];

  return (
    <div className="landing">
      <Header onBack={() => nav('/services')} />
      <div className="svc-detail">
        <div className="crumb" onClick={() => nav('/services')}>
          <ArrowLeft size={12} /> All services
        </div>

        <div className="header">
          <div>
            <div className="svc-eyebrow">{data.summary?.category || 'AWS service'}</div>
            <h1>{doc.short_name}</h1>
            <p className="svc-purpose">{doc.purpose}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="hero-cta primary" onClick={() => nav('/app')}>Use in a project →</button>
              <a className="hero-cta secondary" href={`https://aws.amazon.com/${name.toLowerCase()}/`} target="_blank" rel="noreferrer">
                AWS docs <ExternalLink size={13} />
              </a>
            </div>
          </div>
          <BorderGlow>
            <div className="meta-card">
              <div className="meta-row">
                <span className="l">Service</span>
                <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={16} /> {data.name}
                </span>
              </div>
              <div className="meta-row">
                <span className="l">Category</span>
                <span className="v">{data.summary?.category || '—'}</span>
              </div>
              <div className="meta-row">
                <span className="l">Billing unit</span>
                <span className="v">{data.summary?.billing_unit || '—'}</span>
              </div>
              <div className="meta-row">
                <span className="l">Available regions</span>
                <span className="v">
                  {data.summary?.available_in.includes('GLOBAL')
                    ? 'Global'
                    : `${data.summary?.available_in.length || 0}`}
                </span>
              </div>
              <div className="meta-row">
                <span className="l">Pricing model</span>
                <span className="v">{data.pricing_model}</span>
              </div>
            </div>
          </BorderGlow>
        </div>

        {doc.when_to_use && (
          <div className="svc-section">
            <h2>When to use it</h2>
            <ul>{doc.when_to_use.map((b, i) => <li key={i}>{b}</li>)}</ul>
          </div>
        )}

        {doc.how_to_implement && (
          <div className="svc-section">
            <h2>How to implement</h2>
            <ol>{doc.how_to_implement.map((b, i) => <li key={i}>{renderInline(b)}</li>)}</ol>
          </div>
        )}

        {doc.sample_terraform && (
          <div className="svc-section">
            <h2>Sample Terraform</h2>
            <pre><code>{doc.sample_terraform}</code></pre>
          </div>
        )}

        {pricing && pricing.length > 0 && (
          <div className="svc-section">
            <h2>Live regional pricing snapshot</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
              On-demand list price computed locally from <code>data/aws-catalog.json</code>. {pricing[0].label}
            </p>
            <div className="svc-pricing-grid">
              {pricing.map(p => (
                <div className="svc-pricing-cell" key={p.region}>
                  <div className="r">{p.region}</div>
                  <div className="v">${p.price.toFixed(p.price < 1 ? 4 : 2)}<small>{p.suffix}</small></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {doc.pairs_well_with && (
          <div className="svc-section">
            <h2>Pairs well with</h2>
            <div className="pair-row">
              {doc.pairs_well_with.map(p => (
                <span key={p} className="pair" onClick={() => nav(`/services/${p}`)}>
                  {p} →
                </span>
              ))}
            </div>
          </div>
        )}

        {doc.common_pitfalls && (
          <div className="svc-section">
            <h2>Common pitfalls</h2>
            <ul>{doc.common_pitfalls.map((b, i) => <li key={i}>{b}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

function renderInline(s) {
  // tiny **bold** support for the bullets
  const parts = String(s).split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((p, i) => {
    if (/^\*\*.+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function Header({ onBack }) {
  const nav = useNavigate();
  return (
    <nav className="landing-nav">
      <div className="brand" onClick={() => nav('/')} style={{ cursor: 'pointer' }}>
        <span className="mark">☁</span>
        ARCHITECT/AI
      </div>
      <div className="links">
        <a onClick={() => nav('/services')}>Service library</a>
        <a onClick={() => nav('/app')}>Workspace</a>
      </div>
      <button className="cta" onClick={() => nav('/app')}>Open workspace →</button>
    </nav>
  );
}
