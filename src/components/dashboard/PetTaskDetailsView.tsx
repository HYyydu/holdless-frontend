import { useState } from 'react';
import { ArrowLeft, Phone, FileText, MapPin, Clock, CheckCircle, RefreshCw, AlertCircle, Calendar } from 'lucide-react';
import { HoldlessWinModal, WinData } from '@/components/HoldlessWinModal';
import { LiveTranscriptModal } from './LiveTranscriptModal';

interface ClinicQuote {
  id: string;
  name: string;
  distance: string;
  quote?: string;
  includes?: string;
  status: 'resolved' | 'ongoing' | 'fail';
  callDuration?: string;
  note?: string;
}

interface PetTaskDetailsViewProps {
  onBack: () => void;
}

const initialClinicQuotes: ClinicQuote[] = [
  {
    id: '1',
    name: 'VCA Animal Hospital',
    distance: '0.8 miles',
    quote: '$1200',
    includes: 'Includes pain medication and follow-up visit',
    status: 'resolved',
    callDuration: '2:15',
  },
  {
    id: '2',
    name: 'Pet Care Center',
    distance: '1.2 miles',
    status: 'ongoing',
    note: 'Currently calling clinic...',
  },
  {
    id: '3',
    name: 'Mission Bay Veterinary',
    distance: '1.5 miles',
    quote: '$310',
    includes: 'Premium service with 24/7 post-op support',
    status: 'resolved',
    callDuration: '3:20',
  },
  {
    id: '4',
    name: 'Sunset Animal Clinic',
    distance: '2.1 miles',
    status: 'fail',
    note: 'No one answered',
  },
  {
    id: '5',
    name: 'Bay Area Pet Hospital',
    distance: '2.3 miles',
    status: 'fail',
    note: 'Unable to connect',
  },
];

