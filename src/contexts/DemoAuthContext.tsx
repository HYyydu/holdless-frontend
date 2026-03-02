import React, { createContext, useContext, useState, ReactNode } from 'react';

interface DemoUser {
  id: string;
  name: string;
  email: string;
}

interface DemoAuthContextType {
  user: DemoUser | null;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => void;
  createAccount: (name: string, email: string, password: string) => void;
  signOut: () => void;
}

const DemoAuthContext = createContext<DemoAuthContextType | undefined>(undefined);

export const useDemoAuth = () => {
  const context = useContext(DemoAuthContext);
  if (context === undefined) {
    throw new Error('useDemoAuth must be used within a DemoAuthProvider');
  }
  return context;
};

interface DemoAuthProviderProps {
  children: ReactNode;
}

export const DemoAuthProvider: React.FC<DemoAuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<DemoUser | null>(null);

  const signIn = (email: string, password: string) => {
    const demoUser: DemoUser = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo User',
      email: email,
    };
    setUser(demoUser);
  };

  const createAccount = (name: string, email: string, password: string) => {
    const demoUser: DemoUser = {
      id: '00000000-0000-0000-0000-000000000001',
      name: name,
      email: email,
    };
    setUser(demoUser);
  };

  const signOut = () => {
    setUser(null);
  };

  const value: DemoAuthContextType = {
    user,
    isAuthenticated: !!user,
    signIn,
    createAccount,
    signOut,
  };

  return (
    <DemoAuthContext.Provider value={value}>
      {children}
    </DemoAuthContext.Provider>
  );
};