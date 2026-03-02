import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MapPin,
  Search,
  Phone,
  Star,
  ChevronRight,
  ChevronLeft,
  Stethoscope,
  Scissors,
  Syringe,
  Heart,
  Sparkles,
  FileText,
  CheckCircle2,
  Navigation,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { Pet } from '@/components/PetProfileCard';

const GOOGLE_MAPS_API_KEY = 'AIzaSyAOwc85xjPn48_WqBnRRcrmxzYNvTYd-zo';

const petTaskTypes = [
  { value: 'spay-neuter', label: 'Spay/Neuter quote', icon: Heart },
  { value: 'vaccination', label: 'Vaccination pricing', icon: Syringe },
  { value: 'dental', label: 'Dental cleaning quote', icon: Sparkles },
  { value: 'microchip', label: 'Microchip appointment', icon: FileText },
  { value: 'wellness', label: 'Wellness exam price', icon: Stethoscope },
  { value: 'grooming', label: 'Grooming price check', icon: Scissors },
  { value: 'other', label: 'Other', icon: FileText },
];

interface Clinic {
  id: string;
  name: string;
  address: string;
  phone: string;
  rating: number;
  distance: string;
  openNow?: boolean;
  photoUrl?: string;
}

// Mock clinic data (would come from Google Places API in production)
const mockClinics: Clinic[] = [
  {
    id: '1',
    name: 'Happy Paws Veterinary',
    address: '123 Main St, Austin, TX 78701',
    phone: '(512) 555-1234',
    rating: 4.8,
    distance: '1.2 mi',
    openNow: true,
  },
  {
    id: '2',
    name: 'City Pet Hospital',
    address: '456 Oak Ave, Austin, TX 78702',
    phone: '(512) 555-5678',
    rating: 4.5,
    distance: '2.5 mi',
    openNow: true,
  },
  {
    id: '3',
    name: 'PetVet Clinic',
    address: '789 Elm Blvd, Austin, TX 78703',
    phone: '(512) 555-9012',
    rating: 4.7,
    distance: '3.1 mi',
    openNow: false,
  },
  {
    id: '4',
    name: 'Austin Animal Care',
    address: '321 Pine Dr, Austin, TX 78704',
    phone: '(512) 555-3456',
    rating: 4.3,
    distance: '4.2 mi',
    openNow: true,
  },
  {
    id: '5',
    name: 'Barking Good Vet',
    address: '654 Cedar Ln, Austin, TX 78705',
    phone: '(512) 555-7890',
    rating: 4.6,
    distance: '5.0 mi',
    openNow: true,
  },
  {
    id: '6',
    name: 'Pets First Clinic',
    address: '987 Maple Way, Austin, TX 78706',
    phone: '(512) 555-2345',
    rating: 4.4,
    distance: '6.3 mi',
    openNow: false,
  },
  {
    id: '7',
    name: 'Pawsome Pet Care',
    address: '147 Birch Rd, Austin, TX 78707',
    phone: '(512) 555-6789',
    rating: 4.9,
    distance: '7.1 mi',
    openNow: true,
  },
  {
    id: '8',
    name: 'Furry Friends Hospital',
    address: '258 Willow St, Austin, TX 78708',
    phone: '(512) 555-0123',
    rating: 4.2,
    distance: '8.5 mi',
    openNow: true,
  },
  {
    id: '9',
    name: 'Companion Care Vet',
    address: '369 Spruce Ave, Austin, TX 78709',
    phone: '(512) 555-4567',
    rating: 4.7,
    distance: '9.2 mi',
    openNow: false,
  },
  {
    id: '10',
    name: 'Healthy Pets Clinic',
    address: '480 Redwood Dr, Austin, TX 78710',
    phone: '(512) 555-8901',
    rating: 4.5,
    distance: '10.0 mi',
    openNow: true,
  },
];

interface PetQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPet: Pet | null;
  onCreateTask: (task: {
    petId: string;
    petName: string;
    petType: 'dog' | 'cat' | 'other';
    taskType: string;
    clinics: Clinic[];
    additionalNotes: string;
  }) => void;
}

