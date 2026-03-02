import { useState, useEffect } from 'react';

export interface GovProfile {
  id: string;
  name: string; // Profile display name (e.g., "My Profile", "John's Info")
  fullName: string;
  dateOfBirth: string;
  state: string;
  zipCode: string;
  createdAt: Date;
  updatedAt: Date;
}

const STORAGE_KEY = 'holdless_gov_profiles';

export function useGovProfiles() {
  const [profiles, setProfiles] = useState<GovProfile[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load profiles from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert date strings back to Date objects
        const profilesWithDates = parsed.map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        }));
        setProfiles(profilesWithDates);
      }
    } catch (error) {
      console.error('Error loading profiles:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save profiles to localStorage whenever they change
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
      } catch (error) {
        console.error('Error saving profiles:', error);
      }
    }
  }, [profiles, isLoaded]);

  const addProfile = (profile: Omit<GovProfile, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newProfile: GovProfile = {
      ...profile,
      id: Date.now().toString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setProfiles(prev => [...prev, newProfile]);
    return newProfile;
  };

  const updateProfile = (id: string, updates: Partial<Omit<GovProfile, 'id' | 'createdAt'>>) => {
    setProfiles(prev => prev.map(p => 
      p.id === id 
        ? { ...p, ...updates, updatedAt: new Date() }
        : p
    ));
  };

  const deleteProfile = (id: string) => {
    setProfiles(prev => prev.filter(p => p.id !== id));
  };

  const getProfile = (id: string) => {
    return profiles.find(p => p.id === id);
  };

  return {
    profiles,
    isLoaded,
    addProfile,
    updateProfile,
    deleteProfile,
    getProfile,
  };
}
