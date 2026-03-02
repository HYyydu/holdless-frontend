import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Phone, X, CheckCircle, Calendar, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { Task } from "./TaskCard";
import { HoldlessWinModal, WinData } from "./HoldlessWinModal";

interface SimulationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  onStatusChange: (status: 'in_progress' | 'resolved') => void;
  onComplete: (updatedTask: Task) => void;
}

export function SimulationModal({ open, onOpenChange, task, onStatusChange, onComplete }: SimulationModalProps) {
  const [transcript, setTranscript] = useState<string>('');
  const [showOptions, setShowOptions] = useState(false);
  const [outcome, setOutcome] = useState<string>('');
  const [winModalOpen, setWinModalOpen] = useState(false);
  const [winData, setWinData] = useState<WinData | null>(null);
  useEffect(() => {
    if (open && task) {
      // For tasks that need immediate action, show transcript
      if (task.status === 'on_hold' || task.status === 'pending') {
        onStatusChange('in_progress');
        const transcriptText = generateTranscript(task);
        setTranscript(transcriptText);
      } else {
        // For tasks that need input, show options first
        setShowOptions(true);
      }
    }
  }, [open, task, onStatusChange]);

  const handleOptionSelect = (option: string) => {
    setShowOptions(false);
    setOutcome(option);
    
    if (task) {
      onStatusChange('in_progress');
      
      // Generate appropriate transcript based on selection
      let transcriptText = '';
      if (option.includes('Confirmed morning appointment')) {
        transcriptText = generateTranscript(task);
      } else if (option.includes('refund is now processing')) {
        transcriptText = generateTranscript(task);
      }
      setTranscript(transcriptText);
    }
  };

  const handleClose = () => {
    if (task) {
      // Generate case number
      const caseNumber = task.vendor.toLowerCase().includes('whole foods') 
        ? 'WF789012' 
        : task.vendor.toLowerCase().includes('spectrum')
        ? 'SP123456'
        : `CASE-${Math.random().toString().slice(2, 8)}`;

      // Update task with transcript and resolution
      const updatedTask: Task = {
        ...task,
        status: 'resolved',
        transcript: transcript,
        callSummary: {
          duration: task.vendor.toLowerCase().includes('spectrum') ? '17 minutes' : '21 minutes',
          holdTime: task.vendor.toLowerCase().includes('spectrum') ? '6 minutes' : '10 minutes',
          resolution: 'Successful',
          caseNumber: caseNumber
        }
      };

      onComplete(updatedTask);
      onStatusChange('resolved');

      // Generate win data based on task type
      const generatedWinData = generateWinData(task, caseNumber);
      setWinData(generatedWinData);
    }
    
    // Reset state and close simulation modal
    setShowOptions(false);
    setOutcome('');
    setTranscript('');
    onOpenChange(false);
    
    // Show win modal after closing simulation
    if (task) {
      setTimeout(() => setWinModalOpen(true), 300);
    }
  };

  const generateWinData = (task: Task, caseNumber: string): WinData => {
    const vendor = task.vendor.toLowerCase();
    
    if (vendor.includes('whole foods') || vendor.includes('amazon')) {
      return {
        headline: "Refund Secured! 💰",
        whatHappened: `We negotiated a full refund of $4.99 for your damaged strawberries. No store credit, straight to your original payment method.`,
        timeSaved: "21 min",
        moneyRecovered: "$4.99",
        proof: caseNumber,
        proofLabel: "Case #",
        vendor: task.vendor
      };
    }
    
    if (vendor.includes('spectrum')) {
      return {
        headline: "Appointment Booked! 📅",
        whatHappened: `Your 200 Mbps internet installation is confirmed for Tuesday morning. We handled the entire scheduling call.`,
        timeSaved: "17 min",
        moneySaved: "$0",
        proof: caseNumber,
        proofLabel: "Confirmation #",
        appointmentTime: "Tue 8-12 PM",
        vendor: task.vendor
      };
    }
    
    // Default case
    return {
      headline: "Task Complete! ✅",
      whatHappened: `We successfully resolved your request with ${task.vendor}. Your issue has been handled professionally.`,
      timeSaved: "15 min",
      moneySaved: "$0",
      proof: caseNumber,
      proofLabel: "Case #",
      vendor: task.vendor
    };
  };

  const getActionOptions = (task: Task) => {
    if (task.vendor.toLowerCase().includes('spectrum')) {
      return [
        { 
          id: 'confirm_appointment', 
          label: 'Confirmed morning appointment (Tuesday 8-12 PM)', 
          icon: Calendar,
          variant: 'default' as const
        }
      ];
    }
    
    if (task.vendor.toLowerCase().includes('whole foods')) {
      return [
        { 
          id: 'refund_approved', 
          label: 'Achieve desired outcome - refund is now processing', 
          icon: CheckCircle,
          variant: 'default' as const
        }
      ];
    }

    return [
      { 
        id: 'generic_resolved', 
        label: 'Mark as resolved', 
        icon: CheckCircle,
        variant: 'default' as const
      }
    ];
  };

  const generateTranscript = (task: Task): string => {
    const orderNumber = task.orderNumber || '113-1234567-8910112';
    const vendor = task.vendor;
    const caseNumber = task.vendor.toLowerCase().includes('whole foods') ? 'WF789012' : `CASE-${Math.random().toString().slice(2, 8)}`;
    
    // Generate different transcripts based on task type
    if (vendor.toLowerCase().includes('spectrum')) {
      return `[00:00] System: Dialing ${vendor} Customer Support…
[00:05] System: IVR detected. Navigating to installation services…
[00:09] System: On hold. (music)
[00:12] Agent: Thank you for calling Spectrum, this is Mike. How can I help you today?
[00:14] AI: Hi Mike, I'm calling as Sarah Chen's authorized assistant to schedule internet installation for the 200 Mbps plan. We prefer a morning appointment next week.
[00:17] Agent: I can help with that. Let me verify your account. Can you confirm the service address ending in **90007 and the phone number ending **4567?
[00:19] AI: Confirmed: address ending 90007, phone ending 4567.
[00:21] Agent: Perfect. I have availability next Tuesday, Wednesday, or Friday morning between 8 AM and 12 PM. Which works best?
[00:23] AI: Tuesday morning between 8-12 works perfectly.
[00:24] Agent: Great! I've scheduled your installation for Tuesday 9/24 between 8 AM and 12 PM. Your appointment confirmation is ${caseNumber}. You'll receive a text reminder the day before.
[00:25] AI: Perfect, thank you Mike. That's exactly what we needed.
[00:26] Agent: You're welcome! Is there anything else I can help with today?
[00:27] AI: No, that covers everything. Have a great day!
[00:28] Agent: You too, thanks for choosing Spectrum!
[00:29] System: Call ended. Total duration 17 minutes. Hold time 6 minutes. Appointment ${caseNumber} confirmed. End of transcript`;
    }
    
    // Default to Whole Foods/Amazon return transcript
    return `[00:00] System: Dialing ${vendor} Customer Support…
[00:05] System: IVR detected. Navigating menu for returns/refunds…
[00:09] System: On hold. (music)
[00:12] Agent: Thanks for calling ${vendor} via Amazon, this is Priya. How may I help you today?
[00:14] AI: Hi Priya, I'm calling as Sarah Chen's authorized assistant regarding order #${orderNumber} delivered on 9/14. One item—Driscoll's strawberries—arrived damaged. We're requesting a full refund to the original payment method, no store credit.
[00:17] Agent: I can help with that. For security, please verify the email on the account ending in **…email.com and the shipping ZIP code **90007.
[00:19] AI: Verified: email ending **…email.com, ZIP 90007.
[00:21] Agent: Thank you. I see the order and the strawberries line item. I'll process a refund of $4.99 to the original payment method. No need to return the item.
[00:23] AI: Great—please confirm there's no store credit and that the refund goes to the original payment method.
[00:24] Agent: Confirmed. Refund to original payment method. Your case number is ${caseNumber}. You'll also receive a confirmation email shortly.
[00:25] AI: Thank you, Priya. That resolves our issue. Have a great day.
[00:26] Agent: You're welcome! Thanks for calling ${vendor}.
[00:27] System: Call ended. Total duration 21 minutes. Hold time 10 minutes. Case ${caseNumber} recorded. End of transcript`;
  };

  if (!task) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-6xl max-h-[95vh] p-0 overflow-hidden">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b bg-primary/5 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">AI Call In Progress</h2>
                  <p className="text-sm text-muted-foreground">
                    Handling your request with {task.vendor}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleClose}>
                <X className="w-4 h-4 mr-2" />
                Close
              </Button>
            </div>
          </div>

          {/* Scrollable Content */}
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6">
              {/* Summary Section */}
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-lg">Task Summary</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
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
                </CardContent>
              </Card>

              <Separator />

              {/* Options Section - Show when task needs input */}
              {showOptions && (
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      Choose Next Action
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground mb-4">
                      What would you like to do next for this task?
                    </p>
                    {getActionOptions(task).map((option) => {
                      const IconComponent = option.icon;
                      return (
                        <Button
                          key={option.id}
                          variant={option.variant}
                          className="w-full justify-start h-auto p-4"
                          onClick={() => handleOptionSelect(option.label)}
                        >
                          <IconComponent className="w-4 h-4 mr-3" />
                          <span className="text-left">{option.label}</span>
                        </Button>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Outcome Section - Show when option is selected */}
              {outcome && (
                <Card className="shadow-card border-accent/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-accent/10 rounded-full flex items-center justify-center">
                        <CheckCircle className="w-4 h-4 text-accent" />
                      </div>
                      <div>
                        <p className="font-semibold text-accent">Action Completed</p>
                        <p className="text-sm text-muted-foreground">{outcome}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Transcript Section */}
              {transcript && (
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Call Transcript
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 font-mono text-sm max-h-[500px] overflow-y-auto">
                      {transcript.split('\n').map((line, index) => (
                        <div key={index} className="leading-relaxed py-1">
                          {line}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
    
    {/* Holdless Win Modal */}
    <HoldlessWinModal
      open={winModalOpen}
      onOpenChange={setWinModalOpen}
      winData={winData}
    />
    </>
  );
}