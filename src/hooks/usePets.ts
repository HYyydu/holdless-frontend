import { useState, useEffect, useCallback } from 'react';
import {
  getPetProfiles,
  createPetProfile,
  deletePetProfile,
  type PetProfileFromApi,
} from '@/lib/chatApi';

export interface ProfilePet {
  id: string;
  name: string;
  species: string;
  breed: string;
  dateOfBirth: string;
  weight: string;
}

const STORAGE_KEY = 'holdless_pet_profiles';

function apiToProfilePet(r: PetProfileFromApi): ProfilePet {
  return {
    id: r.id,
    name: r.name,
    species: r.species ?? '',
    breed: r.breed ?? '',
    dateOfBirth: r.date_of_birth ?? '',
    weight: r.weight ?? '',
  };
}

/**
 * Sync pet profiles with Supabase when userId is set; otherwise use localStorage.
 * Pass the same userId as used for chat (e.g. from useDemoAuth().user?.id).
 */
export function usePets(userId: string | null) {
  const [pets, setPets] = useState<ProfilePet[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Load from API when userId is set, else from localStorage
  useEffect(() => {
    if (userId) {
      getPetProfiles(userId).then((list) => {
        setPets(list.map(apiToProfilePet));
        setIsLoaded(true);
      });
    } else {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setPets(Array.isArray(parsed) ? parsed : []);
        } else {
          setPets([]);
        }
      } catch (error) {
        console.error('Error loading pet profiles:', error);
        setPets([]);
      }
      setIsLoaded(true);
    }
  }, [userId]);

  // Persist to localStorage only when not using API (no userId)
  useEffect(() => {
    if (isLoaded && !userId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pets));
      } catch (error) {
        console.error('Error saving pet profiles:', error);
      }
    }
  }, [pets, isLoaded, userId]);

  const addPet = useCallback(
    async (pet: Omit<ProfilePet, 'id'>) => {
      setAddError(null);
      const tempId = `temp-${Date.now()}`;
      const optimisticPet: ProfilePet = {
        ...pet,
        id: tempId,
      };

      if (userId) {
        setPets((prev) => [...prev, optimisticPet]);
        const created = await createPetProfile(userId, {
          name: pet.name,
          species: pet.species || undefined,
          breed: pet.breed || undefined,
          date_of_birth: pet.dateOfBirth || undefined,
          weight: pet.weight || undefined,
        });
        if (created) {
          setPets((prev) =>
            prev.map((p) => (p.id === tempId ? apiToProfilePet(created) : p))
          );
          return created.id;
        }
        setPets((prev) => prev.filter((p) => p.id !== tempId));
        setAddError('Could not save pet. Is the backend running on port 8000? Set VITE_API_TARGET=8000 and restart the dev server.');
        return '';
      }
      const newPet: ProfilePet = {
        ...pet,
        id: crypto.randomUUID?.() ?? `pet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
      setPets((prev) => [...prev, newPet]);
      return newPet.id;
    },
    [userId]
  );

  const removePet = useCallback(
    async (id: string) => {
      if (userId) {
        const ok = await deletePetProfile(userId, id);
        if (ok) setPets((prev) => prev.filter((p) => p.id !== id));
      } else {
        setPets((prev) => prev.filter((p) => p.id !== id));
      }
    },
    [userId]
  );

  return { pets, isLoaded, addPet, removePet, addError };
}
