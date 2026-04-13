import React, { useState } from 'react';
import { Settings, Wifi, WifiOff, Loader2, LogIn, ShieldCheck, LogOut, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { MarketStatus } from '@/hooks/use-market-data';

type LoginStep = 'credentials' | '2fa' | 'manual';

export function SettingsPanel({
  status,
  sendToken,
  clearToken,
}: {
  status: MarketStatus;
  sendToken: (token: string, cookieStr?: string) => void;
  clearToken: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [tempKey, setTempKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/tradingview/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { success?: boolean; needs2FA?: boolean; tempKey?: string; sessionId?: string; cookieStr?: string; error?: string };
      if (data.success && data.sessionId) {
        sendToken(data.sessionId, data.cookieStr ?? '');
        setOpen(false);
        resetForm();
      } else if (data.needs2FA && data.tempKey) {
        setTempKey(data.tempKey);
        setStep('2fa');
      } else {
        setError(data.error ?? 'Login failed. Check your credentials.');
      }
    } catch {
      setError('Connection error — check your network and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handle2FA() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/tradingview/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, tempKey }),
      });
      const data = await res.json() as { success?: boolean; sessionId?: string; cookieStr?: string; error?: string };
      if (data.success && data.sessionId) {
        sendToken(data.sessionId, data.cookieStr ?? '');
        setOpen(false);
        resetForm();
      } else {
        const msg = data.error ?? 'Invalid code. Try again.';
        if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('sign in again')) {
          setStep('credentials');
          setCode('');
          setError('Login session expired — please enter your credentials again.');
        } else {
          setError(msg);
        }
      }
    } catch {
      // Server may have restarted — temp session is gone. Reset to credentials.
      setStep('credentials');
      setCode('');
      setError('Connection lost — please enter your credentials again.');
    } finally {
      setLoading(false);
    }
  }

  function handleManualToken() {
    if (manualToken.trim()) {
      sendToken(manualToken.trim());
      setOpen(false);
      resetForm();
    }
  }

  function resetForm() {
    setStep('credentials');
    setUsername('');
    setPassword('');
    setCode('');
    setManualToken('');
    setTempKey('');
    setError('');
  }

  const isLive = status.authenticated && status.connected;

  return (
    <div className="flex items-center gap-2">
      {/* Status pill */}
      <div
        className="flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#0e0e18] border border-[#1e1e2e]"
        data-testid="status-connection"
      >
        {isLive ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-emerald-400/90">Live</span>
          </>
        ) : status.wsConnected && status.hasSavedToken && !status.authenticated ? (
          <>
            <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
            <span className="text-cyan-400/80">Authenticating…</span>
          </>
        ) : status.wsConnected && status.needsLogin ? (
          <>
            <LogIn className="w-3 h-3 text-amber-400" />
            <span className="text-amber-400/80">Login required</span>
          </>
        ) : status.wsConnected ? (
          <>
            <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
            <span className="text-amber-400/80">Connecting…</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3 text-red-500" />
            <span className="text-red-500/80">Disconnected</span>
          </>
        )}
      </div>

      <button
        className="text-muted-foreground/50 hover:text-white/80 transition-colors p-1 rounded"
        data-testid="btn-settings"
        onClick={() => setOpen(true)}
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="bg-[#0a0a12] border-[#1e1e2e] text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono tracking-wide text-sm">
              {step === 'credentials' && 'TradingView Login'}
              {step === '2fa' && '2-Factor Verification'}
              {step === 'manual' && 'Session Token'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {step === 'credentials' && 'Log in with your TradingView account to stream real-time MNQ1! and MES1! data.'}
              {step === '2fa' && 'Enter the 6-digit code from your authenticator app.'}
              {step === 'manual' && "Paste your sessionid cookie value from TradingView's DevTools > Application > Cookies."}
            </DialogDescription>
          </DialogHeader>

          {/* Saved session notice */}
          {status.hasSavedToken && step === 'credentials' && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-cyan-400/5 border border-cyan-400/15 rounded-md mb-2">
              <div className="flex items-center gap-2 text-xs text-cyan-400/80">
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>Session saved — reconnects automatically on refresh</span>
              </div>
              <button
                onClick={() => { clearToken(); setOpen(false); }}
                className="flex items-center gap-1 text-[11px] font-mono text-white/25 hover:text-red-400 border border-white/8 hover:border-red-400/30 rounded px-2 py-0.5 transition-colors shrink-0"
                title="Forget saved session"
              >
                <LogOut className="w-3 h-3" /> Forget
              </button>
            </div>
          )}

          {step === 'credentials' && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="tv-user" className="text-xs">Username or Email</Label>
                <Input
                  id="tv-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-black border-[#2a2a3a] font-mono text-sm"
                  placeholder="your@email.com"
                  data-testid="input-username"
                  autoComplete="username"
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tv-pass" className="text-xs">Password</Label>
                <Input
                  id="tv-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-black border-[#2a2a3a] font-mono text-sm"
                  placeholder="••••••••"
                  data-testid="input-password"
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>
              {error && <p className="text-xs text-red-400" data-testid="login-error">{error}</p>}
              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1 bg-white text-black hover:bg-gray-200 text-sm"
                  onClick={handleLogin}
                  disabled={loading || !username || !password}
                  data-testid="btn-login"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                  {loading ? 'Signing in…' : 'Sign In'}
                </Button>
              </div>
              <button
                className="text-xs text-muted-foreground/50 hover:text-white/60 w-full text-center pt-0.5 transition-colors"
                onClick={() => { setStep('manual'); setError(''); }}
              >
                Paste session token manually instead
              </button>
            </div>
          )}

          {step === '2fa' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/8 px-3 py-2 rounded-md border border-amber-400/15">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                2-factor authentication required
              </div>
              <div className="space-y-2">
                <Label htmlFor="tv-code" className="text-xs">Authenticator Code</Label>
                <Input
                  id="tv-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="bg-black border-[#2a2a3a] font-mono text-center tracking-[0.5em] text-lg"
                  placeholder="000000"
                  maxLength={6}
                  data-testid="input-2fa-code"
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && handle2FA()}
                />
              </div>
              {error && <p className="text-xs text-red-400" data-testid="2fa-error">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="border border-[#2a2a3a] text-sm"
                  onClick={() => { setStep('credentials'); setError(''); setCode(''); }}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-white text-black hover:bg-gray-200 text-sm"
                  onClick={handle2FA}
                  disabled={loading || code.length !== 6}
                  data-testid="btn-verify-2fa"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {loading ? 'Verifying…' : 'Verify'}
                </Button>
              </div>
            </div>
          )}

          {step === 'manual' && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="tv-token" className="text-xs">Session ID (sessionid cookie)</Label>
                <Input
                  id="tv-token"
                  type="password"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  className="bg-black border-[#2a2a3a] font-mono text-xs"
                  placeholder="Paste sessionid value here"
                  data-testid="input-manual-token"
                />
                <p className="text-xs text-muted-foreground/50">
                  Log into TradingView in Chrome, open DevTools (F12), go to Application &gt; Cookies &gt; tradingview.com, find <code className="bg-black px-1 rounded">sessionid</code> and copy its value.
                </p>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="border border-[#2a2a3a] text-sm"
                  onClick={() => { setStep('credentials'); setError(''); }}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-white text-black hover:bg-gray-200 text-sm"
                  onClick={handleManualToken}
                  disabled={!manualToken.trim()}
                  data-testid="btn-save-token"
                >
                  Connect
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
