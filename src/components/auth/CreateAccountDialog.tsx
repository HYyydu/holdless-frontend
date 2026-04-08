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

interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAccountDialog({ open, onOpenChange }: CreateAccountDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { createAccount } = useDemoAuth();
  const { setTokenFromSupabaseSession } = useCallBackendAuth();
  const navigate = useNavigate();

  const handleCreateAccount = async () => {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (SUPABASE_CONFIGURED) {
        const { data, error: supaErr } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name } },
        });
        if (supaErr) {
          setError(supaErr.message);
          return;
        }
        if (data.session) {
          setTokenFromSupabaseSession(data.session);
          onOpenChange(false);
          navigate('/dashboard');
          return;
        }
        setNotice('Check your email to confirm your account, then sign in.');
        return;
      }
      createAccount(name, email, password);
      onOpenChange(false);
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (provider: 'google' | 'apple') => {
    void provider;
    createAccount('Demo User', 'demo@example.com', 'demo');
    onOpenChange(false);
    navigate('/dashboard');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Account</DialogTitle>
          <DialogDescription>
            Get started with your free demo account
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        {notice && <p className="text-sm text-muted-foreground text-center">{notice}</p>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

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
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            onClick={() => void handleCreateAccount()}
            className="w-full"
            disabled={!name || !email || !password || loading}
          >
            {loading ? 'Creating…' : SUPABASE_CONFIGURED ? 'Create Account' : 'Create Demo Account'}
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
