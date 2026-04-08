import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDemoAuth, SUPABASE_CONFIGURED } from '@/contexts/DemoAuthContext';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Auth() {
  const navigate = useNavigate();
  const { signIn, createAccount } = useDemoAuth();
  const { signInToCallBackend, setTokenFromSupabaseSession } = useCallBackendAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Sign In state
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);

  // Sign Up state
  const [signUpName, setSignUpName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpLoading, setSignUpLoading] = useState(false);

  // Option 1: Sign in with Supabase → session.access_token is sent as Bearer on /api/chat and /api/call
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setSignInLoading(true);
    try {
      if (SUPABASE_CONFIGURED) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: signInEmail.trim(),
          password: signInPassword,
        });
        if (error) {
          console.log('[Auth] Sign in failed (Supabase):', error.message);
          setAuthError(error.message);
          return;
        }
        console.log('[Auth] Sign in success (Supabase):', signInEmail.trim());
        setTokenFromSupabaseSession(data.session);
        // user id comes from DemoAuthProvider via onAuthStateChange (must match auth.users.id)
      } else {
        signIn(signInEmail, signInPassword);
        const result = await signInToCallBackend(signInEmail, signInPassword);
        if (!result.ok && result.error) {
          console.log('[Auth] Sign in failed (call backend):', result.error);
          setAuthError(result.error);
          return;
        }
        console.log('[Auth] Sign in success (call backend):', signInEmail.trim());
      }
      navigate('/dashboard');
    } finally {
      setSignInLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setSignUpLoading(true);
    try {
      if (SUPABASE_CONFIGURED) {
        const { data, error } = await supabase.auth.signUp({
          email: signUpEmail.trim(),
          password: signUpPassword,
          options: { data: { name: signUpName } },
        });
        if (error) {
          console.log('[Auth] Sign up failed (Supabase):', error.message);
          setAuthError(error.message);
          return;
        }
        console.log('[Auth] Sign up success (Supabase):', signUpEmail.trim(), data.session ? '(session created)' : '(confirm email may be required)');
        if (data.session) setTokenFromSupabaseSession(data.session);
        // user id from session via DemoAuthProvider when data.session is set; else user confirms email first
        if (!data.session) {
          setAuthNotice('Check your email to confirm your account, then sign in.');
          return;
        }
      } else {
        createAccount(signUpName, signUpEmail, signUpPassword);
        const result = await signInToCallBackend(signUpEmail, signUpPassword);
        if (!result.ok && result.error) {
          console.log('[Auth] Sign up / call backend sign-in failed:', result.error);
          setAuthError(result.error);
          return;
        }
        console.log('[Auth] Sign up success (call backend):', signUpEmail.trim());
      }
      navigate('/dashboard');
    } finally {
      setSignUpLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Welcome to Holdless</CardTitle>
          <CardDescription className="text-center">
            Sign in to your account or create a new one
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authError && (
            <p className="text-sm text-destructive mb-3 text-center">{authError}</p>
          )}
          {authNotice && (
            <p className="text-sm text-muted-foreground mb-3 text-center">{authNotice}</p>
          )}
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="you@example.com"
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="••••••••"
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={signInLoading}>
                  {signInLoading ? 'Signing in…' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="John Doe"
                    value={signUpName}
                    onChange={(e) => setSignUpName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={signUpLoading}>
                  {signUpLoading ? 'Creating account…' : 'Create Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/')}
          >
            Back to Home
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