export function PetQuoteDialog({
  open,
  onOpenChange,
  selectedPet,
  onCreateTask,
}: PetQuoteDialogProps) {
  const [step, setStep] = useState(1);
  const [taskType, setTaskType] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [distance, setDistance] = useState([10]);
  const [selectedClinics, setSelectedClinics] = useState<string[]>([]);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [clinicsFound, setClinicsFound] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [hoveredClinic, setHoveredClinic] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const resetForm = () => {
    setStep(1);
    setTaskType('');
    setZipCode('');
    setDistance([10]);
    setSelectedClinics([]);
    setAdditionalNotes('');
    setIsSearching(false);
    setClinicsFound(false);
    setMapLoaded(false);
    setHoveredClinic(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetForm();
  };

  // Load Google Maps script
  useEffect(() => {
    if (step === 2 && clinicsFound && !mapLoaded) {
      const existingScript = document.querySelector(`script[src*="maps.googleapis.com"]`);
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          setMapLoaded(true);
          initializeMap();
        };
        document.head.appendChild(script);
      } else {
        setMapLoaded(true);
        initializeMap();
      }
    }
  }, [step, clinicsFound]);

  const initializeMap = () => {
    if (mapRef.current && window.google) {
      const map = new window.google.maps.Map(mapRef.current, {
        center: { lat: 30.2672, lng: -97.7431 }, // Austin, TX
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }],
          },
        ],
      });

      // Add markers for clinics
      mockClinics.forEach((clinic, index) => {
        const lat = 30.2672 + (Math.random() - 0.5) * 0.1;
        const lng = -97.7431 + (Math.random() - 0.5) * 0.15;
        
        new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: clinic.name,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: selectedClinics.includes(clinic.id) ? '#10b981' : '#6b7280',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });
      });
    }
  };

  const handleSearchClinics = () => {
    setIsSearching(true);
    // Simulate API call
    setTimeout(() => {
      setIsSearching(false);
      setClinicsFound(true);
    }, 1500);
  };

  const toggleClinicSelection = (clinicId: string) => {
    if (selectedClinics.includes(clinicId)) {
      setSelectedClinics(selectedClinics.filter((id) => id !== clinicId));
    } else if (selectedClinics.length < 5) {
      setSelectedClinics([...selectedClinics, clinicId]);
    }
  };

  const getTaskTypeLabel = () => {
    return petTaskTypes.find((t) => t.value === taskType)?.label || taskType;
  };

  const generateCallScript = () => {
    if (!selectedPet) return '';
    const spayStatus =
      selectedPet.spayNeuterStatus === 'yes'
        ? 'spayed/neutered'
        : selectedPet.spayNeuterStatus === 'no'
        ? 'not spayed/neutered'
        : 'unknown spay/neuter status';

    return `Hi, I'm calling to get a quote for ${getTaskTypeLabel().toLowerCase()} for my ${
      selectedPet.species
    }, ${selectedPet.name}.

Pet Details:
• Breed: ${selectedPet.breed || 'Unknown'}
• Age: ${selectedPet.age || 'Unknown'}
• Weight: ${selectedPet.weight || 'Unknown'}
• Sex: ${selectedPet.sex}
• Status: ${spayStatus}
${selectedPet.notes ? `• Notes: ${selectedPet.notes}` : ''}

I'd like to know:
1. The total cost including all fees
2. What's included in the service
3. Your earliest available appointment`;
  };

  const handleStartQuoteTask = () => {
    if (!selectedPet) return;

    const selectedClinicData = mockClinics.filter((c) =>
      selectedClinics.includes(c.id)
    );

    onCreateTask({
      petId: selectedPet.id,
      petName: selectedPet.name,
      petType: selectedPet.species,
      taskType: getTaskTypeLabel(),
      clinics: selectedClinicData,
      additionalNotes,
    });

    handleClose();
  };

  const canProceedStep1 = taskType !== '';
  const canProceedStep2 = selectedClinics.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-700">
            <Sparkles className="w-5 h-5" />
            Find Clinics & Request Quotes
          </DialogTitle>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 rounded-lg mb-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= s
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {step > s ? <CheckCircle2 className="w-5 h-5" /> : s}
              </div>
              <span
                className={`ml-2 text-sm hidden sm:inline ${
                  step >= s ? 'text-emerald-700 font-medium' : 'text-gray-500'
                }`}
              >
                {s === 1 ? 'Task & Location' : s === 2 ? 'Select Clinics' : 'Review & Submit'}
              </span>
              {s < 3 && (
                <ChevronRight className="w-4 h-4 text-gray-400 mx-2 hidden sm:inline" />
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-hidden">
          {/* Step 1: Task Type & Location */}
          {step === 1 && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-6">
                {/* Pet Info Banner */}
                {selectedPet && (
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                    <p className="text-sm text-emerald-700">
                      Getting quote for{' '}
                      <span className="font-semibold">{selectedPet.name}</span> (
                      {selectedPet.breed || selectedPet.species})
                    </p>
                  </div>
                )}

                {/* Task Type Selection */}
                <div>
                  <Label className="text-base font-medium">
                    What do you need a quote for?
                  </Label>
                  <Select value={taskType} onValueChange={setTaskType}>
                    <SelectTrigger className="mt-2 border-emerald-200">
                      <SelectValue placeholder="Select a service type" />
                    </SelectTrigger>
                    <SelectContent>
                      {petTaskTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="w-4 h-4 text-emerald-600" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Location Input */}
                <div>
                  <Label className="text-base font-medium">Your Location</Label>
                  <div className="mt-2 flex gap-2">
                    <div className="relative flex-1">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Enter ZIP code or city"
                        value={zipCode}
                        onChange={(e) => setZipCode(e.target.value)}
                        className="pl-10 border-emerald-200"
                      />
                    </div>
                    <Button 
                      variant="outline" 
                      size="icon"
                      className="border-emerald-200 hover:bg-emerald-50"
                      title="Use current location"
                    >
                      <Navigation className="w-4 h-4 text-emerald-600" />
                    </Button>
                  </div>
                </div>

                {/* Distance Slider */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-base font-medium">Search Distance</Label>
                    <span className="text-sm text-emerald-600 font-medium">
                      {distance[0]} miles
                    </span>
                  </div>
                  <Slider
                    value={distance}
                    onValueChange={setDistance}
                    min={5}
                    max={25}
                    step={5}
                    className="[&_[role=slider]]:bg-emerald-500"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>5 mi</span>
                    <span>25 mi</span>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}

          {/* Step 2: Clinic Selection with Map */}
          {step === 2 && (
            <div className="h-full flex flex-col gap-4">
              {!clinicsFound ? (
                <div className="text-center py-8">
                  <Button
                    onClick={handleSearchClinics}
                    disabled={isSearching}
                    className="bg-emerald-500 hover:bg-emerald-600"
                  >
                    {isSearching ? (
                      <>
                        <Search className="w-4 h-4 mr-2 animate-pulse" />
                        Searching clinics...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 mr-2" />
                        Search for Clinics
                      </>
                    )}
                  </Button>
                  <p className="text-sm text-muted-foreground mt-3">
                    We'll find veterinary clinics within {distance[0]} miles of{' '}
                    {zipCode || 'your location'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Map Section */}
                  <div className="relative rounded-xl overflow-hidden border border-emerald-100 bg-gray-100 h-40 shrink-0">
                    <div ref={mapRef} className="absolute inset-0" />
                    {!mapLoaded && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-50 to-teal-50">
                        <div className="text-center">
                          <MapPin className="w-8 h-8 text-emerald-400 mx-auto mb-2 animate-pulse" />
                          <p className="text-sm text-muted-foreground">Loading map...</p>
                        </div>
                      </div>
                    )}
                    {/* Map overlay with location badge */}
                    <div className="absolute top-3 left-3 z-10">
                      <Badge className="bg-white/95 text-emerald-700 shadow-sm border-0">
                        <MapPin className="w-3 h-3 mr-1" />
                        {zipCode || 'Austin, TX'}
                      </Badge>
                    </div>
                  </div>

                  {/* Clinic List Header */}
                  <div className="flex items-center justify-between shrink-0">
                    <p className="text-sm text-muted-foreground">
                      Found <span className="font-medium text-foreground">{mockClinics.length}</span> clinics near you
                    </p>
                    <Badge
                      variant={selectedClinics.length >= 5 ? 'destructive' : 'secondary'}
                      className={selectedClinics.length >= 5 ? '' : 'bg-emerald-100 text-emerald-700'}
                    >
                      {selectedClinics.length}/5 selected
                    </Badge>
                  </div>

                  {/* Scrollable Clinic List */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="space-y-2 pr-4">
                      {mockClinics.map((clinic) => (
                        <div
                          key={clinic.id}
                          onClick={() => toggleClinicSelection(clinic.id)}
                          onMouseEnter={() => setHoveredClinic(clinic.id)}
                          onMouseLeave={() => setHoveredClinic(null)}
                          className={`p-3 rounded-lg border cursor-pointer transition-all ${
                            selectedClinics.includes(clinic.id)
                              ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                              : hoveredClinic === clinic.id
                              ? 'border-emerald-300 bg-emerald-50/50'
                              : 'border-gray-200 hover:border-emerald-200'
                          } ${
                            selectedClinics.length >= 5 &&
                            !selectedClinics.includes(clinic.id)
                              ? 'opacity-50 cursor-not-allowed'
                              : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedClinics.includes(clinic.id)}
                              disabled={
                                selectedClinics.length >= 5 &&
                                !selectedClinics.includes(clinic.id)
                              }
                              className="mt-0.5 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-medium text-foreground text-sm">
                                  {clinic.name}
                                </h4>
                                <div className="flex items-center gap-2 shrink-0">
                                  {clinic.openNow !== undefined && (
                                    <Badge 
                                      variant="outline" 
                                      className={`text-xs ${
                                        clinic.openNow 
                                          ? 'border-green-200 text-green-700 bg-green-50' 
                                          : 'border-gray-200 text-gray-500'
                                      }`}
                                    >
                                      <Clock className="w-2.5 h-2.5 mr-1" />
                                      {clinic.openNow ? 'Open' : 'Closed'}
                                    </Badge>
                                  )}
                                  <Badge variant="outline" className="text-xs">
                                    {clinic.distance}
                                  </Badge>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {clinic.address}
                              </p>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-xs flex items-center gap-1 text-muted-foreground">
                                  <Phone className="w-3 h-3 text-emerald-500" />
                                  {clinic.phone}
                                </span>
                                <span className="text-xs flex items-center gap-1">
                                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                                  <span className="font-medium">{clinic.rating}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          )}

          {/* Step 3: Review & Submit */}
          {step === 3 && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-6">
                {/* Summary */}
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                  <h4 className="font-medium text-emerald-800 mb-2">
                    Quote Request Summary
                  </h4>
                  <div className="text-sm space-y-1 text-emerald-700">
                    <p>
                      <span className="text-muted-foreground">Pet:</span>{' '}
                      {selectedPet?.name}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Service:</span>{' '}
                      {getTaskTypeLabel()}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Clinics:</span>{' '}
                      {selectedClinics.length} selected
                    </p>
                  </div>
                </div>

                {/* Selected Clinics Preview */}
                <div>
                  <Label className="text-base font-medium">Selected Clinics</Label>
                  <div className="mt-2 space-y-2">
                    {mockClinics
                      .filter((c) => selectedClinics.includes(c.id))
                      .map((clinic) => (
                        <div
                          key={clinic.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm"
                        >
                          <div>
                            <p className="font-medium">{clinic.name}</p>
                            <p className="text-xs text-muted-foreground">{clinic.address}</p>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                            {clinic.rating}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Additional Notes */}
                <div>
                  <Label className="text-base font-medium">
                    Additional Information
                  </Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    Add any specific requirements (available times, price range,
                    insurance info, etc.)
                  </p>
                  <Textarea
                    placeholder="e.g., Available weekdays after 3pm, budget around $200-300, have pet insurance with Trupanion..."
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    className="min-h-24 border-emerald-200"
                  />
                </div>

                {/* Call Script Preview */}
                <div>
                  <Label className="text-base font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-500" />
                    Call/Message Script Preview
                  </Label>
                  <div className="mt-2 p-4 bg-gray-50 rounded-lg border text-sm whitespace-pre-line font-mono">
                    {generateCallScript()}
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex justify-between pt-4 border-t mt-4 shrink-0">
          <Button
            variant="outline"
            onClick={() => (step > 1 ? setStep(step - 1) : handleClose())}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          {step < 3 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
              className="bg-emerald-500 hover:bg-emerald-600"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleStartQuoteTask}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Start Quote Request
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Add Google Maps type declarations
declare global {
  interface Window {
    google: any;
  }
}
