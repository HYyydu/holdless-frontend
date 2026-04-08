import { useState } from 'react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PetProfileCard, Pet } from '@/components/PetProfileCard';
import { PetQuoteDialog } from '@/components/pet-care/PetQuoteDialog';
import { PetTaskDetailsDialog } from '@/components/pet-care/PetTaskDetailsDialog';
import { HoldlessWinModal, WinData } from '@/components/HoldlessWinModal';
import { 
  PawPrint, 
  Dog, 
  Cat, 
  Heart, 
  Stethoscope, 
  Calendar,
  DollarSign,
  Phone,
  Clock,
  CheckCircle2,
  Sparkles,
  Search
} from 'lucide-react';
import Footer from '@/components/Footer';

interface PetTask {
  id: string;
  petId: string;
  petName: string;
  petType: 'dog' | 'cat' | 'other';
  clinicName: string;
  service: string;
  status: 'pending' | 'in_progress' | 'quote_received' | 'resolved';
  estimatedCost?: string;
  createdAt: Date;
}

const initialPets: Pet[] = [
  {
    id: '1',
    name: 'Buddy',
    species: 'dog',
    breed: 'Golden Retriever',
    age: '3 years',
    sex: 'male',
    weight: '65 lbs',
    spayNeuterStatus: 'yes',
    notes: 'Allergic to chicken, very friendly',
  },
  {
    id: '2',
    name: 'Whiskers',
    species: 'cat',
    breed: 'Maine Coon',
    age: '5 years',
    sex: 'female',
    weight: '12 lbs',
    spayNeuterStatus: 'yes',
    notes: 'Indoor cat, shy around strangers',
  },
];

