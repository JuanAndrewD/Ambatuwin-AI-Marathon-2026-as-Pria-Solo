import React, { useMemo, useState } from 'react';
import { FileText, Workflow, Receipt, ShieldCheck, Sparkles, Download, Copy, Check, PanelRightClose, FlaskConical } from 'lucide-react';
import AnimatedNumber from './AnimatedNumber';

export default function StudioPane({ project, plan, isGenerating, onGenerate, collapsed, onToggleCollapse, onShowPlan }) {
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState(null);

  const total = plan?.priced?.total ?? 0;
  const components = plan?.priced?.items?.length ?? 0;
  const compliancePass = plan?.compliance?.passes?.length ?? 0;
  const complianceFail = plan?.compliance?.issues?.length ?? 0;
  const overBudget = useMemo(() => {
    const b = plan?.profile?.budget_usd_per_month;
    if (!b || !plan) return null;
    return total > b;
  }, [plan, total]);

  async function runAction(kind) {
    if (!project || isGenerating || busyAction) return;
    setBusyAction(kind);
    try { await onGenerate(kind); } finally { setBusyAction(null); }
  }

  function downloadMd() {
    if (!plan?.markdown) return;
    const blob = new Blob([plan.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `aws-deployment-plan-${plan.region.code}-${ts}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function copyMd() {
    if (!plan?.markdown) return;
    try {
      await navigator.clipboard.writeText(plan.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <aside className={`pane right ${collapsed ? 'collapsed' : ''}`}>
      <div className="pane-header">
        {!collapsed && <h2><span className="pane-icon"><FlaskConical size={13} /></span>Studio</h2>}
        <button className="collapse-btn" onClick={onToggleCollapse} title="Collapse">
          <PanelRightClose size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className="pane-body">
          <div className="studio-grid">
            <StudioCard icon={<FileText size={16} />} name="Generate plan" sub="Full markdown deliverable"
              onClick={() => runAction('full-plan')} busy={busyAction === 'full-plan' || isGenerating} />
            <StudioCard icon={<Workflow size={16} />} name="Architecture diagram" sub="Mermaid in chat"
              onClick={() => runAction('diagram')} busy={busyAction === 'diagram'} />
            <StudioCard icon={<Receipt size={16} />} name="Itemized bill" sub="Per-component costs"
              onClick={() => runAction('bill')} busy={busyAction === 'bill'} />
            <StudioCard icon={<ShieldCheck size={16} />} name="Compliance audit" sub="PDPA / GDPR / HIPAA"
              onClick={() => runAction('compliance')} busy={busyAction === 'compliance'} />
            <StudioCard icon={<Sparkles size={16} />} name="Terraform skeleton" sub="IaC starting point"
              onClick={() => runAction('terraform')} busy={busyAction === 'terraform'} />
            <StudioCard icon={<FileText size={16} />} name="Sales proposal" sub="Client-ready 1-pager"
              onClick={() => runAction('proposal')} busy={busyAction === 'proposal'} />
          </div>

          {plan ? (
            <div className="studio-output">
              <div className="kpi-row">
                <div className={`kpi-card ${overBudget === true ? 'red' : overBudget === false ? 'green' : ''}`}>
                  <div className="kpi-l">Monthly bill</div>
                  <div className="kpi-v"><AnimatedNumber value={total} prefix="$" /></div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-l">Components</div>
                  <div className="kpi-v"><AnimatedNumber value={components} decimals={0} /></div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-l">Region</div>
                  <div className="kpi-v" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{plan.region.code}</div>
                </div>
                <div
                  className={`kpi-card ${complianceFail ? 'red' : compliancePass > 0 ? 'green' : ''}`}
                  title={
                    compliancePass + complianceFail === 0
                      ? 'No data-residency frameworks were inferred from this brief.'
                      : compliancePass > 0 && !complianceFail
                        ? `Region ${plan.region.code} natively attests every framework requested.`
                        : `Region ${plan.region.code} fails ${complianceFail} of ${compliancePass + complianceFail} requested frameworks. Click "Compliance audit" for a qualitative review.`
                  }
                >
                  <div className="kpi-l">Residency</div>
                  <div className="kpi-v">
                    {compliancePass + complianceFail === 0
                      ? <span style={{ color: 'var(--text-faint)' }}>—</span>
                      : <>{compliancePass}/{compliancePass + complianceFail} {complianceFail ? '✗' : '✓'}</>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button className="btn tiny" onClick={onShowPlan}>
                  <FileText size={11} /> View plan in chat
                </button>
                <button className="btn tiny" onClick={downloadMd}>
                  <Download size={11} /> .md
                </button>
                <button className="btn tiny" onClick={copyMd}>
                  {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="muted" style={{ fontSize: 11 }}>
                Generated by <span className="mono">{plan.model}</span> via Chutes. Pricing computed deterministically from local catalog (730h/mo, USD on-demand list).
              </div>
            </div>
          ) : (
            <div className="studio-empty">
              <div className="icon">📐</div>
              Studio output appears here after you generate a plan.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function StudioCard({ icon, name, sub, onClick, busy }) {
  return (
    <button className={`studio-card ${busy ? 'busy' : ''}`} onClick={onClick}>
      <div className="scicon">{busy ? <span className="spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--line)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} /> : icon}</div>
      <div className="scbody">
        <div className="scname">{name}</div>
        <div className="scsub">{sub}</div>
      </div>
    </button>
  );
}
