import { useMemo, useState } from 'react';
import { Clock, AlertCircle, CheckCircle, ListFilter } from 'lucide-react';
import { PetTaskDetailsView } from './PetTaskDetailsView';
import { CallTaskDetailsView } from './CallTaskDetailsView';
import type { CallTask } from './ConversationView';
import type { Task as DashboardTask } from '@/components/TaskCard';

interface Task {
  id: string;
  title: string;
  description: string;
  vendor: string;
  createdAt: Date;
  priority: 'high' | 'medium' | 'low';
  status: 'in_progress' | 'needs_input' | 'resolved';
}

interface TasksViewProps {
  showPetTask?: boolean;
  /** Tasks created from outbound calls (call purpose as title, status: in_progress → resolved) */
  callTasks?: CallTask[];
  /** Persisted generic tasks from Dashboard (optional; when provided, used instead of sampleTasks) */
  tasks?: DashboardTask[];
  /** When set, show call task details view instead of list */
  selectedCallTask?: CallTask | null;
  onSelectCallTask?: (task: CallTask | null) => void;
  onWatchTranscript?: (callId: string, label: string) => void;
  /** When call ends (e.g. detected via polling), update task to resolved */
  onCallEnded?: (callId: string) => void;
  /** Retry the call with same purpose (e.g. when no useful info was obtained). Returns new callId or null. */
  onRetryCall?: (callId: string, purpose: string) => Promise<{ newCallId: string } | null>;
}

const sampleTasks: Task[] = [
  {
    id: '1',
    title: 'Internet billing issue',
    description: 'Disputed charge of $45.99 on January statement',
    vendor: 'Comcast',
    createdAt: new Date('2026-01-27'),
    priority: 'high',
    status: 'in_progress',
  },
  {
    id: '2',
    title: 'Cancel gym membership',
    description: 'Request cancellation of unused gym membership',
    vendor: 'LA Fitness',
    createdAt: new Date('2026-01-24'),
    priority: 'medium',
    status: 'needs_input',
  },
  {
    id: '3',
    title: 'Flight refund request',
    description: 'Request refund for cancelled flight AA1234',
    vendor: 'American Airlines',
    createdAt: new Date('2026-01-19'),
    priority: 'high',
    status: 'resolved',
  },
  {
    id: '4',
    title: 'Wrong item received',
    description: 'Ordered blue shirt but received red one',
    vendor: 'Amazon',
    createdAt: new Date('2026-01-22'),
    priority: 'medium',
    status: 'in_progress',
  },
];

const formatDate = (date: Date) => {
  try {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
};

/** Format task title (e.g. general_business → General Business) for display. */
function formatTaskTitle(title: string): string {
  if (!title || typeof title !== 'string') return title ?? '';
  return title.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const StatusBadge = ({ status }: { status: Task['status'] }) => {
  const config: Record<Task['status'], { label: string; icon: typeof Clock; className: string }> = {
    in_progress: { 
      label: 'In Progress', 
      icon: Clock, 
      className: 'bg-blue-50 text-blue-600 border-blue-200' 
    },
    needs_input: { 
      label: 'Needs Input', 
      icon: AlertCircle, 
      className: 'bg-orange-50 text-orange-600 border-orange-200' 
    },
    resolved: { 
      label: 'Resolved', 
      icon: CheckCircle, 
      className: 'bg-green-50 text-green-600 border-green-200' 
    },
  };

  const c = config[status] ?? config.in_progress;
  const { label, icon: Icon, className } = c;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${className}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
};

function isCallTask(task: Task | CallTask): task is CallTask {
  return 'callId' in task && typeof (task as CallTask).callId === 'string';
}

function toListTask(t: DashboardTask | Task): Task {
  if ('title' in t && 'description' in t) return t as Task;
  const d = t as DashboardTask;
  return {
    id: d.id,
    title: d.issue,
    description: d.desiredOutcome,
    vendor: d.vendor,
    createdAt: d.createdAt,
    priority: 'medium',
    status: d.status === 'failed' ? 'resolved' : (d.status as Task['status']) || 'in_progress',
  };
}

export function TasksView({
  showPetTask = false,
  callTasks = [],
  tasks: dashboardTasks,
  selectedCallTask = null,
  onSelectCallTask,
  onWatchTranscript,
  onCallEnded,
  onRetryCall,
}: TasksViewProps) {
  const [localTasks] = useState<Task[]>(sampleTasks);
  const genericTasks = dashboardTasks != null ? dashboardTasks.map(toListTask) : localTasks;
  const allTasks = [...callTasks, ...genericTasks];
  const [showPetDetails, setShowPetDetails] = useState(false);

  const stats = useMemo(() => ({
    total: allTasks.length + (showPetTask ? 1 : 0),
    in_progress: allTasks.filter(t => t.status === 'in_progress').length,
    needs_input: allTasks.filter(t => t.status === 'needs_input').length,
    resolved: allTasks.filter(t => t.status === 'resolved').length + (showPetTask ? 1 : 0),
  }), [allTasks, showPetTask]);

  // Show call task details view
  if (selectedCallTask && onSelectCallTask && onWatchTranscript) {
    return (
      <CallTaskDetailsView
        task={selectedCallTask}
        onBack={() => onSelectCallTask(null)}
        onWatchTranscript={onWatchTranscript}
        onCallEnded={onCallEnded}
        onRetryCall={onRetryCall}
      />
    );
  }

  // Show pet task details view
  if (showPetDetails) {
    return <PetTaskDetailsView onBack={() => setShowPetDetails(false)} />;
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-[hsl(250_30%_99%)]">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your customer service requests</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <ListFilter className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">Total Tasks</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-sm text-gray-500">In Progress</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.in_progress}</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-sm text-gray-500">Needs Input</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.needs_input}</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-sm text-gray-500">Resolved</p>
                <p className="text-2xl font-semibold text-gray-900">{stats.resolved}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Task List */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 mb-4">All Tasks</h2>
          <div className="space-y-3">
            {/* Pet Checkup Task Card - Simple list item style */}
            {showPetTask && (
              <div 
                onClick={() => setShowPetDetails(true)}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-blue-600 hover:text-blue-700">
                      Get a Quote — Pet Clinic (Cat Spay)
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">Get spay surgery quotes from nearby veterinary clinics</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                      <span>Multiple Clinics</span>
                      <span>•</span>
                      <span>Created 2/2/2026</span>
                      <span>•</span>
                      <span>High Priority</span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border bg-green-50 text-green-600 border-green-200">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Resolved
                  </span>
                </div>
              </div>
            )}
            
            {allTasks.map((task) => (
              <div
                key={task.id}
                onClick={() => {
                  if (isCallTask(task) && onSelectCallTask) {
                    onSelectCallTask(task);
                  }
                }}
                className={`bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 transition-colors ${isCallTask(task) ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{formatTaskTitle(task.title)}</h3>
                    <p className="text-sm text-gray-500 mt-1">{task.description}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                      <span>{task.vendor}</span>
                      <span>•</span>
                      <span>Created {formatDate(task.createdAt)}</span>
                      <span>•</span>
                      <span>{(task.priority && String(task.priority).charAt(0).toUpperCase() + String(task.priority).slice(1)) || 'Medium'} Priority</span>
                    </div>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
