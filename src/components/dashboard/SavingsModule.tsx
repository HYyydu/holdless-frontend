import { TrendingUp, Clock, DollarSign, Zap } from 'lucide-react';

interface SavingsModuleProps {
  monthlyRefunds: number;
  timeSavedThisMonth: string;
  totalRefunds: number;
  totalTimeSaved: string;
}

export function SavingsModule({ 
  monthlyRefunds, 
  timeSavedThisMonth, 
  totalRefunds, 
  totalTimeSaved 
}: SavingsModuleProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-savings">
      {/* Subtle decorative element */}
      <div className="absolute -right-8 -top-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl" />
      <div className="absolute -left-4 -bottom-4 w-24 h-24 bg-accent/5 rounded-full blur-xl" />
      
      <div className="relative p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Your Impact</h3>
            <p className="text-sm text-muted-foreground">Savings & time recovered</p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-6">
          {/* This Month Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Month</span>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-success/10 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-success" />
                </div>
                <div>
                  <p className="text-xl font-bold text-success">${monthlyRefunds.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Refunds</p>
                </div>
              </div>
              
              <div className="w-px h-10 bg-border/50" />
              
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-accent/10 rounded-lg flex items-center justify-center">
                  <Clock className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <p className="text-xl font-bold text-accent">{timeSavedThisMonth}</p>
                  <p className="text-xs text-muted-foreground">Time Saved</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* All Time Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">All Time</span>
              <div className="flex-1 h-px bg-border/50" />
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xl font-bold text-primary">${totalRefunds.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Total Refunds</p>
                </div>
              </div>
              
              <div className="w-px h-10 bg-border/50" />
              
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">{totalTimeSaved}</p>
                  <p className="text-xs text-muted-foreground">Time Saved</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}