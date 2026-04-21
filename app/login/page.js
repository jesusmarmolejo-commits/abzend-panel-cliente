'use client'
import { useState } from 'react'
import { createClient } from '../../lib/supabase'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loginGoogle = async () => {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  return (
    <div style={styles.container}>
      <div style={styles.box}>
        <h1 style={styles.logo}>ABZEND</h1>
        <p style={styles.sub}>Panel Cliente</p>
        {error && <p style={styles.error}>{error}</p>}
        <button style={styles.btn} onClick={loginGoogle} disabled={loading}>
          <img src="https://www.google.com/favicon.ico" width="18" alt="Google" style={{marginRight:8}} />
          {loading ? 'Conectando...' : 'Continuar con Google'}
        </button>
        <p style={styles.terms}>Al ingresar aceptas los términos de uso de ABZEND</p>
      </div>
    </div>
  )
}

const styles = {
  container: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#0F6E56' },
  box: { background:'#fff', borderRadius:16, padding:'2rem', width:'100%', maxWidth:380, textAlign:'center' },
  logo: { fontSize:28, fontWeight:700, color:'#0F6E56', letterSpacing:2, marginBottom:4 },
  sub: { fontSize:13, color:'#888', marginBottom:'1.5rem' },
  error: { background:'#FCEBEB', color:'#A32D2D', borderRadius:8, padding:'10px 12px', fontSize:13, marginBottom:'1rem' },
  btn: { display:'flex', alignItems:'center', justifyContent:'center', width:'100%', padding:12, background:'#fff', color:'#333', border:'1px solid #ddd', borderRadius:8, fontSize:15, fontWeight:500, cursor:'pointer' },
  terms: { fontSize:12, color:'#aaa', marginTop:'1rem' }
}
