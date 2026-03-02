import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertCircle, ChevronDown, Phone, User } from "lucide-react";
import { useState } from "react";
import { Task } from "./TaskCard";

interface AdditionalInfoDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (taskId: string, additionalInfo: string) => void;
}

export function AdditionalInfoDialog({ task, open, onOpenChange, onSubmit }: AdditionalInfoDialogProps) {
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  if (!task) return null;

  const handleSubmit = () => {
    if (onSubmit && additionalInfo.trim()) {
      onSubmit(task.id, additionalInfo);
      setAdditionalInfo("");
      onOpenChange(false);
    }
  };

  // Parse transcript for display
  const transcriptLines = task.transcript?.split('\n').filter(line => line.trim()) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-warning" />
            Additional Information Needed
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* What We Need Section */}
            <Card className="border-warning/50 bg-warning/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  What We Need From You
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="font-semibold text-foreground mb-1">Task Details</p>
                    <p className="text-sm text-muted-foreground">
                      <strong>Vendor:</strong> {task.vendor}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <strong>Issue:</strong> {task.issue}
                    </p>
                    {task.orderNumber && (
                      <p className="text-sm text-muted-foreground">
                        <strong>Order:</strong> #{task.orderNumber}
                      </p>
                    )}
                  </div>

                  <div className="p-3 bg-background rounded-lg border">
                    <p className="text-sm font-medium text-foreground mb-2">
                      Information Required:
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Specific item number or SKU for the refund</li>
                      <li>Preferred refund method (original payment or store credit)</li>
                      <li>Any additional details mentioned by the agent</li>
                    </ul>
                  </div>

                  <div>
                    <Label htmlFor="additional-info">
                      Your Response <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="additional-info"
                      placeholder="Please provide the requested information here. For example: Item number: ABC123, Refund to original payment method preferred..."
                      value={additionalInfo}
                      onChange={(e) => setAdditionalInfo(e.target.value)}
                      className="min-h-[120px] mt-2"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      We'll use this information to complete your support request
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={handleSubmit}
                      disabled={!additionalInfo.trim()}
                      className="flex-1"
                    >
                      Submit Information
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Call Transcript Section */}
            {task.transcript && (
              <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
                <Card>
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Phone className="w-5 h-5" />
                          Call Transcript
                        </span>
                        <ChevronDown 
                          className={`w-5 h-5 transition-transform ${transcriptOpen ? 'rotate-180' : ''}`} 
                        />
                      </CardTitle>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent>
                      <ScrollArea className="h-[300px] rounded-md border p-4 bg-muted/30">
                        <div className="space-y-3">
                          {transcriptLines.map((line, index) => {
                            const isAgent = line.toLowerCase().includes('agent:');
                            const isHoldless = line.toLowerCase().includes('holdless:');
                            
                            return (
                              <div 
                                key={index}
                                className={`p-3 rounded-lg ${
                                  isAgent 
                                    ? 'bg-primary/10 border-l-4 border-primary' 
                                    : isHoldless 
                                    ? 'bg-accent/10 border-l-4 border-accent'
                                    : 'bg-background'
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  {(isAgent || isHoldless) && (
                                    <User className="w-4 h-4 mt-0.5 text-muted-foreground" />
                                  )}
                                  <p className="text-sm text-foreground">{line}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
