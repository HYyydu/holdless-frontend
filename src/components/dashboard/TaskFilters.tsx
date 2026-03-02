import { Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TaskFilter = 'all' | 'in_progress' | 'needs_input' | 'resolved';

interface TaskFiltersProps {
  activeFilter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  taskCounts: {
    all: number;
    in_progress: number;
    needs_input: number;
    resolved: number;
  };
}

const filters: { key: TaskFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'needs_input', label: 'Needs Input' },
  { key: 'resolved', label: 'Resolved' }
];

export function TaskFilters({ 
  activeFilter, 
  onFilterChange, 
  searchQuery, 
  onSearchChange,
  taskCounts 
}: TaskFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      {/* Filter Pills */}
      <div className="flex items-center gap-2 p-1 bg-muted/50 rounded-lg">
        {filters.map((filter) => {
          const count = taskCounts[filter.key];
          const isActive = activeFilter === filter.key;
          
          return (
            <button
              key={filter.key}
              onClick={() => onFilterChange(filter.key)}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                isActive 
                  ? "bg-card text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-card/50"
              )}
            >
              {filter.label}
              <span className={cn(
                "text-xs px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                isActive 
                  ? "bg-primary/10 text-primary" 
                  : "bg-muted text-muted-foreground"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
      
      {/* Search Input */}
      <div className="relative w-full sm:w-72">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search vendors or tasks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-9 bg-card border-border/50 focus:border-primary/50"
        />
      </div>
    </div>
  );
}