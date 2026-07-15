import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { InkCard, InkButton, Tamil } from '@/components/ink';

export default function Login({ onLogin }) {
  const [step, setStep]         = useState('phone');
  const [phone, setPhone]       = useState('');
  const [code, setCode]         = useState('');
  const [devOtp, setDevOtp]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [resendSec, setResendSec] = useState(30);
  const otpRef = useRef(null);

  async function sendOtp() {
    if (!/^\d{10}$/.test(phone)) { setError('Enter a valid 10-digit phone number'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/send-otp', { phone, role: 'shop' });
      setDevOtp(data.dev_otp || null);
      if (data.dev_otp) setCode(String(data.dev_otp));
      setStep('otp');
      setResendSec(30);
    } catch {
      setError('Failed to send OTP. Try again.');
    } finally { setLoading(false); }
  }

  async function verifyOtp() {
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit OTP'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/auth/verify-otp', { phone, code, role: 'shop' });
      onLogin({ user: data.user, token: data.token, refreshToken: data.refreshToken });
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid OTP');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (step !== 'otp' || resendSec <= 0) return;
    const id = setInterval(() => setResendSec(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [step, resendSec]);

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <InkCard className="w-full max-w-md p-8" style={{ borderRadius: 24 }}>
        <div style={{ fontFamily: 'Instrument Serif', fontSize: 48, lineHeight: '48px', color: 'var(--color-ink)' }}>
          Inkiro<span style={{ color: 'var(--color-accent)' }}>.</span>
        </div>
        <div className="text-ink-muted text-[11px] font-bold tracking-widest uppercase mt-1">Shop dashboard</div>
        <p className="text-ink-soft mt-2">Sign in to manage orders.</p>
        <Tamil size={12}>ஆர்டர்களை நிர்வகிக்க உள்நுழையவும்</Tamil>

        {step === 'phone' ? (
          <>
            <div className="mt-6">
              <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Phone number</div>
              <div className={`flex items-center gap-2.5 mt-2 pb-2 border-b-2 ${phone.length === 10 ? 'border-accent' : phone.length > 0 ? 'border-rose' : 'border-ink'}`}>
                <span className="text-ink text-xl font-bold">+91</span>
                <input
                  className="flex-1 text-ink text-xl font-bold bg-transparent outline-none"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                  onKeyDown={e => e.key === 'Enter' && sendOtp()}
                  maxLength={10}
                  inputMode="numeric"
                  style={{ letterSpacing: 1.5 }}
                  autoFocus
                />
                <span className="text-ink-muted text-xs font-bold" style={{ minWidth: 28 }}>
                  {phone.length}/10
                </span>
              </div>
            </div>
            {error && <p className="text-rose text-xs mt-2">{error}</p>}
            <InkButton variant="accent" size="lg" full className="mt-4" onClick={sendOtp} disabled={loading}>
              {loading ? 'Sending…' : 'Send OTP'}
            </InkButton>
          </>
        ) : (
          <>
            <div className="mt-6 flex items-center gap-1.5">
              <span className="text-ink-soft text-sm">Sent to +91 {phone} ·</span>
              <button className="text-accent font-semibold text-sm" onClick={() => { setStep('phone'); setCode(''); }}>change</button>
            </div>
            <div className="mt-4 relative">
              <div className="flex gap-2.5" onClick={() => otpRef.current?.focus()}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const d = code[i] || '';
                  const isFocus = i === code.length;
                  return (
                    <div
                      key={i}
                      className={`flex-1 aspect-square flex items-center justify-center rounded-2xl border-[1.5px] cursor-text ${
                        d ? 'bg-accent-soft border-accent'
                          : isFocus ? 'bg-paper-elev border-accent'
                          : 'bg-paper-elev border-hair-strong'
                      }`}
                      style={{ maxHeight: 58 }}
                    >
                      <span className={`font-mono text-2xl font-bold ${d ? 'text-accent-ink' : 'text-ink-muted'}`}>{d}</span>
                    </div>
                  );
                })}
              </div>
              <input
                ref={otpRef}
                className="absolute opacity-0 h-0 w-0"
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && verifyOtp()}
                inputMode="numeric"
                autoFocus
              />
            </div>
            <div className="mt-3 text-ink-muted text-[13px] flex items-center gap-2">
              {resendSec > 0
                ? <>Resend in 0:{String(resendSec).padStart(2, '0')}</>
                : <button className="text-accent font-semibold" onClick={sendOtp}>Resend</button>
              }
            </div>
            {error && <p className="text-rose text-xs mt-2">{error}</p>}
            <InkButton variant="accent" size="lg" full className="mt-4" onClick={verifyOtp} disabled={loading || code.length !== 6}>
              {loading ? 'Verifying…' : 'Verify'}
            </InkButton>
            {devOtp && (
              <div className="mt-3 px-4 py-2.5 rounded-xl bg-sky-soft text-sky text-xs">
                ⚡ Dev build · code auto-filled ({devOtp})
              </div>
            )}
          </>
        )}
      </InkCard>
    </div>
  );
}