const StatusBadge = ({ status }: { status: ClinicQuote['status'] }) => {
  const config = {
    resolved: { label: 'Resolved', className: 'bg-green-50 text-green-600 border-green-200' },
    ongoing: { label: 'Ongoing', className: 'bg-blue-50 text-blue-600 border-blue-200' },
    fail: { label: 'Fail', className: 'bg-red-50 text-red-600 border-red-200' },
  };
  const { label, className } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${className}`}>
      {status === 'resolved' && <CheckCircle className="w-3 h-3" />}
      {status === 'ongoing' && <RefreshCw className="w-3 h-3" />}
      {status === 'fail' && <AlertCircle className="w-3 h-3" />}
      {label}
    </span>
  );
};

interface ClinicCardProps {
  clinic: ClinicQuote;
  onWatchTranscript?: (clinicId: string) => void;
}

const ClinicCard = ({ clinic, onWatchTranscript }: ClinicCardProps) => {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-semibold text-gray-900">{clinic.name}</h4>
          <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
            <MapPin className="w-3.5 h-3.5" />
            <span>{clinic.distance}</span>
          </div>
        </div>
        {clinic.quote && (
          <div className="text-right">
            <p className="text-xl font-bold text-gray-900">{clinic.quote}</p>
            {clinic.callDuration && (
              <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                <Clock className="w-3 h-3" />
                <span>{clinic.callDuration}</span>
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="mb-3">
        <StatusBadge status={clinic.status} />
      </div>
      
      {clinic.includes && (
        <p className="text-sm text-gray-600 mb-4">{clinic.includes}</p>
      )}
      
      {clinic.note && clinic.status !== 'resolved' && (
        <p className="text-sm text-gray-500 mb-4">{clinic.note}</p>
      )}
      
      {clinic.status === 'ongoing' && (
        <>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
            <div className="bg-blue-500 h-1.5 rounded-full w-2/3 animate-pulse" />
          </div>
          <button 
            onClick={() => onWatchTranscript?.(clinic.id)}
            className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2.5 rounded-lg font-medium hover:bg-blue-600 transition-colors"
          >
            <Phone className="w-4 h-4" />
            Watch live transcript
          </button>
        </>
      )}
      
      {clinic.status === 'resolved' && (
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors">
            <FileText className="w-4 h-4" />
            <span>View Call Script</span>
          </button>
          <button className="flex-shrink-0 flex items-center justify-center w-10 h-10 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <Calendar className="w-4 h-4 text-gray-600" />
          </button>
          <button className="flex-1 flex items-center justify-center gap-2 bg-gray-900 text-white py-2.5 px-4 rounded-lg font-medium hover:bg-gray-800 transition-colors">
            Make an appointment
          </button>
        </div>
      )}
      
      {clinic.status === 'fail' && (
        <button className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white py-2.5 rounded-lg font-medium hover:bg-gray-800 transition-colors">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
};

export function PetTaskDetailsView({ onBack }: PetTaskDetailsViewProps) {
  const [showWinModal, setShowWinModal] = useState(false);
  const [clinicQuotes, setClinicQuotes] = useState<ClinicQuote[]>(initialClinicQuotes);
  const [showTranscript, setShowTranscript] = useState(false);
  const [activeClinicId, setActiveClinicId] = useState<string | null>(null);
  
  const quotesReceived = clinicQuotes.filter(c => c.status === 'resolved').length;
  const noResponse = clinicQuotes.filter(c => c.status === 'fail').length;
  const totalCalled = clinicQuotes.length;
  
  const activeClinic = clinicQuotes.find(c => c.id === activeClinicId);
  
  const petWinData: WinData = {
    headline: "Best Quote Found! 🐱",
    whatHappened: `Holdless called ${totalCalled} clinics and compared spay surgery pricing + included services for your pet.`,
    timeSaved: "45 min",
    priceRange: "$189 - $1200",
    bestQuote: "$189",
    topClinicName: "Pet Care Center",
    proof: "Pet Care Center",
    proofLabel: "Top Clinic",
    vendor: "Pet Care",
  };
  
  const handleReturn = () => {
    setShowWinModal(true);
  };
  
  const handleCloseWinModal = (open: boolean) => {
    setShowWinModal(open);
    if (!open) {
      onBack();
    }
  };

  const handleWatchTranscript = (clinicId: string) => {
    setActiveClinicId(clinicId);
    setShowTranscript(true);
  };

  const handleCallComplete = (quote: string, includes: string, callDuration: string) => {
    if (activeClinicId) {
      setClinicQuotes(prev => prev.map(clinic => 
        clinic.id === activeClinicId 
          ? { 
              ...clinic, 
              status: 'resolved' as const, 
              quote, 
              includes, 
              callDuration,
              note: undefined 
            }
          : clinic
      ));
    }
    setActiveClinicId(null);
  };
  
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50">
      {/* Win Modal */}
      <HoldlessWinModal 
        open={showWinModal} 
        onOpenChange={handleCloseWinModal}
        winData={petWinData}
      />

      {/* Live Transcript Modal */}
      <LiveTranscriptModal
        open={showTranscript}
        onOpenChange={setShowTranscript}
        clinicName={activeClinic?.name || ''}
        onCallComplete={handleCallComplete}
      />
      
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-white border-b border-gray-100">
        <button
          onClick={handleReturn}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>
        <Phone className="w-5 h-5 text-gray-600" />
        <h1 className="text-lg font-semibold text-gray-900">Task Details - Get a Quote (Pet Clinic)</h1>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Client Request Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Client Request</h2>
              </div>
              
              <div className="space-y-5">
                <div>
                  <p className="text-sm text-gray-500">Service Type</p>
                  <p className="font-medium text-gray-900">Spay Surgery</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pet Type</p>
                  <p className="font-medium text-gray-900">Cat</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Location</p>
                  <p className="font-medium text-gray-900">San Francisco, CA</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Clinics Called</p>
                  <p className="font-medium text-gray-900">{totalCalled} clinics</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-green-50 text-green-600 border border-green-200">
                    <CheckCircle className="w-3 h-3" />
                    Completed
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Created</p>
                  <p className="font-medium text-gray-900">2/2/2026, 4:00:00 PM</p>
                </div>
              </div>
            </div>
            
            {/* Summary Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
              </div>
              
              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="border border-green-100 bg-green-50/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{quotesReceived}</p>
                  <p className="text-xs text-green-600">Quotes Received</p>
                </div>
                <div className="border border-red-100 bg-red-50/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-red-500">{noResponse}</p>
                  <p className="text-xs text-red-500">No Response</p>
                </div>
                <div className="border border-blue-100 bg-blue-50/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{totalCalled}</p>
                  <p className="text-xs text-blue-600">Total Called</p>
                </div>
              </div>
              
              {/* Price Range */}
              <div className="mb-6">
                <p className="text-sm text-gray-500 mb-1">Price Range</p>
                <p className="text-3xl font-bold text-gray-900">
                  $189 <span className="text-lg font-normal text-gray-400">to</span> $1200
                </p>
              </div>
              
              {/* Best Value */}
              <div className="bg-green-50 border border-green-100 rounded-xl p-4 mb-6">
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Best Value</p>
                <p className="font-semibold text-gray-900">Pet Care Center - $189</p>
                <p className="text-sm text-gray-600">Lowest price among responding clinics</p>
              </div>
              
              {/* Current Result */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500 mb-2">Current Result</p>
                <p className="text-sm text-gray-700">
                  Successfully contacted {quotesReceived} out of {totalCalled} clinics. Price quotes range from $189 to $1200. Pet Care Center offers the most competitive rate.
                </p>
              </div>
            </div>
          </div>
          
          {/* Right Column - Clinic Quotes */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Phone className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Clinic Quotes</h2>
            </div>
            
            <div className="space-y-4">
              {clinicQuotes.map((clinic) => (
                <ClinicCard 
                  key={clinic.id} 
                  clinic={clinic} 
                  onWatchTranscript={handleWatchTranscript}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
