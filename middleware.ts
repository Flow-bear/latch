import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // API routes handle their own auth (e.g., /api/checkin uses CRON_SECRET).
    // Static assets and PWA files don't need session refresh.
    '/((?!api/|_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest.json|sw.js|workbox-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
