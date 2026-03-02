import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Phone,
  Star,
  Calendar,
  DollarSign,
  CheckCircle2,
  Clock,
  Lightbulb,
} from 'lucide-react';
import { WinData } from '@/components/HoldlessWinModal';

interface ClinicQuote {
  id: string;
  name: string;
  address: string;
  phone: string;
  rating: number;
  estimatedPrice?: string;
  notes?: string;
  availability?: string;
  status: 'pending' | 'received' | 'no_response';
}

interface PetTaskDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: {
    id: string;
    petName: string;
    service: string;
    status: string;
    clinics: ClinicQuote[];
    createdAt: Date;
  } | null;
  onBookAppointment?: (taskId: string, clinicName: string, winData: WinData) => void;
}

// Mock quote data for demonstration
const mockQuotes: Record<string, ClinicQuote[]> = {
  '1': [
    {
      id: '1',
      name: 'Happy Paws Veterinary',
      address: '123 Main St, Austin, TX 78701',
      phone: '(512) 555-1234',
      rating: 4.8,
      estimatedPrice: '$85 - $120',
      notes: 'Includes exam, vaccines, and fecal test',
      availability: 'Next available: Feb 3, 2pm',
      status: 'received',
    },
    {
      id: '2',
      name: 'City Pet Hospital',
      address: '456 Oak Ave, Austin, TX 78702',
      phone: '(512) 555-5678',
      rating: 4.5,
      estimatedPrice: '$95 - $130',
      notes: 'Exam and core vaccines only',
      availability: 'Next available: Feb 5, 10am',
      status: 'received',
    },
    {
      id: '3',
      name: 'PetVet Clinic',
      address: '789 Elm Blvd, Austin, TX 78703',
      phone: '(512) 555-9012',
      rating: 4.7,
      status: 'pending',
    },
  ],
  '2': [
    {
      id: '1',
      name: 'City Pet Hospital',
      address: '456 Oak Ave, Austin, TX 78702',
      phone: '(512) 555-5678',
      rating: 4.5,
      estimatedPrice: '$250 - $400',
      notes: 'Full dental with anesthesia, cleaning, and X-rays',
      availability: 'Consultation needed first',
      status: 'received',
    },
  ],
};

