import { useState } from 'react';
import { Star, Phone, CheckCircle, Clock, MapPin, XCircle, Sparkles } from 'lucide-react';

interface ClinicQuote {
  id: string;
  name: string;
  quote: string;
  includes: string[];
  availability: string;
  recommended?: boolean;
  noAnswer?: boolean;
}

interface PetCheckupTaskCardProps {
  petName: string;
  zipCode: string;
  clinics: ClinicQuote[];
  noAnswerClinics?: { name: string; note: string }[];
  recommendation: string;
  onBookAppointment?: () => void;
}

const ClinicCard = ({ clinic, isRecommended }: { clinic: ClinicQuote; isRecommended?: boolean }) => (
  <div className={`bg-white border rounded-xl p-4 ${isRecommended ? 'border-green-300 ring-1 ring-green-100' : 'border-gray-200'}`}>
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-2">
        <h4 className="font-medium text-gray-900">{clinic.name}</h4>
        {isRecommended && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-full">
            <Sparkles className="w-3 h-3" />
            Recommended
          </span>
        )}
      </div>
      <span className="text-lg font-semibold text-gray-900">{clinic.quote}</span>
    </div>
    
    <div className="space-y-2 text-sm">
      <div className="flex items-start gap-2">
        <CheckCircle className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
        <span className="text-gray-600">
          Includes: {clinic.includes.join(', ')}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <Clock className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
        <span className="text-gray-600">{clinic.availability}</span>
      </div>
    </div>
  </div>
);

const NoAnswerCard = ({ name, note }: { name: string; note: string }) => (
  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
    <div className="flex items-start gap-2">
      <XCircle className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
      <div>
        <span className="font-medium text-gray-700">{name}</span>
        <p className="text-sm text-gray-500 mt-0.5">{note}</p>
      </div>
    </div>
  </div>
);

export function PetCheckupTaskCard({
  petName,
  zipCode,
  clinics,
  noAnswerClinics = [],
  recommendation,
  onBookAppointment,
}: PetCheckupTaskCardProps) {
  const [expanded, setExpanded] = useState(true);
  const recommendedClinic = clinics.find(c => c.recommended);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-medium text-gray-900">Pet check-up quotes – {petName} ({zipCode})</h3>
            <p className="text-sm text-gray-500 mt-1">Here's what I found from the clinics you selected:</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border bg-green-50 text-green-600 border-green-200">
            <CheckCircle className="w-3.5 h-3.5" />
            Completed
          </span>
        </div>
      </div>

      {/* Clinic Cards */}
      <div className="p-5 space-y-3">
        {clinics.map((clinic) => (
          <ClinicCard 
            key={clinic.id} 
            clinic={clinic} 
            isRecommended={clinic.recommended} 
          />
        ))}

        {/* No Answer Section */}
        {noAnswerClinics.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Did not answer
            </p>
            {noAnswerClinics.map((clinic, idx) => (
              <NoAnswerCard key={idx} name={clinic.name} note={clinic.note} />
            ))}
          </div>
        )}
      </div>

      {/* Recommendation */}
      <div className="px-5 pb-5">
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-gray-200">
              <Sparkles className="w-4 h-4 text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">My Recommendation</p>
              <p className="text-sm text-gray-600 mt-1">{recommendation}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Button */}
      {onBookAppointment && (
        <div className="px-5 pb-5">
          <button
            onClick={onBookAppointment}
            className="w-full py-3 px-4 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 transition-colors"
          >
            Book this appointment for me
          </button>
        </div>
      )}
    </div>
  );
}
