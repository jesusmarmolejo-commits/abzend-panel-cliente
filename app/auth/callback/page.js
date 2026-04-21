'use client'
import { useEffect } from 'react'
import { createClient } from '../../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function Callback() {
  const router = useRouter()

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()
      const code = new URLSearchParams(window.location.search).get('code')

      console.log('Code:', code ? 'SI' : 'NO')

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error && data.session) {
          console.log('Login exitoso:', data.user?.email)
          router.push('/dashboard')
          return
        }
        console.error('Exchange error:', error?.message)
        router.push('/login?error=auth')
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.push('/dashboard')
        return
      }

      router.push('/login')
    }

    handleCallback()
  }, [])

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#0F6E56'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center'}}>
        <p style={{color:'#0F6E56',fontWeight:700,fontSize:20,letterSpacing:2}}>ABZEND</p>
        <p style={{color:'#888',marginTop:8}}>Verificando acceso...</p>
      </div>
    </div>
  )
}
