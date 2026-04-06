import { useState, useMemo } from 'react';
import { Task } from '@/components/TaskCard';
import { NewTaskDialog } from '@/components/NewTaskDialog';
import { TaskDetailsDialog } from '@/components/TaskDetailsDialog';
import { SimulationModal } from '@/components/SimulationModal';
import { ActivityItem } from '@/components/ActivityCard';
import { ActivityDetailsDialog } from '@/components/ActivityDetailsDialog';
import { AdditionalInfoDialog } from '@/components/AdditionalInfoDialog';
import { ProfileSection } from '@/components/ProfileSection';
import { PetProfilesSection } from '@/components/PetProfilesSection';
import { StatusStrip } from '@/components/dashboard/StatusStrip';
import { SavingsModule } from '@/components/dashboard/SavingsModule';
import { TaskFilters, TaskFilter } from '@/components/dashboard/TaskFilters';
import { SmartTaskCard } from '@/components/dashboard/SmartTaskCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { DashboardSidebar, DashboardTab } from '@/components/dashboard/DashboardSidebar';
import { AIChatHome } from '@/components/dashboard/AIChatHome';
import { ConversationView, CallTask } from '@/components/dashboard/ConversationView';
import { TasksView } from '@/components/dashboard/TasksView';
import { LiveTranscriptModal } from '@/components/dashboard/LiveTranscriptModal';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
import { useUserProfile } from '@/hooks/useUserProfile';
import { usePets } from '@/hooks/usePets';
import { useTasks, taskToPayload } from '@/hooks/useTasks';
import { useDemoAuth } from '@/contexts/DemoAuthContext';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';
import { summarizeCall, retryCall } from '@/lib/chatApi';

// Sample data with vendor logos
const sampleTasks: Task[] = [
  {
    id: '1',
    vendor: 'Whole Foods',
    vendorLogo: '/assets/whole-foods-logo.png',
    issue: 'Damaged strawberries in delivery',
    status: 'on_hold',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    orderNumber: '113-1234567-8910112',
    desiredOutcome: 'Full refund for damaged item, no store credit',
    channel: 'call',
    holdTime: '12:34'
  },
  {
    id: '2',
    vendor: 'Spectrum',
    vendorLogo: '/assets/spectrum-logo.png',
    issue: 'Schedule internet installation',
    status: 'needs_input',
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
    desiredOutcome: 'Install 200 Mbps plan next week, morning preferred',
    channel: 'call',
    transcript: 'Agent: Thank you for calling Spectrum. How can I help you today?\nHoldless: I need to schedule an internet installation for 200 Mbps.\nAgent: I can help with that. What address will this be for?\nHoldless: 123 Main Street, Los Angeles, CA 90007.\nAgent: Great, I have availability next week. Before I can proceed, I need to know: Do you need a modem/router rental or do you have your own equipment? Also, would you prefer morning (9 AM - 12 PM) or afternoon (1 PM - 5 PM) installation?'
  },
  {
    id: '3',
    vendor: 'Amazon',
    vendorLogo: '/assets/amazon-logo.png',
    issue: 'Return wrong size shoes',
    status: 'resolved',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    orderNumber: '112-9876543-2109876',
    desiredOutcome: 'Exchange for size 10, same color',
    channel: 'chat'
  }
];

