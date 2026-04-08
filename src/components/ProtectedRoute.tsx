import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDemoAuth } from '@/contexts/DemoAuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, authReady } = useDemoAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && !isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [authReady, isAuthenticated, navigate]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  return <>{children}</>;
}