import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dog, Cat, PawPrint, Pencil, Check, X, Plus, Trash2 } from 'lucide-react';

export interface Pet {
  id: string;
  name: string;
  species: 'dog' | 'cat' | 'other';
  breed: string;
  age: string;
  sex: 'male' | 'female' | 'unknown';
  weight?: string;
  spayNeuterStatus: 'yes' | 'no' | 'unknown';
  notes: string;
}

interface PetProfileCardProps {
  pets: Pet[];
  onSavePet: (pet: Pet) => void;
  onDeletePet: (petId: string) => void;
  onAddPet: () => void;
  selectedPetId: string | null;
  onSelectPet: (petId: string) => void;
}

const defaultPet: Omit<Pet, 'id'> = {
  name: '',
  species: 'dog',
  breed: '',
  age: '',
  sex: 'unknown',
  weight: '',
  spayNeuterStatus: 'unknown',
  notes: '',
};

export function PetProfileCard({
  pets,
  onSavePet,
  onDeletePet,
  onAddPet,
  selectedPetId,
  onSelectPet,
}: PetProfileCardProps) {
  const [editingPetId, setEditingPetId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<Pet, 'id'>>(defaultPet);

  const selectedPet = pets.find((p) => p.id === selectedPetId);

  const startEditing = (pet: Pet) => {
    setEditingPetId(pet.id);
    setEditForm({
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      age: pet.age,
      sex: pet.sex,
      weight: pet.weight || '',
      spayNeuterStatus: pet.spayNeuterStatus,
      notes: pet.notes,
    });
  };

  const cancelEditing = () => {
    setEditingPetId(null);
    setEditForm(defaultPet);
  };

  const saveEdit = () => {
    if (editingPetId && editForm.name) {
      onSavePet({
        id: editingPetId,
        ...editForm,
      });
      setEditingPetId(null);
      setEditForm(defaultPet);
    }
  };

  const getPetIcon = (species: Pet['species']) => {
    if (species === 'dog') return <Dog className="w-5 h-5 text-emerald-600" />;
    if (species === 'cat') return <Cat className="w-5 h-5 text-emerald-600" />;
    return <PawPrint className="w-5 h-5 text-emerald-600" />;
  };

  if (pets.length === 0) {
    return (
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-teal-50/30 shadow-sm">
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <PawPrint className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">No Pets Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add your first pet to get started with pet care requests
            </p>
            <Button
              onClick={onAddPet}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Pet
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pet Selection Tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        {pets.map((pet) => (
          <Button
            key={pet.id}
            variant={selectedPetId === pet.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => onSelectPet(pet.id)}
            className={
              selectedPetId === pet.id
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-0'
                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
            }
          >
            {getPetIcon(pet.species)}
            <span className="ml-2">{pet.name}</span>
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddPet}
          className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Pet
        </Button>
      </div>

      {/* Selected Pet Card */}
      {selectedPet && (
        <Card className="border-emerald-100 bg-gradient-to-br from-white to-emerald-50/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl flex items-center justify-center">
                  {getPetIcon(selectedPet.species)}
                </div>
                <div>
                  <CardTitle className="text-lg">{selectedPet.name}</CardTitle>
                  <p className="text-sm text-muted-foreground capitalize">
                    {selectedPet.breed || selectedPet.species} · {selectedPet.age || 'Age unknown'}
                  </p>
                </div>
              </div>
              {editingPetId !== selectedPet.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEditing(selectedPet)}
                  className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                >
                  <Pencil className="w-4 h-4 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {editingPetId === selectedPet.id ? (
              /* Edit Form */
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="pet-name">Pet Name *</Label>
                    <Input
                      id="pet-name"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder="e.g., Buddy"
                      className="border-emerald-200 focus-visible:ring-emerald-400"
                    />
                  </div>

                  <div>
                    <Label htmlFor="species">Species *</Label>
                    <Select
                      value={editForm.species}
                      onValueChange={(value: Pet['species']) =>
                        setEditForm({ ...editForm, species: value })
                      }
                    >
                      <SelectTrigger className="border-emerald-200">
                        <SelectValue placeholder="Select species" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dog">Dog</SelectItem>
                        <SelectItem value="cat">Cat</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="breed">Breed</Label>
                    <Input
                      id="breed"
                      value={editForm.breed}
                      onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })}
                      placeholder="e.g., Golden Retriever"
                      className="border-emerald-200 focus-visible:ring-emerald-400"
                    />
                  </div>

                  <div>
                    <Label htmlFor="age">Age</Label>
                    <Input
                      id="age"
                      value={editForm.age}
                      onChange={(e) => setEditForm({ ...editForm, age: e.target.value })}
                      placeholder="e.g., 3 years"
                      className="border-emerald-200 focus-visible:ring-emerald-400"
                    />
                  </div>

                  <div>
                    <Label>Sex</Label>
                    <RadioGroup
                      value={editForm.sex}
                      onValueChange={(value: Pet['sex']) =>
                        setEditForm({ ...editForm, sex: value })
                      }
                      className="flex gap-4 mt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="male" id="male" />
                        <Label htmlFor="male" className="font-normal">Male</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="female" id="female" />
                        <Label htmlFor="female" className="font-normal">Female</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="unknown" id="sex-unknown" />
                        <Label htmlFor="sex-unknown" className="font-normal">Unknown</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div>
                    <Label htmlFor="weight">Weight (optional)</Label>
                    <Input
                      id="weight"
                      value={editForm.weight}
                      onChange={(e) => setEditForm({ ...editForm, weight: e.target.value })}
                      placeholder="e.g., 25 lbs"
                      className="border-emerald-200 focus-visible:ring-emerald-400"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <Label>Spay/Neuter Status</Label>
                    <RadioGroup
                      value={editForm.spayNeuterStatus}
                      onValueChange={(value: Pet['spayNeuterStatus']) =>
                        setEditForm({ ...editForm, spayNeuterStatus: value })
                      }
                      className="flex gap-4 mt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="yes" id="spay-yes" />
                        <Label htmlFor="spay-yes" className="font-normal">Yes</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="no" id="spay-no" />
                        <Label htmlFor="spay-no" className="font-normal">No</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="unknown" id="spay-unknown" />
                        <Label htmlFor="spay-unknown" className="font-normal">Unknown</Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes">Notes (allergies, temperament, special needs)</Label>
                  <Textarea
                    id="notes"
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    placeholder="Any special information about your pet..."
                    className="min-h-20 border-emerald-200 focus-visible:ring-emerald-400"
                  />
                </div>

                <div className="flex justify-between pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeletePet(selectedPet.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete Pet
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={cancelEditing}>
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveEdit}
                      disabled={!editForm.name}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white"
                    >
                      <Check className="w-4 h-4 mr-1" />
                      Save Pet Profile
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* View Mode */
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Sex</p>
                  <p className="font-medium capitalize">{selectedPet.sex}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Weight</p>
                  <p className="font-medium">{selectedPet.weight || '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Spay/Neuter</p>
                  <p className="font-medium capitalize">{selectedPet.spayNeuterStatus}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Species</p>
                  <p className="font-medium capitalize">{selectedPet.species}</p>
                </div>
                {selectedPet.notes && (
                  <div className="col-span-2 md:col-span-4">
                    <p className="text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedPet.notes}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
