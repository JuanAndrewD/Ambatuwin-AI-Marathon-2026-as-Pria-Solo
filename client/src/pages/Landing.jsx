import React, { useEffect, useState } from 'react';
import { ArrowRight, Cloud, Sparkles, ShieldCheck, Workflow, Receipt, BookOpen, Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, KeyRound, Archive, ArrowUpFromLine, Box, Layers, ChevronDown, ArrowUp } from 'lucide-react';
import { useNavigate } from '../lib/router';
import { api } from '../lib/api';
import { GridMotion, BorderGlow, SpotlightCard, ShinyText, SplitText, MagneticButton, TiltCard } from '../components/bits';
import '../styles/landing.css';

const ICONS = { Cpu, Database, HardDrive, Network, Globe, Compass, Zap, Boxes, Shield, ShieldCheck, KeyRound, Archive, ArrowUpFromLine, Cube: Box, Layers };

export default function Landing() {
  const nav = useNavigate();
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({ regions: 0, services: 0, frameworks: 0 });
  const [showTopFab, setShowTopFab] = useState(false);

  useEffect(() => {
    fetch('/api/services-overview').then(r => r.json()).then(d => setServices(d.services || []));
    fetch('/api/catalog').then(r => r.json()).then(d => setStats({
      regions: d.regions?.length || 0,
      services: d.services?.length || 0,
      frameworks: d.compliance_frameworks?.length || 0,
    }));
    function onScroll() { setShowTopFab(window.scrollY > 600); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand" onClick={() => nav('/')} style={{ cursor: 'pointer' }}>
          <span className="mark"><Cloud size={13} color="#fff" /></span>
          ARCHITECT/AI
        </div>
        <div className="links">
          <a onClick={() => scrollTo('how')}>How it works</a>
          <a onClick={() => scrollTo('services')}>Services</a>
          <a onClick={() => scrollTo('features')}>Features</a>
          <a onClick={() => nav('/services')}>Service library</a>
        </div>
        <MagneticButton>
          <button className="cta" onClick={() => nav('/app')}>
            Try the architect <ArrowRight size={14} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
          </button>
        </MagneticButton>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-bg"><GridMotion rows={5} cellsPerRow={14} /></div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>
            <SplitText text="Cloud" />{' '}
            <span className="underline-key"><SplitText text="architecture" delay={0.05} /></span>{' '}
            <SplitText text="that" delay={0.5} /> <SplitText text="quotes" delay={0.55} />{' '}
            <span className="underline-key b"><SplitText text="itself" delay={0.6} /></span>
          </h1>
          <div className="hero-cta-row">
            <MagneticButton strength={0.18}>
              <button className="hero-cta primary" onClick={() => nav('/app')}>
                <ShinyText speed={3}>Start architecting</ShinyText>
                <ArrowRight size={16} />
              </button>
            </MagneticButton>
            <MagneticButton strength={0.18}>
              <button className="hero-cta secondary" onClick={() => nav('/services')}>
                <BookOpen size={15} /> Browse services
              </button>
            </MagneticButton>
          </div>
        </div>
        <div className="hero-aside">
          <p className="lede">
            Describe your stack in plain English. The agent navigates a real AWS catalog,
            picks regions for residency and latency, and returns a complete deployment plan
            with a Mermaid diagram and a deterministic monthly bill.
          </p>
          <p>
            Powered by <ShinyText speed={5}>Chutes-hosted</ShinyText> open models. Pricing computed locally.
            Every service in the catalog is documented and ready to be wired in.
          </p>
          <div className="badges">
            <span className="badge accent"><ShieldCheck size={12} /> Reproducible bills</span>
            <span className="badge">{stats.services} AWS services</span>
            <span className="badge">{stats.regions} regions</span>
            <span className="badge">{stats.frameworks} compliance frameworks</span>
          </div>
        </div>
      </section>

      {/* Anthropic-style showcase block */}
      <section className="showcase">
        <div className="showcase-card">
          <div className="showcase-text">
            <h2>Project<br /><i>Glassroom</i></h2>
            <p>An autonomous Sales Engineer for the Asia-Pacific cloud era.</p>
            <button className="pill" onClick={() => nav('/app')}>Open the workspace →</button>
          </div>
          <div className="showcase-art">
            <div className="showcase-art-grid" />
            <VoronoiOrnament />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="section">
        <div className="section-eyebrow">How it works</div>
        <h2 className="section-title">From a sentence to a signed-off architecture, in four steps.</h2>
        <p className="section-lede">
          Each step is auditable. The LLM proposes the shape of the system; pricing,
          region availability, and compliance verdicts are computed locally from a
          versioned AWS catalog so the bill is reproducible.
        </p>
        <div className="pipeline">
          <PipelineStep n="01" title="Brief">
            Paste the requirements brief. The agent extracts a structured workload profile — users, regions, compliance, budget.
          </PipelineStep>
          <PipelineStep n="02" title="Design">
            The architect proposes components from a constrained AWS service vocabulary — only what you've enabled in Resources.
          </PipelineStep>
          <PipelineStep n="03" title="Validate">
            Deterministic guardrails check region availability, fall back when needed, and price every component from the local catalog.
          </PipelineStep>
          <PipelineStep n="04" title="Deliver">
            Output a markdown plan with Mermaid diagram, itemized bill, compliance audit, Terraform skeleton, and sales proposal.
          </PipelineStep>
        </div>
      </section>

      {/* FEATURES — BorderGlow row */}
      <section id="features" className="section">
        <div className="section-eyebrow">Features</div>
        <h2 className="section-title">Built for technical sales engineers.</h2>
        <div className="feature-row">
          <BorderGlow>
            <div className="feature-card">
              <Workflow size={26} style={{ color: 'var(--accent)', marginBottom: 14 }} />
              <h3>Live architecture diagrams</h3>
              <p>Mermaid diagrams generated on the fly, grouped by edge / app / data / ops tiers, ready to drop into a proposal deck.</p>
            </div>
          </BorderGlow>
          <BorderGlow>
            <div className="feature-card">
              <Receipt size={26} style={{ color: 'var(--accent)', marginBottom: 14 }} />
              <h3>Reproducible bills</h3>
              <p>Pricing comes from a versioned local catalog of AWS on-demand list prices — never the LLM. Same brief, same number, every time.</p>
            </div>
          </BorderGlow>
          <BorderGlow>
            <div className="feature-card">
              <ShieldCheck size={26} style={{ color: 'var(--accent)', marginBottom: 14 }} />
              <h3>Data residency aware</h3>
              <p>Knows which regions natively attest PDPA-MY, PDPA-SG, GDPR, HIPAA, and more. Flags every framework that fails.</p>
            </div>
          </BorderGlow>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="section">
        <div className="section-eyebrow">Service library</div>
        <h2 className="section-title">Every AWS building block, documented and ready.</h2>
        <p className="section-lede">
          Tap any service to see what it's for, when to use it, how to wire it in,
          common pitfalls, sample Terraform, and live regional pricing.
        </p>
        <div className="svc-grid">
          {services.map(s => {
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
      </section>

      <footer className="landing-footer">
        Built for the AI Marathon 2026 · Powered by{' '}
        <ShinyText speed={4}>Chutes</ShinyText> ·
        <a onClick={() => nav('/app')}>workspace</a>·
        <a onClick={() => nav('/services')}>services</a>·
        Pricing model: AWS on-demand list (USD), 730 h/month
      </footer>

      <button
        className={`scroll-down-cue ${showTopFab ? 'hidden' : ''}`}
        onClick={() => scrollTo('how')}
        aria-label="Scroll to how it works"
      >
        <span>Scroll to explore</span>
        <ChevronDown size={18} />
      </button>

      <button
        className={`back-to-top ${showTopFab ? 'visible' : ''}`}
        onClick={scrollToTop}
        title="Back to top"
        aria-label="Back to top"
      >
        <ArrowUp size={16} />
      </button>
    </div>
  );
}

function PipelineStep({ n, title, children }) {
  return (
    <SpotlightCard className="pipeline-step" spotlightColor="rgba(139, 92, 246, 0.14)">
      <span className="num">{n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </SpotlightCard>
  );
}

// CSS-only voronoi-style ornament for the showcase block. Stylised to evoke
// the Anthropic "Project Glasswing" hero without copying it pixel-for-pixel.
function VoronoiOrnament() {
  return (
    <svg className="showcase-art-svg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
      {Array.from({ length: 18 }).map((_, i) => {
        const angle = (i / 18) * Math.PI * 2;
        const cx = 200 + Math.cos(angle) * 140 + (Math.sin(i * 1.7) * 30);
        const cy = 200 + Math.sin(angle) * 140 + (Math.cos(i * 1.3) * 30);
        const sides = 5 + (i % 3);
        const radius = 36 + (i % 4) * 10;
        const points = [];
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2 + i * 0.4;
          points.push(`${(cx + Math.cos(a) * radius).toFixed(1)},${(cy + Math.sin(a) * radius).toFixed(1)}`);
        }
        return <path key={i} d={`M${points.join(' L')} Z`} className={i % 5 === 0 ? 'accent' : ''} />;
      })}
    </svg>
  );
}
