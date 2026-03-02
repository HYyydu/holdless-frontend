import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Phone, MessageCircle, ExternalLink, AlertCircle } from "lucide-react";

export interface Task {
  id: string;
  vendor: string;
  vendorLogo?: string;
  issue: string;
  status: 'pending' | 'in_progress' | 'on_hold' | 'needs_input' | 'resolved' | 'failed';
  createdAt: Date;
  eta?: string;
  orderNumber?: string;
  desiredOutcome: string;
  channel?: 'call' | 'chat' | 'form' | 'email';
  holdTime?: string;
  transcript?: string;
  callSummary?: {
    duration: string;
    holdTime: string;
    resolution: string;
    caseNumber: string;
  };
}

interface TaskCardProps {
  task: Task;
  onViewDetails?: (taskId: string) => void;
  onTakeAction?: (taskId: string) => void;
}

const statusConfig = {
  pending: { 
    label: 'Queued', 
    variant: 'secondary' as const, 
    icon: Clock,
    description: 'Waiting to start'
  },
  in_progress: { 
    label: 'In Progress', 
    variant: 'default' as const, 
    icon: Phone,
    description: 'Handling your request'
  },
  on_hold: { 
    label: 'On Hold', 
    variant: 'warning' as const, 
    icon: Clock,
    description: 'Waiting for agent'
  },
  needs_input: { 
    label: 'Needs Input', 
    variant: 'destructive' as const, 
    icon: AlertCircle,
    description: 'Your attention required'
  },
  resolved: { 
    label: 'Resolved', 
    variant: 'outline' as const, 
    icon: MessageCircle,
    description: 'Successfully completed'
  },
  failed: { 
    label: 'Failed', 
    variant: 'destructive' as const, 
    icon: AlertCircle,
    description: 'Could not complete'
  }
};

export function TaskCard({ task, onViewDetails, onTakeAction }: TaskCardProps) {
  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  
  return (
    <Card className="shadow-card hover:shadow-elegant transition-smooth">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-primary rounded-lg flex items-center justify-center shadow-sm">
              {task.vendorLogo ? (
                <img 
                  src={task.vendorLogo} 
                  alt={`${task.vendor} logo`} 
                  className="w-6 h-6 object-contain" 
                />
              ) : (
                <span className="text-sm font-semibold text-background">
                  {task.vendor.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{task.vendor}</h3>
              <p className="text-sm text-muted-foreground">{task.issue}</p>
              {task.orderNumber && (
                <p className="text-xs text-muted-foreground">Order #{task.orderNumber}</p>
              )}
            </div>
          </div>
          <Badge variant={config.variant} className="flex items-center gap-1">
            <StatusIcon className="w-3 h-3" />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            <strong>Goal:</strong> {task.desiredOutcome}
          </div>
          
          {task.status === 'on_hold' && task.holdTime && (
            <div className="flex items-center gap-2 text-sm text-warning">
              <Clock className="w-4 h-4" />
              On hold for {task.holdTime}
            </div>
          )}
          
          {task.eta && task.status === 'pending' && (
            <div className="text-sm text-muted-foreground">
              <strong>ETA:</strong> {task.eta}
            </div>
          )}
          
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {task.channel && (
                <span className="flex items-center gap-1">
                  {task.channel === 'call' && <Phone className="w-3 h-3" />}
                  {task.channel === 'chat' && <MessageCircle className="w-3 h-3" />}
                  Via {task.channel}
                </span>
              )}
              <span>•</span>
              <span>{task.createdAt.toLocaleDateString()}</span>
            </div>
            
            <div className="flex gap-2">
              {(task.status === 'needs_input' || task.status === 'on_hold' || task.status === 'pending') && onTakeAction && (
                <Button size="sm" variant="warning" onClick={() => onTakeAction(task.id)}>
                  Take Action
                </Button>
              )}
              {onViewDetails && (
                <Button size="sm" variant="outline" onClick={() => onViewDetails(task.id)}>
                  <ExternalLink className="w-3 h-3" />
                  Details
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}