import Link from 'next/link'
import { ArrowRight, Clock3, FileSearch, FileText, Info } from 'lucide-react'
import { getSafeVisualizationUrl, type ForensicResponse } from '@/lib/truthlens-api'
import EvidenceGraph from '@/components/evidence-graph'

function displayConfidence(value: number | string) {
  if (typeof value !== 'number') return value
  return `${value >= 0 && value <= 1 ? Math.round(value * 100) : value}%`
}

export default function AnalysisResult({ response, section, sourcePreviewUrl }: { response: unknown; section: string; sourcePreviewUrl?: string }) {
  const result = response && typeof response === 'object' && !Array.isArray(response)
    ? response as ForensicResponse
    : null
  const findings = Array.isArray(result?.findings) ? result.findings : []
  const timestamps = Array.isArray(result?.suspiciousTimestamps) ? result.suspiciousTimestamps : []
  const relationships = Array.isArray(result?.evidenceRelationships) ? result.evidenceRelationships : []
  const visualizations = Array.isArray(result?.visualizations) ? result.visualizations : []
  const metadata = result?.metadata && typeof result.metadata === 'object' ? Object.entries(result.metadata) : []
  const limitations = Array.isArray(result?.limitations) ? result.limitations : []
  const hasEvidence = Boolean(result?.summary || result?.assessment || findings.length || timestamps.length || relationships.length || visualizations.length || metadata.length || limitations.length)

  return (
    <section className="workspace-panel workspace-analysis-results" aria-live="polite">
      <div className="panel-heading">
        <div><p className="eyebrow">BACKEND RESPONSE</p><h2>{section} analysis</h2></div>
        {result?.status && <span className="response-status">{result.status}</span>}
      </div>
      {result?.assessment && <div className="returned-assessment"><span>Assessment returned by service</span><strong>{result.assessment}</strong></div>}
      {result?.summary && <p className="returned-summary">{result.summary}</p>}
      {!hasEvidence && <div className="result-empty"><Info aria-hidden="true" /><p>The service responded, but did not return any renderable findings. No detection or confidence value has been inferred.</p></div>}

      {metadata.length > 0 && <div className="result-metadata"><h3>File and analysis metadata</h3><dl>{metadata.map(([label, value]) => <div key={label}><dt>{label.replace(/([A-Z])/g, ' $1')}</dt><dd>{value === null ? 'Not provided' : String(value)}</dd></div>)}</dl></div>}

      {visualizations.length > 0 && <div className="result-section"><h3>Returned forensic visualisations</h3>{section === 'Image' && sourcePreviewUrl && <div className="image-evidence-comparison"><figure className="forensic-visualization"><img src={sourcePreviewUrl} alt="Original uploaded image" /><figcaption>Original source</figcaption></figure>{(() => {
        const item = visualizations[0]
        const source = getSafeVisualizationUrl(item.url)
        return <figure className="forensic-visualization" key={`comparison-${item.label}`}>{source ? <img src={source} alt={item.label} /> : <div className="visualization-unavailable">This visualisation is not hosted by the configured analysis service.</div>}<figcaption>{item.label}</figcaption></figure>
      })()}</div>}{visualizations.length > (section === 'Image' && sourcePreviewUrl ? 1 : 0) && <div className="visualization-grid">{visualizations.slice(section === 'Image' && sourcePreviewUrl ? 1 : 0).map((item, index) => {
        const source = getSafeVisualizationUrl(item.url)
        return <figure className="forensic-visualization" key={`${item.label}-${index}`}>{source ? <img src={source} alt={item.label} /> : <div className="visualization-unavailable">This visualisation is not hosted by the configured analysis service.</div>}<figcaption>{item.label}</figcaption></figure>
      })}</div>}</div>}

      {findings.length > 0 && <div className="result-section"><h3>Evidence-linked findings</h3><div className="returned-findings">{findings.map((finding, index) => <article className="returned-finding" key={finding.id ?? `${finding.title}-${index}`}>
        <div className="finding-heading"><span>{finding.type ?? 'Finding'}</span>{typeof finding.confidence === 'number' || typeof finding.confidence === 'string' ? <span>Confidence returned: {displayConfidence(finding.confidence)}</span> : null}</div>
        <h4>{finding.title ?? 'Untitled finding'}</h4>
        {finding.description && <p>{finding.description}</p>}
        {(finding.timestamp || finding.evidenceRef || finding.sourceRef) && <div className="finding-references">{finding.timestamp && <span><Clock3 aria-hidden="true" />{finding.timestamp}</span>}{finding.evidenceRef && <span><FileSearch aria-hidden="true" />{finding.evidenceRef}</span>}{finding.sourceRef && <span>{finding.sourceRef}</span>}</div>}
      </article>)}</div></div>}

      {timestamps.length > 0 && <div className="result-section"><h3>Returned timestamps</h3><ol className="returned-timestamps">{timestamps.map((item, index) => <li key={`${item.timestamp}-${index}`}><time>{item.timestamp}</time><div><strong>{item.label ?? 'Evidence timestamp'}</strong>{item.description && <p>{item.description}</p>}{item.evidenceRef && <small>{item.evidenceRef}</small>}</div></li>)}</ol></div>}

      {relationships.length > 0 && <div className="result-section"><h3>Evidence relationships returned</h3><p className="graph-count-note">This graph uses only relationships returned by the configured analysis service.</p><EvidenceGraph relationships={relationships} /></div>}

      {limitations.length > 0 && <div className="result-section"><h3>Technical limitations returned</h3><ul className="returned-limitations">{limitations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}
      {result?.reportId && <Link className="button button-outline result-report-link" href={`/workspace?section=reports&report=${encodeURIComponent(result.reportId)}`}><FileText aria-hidden="true" /> Open report <ArrowRight aria-hidden="true" /></Link>}
      {result?.id && <p className="result-id">Response ID: {result.id}</p>}
    </section>
  )
}
