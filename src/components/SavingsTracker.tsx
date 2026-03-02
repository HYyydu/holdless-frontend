import { Card, CardContent } from '@/components/ui/card';
import { DollarSign, Clock } from 'lucide-react';

interface SavingsTrackerProps {
  monthlyRefunds: number;
  timeSavedThisMonth: string;
  totalRefunds: number;
  totalTimeSaved: string;
}

export const SavingsTracker = ({ 
  monthlyRefunds, 
  timeSavedThisMonth, 
  totalRefunds, 
  totalTimeSaved 
}: SavingsTrackerProps) => {
  return (
    <Card className="shadow-card bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Savings & Time Tracker</h3>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-muted-foreground">
                  Refunds: <span className="font-semibold text-primary">${monthlyRefunds.toFixed(2)}</span> this month
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  Time saved: <span className="font-semibold text-accent">{timeSavedThisMonth}</span>
                </span>
              </div>
            </div>
          </div>
          
          <div className="text-right">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">All-time</span>
            </div>
            <div className="text-sm">
              <span className="font-semibold text-primary">${totalRefunds.toFixed(2)}</span>
              <span className="text-muted-foreground mx-2">·</span>
              <span className="font-semibold text-accent">{totalTimeSaved}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};