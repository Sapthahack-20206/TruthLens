import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

const LOGO_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/TruthLens%20Aperture%20Logo-Zh8uJ1dIwq1yd1IEsjzn4BDgWzmMQA.png'

type PolicyMode = 'privacy' | 'terms'

const content: Record<PolicyMode, { eyebrow: string; title: string; introduction: string; sections: { title: string; body: string }[] }> = {
  privacy: {
    eyebrow: 'PRIVACY INFORMATION',
    title: 'Privacy at TruthLens',
    introduction: 'This TruthLens build is a frontend prototype. Its backend, account service, and data-retention policy have not been configured.',
    sections: [
      { title: 'Information sent for analysis', body: 'When an investigation is submitted, the selected files and optional context are sent to the configured analysis endpoint. If no endpoint is configured, requests use the current site origin and may fail. Do not upload sensitive material until the service operator has confirmed its access and retention policies.' },
      { title: 'Browser storage', body: 'The frontend does not save investigation data in local storage. Temporary media previews use browser object URLs and are released when the selected file changes or the preview is removed.' },
      { title: 'Accounts and reports', body: 'Authentication is not connected in this prototype. Report files and investigation details can only be retrieved when the configured backend returns them.' },
      { title: 'Service operator', body: 'The operator of the connected backend is responsible for explaining how submitted files, account data, and generated reports are secured and retained.' },
    ],
  },
  terms: {
    eyebrow: 'TERMS OF USE',
    title: 'TruthLens terms',
    introduction: 'This page is a draft for review. Have qualified counsel review terms and policies before using TruthLens with real users or sensitive evidence.',
    sections: [
      { title: 'Prototype use', body: 'This interface is a development prototype. Authentication, backend processing, and report generation depend on separately configured services and may be unavailable.' },
      { title: 'Evidence and analysis', body: 'Analysis outputs are returned by the configured service, may be uncertain or incomplete, and are not proof of authenticity or manipulation. A qualified human reviewer should evaluate findings in context.' },
      { title: 'Uploaded material', body: 'Only submit material you are authorized to process. Before uploading confidential or personal material, verify the connected service’s security, access controls, and retention practices.' },
      { title: 'No legal advice', body: 'TruthLens does not provide legal advice or replace professional forensic review. Final service terms should be approved by the service operator and legal counsel.' },
    ],
  },
}

export default function PolicyScreen({ mode }: { mode: PolicyMode }) {
  const page = content[mode]

  return <main className="policy-screen"><header className="auth-nav"><Link className="brand" href="/" aria-label="TruthLens home"><span className="brand-symbol"><img src={LOGO_URL} alt="" /></span><span className="brand-name">TruthLens</span></Link><Link className="auth-back" href="/"><ArrowLeft /> Back to home</Link></header><article className="policy-content"><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1><p className="policy-intro">{page.introduction}</p><div className="policy-notice" role="note">Prototype notice: backend configuration, authentication, and service policies are not connected in this build.</div>{page.sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}<Link className="button button-outline" href="/">Return to TruthLens <ArrowLeft /></Link></article><footer className="auth-footer">TruthLens · Evidence-led digital forensics</footer></main>
}
