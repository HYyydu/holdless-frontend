import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  FileText, 
  Download, 
  ExternalLink,
  DollarSign,
  Calendar,
  AlertCircle
} from "lucide-react";

export interface ActivityItem {
  id: string;
  vendor: string;
  type: 'task_completed' | 'task_failed' | 'refund_issued' | 'appointment_scheduled' | 'document_received' | 'alert';
  title: string;
  description: string;
  timestamp: Date;
  outcome?: {
    type: 'refund' | 'appointment' | 'document' | 'resolution' | 'alert';
    amount?: string;
    date?: Date;
    caseNumber?: string;
    downloadUrl?: string;
    urgency?: 'low' | 'medium' | 'high';
    deadline?: Date;
  };
  transcriptUrl?: string;
}


const typeConfig = {
  task_completed: {
    icon: CheckCircle,
    iconColor: "text-accent",
    bgColor: "bg-accent/10"
  },
  task_failed: {
    icon: XCircle,
    iconColor: "text-destructive",
    bgColor: "bg-destructive/10"
  },
  refund_issued: {
    icon: DollarSign,
    iconColor: "text-accent",
    bgColor: "bg-accent/10"
  },
  appointment_scheduled: {
    icon: Calendar,
    iconColor: "text-primary",
    bgColor: "bg-primary/10"
  },
  document_received: {
    icon: FileText,
    iconColor: "text-primary",
    bgColor: "bg-primary/10"
  },
  alert: {
    icon: AlertCircle,
    iconColor: "text-warning",
    bgColor: "bg-warning/10"
  }
};

interface ActivityCardProps {
  activity: ActivityItem;
  onViewTranscript?: (activityId: string) => void;
  onDownload?: (url: string) => void;
  onViewDetails?: (activity: ActivityItem) => void;
}

export function ActivityCard({ activity, onViewTranscript, onDownload, onViewDetails }: ActivityCardProps) {
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
  
  const getDownloadLabel = () => {
    if (activity.outcome?.type === 'document') {
      if (activity.title.toLowerCase().includes('return')) {
        return 'Download Return Label';
      }
      return 'Download Document';
    }
    return 'Download';
  };

  return (
    <Card 
      className="shadow-card hover:shadow-elegant transition-smooth cursor-pointer" 
      onClick={() => onViewDetails?.(activity)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 ${config.bgColor} rounded-lg flex items-center justify-center`}>
            <Icon className={`w-5 h-5 ${config.iconColor}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-foreground">{activity.title}</h3>
                <p className="text-sm text-muted-foreground">{activity.vendor}</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">
                  {formatTimeAgo(activity.timestamp)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="space-y-3">
          <p className="text-sm text-foreground">{activity.description}</p>
          
          {activity.outcome && (
            <div className="p-3 bg-muted/50 rounded-lg">
              {activity.outcome.type === 'refund' && (
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-accent" />
                  <span className="font-medium text-accent">
                    Refund: {activity.outcome.amount}
                  </span>
                  {activity.outcome.caseNumber && (
                    <Badge variant="outline" className="text-xs">
                      Case #{activity.outcome.caseNumber}
                    </Badge>
                  )}
                </div>
              )}
              
              {activity.outcome.type === 'appointment' && activity.outcome.date && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  <span className="font-medium">
                    Scheduled: {activity.outcome.date.toLocaleDateString()} at {activity.outcome.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
              
              {activity.outcome.type === 'document' && (
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="font-medium">Document ready</span>
                  {activity.outcome.downloadUrl && onDownload && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload(activity.outcome!.downloadUrl!);
                      }}
                    >
                      <Download className="w-3 h-3" />
                      {getDownloadLabel()}
                    </Button>
                  )}
                </div>
              )}
              
              {activity.outcome.type === 'alert' && (
                <div className="flex items-center gap-2">
                  <AlertCircle className={`w-4 h-4 ${
                    activity.outcome.urgency === 'high' ? 'text-destructive' : 
                    activity.outcome.urgency === 'medium' ? 'text-warning' : 'text-muted-foreground'
                  }`} />
                  <span className="font-medium">
                    {activity.outcome.urgency === 'high' ? 'Urgent Alert' : 
                     activity.outcome.urgency === 'medium' ? 'Alert' : 'Notice'}
                  </span>
                  {activity.outcome.deadline && (
                    <Badge variant="outline" className="text-xs">
                      {activity.outcome.deadline.toLocaleDateString()}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
          
          <div className="flex justify-between items-center pt-2">
            <div className="text-xs text-muted-foreground">
              {activity.timestamp.toLocaleDateString()} at {activity.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            
            <div className="flex gap-2">
              {activity.transcriptUrl && onViewTranscript && (
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewTranscript(activity.id);
                  }}
                >
                  <FileText className="w-3 h-3" />
                  View Transcript
                </Button>
              )}
              <Button 
                size="sm" 
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails?.(activity);
                }}
              >
                View Details
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}