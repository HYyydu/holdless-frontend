import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  CheckCircle, 
  XCircle, 
  DollarSign, 
  Calendar, 
  FileText, 
  Download,
  ChevronDown,
  ChevronRight,
  User,
  Headphones
} from "lucide-react";
import { ActivityItem } from "./ActivityCard";
import { useState } from "react";

interface ActivityDetailsDialogProps {
  activity: ActivityItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Sample transcript for demo
const sampleTranscript = [
  { speaker: 'agent', text: 'Thank you for calling, this is Sarah. How can I help you today?', timestamp: '10:23 AM' },
  { speaker: 'customer', text: 'Hi, I need to return some shoes I ordered. They sent me the wrong size.', timestamp: '10:23 AM' },
  { speaker: 'agent', text: 'I\'d be happy to help you with that return. Can you provide me with your order number?', timestamp: '10:24 AM' },
  { speaker: 'customer', text: 'Yes, it\'s 112-9876543-2109876', timestamp: '10:24 AM' },
  { speaker: 'agent', text: 'Perfect, I can see your order here. You ordered size 9 but need size 10, is that correct?', timestamp: '10:25 AM' },
  { speaker: 'customer', text: 'Exactly! Same style and color, just size 10.', timestamp: '10:25 AM' },
  { speaker: 'agent', text: 'Great! I\'ve processed an exchange for you. You\'ll receive a return label via email, and once we receive the shoes, we\'ll send out the size 10.', timestamp: '10:26 AM' },
  { speaker: 'customer', text: 'Perfect! Thank you so much for your help.', timestamp: '10:26 AM' },
  { speaker: 'agent', text: 'You\'re welcome! Is there anything else I can help you with today?', timestamp: '10:27 AM' },
  { speaker: 'customer', text: 'No, that\'s everything. Have a great day!', timestamp: '10:27 AM' }
];

const getSpeakerIcon = (speaker: string) => {
  return speaker === 'agent' ? Headphones : User;
};

const getSpeakerName = (speaker: string) => {
  return speaker === 'agent' ? 'Support Agent' : 'You';
};

const getEntryStyle = (speaker: string) => {
  return speaker === 'agent' 
    ? 'bg-muted/30 border-l-4 border-l-primary' 
    : 'bg-accent/10 border-l-4 border-l-accent ml-8';
};

const downloadDocument = (activity: ActivityItem) => {
  // Simulate download
  const filename = activity.outcome?.type === 'document' ? 'return-label.pdf' : 'document.pdf';
  console.log(`Downloading ${filename} for activity: ${activity.title}`);
  
  // Create a temporary download
  const blob = new Blob(['Sample document content'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export function ActivityDetailsDialog({ activity, open, onOpenChange }: ActivityDetailsDialogProps) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  if (!activity) return null;

  const getStatusIcon = () => {
    switch (activity.type) {
      case 'task_completed':
        return <CheckCircle className="w-5 h-5 text-accent" />;
      case 'task_failed':
        return <XCircle className="w-5 h-5 text-destructive" />;
      case 'refund_issued':
        return <DollarSign className="w-5 h-5 text-accent" />;
      case 'appointment_scheduled':
        return <Calendar className="w-5 h-5 text-primary" />;
      case 'document_received':
        return <FileText className="w-5 h-5 text-primary" />;
      default:
        return <CheckCircle className="w-5 h-5 text-accent" />;
    }
  };

  const getStatusText = () => {
    switch (activity.type) {
      case 'task_completed':
        return 'Completed';
      case 'task_failed':
        return 'Failed';
      case 'refund_issued':
        return 'Refund Issued';
      case 'appointment_scheduled':
        return 'Scheduled';
      case 'document_received':
        return 'Document Ready';
      default:
        return 'Completed';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <div className="font-semibold">{activity.title}</div>
              <div className="text-sm font-normal text-muted-foreground">{activity.vendor}</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6">
            {/* Activity Details */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <div className="flex items-center gap-2 mt-1">
                    {getStatusIcon()}
                    <Badge variant="outline">{getStatusText()}</Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Date</label>
                  <div className="mt-1">{activity.timestamp.toLocaleString()}</div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <div className="mt-1">{activity.description}</div>
              </div>
            </div>

            <Separator />

            {/* Outcome Details */}
            {activity.outcome && (
              <div className="space-y-4">
                <h3 className="font-medium">Outcome Details</h3>
                
                {activity.outcome.type === 'refund' && (
                  <div className="p-4 bg-accent/10 rounded-lg border">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-4 h-4 text-accent" />
                      <span className="font-medium">Refund Processed</span>
                    </div>
                    <div className="text-2xl font-bold text-accent mb-1">{activity.outcome.amount}</div>
                    {activity.outcome.caseNumber && (
                      <div className="text-sm text-muted-foreground">
                        Case Number: {activity.outcome.caseNumber}
                      </div>
                    )}
                  </div>
                )}

                {activity.outcome.type === 'appointment' && activity.outcome.date && (
                  <div className="p-4 bg-primary/10 rounded-lg border">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-primary" />
                      <span className="font-medium">Appointment Scheduled</span>
                    </div>
                    <div className="font-medium">
                      {activity.outcome.date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {activity.outcome.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )}

                {activity.outcome.type === 'document' && (
                  <div className="p-4 bg-primary/10 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <FileText className="w-4 h-4 text-primary" />
                          <span className="font-medium">Return Label Ready</span>
                        </div>
                        {activity.outcome.caseNumber && (
                          <div className="text-sm text-muted-foreground">
                            Case Number: {activity.outcome.caseNumber}
                          </div>
                        )}
                      </div>
                      <Button 
                        onClick={() => downloadDocument(activity)}
                        className="flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Download Return Label
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Transcript Section */}
            {activity.transcriptUrl && (
              <>
                <Separator />
                <div className="space-y-4">
                  <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span className="flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Call Transcript
                        </span>
                        {transcriptOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4">
                      <div className="space-y-3 max-h-80 overflow-y-auto">
                        {sampleTranscript.map((entry, index) => {
                          const SpeakerIcon = getSpeakerIcon(entry.speaker);
                          return (
                            <div key={index} className={`p-3 rounded-lg ${getEntryStyle(entry.speaker)}`}>
                              <div className="flex items-start gap-3">
                                <SpeakerIcon className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium text-foreground">
                                      {getSpeakerName(entry.speaker)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {entry.timestamp}
                                    </span>
                                  </div>
                                  <p className="text-sm text-foreground leading-relaxed">
                                    {entry.text}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}