const samplePetTasks: PetTask[] = [
  {
    id: '1',
    petId: '1',
    petName: 'Buddy',
    petType: 'dog',
    clinicName: 'Happy Paws Veterinary',
    service: 'Annual checkup + vaccinations',
    status: 'quote_received',
    estimatedCost: '$85 - $120',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: '2',
    petId: '2',
    petName: 'Whiskers',
    petType: 'cat',
    clinicName: 'City Pet Hospital',
    service: 'Dental cleaning consultation',
    status: 'in_progress',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
  {
    id: '3',
    petId: '1',
    petName: 'Buddy',
    petType: 'dog',
    clinicName: 'PetVet Clinic',
    service: 'Grooming + nail trim',
    status: 'resolved',
    estimatedCost: '$45',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  },
];

const PetCare = () => {
  const [pets, setPets] = useState<Pet[]>(initialPets);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(initialPets[0]?.id || null);
  const [tasks, setTasks] = useState<PetTask[]>(samplePetTasks);
  const [activeTab, setActiveTab] = useState<'tasks' | 'profile'>('tasks');
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<PetTask | null>(null);

  const handleSavePet = (updatedPet: Pet) => {
    setPets((prev) =>
      prev.map((p) => (p.id === updatedPet.id ? updatedPet : p))
    );
    // Update tasks with new pet name
    setTasks((prev) =>
      prev.map((t) =>
        t.petId === updatedPet.id
          ? { ...t, petName: updatedPet.name, petType: updatedPet.species }
          : t
      )
    );
  };

  const handleDeletePet = (petId: string) => {
    setPets((prev) => prev.filter((p) => p.id !== petId));
    if (selectedPetId === petId) {
      setSelectedPetId(pets.find((p) => p.id !== petId)?.id || null);
    }
  };

  const handleAddPet = () => {
    const newPet: Pet = {
      id: Date.now().toString(),
      name: 'New Pet',
      species: 'dog',
      breed: '',
      age: '',
      sex: 'unknown',
      weight: '',
      spayNeuterStatus: 'unknown',
      notes: '',
    };
    setPets((prev) => [...prev, newPet]);
    setSelectedPetId(newPet.id);
  };

  const handleCreateQuoteTask = (taskData: {
    petId: string;
    petName: string;
    petType: 'dog' | 'cat' | 'other';
    taskType: string;
    clinics: { id: string; name: string; address: string; phone: string; rating: number; distance: string }[];
    additionalNotes: string;
  }) => {
    const newTask: PetTask = {
      id: Date.now().toString(),
      petId: taskData.petId,
      petName: taskData.petName,
      petType: taskData.petType,
      clinicName: taskData.clinics.map(c => c.name).join(', '),
      service: taskData.taskType,
      status: 'in_progress',
      createdAt: new Date(),
    };
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleViewDetails = (task: PetTask) => {
    setSelectedTask(task);
    setDetailsDialogOpen(true);
  };

  // Holdless Win state
  const [winModalOpen, setWinModalOpen] = useState(false);
  const [winData, setWinData] = useState<WinData | null>(null);

  const handleBookAppointment = (taskId: string, clinicName: string, winDataFromDialog: WinData) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId 
          ? { ...t, status: 'resolved' as const, clinicName } 
          : t
      )
    );
    
    // Set win data and show modal after a short delay
    setWinData(winDataFromDialog);
    setTimeout(() => setWinModalOpen(true), 400);
  };

  const selectedPet = pets.find(p => p.id === selectedPetId) || null;

  const getStatusBadge = (status: PetTask['status']) => {
    const styles = {
      pending: 'bg-amber-100 text-amber-700 border-amber-200',
      in_progress: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      quote_received: 'bg-teal-100 text-teal-700 border-teal-200',
      resolved: 'bg-green-100 text-green-700 border-green-200',
    };
    const labels = {
      pending: 'Pending',
      in_progress: 'Getting Quote',
      quote_received: 'Quote Ready',
      resolved: 'Completed',
    };
    return (
      <Badge className={`${styles[status]} border font-medium`}>
        {labels[status]}
      </Badge>
    );
  };

  const getPetIcon = (type: PetTask['petType']) => {
    if (type === 'dog') return <Dog className="w-5 h-5 text-emerald-600" />;
    if (type === 'cat') return <Cat className="w-5 h-5 text-emerald-600" />;
    return <PawPrint className="w-5 h-5 text-emerald-600" />;
  };

  const pendingCount = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  
  // Filter tasks by selected pet
  const filteredTasks = selectedPetId 
    ? tasks.filter(t => t.petId === selectedPetId)
    : tasks;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-background to-background">
      <Header 
        activeTab={activeTab}
        onTabChange={setActiveTab}
        pendingTasksCount={pendingCount}
      />
      
      <main className="container max-w-6xl mx-auto px-4 py-8">
        {/* Pet Care Hero */}
        <div className="relative mb-10">
          {/* Decorative paw prints */}
          <div className="absolute -top-4 right-8 opacity-10">
            <PawPrint className="w-24 h-24 text-emerald-500 rotate-12" />
          </div>
          <div className="absolute top-12 right-32 opacity-5">
            <PawPrint className="w-16 h-16 text-emerald-500 -rotate-12" />
          </div>
          
          <div className="flex items-center gap-4 mb-2">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <PawPrint className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Pet Care</h1>
              <p className="text-muted-foreground">Get clinic quotes without the wait</p>
            </div>
          </div>
        </div>

        {/* Pet Profiles Section - Replaces Quick Stats */}
        <div className="mb-8">
          <PetProfileCard
            pets={pets}
            onSavePet={handleSavePet}
            onDeletePet={handleDeletePet}
            onAddPet={handleAddPet}
            selectedPetId={selectedPetId}
            onSelectPet={setSelectedPetId}
          />
        </div>

        {/* New Quote Request Card */}
        <Card className="mb-8 border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 shadow-md overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-500" />
              <CardTitle className="text-lg text-emerald-800">Find Clinics & Request Quotes</CardTitle>
            </div>
            <CardDescription className="text-emerald-600/80">
              {selectedPet 
                ? `Get quotes for ${selectedPet.name} from multiple clinics in your area`
                : 'Select a pet to start getting clinic quotes'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => setQuoteDialogOpen(true)}
              disabled={!selectedPet}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md w-full sm:w-auto"
            >
              <Search className="w-4 h-4 mr-2" />
              Find Clinics & Get Quotes
            </Button>
          </CardContent>
        </Card>

        {/* Pet Tasks List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Heart className="w-5 h-5 text-emerald-500" />
              {selectedPetId && pets.find(p => p.id === selectedPetId)
                ? `${pets.find(p => p.id === selectedPetId)?.name}'s Requests`
                : 'Your Pet Requests'}
            </h2>
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
              {filteredTasks.length} total
            </Badge>
          </div>

          <div className="grid gap-4">
            {filteredTasks.length === 0 ? (
              <Card className="border-emerald-100 bg-white">
                <CardContent className="pt-6 text-center py-8">
                  <p className="text-muted-foreground">No requests for this pet yet. Create one above!</p>
                </CardContent>
              </Card>
            ) : (
              filteredTasks.map((task) => (
              <Card 
                key={task.id} 
                className="border-emerald-100/50 hover:border-emerald-200 transition-all hover:shadow-md bg-white"
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    {/* Pet Icon */}
                    <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      {getPetIcon(task.petType)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <h3 className="font-semibold text-foreground">{task.petName}</h3>
                          <p className="text-sm text-muted-foreground">{task.service}</p>
                        </div>
                        {getStatusBadge(task.status)}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mt-3">
                        <div className="flex items-center gap-1.5">
                          <Stethoscope className="w-4 h-4 text-emerald-500" />
                          <span>{task.clinicName}</span>
                        </div>
                        {task.estimatedCost && (
                          <div className="flex items-center gap-1.5">
                            <DollarSign className="w-4 h-4 text-teal-500" />
                            <span className="font-medium text-foreground">{task.estimatedCost}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4 text-emerald-400" />
                          <span>{task.createdAt.toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action */}
                    <div className="flex-shrink-0">
                      {task.status === 'quote_received' ? (
                        <Button 
                          size="sm" 
                          className="bg-emerald-500 hover:bg-emerald-600 text-white"
                          onClick={() => handleViewDetails(task)}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          View Quote
                        </Button>
                      ) : task.status === 'in_progress' ? (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => handleViewDetails(task)}
                        >
                          <Phone className="w-4 h-4 mr-1" />
                          Calling...
                        </Button>
                      ) : task.status === 'resolved' ? (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="text-muted-foreground"
                          onClick={() => handleViewDetails(task)}
                        >
                          View Details
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="border-emerald-200"
                          onClick={() => handleViewDetails(task)}
                        >
                          <Clock className="w-4 h-4 mr-1" />
                          Pending
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
              ))
            )}
          </div>
        </div>

        {/* Helpful Tips */}
        <Card className="mt-10 border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Heart className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-1">How Pet Care Works</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Simply describe what your pet needs—checkups, vaccinations, grooming, or specialist visits. 
                  Holdless will call local clinics on your behalf to get quotes and availability, 
                  saving you time on hold and helping you compare prices easily.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <Footer />

      {/* Quote Dialog */}
      <PetQuoteDialog
        open={quoteDialogOpen}
        onOpenChange={setQuoteDialogOpen}
        selectedPet={selectedPet}
        onCreateTask={handleCreateQuoteTask}
      />

      {/* Task Details Dialog */}
      <PetTaskDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        task={selectedTask ? {
          id: selectedTask.id,
          petName: selectedTask.petName,
          service: selectedTask.service,
          status: selectedTask.status,
          clinics: [],
          createdAt: selectedTask.createdAt,
        } : null}
        onBookAppointment={handleBookAppointment}
      />

      {/* Holdless Win Modal */}
      <HoldlessWinModal
        open={winModalOpen}
        onOpenChange={setWinModalOpen}
        winData={winData}
      />
    </div>
  );
};

export default PetCare;
