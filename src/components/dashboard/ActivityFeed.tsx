import { ActivityItem } from "@/components/ActivityCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  FileText, 
  Download, 
  DollarSign,
  Calendar,
  AlertTriangle,
  ChevronRight,
  Bell
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActivityFeedProps {
  activities: ActivityItem[];
  onViewTranscript?: (activityId: string) => void;
  onDownload?: (url: string) => void;
  onViewDetails?: (activity: ActivityItem) => void;
}

const typeConfig = {
  task_completed: {
    icon: CheckCircle,
    iconColor: "text-success",
    bgColor: "bg-success/10",
    category: 'outcomes'
  },
  task_failed: {
    icon: XCircle,
    iconColor: "text-destructive",
    bgColor: "bg-destructive/10",
    category: 'outcomes'
  },
  refund_issued: {
    icon: DollarSign,
    iconColor: "text-success",
    bgColor: "bg-success/10",
    category: 'outcomes'
  },
  appointment_scheduled: {
    icon: Calendar,
    iconColor: "text-primary",
    bgColor: "bg-primary/10",
    category: 'outcomes'
  },
  document_received: {
    icon: FileText,
    iconColor: "text-primary",
    bgColor: "bg-primary/10",
    category: 'documents'
  },
  alert: {
    icon: AlertTriangle,
    iconColor: "text-warning",
    bgColor: "bg-warning/10",
    category: 'alerts'
  }
};

function ActivityCard({ 
  activity, 
  onViewTranscript, 
  onDownload, 
  onViewDetails 
}: {
  activity: ActivityItem;
  onViewTranscript?: (activityId: string) => void;
  onDownload?: (url: string) => void;
  onViewDetails?: (activity: ActivityItem) => void;
}) {
  const config = typeConfig[activity.type];
  const Icon = config.icon;
  
  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)}h ago`;
    } else {
      return `${Math.floor(diffInMinutes / 1440)}d ago`;
    }
  };

  const getUrgencyBadge = () => {
    if (activity.outcome?.type !== 'alert') return null;
    
    const urgency = activity.outcome.urgency;
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "text-[10px] uppercase tracking-wider font-semibold",
          urgency === 'high' && "border-destructive/30 text-destructive bg-destructive/5",
          urgency === 'medium' && "border-warning/30 text-warning bg-warning/5",
          urgency === 'low' && "border-muted-foreground/30 text-muted-foreground bg-muted/50"
        )}
      >
        {urgency === 'high' ? 'Urgent' : urgency === 'medium' ? 'Important' : 'Notice'}
      </Badge>
    );
  };
  
  return (
    <div 
      className="group flex gap-4 p-4 bg-card rounded-xl border border-border/50 hover:shadow-card-hover transition-all cursor-pointer"
      onClick={() => onViewDetails?.(activity)}
    >
      {/* Icon */}
      <div className={cn(
        "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center",
        config.bgColor
      )}>
        <Icon className={cn("w-5 h-5", config.iconColor)} />
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-foreground text-sm">{activity.title}</h4>
            {getUrgencyBadge()}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatTimeAgo(activity.timestamp)}
          </span>
        </div>
        
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
          {activity.description}
        </p>
        
        {/* Outcome Badge */}
        {activity.outcome && (
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {activity.outcome.type === 'refund' && (
              <Badge variant="outline" className="bg-success/5 border-success/20 text-success font-semibold">
                <DollarSign className="w-3 h-3 mr-1" />
                {activity.outcome.amount}
              </Badge>
            )}
            
            {activity.outcome.type === 'appointment' && activity.outcome.date && (
              <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary">
                <Calendar className="w-3 h-3 mr-1" />
                {activity.outcome.date.toLocaleDateString()} at {activity.outcome.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Badge>
            )}
            
            {activity.outcome.caseNumber && (
              <Badge variant="outline" className="text-muted-foreground font-mono text-xs">
                Case #{activity.outcome.caseNumber}
              </Badge>
            )}
            
            {activity.outcome.deadline && (
              <Badge variant="outline" className="border-warning/30 text-warning bg-warning/5">
                <Clock className="w-3 h-3 mr-1" />
                Due {activity.outcome.deadline.toLocaleDateString()}
              </Badge>
            )}
          </div>
        )}
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {activity.outcome?.type === 'document' && activity.outcome.downloadUrl && onDownload && (
            <Button 
              size="sm" 
              variant="outline"
              className="h-7 text-xs bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(activity.outcome!.downloadUrl!);
              }}
            >
              <Download className="w-3 h-3 mr-1.5" />
              Download Label
            </Button>
          )}
          
          {activity.transcriptUrl && onViewTranscript && (
            <Button 
              size="sm" 
              variant="ghost"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onViewTranscript(activity.id);
              }}
            >
              <FileText className="w-3 h-3 mr-1.5" />
              View Transcript
            </Button>
          )}
        </div>
      </div>
      
      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

export function ActivityFeed({ activities, onViewTranscript, onDownload, onViewDetails }: ActivityFeedProps) {
  // Group activities by category
  const alerts = activities.filter(a => typeConfig[a.type].category === 'alerts');
  const documents = activities.filter(a => typeConfig[a.type].category === 'documents');
  const outcomes = activities.filter(a => typeConfig[a.type].category === 'outcomes');

  const renderSection = (title: string, items: ActivityItem[], icon: typeof Bell) => {
    if (items.length === 0) return null;
    const SectionIcon = icon;
    
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <SectionIcon className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        
        <div className="space-y-3">
          {items.map((activity) => (
            <ActivityCard 
              key={activity.id}
              activity={activity}
              onViewTranscript={onViewTranscript}
              onDownload={onDownload}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {renderSection('Alerts', alerts, AlertTriangle)}
      {renderSection('Documents', documents, FileText)}
      {renderSection('Call Outcomes', outcomes, CheckCircle)}
    </div>
  );
}