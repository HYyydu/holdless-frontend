import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import { 
  Phone, 
  MessageCircle, 
  Clock, 
  User, 
  Bot, 
  FileText, 
  Download,
  Paperclip,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { Task } from "./TaskCard";

interface TranscriptEntry {
  id: string;
  timestamp: Date;
  speaker: 'ai_assistant' | 'customer_rep' | 'system';
  message: string;
  type?: 'verification' | 'hold_start' | 'hold_end' | 'resolution' | 'normal';
}

interface TaskDetailsDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Sample transcript data
const sampleTranscript: TranscriptEntry[] = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    speaker: 'system',
    message: 'Call initiated to Whole Foods customer service',
    type: 'normal'
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000),
    speaker: 'customer_rep',
    message: 'Thank you for calling Whole Foods, this is Maria. How can I help you today?'
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45000),
    speaker: 'ai_assistant',
    message: "Hi Maria, I'm calling as Sarah Chen's authorized assistant. She asked me to help with order #113-1234567-8910112 that was delivered yesterday. Some strawberries in the order arrived damaged and moldy."
  },
  {
    id: '4',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 60000),
    speaker: 'customer_rep',
    message: "I'm sorry to hear about that. Let me look up the order. Can you verify the email address on the account?"
  },
  {
    id: '5',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 75000),
    speaker: 'ai_assistant',
    message: "The email on file ends with @email.com and the delivery address is in Los Angeles, ZIP 90007."
  },
  {
    id: '6',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 90000),
    speaker: 'customer_rep',
    message: "Perfect, I found the order. I can see the Driscoll's strawberries for $4.99. What would you like me to do about the damaged item?"
  },
  {
    id: '7',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 105000),
    speaker: 'ai_assistant',
    message: "Sarah would like a full refund to her original payment method. She doesn't need store credit or a replacement."
  },
  {
    id: '8',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 600000),
    speaker: 'system',
    message: 'Put on hold - waiting for supervisor approval',
    type: 'hold_start'
  },
  {
    id: '9',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1200000),
    speaker: 'system',
    message: 'Representative returned from hold',
    type: 'hold_end'
  },
  {
    id: '10',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1215000),
    speaker: 'customer_rep',
    message: "Thank you for waiting. I've processed a full refund of $4.99 to the original payment method. The refund should appear within 3-5 business days. Your case number is WF789012."
  },
  {
    id: '11',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1230000),
    speaker: 'ai_assistant',
    message: "Thank you Maria, that's exactly what Sarah was hoping for. Is there anything else needed from our end?"
  },
  {
    id: '12',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1245000),
    speaker: 'customer_rep',
    message: "No, that takes care of everything. Have a great day!"
  },
  {
    id: '13',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1260000),
    speaker: 'system',
    message: 'Call completed successfully - refund processed',
    type: 'resolution'
  }
];

