import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PawPrint, Plus, Calendar, Scale } from 'lucide-react';
import type { ProfilePet } from '@/hooks/usePets';

interface PetProfilesSectionProps {
  pets: ProfilePet[];
  onAddPet: (pet: Omit<ProfilePet, 'id'>) => void;
  addError?: string | null;
}

const SPECIES_OPTIONS = ['Dog', 'Cat', 'Bird', 'Rabbit', 'Other'];

export function PetProfilesSection({ pets, onAddPet, addError }: PetProfilesSectionProps) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    species: 'Dog',
    breed: '',
    dateOfBirth: '',
    weight: '',
  });

  const resetForm = () => {
    setForm({
      name: '',
      species: 'Dog',
      breed: '',
      dateOfBirth: '',
      weight: '',
    });
  };

  const openAddModal = () => {
    resetForm();
    setAddModalOpen(true);
  };

  const handleAddPet = () => {
    if (!form.name.trim()) return;
    onAddPet({
      name: form.name.trim(),
      species: form.species,
      breed: form.breed.trim(),
      dateOfBirth: form.dateOfBirth,
      weight: form.weight.trim(),
    });
    setAddModalOpen(false);
    resetForm();
  };

  return (
    <>
      <Card className="shadow-card border border-gray-200/80 bg-white rounded-xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
              <PawPrint className="w-4 h-4 text-gray-600" />
            </div>
            Pet Profiles
          </CardTitle>
          <Button
            onClick={openAddModal}
            className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded-lg"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Pet
          </Button>
        </CardHeader>
        <CardContent>
          {addError && (
            <p className="text-sm text-red-600 mb-4 rounded-lg bg-red-50 p-3 border border-red-200">
              {addError}
            </p>
          )}
          {pets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-20 h-20 rounded-full bg-purple-50 flex items-center justify-center mb-4">
                <PawPrint className="w-10 h-10 text-[#7C3AED]" />
              </div>
              <p className="text-gray-500 text-sm mb-4">No pets added yet</p>
              <Button
                variant="outline"
                onClick={openAddModal}
                className="rounded-lg border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add your first pet
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {pets.map((pet) => (
                <div
                  key={pet.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/50"
                >
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <PawPrint className="w-5 h-5 text-[#7C3AED]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{pet.name}</p>
                    <p className="text-sm text-gray-500 truncate">
                      {pet.species}
                      {pet.breed ? ` · ${pet.breed}` : ''}
                      {pet.weight ? ` · ${pet.weight} lbs` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-[480px] gap-4 p-6 rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-left text-lg font-bold text-gray-900">
              Add Pet
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pet-name" className="text-sm font-medium text-foreground">
                Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pet-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Buddy"
                className="h-11 rounded-lg bg-gray-50 border-gray-200"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pet-species" className="text-sm font-medium text-foreground">
                  Species
                </Label>
                <Select
                  value={form.species}
                  onValueChange={(value) => setForm((f) => ({ ...f, species: value }))}
                >
                  <SelectTrigger
                    id="pet-species"
                    className="h-11 rounded-lg bg-gray-50 border-gray-200"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPECIES_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pet-breed" className="text-sm font-medium text-foreground">
                  Breed
                </Label>
                <Input
                  id="pet-breed"
                  value={form.breed}
                  onChange={(e) => setForm((f) => ({ ...f, breed: e.target.value }))}
                  placeholder="e.g. Golden Retriever"
                  className="h-11 rounded-lg bg-gray-50 border-gray-200"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="pet-dob"
                  className="text-sm font-medium text-foreground flex items-center gap-1.5"
                >
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  Date of Birth
                </Label>
                <Input
                  id="pet-dob"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  placeholder="mm/dd/yyyy"
                  className="h-11 rounded-lg bg-gray-50 border-gray-200"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="pet-weight"
                  className="text-sm font-medium text-foreground flex items-center gap-1.5"
                >
                  <Scale className="w-4 h-4 text-muted-foreground" />
                  Weight (lbs)
                </Label>
                <Input
                  id="pet-weight"
                  type="text"
                  inputMode="decimal"
                  value={form.weight}
                  onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                  placeholder="e.g. 25"
                  className="h-11 rounded-lg bg-gray-50 border-gray-200"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2 sm:gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddModalOpen(false)}
              className="rounded-lg border-gray-300"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddPet}
              disabled={!form.name.trim()}
              className="rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white"
            >
              Add Pet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
