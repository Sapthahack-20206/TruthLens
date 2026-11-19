import AuthScreen from '@/components/auth-screen'
import PolicyScreen from '@/components/policy-screen'

const authRoutes = ['login', 'register', 'forgot-password', 'reset-password'] as const
const policyRoutes = ['privacy', 'terms'] as const

type AuthRoute = (typeof authRoutes)[number]
type PolicyRoute = (typeof policyRoutes)[number]

export function generateStaticParams() {
  return [...authRoutes, ...policyRoutes].map((slug) => ({ slug }))
}

export default async function AuthRoutePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (authRoutes.includes(slug as AuthRoute)) return <AuthScreen mode={slug as AuthRoute} />
  if (policyRoutes.includes(slug as PolicyRoute)) return <PolicyScreen mode={slug as PolicyRoute} />
  return <main className="not-found"><p>Page not found</p><a href="/">Return home</a></main>
}