export function TaskDetailsDialog({ task, open, onOpenChange }: TaskDetailsDialogProps) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  
  if (!task) return null;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getSpeakerIcon = (speaker: string) => {
    switch (speaker) {
      case 'ai_assistant': return <Bot className="w-4 h-4 text-primary" />;
      case 'customer_rep': return <User className="w-4 h-4 text-accent" />;
      case 'system': return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
      default: return <MessageCircle className="w-4 h-4" />;
    }
  };

  const getSpeakerName = (speaker: string) => {
    switch (speaker) {
      case 'ai_assistant': return 'AI Assistant';
      case 'customer_rep': return 'Customer Rep';
      case 'system': return 'System';
      default: return speaker;
    }
  };

  const getEntryStyle = (type?: string) => {
    switch (type) {
      case 'hold_start':
      case 'hold_end':
        return 'bg-warning/10 border-warning/20';
      case 'resolution':
        return 'bg-accent/10 border-accent/20';
      case 'verification':
        return 'bg-primary/10 border-primary/20';
      default:
        return 'bg-card border-border';
    }
  };

  const downloadTranscript = () => {
    if (!task.transcript) return;
    
    const blob = new Blob([task.transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${task.vendor}-${task.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const parseTranscriptForDisplay = (transcript: string) => {
    return transcript.split('\n').map((line, index) => {
      const match = line.match(/^\[(\d{2}:\d{2})\] (\w+): (.+)$/);
      if (match) {
        const [, time, speaker, message] = match;
        return {
          id: index.toString(),
          time,
          speaker: speaker.toLowerCase(),
          message
        };
      }
      return null;
    }).filter(Boolean);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Task Details - {task.vendor}
          </DialogTitle>
        </DialogHeader>

        <div className={`grid grid-cols-1 gap-6 h-full ${
          task.status === 'resolved' || task.status === 'failed' 
            ? 'lg:grid-cols-2' 
            : 'lg:grid-cols-3'
        }`}>
          {/* Client Request Summary */}
          <div className="space-y-4">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Client Request
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Vendor</label>
                  <p className="font-semibold">{task.vendor}</p>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Issue Type</label>
                  <p>{task.issue}</p>
                </div>
                
                {task.orderNumber && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Order Number</label>
                    <p className="font-mono text-sm">#{task.orderNumber}</p>
                  </div>
                )}
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Desired Outcome</label>
                  <p>{task.desiredOutcome}</p>
                </div>
                {task.billDetails && (
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Bill Details</label>
                    {task.billDetails.companyProviderName && <p className="text-sm"><strong>Provider:</strong> {task.billDetails.companyProviderName}</p>}
                    {task.billDetails.billAmount && <p className="text-sm"><strong>Amount:</strong> {task.billDetails.billAmount}</p>}
                    {task.billDetails.invoiceNumber && (
                      <p className="text-sm"><strong>Invoice:</strong> {task.billDetails.invoiceNumber}</p>
                    )}
                    {task.billDetails.accountNumber && (
                      <p className="text-sm"><strong>Account:</strong> {task.billDetails.accountNumber}</p>
                    )}
                    {task.billDetails.accountOrInvoiceNumber &&
                      !task.billDetails.invoiceNumber &&
                      !task.billDetails.accountNumber && (
                        <p className="text-sm"><strong>Account/Invoice:</strong> {task.billDetails.accountOrInvoiceNumber}</p>
                      )}
                    {task.billDetails.billDueDate && <p className="text-sm"><strong>Due Date:</strong> {task.billDetails.billDueDate}</p>}
                    {task.billDetails.chargeOrServiceDate && <p className="text-sm"><strong>Service Date:</strong> {task.billDetails.chargeOrServiceDate}</p>}
                  </div>
                )}
                {Array.isArray(task.attachments) && task.attachments.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Uploaded Documents</label>
                    <div className="mt-1 space-y-1">
                      {task.attachments.map((attachment) => (
                        <div key={attachment.path} className="text-sm flex items-center gap-2">
                          <Paperclip className="w-3 h-3 text-muted-foreground" />
                          <span>{attachment.fileName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <Badge variant={task.status === 'resolved' ? 'default' : 'warning'}>
                    {task.status === 'resolved' ? 'Completed' : 'In Progress'}
                  </Badge>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Created</label>
                  <p className="text-sm">{task.createdAt.toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>

            {/* Call Summary */}
            {task.callSummary && (
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-lg">Call Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Duration:</span>
                    <span>{task.callSummary.duration}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Hold Time:</span>
                    <span>{task.callSummary.holdTime}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Resolution:</span>
                    <span className="text-accent font-medium">{task.callSummary.resolution}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Case #:</span>
                    <span className="font-mono">{task.callSummary.caseNumber}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Transcript Section */}
            <Card className="shadow-card">
              <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-accent/5 transition-colors">
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4" />
                        Transcript (View)
                      </span>
                      {transcriptOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    {task.transcript ? (
                      <div className="space-y-4">
                        <ScrollArea className="h-[300px]">
                          <div className="space-y-3">
                            {parseTranscriptForDisplay(task.transcript).map((entry, index) => (
                              <div key={index} className="flex gap-3 text-sm">
                                <span className="text-muted-foreground font-mono text-xs mt-1 min-w-[45px]">
                                  {entry?.time}
                                </span>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    {entry?.speaker === 'ai' && <Bot className="w-3 h-3 text-primary" />}
                                    {entry?.speaker === 'agent' && <User className="w-3 h-3 text-accent" />}
                                    {entry?.speaker === 'system' && <AlertCircle className="w-3 h-3 text-muted-foreground" />}
                                    <span className="font-medium text-xs">
                                      {entry?.speaker === 'ai' ? 'AI Assistant' : 
                                       entry?.speaker === 'agent' ? 'Customer Rep' : 
                                       'System'}
                                    </span>
                                  </div>
                                  <p className="leading-relaxed">{entry?.message}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                        <Button variant="outline" className="w-full" onClick={downloadTranscript}>
                          <Download className="w-4 h-4 mr-2" />
                          Download Transcript
                        </Button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-4">
                        No transcript yet—click Take Action to simulate this call.
                      </p>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>

          {/* Task Actions */}
          <div className="space-y-4">
            {task.status !== 'resolved' && task.status !== 'failed' && (
              <Card className="shadow-card">
                <CardContent className="p-4">
                  <div className="text-center space-y-3">
                    <h3 className="font-semibold">Ready to resolve this task?</h3>
                    <p className="text-sm text-muted-foreground">
                      Our AI will simulate the call and show you the transcript in real-time.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Additional resolved task info */}
            {(task.status === 'resolved' || task.status === 'failed') && task.transcript && (
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle className={`w-4 h-4 ${task.status === 'resolved' ? 'text-green-500' : 'text-red-500'}`} />
                    Task {task.status === 'resolved' ? 'Completed' : 'Failed'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {task.status === 'resolved' 
                      ? 'This task has been successfully completed. View the call summary and transcript for details.'
                      : 'This task could not be completed. Please review the transcript for more information.'
                    }
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}