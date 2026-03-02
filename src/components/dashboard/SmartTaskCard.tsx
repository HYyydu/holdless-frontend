import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Clock, 
  Phone, 
  MessageCircle, 
  ExternalLink, 
  AlertTriangle,
  CheckCircle,
  Play,
  Timer,
  ChevronRight
} from "lucide-react";
import { Task } from "@/components/TaskCard";
import { cn } from "@/lib/utils";

interface SmartTaskCardProps {
  task: Task;
  onViewDetails?: (taskId: string) => void;
  onTakeAction?: (taskId: string) => void;
}

const statusConfig = {
  pending: { 
    label: 'Queued', 
    icon: Timer,
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-muted-foreground',
    isLive: false
  },
  in_progress: { 
    label: 'In Progress', 
    icon: Play,
    badgeClass: 'bg-primary/10 text-primary border-primary/20',
    dotClass: 'bg-primary',
    isLive: true
  },
  on_hold: { 
    label: 'On Hold', 
    icon: Clock,
    badgeClass: 'bg-warning/10 text-warning border-warning/20',
    dotClass: 'bg-warning',
    isLive: true
  },
  needs_input: { 
    label: 'Needs Input', 
    icon: AlertTriangle,
    badgeClass: 'bg-destructive/10 text-destructive border-destructive/20',
    dotClass: 'bg-destructive',
    isLive: true
  },
  resolved: { 
    label: 'Resolved', 
    icon: CheckCircle,
    badgeClass: 'bg-success/10 text-success border-success/20',
    dotClass: 'bg-success',
    isLive: false
  },
  failed: { 
    label: 'Failed', 
    icon: AlertTriangle,
    badgeClass: 'bg-destructive/10 text-destructive border-destructive/20',
    dotClass: 'bg-destructive',
    isLive: false
  }
};

export function SmartTaskCard({ task, onViewDetails, onTakeAction }: SmartTaskCardProps) {
  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  const showTakeAction = task.status === 'needs_input' || task.status === 'on_hold' || task.status === 'pending';
  
  return (
    <div className="group bg-card rounded-xl border border-border/50 shadow-card hover:shadow-card-hover transition-all duration-300 overflow-hidden">
      {/* Status accent bar */}
      <div className={cn(
        "h-1 w-full",
        task.status === 'needs_input' && "bg-destructive",
        task.status === 'on_hold' && "bg-warning",
        task.status === 'in_progress' && "bg-primary",
        task.status === 'resolved' && "bg-success",
        task.status === 'pending' && "bg-muted-foreground",
        task.status === 'failed' && "bg-destructive"
      )} />
      
      <div className="p-5">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            {/* Vendor Logo */}
            <div className="w-11 h-11 bg-muted rounded-xl flex items-center justify-center overflow-hidden border border-border/50">
              {task.vendorLogo ? (
                <img 
                  src={task.vendorLogo} 
                  alt={`${task.vendor} logo`} 
                  className="w-7 h-7 object-contain" 
                />
              ) : (
                <span className="text-sm font-semibold text-muted-foreground">
                  {task.vendor.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            
            <div>
              <h3 className="font-semibold text-foreground leading-tight">{task.vendor}</h3>
              <p className="text-sm text-muted-foreground line-clamp-1">{task.issue}</p>
            </div>
          </div>
          
          {/* Status Badge */}
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
            config.badgeClass
          )}>
            {config.isLive && (
              <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse-live", config.dotClass)} />
            )}
            <StatusIcon className="w-3 h-3" />
            <span>{config.label}</span>
          </div>
        </div>
        
        {/* Order / Service Info */}
        {task.orderNumber && (
          <div className="mb-3 px-3 py-2 bg-muted/50 rounded-lg">
            <span className="text-xs text-muted-foreground font-medium">Order </span>
            <span className="text-xs text-foreground font-mono">{task.orderNumber}</span>
          </div>
        )}
        
        {/* Goal */}
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Goal</p>
          <p className="text-sm text-foreground leading-relaxed">{task.desiredOutcome}</p>
        </div>
        
        {/* On Hold Indicator */}
        {task.status === 'on_hold' && task.holdTime && (
          <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/20 rounded-lg">
            <Clock className="w-4 h-4 text-warning" />
            <span className="text-sm font-medium text-warning">On hold for {task.holdTime}</span>
          </div>
        )}
        
        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          {/* Metadata */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {task.channel && (
              <span className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 rounded-md">
                {task.channel === 'call' && <Phone className="w-3 h-3" />}
                {task.channel === 'chat' && <MessageCircle className="w-3 h-3" />}
                <span className="capitalize">{task.channel}</span>
              </span>
            )}
            <span>{task.createdAt.toLocaleDateString()}</span>
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-2">
            {showTakeAction && onTakeAction && (
              <Button 
                size="sm" 
                onClick={() => onTakeAction(task.id)}
                className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                Take Action
              </Button>
            )}
            {onViewDetails && (
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => onViewDetails(task.id)}
                className="h-8 text-muted-foreground hover:text-foreground"
              >
                Details
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}