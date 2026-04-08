import { useState, useEffect, useCallback } from 'react';

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  dateOfBirth: string;
  state: string;
  zipCode: string;
  tone: string;
  language: string;
}

const STORAGE_KEY = 'holdless_user_profile';

const defaultProfile: UserProfile = {
  name: '',
  email: '',
  phone: '',
  address: '',
  dateOfBirth: '',
  state: '',
  zipCode: '',
  tone: '',
  language: '',
};

export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile>(defaultProfile);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load profile from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setProfile({ ...defaultProfile, ...parsed });
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save profile to localStorage whenever it changes
  useEffect(() => {
    if (isLoaded) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      } catch (error) {
        console.error('Error saving user profile:', error);
      }
    }
  }, [profile, isLoaded]);

  const updateProfile = useCallback((field: string, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateMultipleFields = useCallback((updates: Partial<UserProfile>) => {
    setProfile(prev => ({ ...prev, ...updates }));
  }, []);

  // Check if profile has essential info filled for autofill
  const hasEssentialInfo = Boolean(
    profile.name?.trim() && 
    profile.dateOfBirth && 
    profile.state?.trim() && 
    profile.zipCode?.trim()
  );

  return {
    profile,
    isLoaded,
    updateProfile,
    updateMultipleFields,
    hasEssentialInfo,
  };
}
