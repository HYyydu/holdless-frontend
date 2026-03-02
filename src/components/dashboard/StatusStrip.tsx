import { BarChart3, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

interface TaskStats {
  total: number;
  inProgress: number;
  resolved: number;
  needsInput: number;
}

interface StatusStripProps {
  stats: TaskStats;
}

const statItems = [
  {
    key: 'total',
    label: 'Total Tasks',
    icon: BarChart3,
    color: 'primary',
    bgClass: 'bg-primary/8',
    iconClass: 'text-primary',
    progressClass: 'bg-primary/20'
  },
  {
    key: 'inProgress',
    label: 'In Progress',
    icon: Clock,
    color: 'warning',
    bgClass: 'bg-warning/10',
    iconClass: 'text-warning',
    progressClass: 'bg-warning/30'
  },
  {
    key: 'resolved',
    label: 'Resolved',
    icon: CheckCircle,
    color: 'success',
    bgClass: 'bg-success/10',
    iconClass: 'text-success',
    progressClass: 'bg-success/30'
  },
  {
    key: 'needsInput',
    label: 'Needs Input',
    icon: AlertTriangle,
    color: 'destructive',
    bgClass: 'bg-destructive/10',
    iconClass: 'text-destructive',
    progressClass: 'bg-destructive/30'
  }
] as const;

export function StatusStrip({ stats }: StatusStripProps) {
  const getPercentage = (value: number) => {
    if (stats.total === 0) return 0;
    return (value / stats.total) * 100;
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 shadow-card overflow-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border/50">
        {statItems.map((item) => {
          const Icon = item.icon;
          const value = stats[item.key as keyof TaskStats];
          const percentage = getPercentage(value);
          
          return (
            <div 
              key={item.key}
              className="p-5 relative group hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 ${item.bgClass} rounded-lg flex items-center justify-center`}>
                  <Icon className={`w-4.5 h-4.5 ${item.iconClass}`} />
                </div>
                {item.key === 'needsInput' && value > 0 && (
                  <span className="w-2 h-2 bg-destructive rounded-full animate-pulse-live" />
                )}
                {item.key === 'inProgress' && value > 0 && (
                  <span className="w-2 h-2 bg-warning rounded-full animate-pulse-live" />
                )}
              </div>
              
              <div className="space-y-1.5">
                <p className="text-2xl font-semibold text-foreground tracking-tight">
                  {value}
                </p>
                <p className="text-sm text-muted-foreground font-medium">
                  {item.label}
                </p>
              </div>
              
              {/* Progress indicator */}
              <div className="absolute bottom-0 left-0 right-0 h-1">
                <div 
                  className={`h-full ${item.progressClass} transition-all duration-500`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}