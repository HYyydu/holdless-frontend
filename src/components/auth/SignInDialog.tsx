import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDemoAuth, SUPABASE_CONFIGURED } from '@/contexts/DemoAuthContext';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignInDialog({ open, onOpenChange }: SignInDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn } = useDemoAuth();
  const { setTokenFromSupabaseSession } = useCallBackendAuth();
  const navigate = useNavigate();

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      if (SUPABASE_CONFIGURED) {
        const { data, error: supaErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (supaErr) {
          setError(supaErr.message);
          return;
        }
        setTokenFromSupabaseSession(data.session);
        onOpenChange(false);
        navigate('/dashboard');
        return;
      }
      signIn(email, password);
      onOpenChange(false);
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (provider: 'google' | 'apple') => {
    void provider;
    signIn('demo@example.com', 'demo');
    onOpenChange(false);
    navigate('/dashboard');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign In</DialogTitle>
          <DialogDescription>
            Enter your credentials to access your account
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            onClick={() => void handleSignIn()}
            className="w-full"
            disabled={!email || !password || loading}
          >
            {loading ? 'Signing in…' : SUPABASE_CONFIGURED ? 'Sign In' : 'Sign In Demo'}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          {!SUPABASE_CONFIGURED && (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleDemoLogin('google')}
                className="w-full"
              >
                Continue with Google
              </Button>
              <Button
                variant="outline"
                onClick={() => handleDemoLogin('apple')}
                className="w-full"
              >
                Continue with Apple
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