const sampleActivity: ActivityItem[] = [
  {
    id: '1',
    vendor: 'Amazon',
    type: 'alert',
    title: 'Return Window Alert',
    description: 'Return window ends in 3 days (Amazon shoes)',
    timestamp: new Date(Date.now() - 30 * 60 * 1000),
    outcome: {
      type: 'alert',
      urgency: 'high',
      deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    }
  },
  {
    id: '2',
    vendor: 'Amazon',
    type: 'task_completed',
    title: 'Return Label Issued',
    description: 'Successfully requested return for wrong size shoes. Exchange approved.',
    timestamp: new Date(Date.now() - 60 * 60 * 1000),
    outcome: {
      type: 'document',
      caseNumber: 'RMA123456',
      downloadUrl: '#'
    },
    transcriptUrl: '#'
  },
  {
    id: '3',
    vendor: 'Chase Bank',
    type: 'refund_issued',
    title: 'Fee Reversal Approved',
    description: 'Overdraft fee was reversed after explaining the error in automatic payment timing.',
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
    outcome: {
      type: 'refund',
      amount: '$35.00',
      caseNumber: 'CB789012'
    }
  },
  {
    id: '4',
    vendor: 'Best Buy',
    type: 'alert',
    title: 'Warranty Expiration',
    description: 'Extended warranty expires in 7 days (MacBook Pro)',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    outcome: {
      type: 'alert',
      urgency: 'medium',
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  },
  {
    id: '5',
    vendor: 'Comcast',
    type: 'appointment_scheduled',
    title: 'Installation Scheduled',
    description: 'Successfully scheduled internet installation for new home.',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    outcome: {
      type: 'appointment',
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    }
  }
];

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('ai-chat');
  const [activity, setActivity] = useState<ActivityItem[]>(sampleActivity);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulationTask, setSimulationTask] = useState<Task | null>(null);
  const [activityDetailsOpen, setActivityDetailsOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);
  const [additionalInfoOpen, setAdditionalInfoOpen] = useState(false);
  const [additionalInfoTask, setAdditionalInfoTask] = useState<Task | null>(null);
  const [newTaskDialogOpen, setNewTaskDialogOpen] = useState(false);
  const [initialTaskDescription, setInitialTaskDescription] = useState('');
  
  // Conversation view state
  const [showConversation, setShowConversation] = useState(false);
  const [conversationMessage, setConversationMessage] = useState('');
  const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
  const [historyInitialMessages, setHistoryInitialMessages] = useState<{ role: string; content: string }[] | null>(null);
  
  // Task badge state for +1 animation
  const [taskBadge, setTaskBadge] = useState<number | null>(null);
  
  // Pet check-up task created flag
  const [petTaskCreated, setPetTaskCreated] = useState(false);

  const [selectedCallTask, setSelectedCallTask] = useState<CallTask | null>(null);
  const [transcriptFromTask, setTranscriptFromTask] = useState<{
    open: boolean;
    callId: string | null;
    label: string;
  }>({ open: false, callId: null, label: '' });

  // Filter states
  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Use global user profile hook with persistence
  const { profile, updateProfile } = useUserProfile();
  const { user } = useDemoAuth();
  const userId = user?.id ?? null;
  const { pets, addPet, addError } = usePets(userId);

  // Tasks from Supabase (load on mount, persist on add/update)
  const {
    tasks,
    callTasks,
    setTasks,
    setCallTasks,
    isLoading: tasksLoading,
    addTask,
    updateTaskById,
    addCallTask,
    updateCallTaskByCallId,
  } = useTasks(userId);
  const { callBackendToken } = useCallBackendAuth();

  // Use task from callTasks when available so status updates (e.g. after call_ended) reflect in Task Details
  const effectiveSelectedCallTask = useMemo(
    () =>
      selectedCallTask?.callId
        ? callTasks.find((t) => t.callId === selectedCallTask.callId) ?? selectedCallTask
        : selectedCallTask ?? null,
    [callTasks, selectedCallTask]
  );
  // Stored transcript for the open transcript modal (from task.payload when viewing past record)
  const transcriptTask = transcriptFromTask.callId
    ? callTasks.find((t) => t.callId === transcriptFromTask.callId)
    : null;

  const connectedAccounts = [
    {
      id: '1',
      provider: 'Amazon',
      email: 'sarah.chen@email.com',
      status: 'connected' as const,
      lastSync: new Date(Date.now() - 2 * 60 * 60 * 1000)
    },
    {
      id: '2',
      provider: 'Google',
      email: 'sarah.chen@gmail.com',
      status: 'connected' as const,
      lastSync: new Date(Date.now() - 60 * 60 * 1000)
    }
  ];

  // Task filtering logic
  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    // Apply status filter
    if (activeFilter !== 'all') {
      if (activeFilter === 'in_progress') {
        result = result.filter(t => ['pending', 'in_progress', 'on_hold'].includes(t.status));
      } else if (activeFilter === 'needs_input') {
        result = result.filter(t => t.status === 'needs_input');
      } else if (activeFilter === 'resolved') {
        result = result.filter(t => t.status === 'resolved');
      }
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t => 
        t.vendor.toLowerCase().includes(query) ||
        t.issue.toLowerCase().includes(query) ||
        t.desiredOutcome.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [tasks, activeFilter, searchQuery]);

  const taskCounts = useMemo(() => ({
    all: tasks.length,
    in_progress: tasks.filter(t => ['pending', 'in_progress', 'on_hold'].includes(t.status)).length,
    needs_input: tasks.filter(t => t.status === 'needs_input').length,
    resolved: tasks.filter(t => t.status === 'resolved').length
  }), [tasks]);

  const taskStats = {
    total: tasks.length,
    inProgress: tasks.filter(t => ['pending', 'in_progress', 'on_hold'].includes(t.status)).length,
    resolved: tasks.filter(t => t.status === 'resolved').length,
    needsInput: tasks.filter(t => t.status === 'needs_input').length
  };

  const handleCreateTask = async (newTask: Task) => {
    if (userId) {
      await addTask(newTask);
    } else {
      setTasks([newTask, ...tasks]);
    }
    setNewTaskDialogOpen(false);
  };

  const handleStartTask = (description: string) => {
    // Open conversation view instead of task dialog
    setConversationMessage(description);
    setShowConversation(true);
  };

  const handleBackFromConversation = () => {
    setShowConversation(false);
    setConversationMessage('');
    setHistoryConversationId(null);
    setHistoryInitialMessages(null);
  };

  const handleSelectConversationToContinue = (conversationId: string, messages: { role: string; content: string }[]) => {
    setHistoryConversationId(conversationId);
    setHistoryInitialMessages(messages);
    setConversationMessage('');
    setShowConversation(true);
  };

  const handleTaskCreatedFromConversation = () => {
    // Show +1 badge
    setTaskBadge(1);
    setPetTaskCreated(true);
    
    // Clear badge after 3 seconds
    setTimeout(() => {
      setTaskBadge(null);
    }, 3000);
  };

  const handleCallTaskCreated = async (task: CallTask) => {
    if (userId) {
      const isExistingTask = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.id);
      await addCallTask(task, isExistingTask ? { skipCreate: true } : undefined);
    } else {
      setCallTasks((prev) => [task, ...prev]);
    }
    setTaskBadge(1);
    setTimeout(() => setTaskBadge(null), 3000);
  };

  const handleCallTaskStatusUpdate = async (
    callId: string,
    status: 'in_progress' | 'resolved',
    payloadPatch?: Record<string, unknown>
  ) => {
    if (userId) {
      await updateCallTaskByCallId(callId, status, payloadPatch);
    } else {
      setCallTasks((prev) =>
        prev.map((t) => {
          if (t.callId !== callId) return t;
          const nextPayload = { ...t.payload, ...payloadPatch };
          const nextCallId =
            payloadPatch?.callId != null
              ? String(payloadPatch.callId)
              : t.callId;
          return { ...t, status, callId: nextCallId, payload: nextPayload };
        })
      );
    }
  };

  const handleRetryCall = async (
    callId: string,
    purpose: string
  ): Promise<{ newCallId: string } | null> => {
    const task = callTasks.find((t) => t.callId === callId);
    if (!task) return null;
    const result = await retryCall(callId, purpose, {
      callBackendToken: callBackendToken ?? undefined,
      phone_number: (task.payload?.phone_number as string) ?? undefined,
    });
    if (!result) return null;
    const mergedPayload = {
      ...(task.payload || {}),
      callId: result.callId,
      hasRetried: true,
    };
    await handleCallTaskStatusUpdate(callId, 'in_progress', mergedPayload);
    return { newCallId: result.callId };
  };

  const handleUpdateProfile = (field: string, value: string) => {
    updateProfile(field, value);
  };

  const handleConnectAccount = (provider: string) => {
    console.log(`Connecting to ${provider}...`);
  };

  const handleViewTaskDetails = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setSelectedTask(task);
      setTaskDetailsOpen(true);
    }
  };

  const handleTakeAction = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      if (task.status === 'needs_input') {
        setAdditionalInfoTask(task);
        setAdditionalInfoOpen(true);
      } else {
        setSimulationTask(task);
        setSimulationOpen(true);
      }
    }
  };

  const handleTaskStatusChange = async (status: 'in_progress' | 'resolved') => {
    if (simulationTask) {
      if (userId) {
        await updateTaskById(simulationTask.id, { status });
      } else {
        setTasks(prevTasks =>
          prevTasks.map(t =>
            t.id === simulationTask.id ? { ...t, status } : t
          )
        );
      }
      if (selectedTask?.id === simulationTask.id) {
        setSelectedTask(prev => prev ? { ...prev, status } : null);
      }
    }
  };

  const handleSimulationComplete = async (updatedTask: Task) => {
    if (userId) {
      await updateTaskById(updatedTask.id, {
        status: updatedTask.status,
        payload: taskToPayload(updatedTask),
      });
    } else {
      setTasks(prevTasks =>
        prevTasks.map(t => t.id === updatedTask.id ? updatedTask : t)
      );
    }
    if (selectedTask?.id === updatedTask.id) {
      setSelectedTask(updatedTask);
    }
  };

  const handleViewActivityDetails = (activity: ActivityItem) => {
    setSelectedActivity(activity);
    setActivityDetailsOpen(true);
  };

  const handleViewTranscript = (activityId: string) => {
    const activity = sampleActivity.find(a => a.id === activityId);
    if (activity) {
      handleViewActivityDetails(activity);
    }
  };

  const handleDownloadDocument = (url: string) => {
    console.log('Downloading document from:', url);
  };

  const handleSubmitAdditionalInfo = async (taskId: string, additionalInfo: string) => {
    if (userId) {
      await updateTaskById(taskId, { status: 'in_progress' });
    } else {
      setTasks(prevTasks =>
        prevTasks.map(t =>
          t.id === taskId ? { ...t, status: 'in_progress' as const } : t
        )
      );
    }
    console.log(`Additional info submitted for task ${taskId}:`, additionalInfo);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar - collapsed when in conversation */}
      <DashboardSidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        collapsed={showConversation}
        taskBadge={taskBadge}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-background overflow-hidden">
        {activeTab === 'ai-chat' && !showConversation && (
          <AIChatHome
            onStartTask={handleStartTask}
            onSelectConversationToContinue={handleSelectConversationToContinue}
          />
        )}

        {activeTab === 'ai-chat' && showConversation && (
          <ConversationView 
            initialMessage={conversationMessage}
            onBack={handleBackFromConversation}
            initialConversationId={historyConversationId ?? undefined}
            initialMessages={historyInitialMessages ?? undefined}
            onTaskCreated={handleTaskCreatedFromConversation}
            onCallTaskCreated={handleCallTaskCreated}
            onCallTaskStatusUpdate={handleCallTaskStatusUpdate}
          />
        )}

        {activeTab === 'tasks' && (
          <TasksView
            showPetTask={petTaskCreated}
            callTasks={callTasks}
            tasks={tasks}
            selectedCallTask={effectiveSelectedCallTask}
            onSelectCallTask={setSelectedCallTask}
            onWatchTranscript={(callId, label) =>
              setTranscriptFromTask({ open: true, callId, label })
            }
            onCallEnded={async (callId) => {
              const task = callTasks.find((t) => t.callId === callId);
              const purpose = task?.description || task?.title || '';
              await handleCallTaskStatusUpdate(callId, 'resolved');
              const result = await summarizeCall(callId, purpose, {
                callBackendToken: callBackendToken ?? undefined,
              });
              if (result?.summary) {
                await handleCallTaskStatusUpdate(callId, 'resolved', {
                  callSummary: result.summary,
                  usefulInfoObtained: result.usefulInfoObtained,
                });
              }
            }}
            onRetryCall={handleRetryCall}
          />
        )}

        {activeTab === 'activity' && (
          <div className="flex-1 p-8 max-w-5xl mx-auto w-full bg-[hsl(250_30%_99%)]">
            <div className="space-y-8">
              {/* Page Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
                    <Activity className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
                    <p className="text-sm text-gray-500">Track your call outcomes and alerts</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600">
                  {activity.length} items
                </Badge>
              </div>
              
              {activity.length > 0 ? (
                <ActivityFeed 
                  activities={activity}
                  onViewTranscript={handleViewTranscript}
                  onDownload={handleDownloadDocument}
                  onViewDetails={handleViewActivityDetails}
                />
              ) : (
                <Card className="border-dashed border-2 border-gray-200">
                  <CardContent className="py-16 text-center">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                      <Activity className="w-6 h-6 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No activity yet</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto">
                      Your task history and updates will appear here
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full bg-[hsl(250_30%_99%)]">
              <div className="space-y-6 pb-8">
                <h2 className="text-2xl font-bold text-gray-900">Profile Settings</h2>
                <ProfileSection 
                  profile={profile}
                  connectedAccounts={connectedAccounts}
                  onUpdateProfile={handleUpdateProfile}
                  onConnectAccount={handleConnectAccount}
                />
                <PetProfilesSection pets={pets} onAddPet={addPet} addError={addError} />
              </div>
            </div>
          </div>
        )}


        {activeTab === 'settings' && (
          <div className="flex-1 p-8 max-w-5xl mx-auto w-full bg-[hsl(250_30%_99%)]">
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
              <p className="text-gray-500">Application settings coming soon.</p>
            </div>
          </div>
        )}
      </div>

      <NewTaskDialog 
        onCreateTask={handleCreateTask}
        open={newTaskDialogOpen}
        onOpenChange={setNewTaskDialogOpen}
        initialDescription={initialTaskDescription}
      />
      <TaskDetailsDialog 
        task={selectedTask}
        open={taskDetailsOpen}
        onOpenChange={setTaskDetailsOpen}
      />
      <SimulationModal 
        open={simulationOpen}
        onOpenChange={setSimulationOpen}
        task={simulationTask}
        onStatusChange={handleTaskStatusChange}
        onComplete={handleSimulationComplete}
      />
      <ActivityDetailsDialog 
        activity={selectedActivity}
        open={activityDetailsOpen}
        onOpenChange={setActivityDetailsOpen}
      />
      <AdditionalInfoDialog
        task={additionalInfoTask}
        open={additionalInfoOpen}
        onOpenChange={setAdditionalInfoOpen}
        onSubmit={handleSubmitAdditionalInfo}
      />

      {/* Transcript modal when opened from Tasks tab (call task details) */}
      {transcriptFromTask.callId && (
        <LiveTranscriptModal
          open={transcriptFromTask.open}
          onOpenChange={(open) =>
            setTranscriptFromTask((prev) =>
              open ? { ...prev, open: true } : { open: false, callId: null, label: '' }
            )
          }
          clinicName={transcriptFromTask.label}
          callId={transcriptFromTask.callId}
          initialTranscript={
            (() => {
              const t = transcriptTask?.payload?.transcript;
              return typeof t === 'string' ? t : undefined;
            })()
          }
          initialCallDuration={
            (() => {
              const d = transcriptTask?.payload?.callDuration;
              return d != null ? String(d) : undefined;
            })()
          }
          onCallComplete={async (quote, transcriptText, callDuration) => {
            if (transcriptFromTask.callId) {
              const callId = transcriptFromTask.callId;
              await handleCallTaskStatusUpdate(callId, 'resolved', {
                transcript: transcriptText,
                quote,
                callDuration,
              });
              const task = callTasks.find((t) => t.callId === callId);
              const purpose = task?.description || task?.title || '';
              const result = await summarizeCall(callId, purpose, {
                callBackendToken: callBackendToken ?? undefined,
                transcript: transcriptText,
              });
              if (result?.summary) {
                await handleCallTaskStatusUpdate(callId, 'resolved', {
                  callSummary: result.summary,
                  usefulInfoObtained: result.usefulInfoObtained,
                });
              }
            }
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;
