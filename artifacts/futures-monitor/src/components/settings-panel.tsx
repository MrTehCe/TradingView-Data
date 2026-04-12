import React, { useState } from 'react';
import { Settings, Wifi, WifiOff, Loader2, LogIn, ShieldCheck } from 'lucide-react';
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
}: {
  status: MarketStatus;
  sendToken: (token: string) => void;
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
      const data = await res.json() as { success?: boolean; needs2FA?: boolean; tempKey?: string; sessionId?: string; error?: string };
      if (data.success && data.sessionId) {
        sendToken(data.sessionId);
        setOpen(false);
        resetForm();
      } else if (data.needs2FA && data.tempKey) {
        setTempKey(data.tempKey);
        setStep('2fa');
      } else {
        setError(data.error ?? 'Login failed. Check your credentials.');
      }
    } catch {
      setError('Network error — could not reach TradingView.');
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
      const data = await res.json() as { success?: boolean; sessionId?: string; error?: string };
      if (data.success && data.sessionId) {
        sendToken(data.sessionId);
        setOpen(false);
        resetForm();
      } else {
        setError(data.error ?? 'Invalid code. Try again.');
      }
    } catch {
      setError('Network error — could not verify code.');
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
    <div className="flex items-center gap-3">
      <div
        className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full bg-[#111] border border-[#222]"
        data-testid="status-connection"
      >
        {isLive ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-500/80">Live</span>
          </>
        ) : status.wsConnected && status.needsLogin ? (
          <>
            <LogIn className="w-3.5 h-3.5 text-yellow-500" />
            <span className="text-yellow-500/80">Login required</span>
          </>
        ) : status.wsConnected ? (
          <>
            <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
            <span className="text-yellow-400/80">Connecting to TV...</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-red-500" />
            <span className="text-red-500/80">Disconnected</span>
          </>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-white"
        data-testid="btn-settings"
        onClick={() => setOpen(true)}
      >
        <Settings className="w-5 h-5" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="bg-[#0d0d0d] border-[#222] text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono tracking-wide">
              {step === 'credentials' && 'TradingView Login'}
              {step === '2fa' && '2-Factor Verification'}
              {step === 'manual' && 'Session Token'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              {step === 'credentials' && 'Log in with your TradingView account to stream real-time MNQ1! and MES1! data.'}
              {step === '2fa' && 'Enter the 6-digit code from your authenticator app.'}
              {step === 'manual' && 'Paste your sessionid cookie value from TradingView\'s DevTools > Application > Cookies.'}
            </DialogDescription>
          </DialogHeader>

          {step === 'credentials' && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="tv-user">Username or Email</Label>
                <Input
                  id="tv-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-black border-[#333] font-mono"
                  placeholder="your@email.com"
                  data-testid="input-username"
                  autoComplete="username"
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tv-pass">Password</Label>
                <Input
                  id="tv-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-black border-[#333] font-mono"
                  placeholder="••••••••"
                  data-testid="input-password"
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>
              {error && <p className="text-xs text-red-400" data-testid="login-error">{error}</p>}
              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1 bg-white text-black hover:bg-gray-200"
                  onClick={handleLogin}
                  disabled={loading || !username || !password}
                  data-testid="btn-login"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </div>
              <button
                className="text-xs text-muted-foreground hover:text-white w-full text-center pt-1"
                onClick={() => { setStep('manual'); setError(''); }}
              >
                Paste session token manually instead
              </button>
            </div>
          )}

          {step === '2fa' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 px-3 py-2 rounded-md border border-yellow-400/20">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                2-factor authentication required
              </div>
              <div className="space-y-2">
                <Label htmlFor="tv-code">Authenticator Code</Label>
                <Input
                  id="tv-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="bg-black border-[#333] font-mono text-center tracking-[0.5em] text-lg"
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
                  className="border border-[#333]"
                  onClick={() => { setStep('credentials'); setError(''); setCode(''); }}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-white text-black hover:bg-gray-200"
                  onClick={handle2FA}
                  disabled={loading || code.length !== 6}
                  data-testid="btn-verify-2fa"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {loading ? 'Verifying...' : 'Verify'}
                </Button>
              </div>
            </div>
          )}

          {step === 'manual' && (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="tv-token">Session ID (sessionid cookie)</Label>
                <Input
                  id="tv-token"
                  type="password"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  className="bg-black border-[#333] font-mono text-xs"
                  placeholder="Paste sessionid value here"
                  data-testid="input-manual-token"
                />
                <p className="text-xs text-muted-foreground/60">
                  Log into TradingView in Chrome, open DevTools (F12), go to Application &gt; Cookies &gt; tradingview.com, find <code className="bg-black px-1 rounded">sessionid</code> and copy its value.
                </p>
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="border border-[#333]"
                  onClick={() => { setStep('credentials'); setError(''); }}
                >
                  Back
                </Button>
                <Button
                  className="flex-1 bg-white text-black hover:bg-gray-200"
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
