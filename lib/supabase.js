import { createBrowserClient } from '@supabase/ssr'

// Storage compartido usando cookies para que sobreviva redirects
const cookieStorage = {
  getItem: (key) => {
    if (typeof document === 'undefined') return null
    const cookies = document.cookie.split(';').reduce((acc, c) => {
      const [k, v] = c.trim().split('=')
      if (k) acc[decodeURIComponent(k)] = decodeURIComponent(v || '')
      return acc
    }, {})
    return cookies[key] || null
  },
  setItem: (key, value) => {
    if (typeof document === 'undefined') return
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=600; SameSite=Lax`
  },
  removeItem: (key) => {
    if (typeof document === 'undefined') return
    document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0`
  }
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        storage: cookieStorage,
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true
      }
    }
  )
}

export const supabase = createClient()