export function PetTaskDetailsDialog({
  open,
  onOpenChange,
  task,
  onBookAppointment,
}: PetTaskDetailsDialogProps) {
  if (!task) return null;

  const quotes = mockQuotes[task.id] || [];
  const receivedQuotes = quotes.filter((q) => q.status === 'received');
  const pendingQuotes = quotes.filter((q) => q.status === 'pending');
  const lowestPrice = receivedQuotes.length > 0
    ? receivedQuotes
        .map((q) => q.estimatedPrice?.split(' - ')[0].replace('$', '') || '999')
        .sort((a, b) => parseFloat(a) - parseFloat(b))[0]
    : null;

  // Find cheapest clinic for display
  const cheapestClinic = receivedQuotes.length > 0
    ? receivedQuotes.reduce((prev, curr) => {
        const prevPrice = parseFloat(prev.estimatedPrice?.split(' - ')[0].replace('$', '') || '999');
        const currPrice = parseFloat(curr.estimatedPrice?.split(' - ')[0].replace('$', '') || '999');
        return prevPrice < currPrice ? prev : curr;
      })
    : null;

  const handleBookAppointment = (clinic: ClinicQuote) => {
    // Generate win data for pet task - matching user's example format
    const lowestPriceFormatted = clinic.estimatedPrice?.split(' - ')[0] || "Best price";
    
    const winDataForPet: WinData = {
      headline: `Best ${task.service.toLowerCase().split(' ')[0]} quote found`,
      whatHappened: `Holdless called ${quotes.length} clinics and compared ${task.service.toLowerCase()} pricing + included services.`,
      timeSaved: "45 min",
      bestQuote: lowestPriceFormatted,
      priceRange: clinic.estimatedPrice,
      topClinicName: clinic.name,
      proof: `${clinic.name} — ${lowestPriceFormatted}`,
      proofLabel: "Best Deal",
    };
    
    // Trigger parent callback with win data
    if (onBookAppointment) {
      onBookAppointment(task.id, clinic.name, winDataForPet);
    }
    
    onOpenChange(false);
  };

  const getStatusBadge = (status: ClinicQuote['status']) => {
    switch (status) {
      case 'received':
        return (
          <Badge className="bg-green-100 text-green-700 border-green-200">
            Quote Received
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200">
            Pending
          </Badge>
        );
      case 'no_response':
        return (
          <Badge className="bg-gray-100 text-gray-700 border-gray-200">
            No Response
          </Badge>
        );
    }
  };

  const getRecommendation = () => {
    if (receivedQuotes.length === 0) {
      return "We're still collecting quotes from clinics. You'll be notified when responses come in.";
    }
    
    const cheapest = receivedQuotes.reduce((prev, curr) => {
      const prevPrice = parseFloat(prev.estimatedPrice?.split(' - ')[0].replace('$', '') || '999');
      const currPrice = parseFloat(curr.estimatedPrice?.split(' - ')[0].replace('$', '') || '999');
      return prevPrice < currPrice ? prev : curr;
    });

    const bestRated = receivedQuotes.reduce((prev, curr) => 
      curr.rating > prev.rating ? curr : prev
    );

    if (cheapest.id === bestRated.id) {
      return `${cheapest.name} offers the best value with competitive pricing and highest ratings. Consider booking with them.`;
    }

    return `For best price, consider ${cheapest.name} (starting at ${cheapest.estimatedPrice?.split(' - ')[0]}). For highest rated service, ${bestRated.name} has ${bestRated.rating} stars.`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Quote Details: {task.service}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {/* Task Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-emerald-50 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Pet</p>
              <p className="font-medium">{task.petName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Service</p>
              <p className="font-medium">{task.service}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Quotes Received</p>
              <p className="font-medium">
                {receivedQuotes.length} of {quotes.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Lowest Price</p>
              <p className="font-medium text-emerald-600">
                {lowestPrice ? `$${lowestPrice}` : 'Pending'}
              </p>
            </div>
          </div>

          {/* Quote Comparison Table */}
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              Clinic Comparison
            </h3>
            
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Clinic</TableHead>
                    <TableHead className="font-semibold">
                      Estimated Price
                    </TableHead>
                    <TableHead className="font-semibold">What's Included</TableHead>
                    <TableHead className="font-semibold">Availability</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((clinic) => (
                    <TableRow key={clinic.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{clinic.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                              {clinic.rating}
                            </span>
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {clinic.phone}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {clinic.estimatedPrice ? (
                          <span className="font-semibold text-emerald-600">
                            {clinic.estimatedPrice}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {clinic.notes || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {clinic.availability ? (
                          <div className="flex items-center gap-1 text-sm">
                            <Calendar className="w-3 h-3 text-emerald-500" />
                            {clinic.availability}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(clinic.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pending Clinics */}
          {pendingQuotes.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
              <Clock className="w-4 h-4 text-amber-600" />
              <p className="text-sm text-amber-700">
                Waiting for responses from {pendingQuotes.length} clinic
                {pendingQuotes.length > 1 ? 's' : ''}: {' '}
                {pendingQuotes.map((q) => q.name).join(', ')}
              </p>
            </div>
          )}

          {/* Recommendation */}
          <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg border border-emerald-100">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Lightbulb className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h4 className="font-medium text-emerald-800 mb-1">
                  Recommended Next Step
                </h4>
                <p className="text-sm text-emerald-700">{getRecommendation()}</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {receivedQuotes.length > 0 && task.status !== 'resolved' && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Book an appointment:</p>
              <div className="flex flex-wrap gap-2">
                {receivedQuotes.map((clinic) => (
                  <Button
                    key={clinic.id}
                    size="sm"
                    className="bg-emerald-500 hover:bg-emerald-600 text-white"
                    onClick={() => handleBookAppointment(clinic)}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Book {clinic.name.split(' ')[0]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t mt-4">
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
