import { useState, useEffect, useCallback } from 'react';

export interface UserProfile {
  firstName: string;
  lastName: string;
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
  firstName: '',
  lastName: '',
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
        const legacyName =
          typeof parsed?.name === 'string' ? parsed.name.trim() : '';
        const existingFirstName =
          typeof parsed?.firstName === 'string' ? parsed.firstName.trim() : '';
        const existingLastName =
          typeof parsed?.lastName === 'string' ? parsed.lastName.trim() : '';
        const [legacyFirstName, ...legacyLastParts] = legacyName.split(/\s+/).filter(Boolean);
        setProfile({
          ...defaultProfile,
          ...parsed,
          firstName: existingFirstName || legacyFirstName || '',
          lastName: existingLastName || legacyLastParts.join(' '),
        });
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
    profile.firstName?.trim() && 
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
