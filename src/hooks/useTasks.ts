import { useState, useEffect, useCallback } from 'react';
import { getTasks, createTask, updateTask, type TaskRowFromApi } from '@/lib/chatApi';
import type { Task } from '@/components/TaskCard';
import type { CallTask } from '@/components/dashboard/ConversationView';

function rowToTask(row: TaskRowFromApi): Task {
  const p = row.payload || {};
  return {
    id: row.id,
    vendor: (p.vendor as string) ?? 'Unknown',
    vendorLogo: p.vendorLogo as string | undefined,
    issue: (p.issue as string) ?? '',
    status: (row.status as Task['status']) ?? 'pending',
    createdAt: new Date(row.created_at),
    eta: p.eta as string | undefined,
    orderNumber: p.orderNumber as string | undefined,
    desiredOutcome: (p.desiredOutcome as string) ?? '',
    channel: p.channel as Task['channel'],
    holdTime: p.holdTime as string | undefined,
    transcript: p.transcript as string | undefined,
    callSummary: p.callSummary as Task['callSummary'],
  };
}

const CALL_TASK_STATUSES: Set<string> = new Set(['in_progress', 'needs_input', 'resolved']);

function rowToCallTask(row: TaskRowFromApi): CallTask {
  const p = row.payload || {};
  const rawStatus = row.status;
  const status = CALL_TASK_STATUSES.has(String(rawStatus))
    ? (rawStatus as CallTask['status'])
    : 'in_progress';
  return {
    id: row.id,
    callId: (p.callId as string) ?? '',
    title: (p.title as string) ?? (p.callReason as string) ?? '',
    description: (p.description as string) ?? '',
    vendor: (p.vendor as string) ?? 'Phone Call',
    createdAt: new Date(row.created_at),
    priority: (p.priority as CallTask['priority']) ?? 'medium',
    status,
    callSummary: (p.callSummary as string) ?? undefined,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
}

function isCallTaskRow(row: TaskRowFromApi): boolean {
  const p = row.payload || {};
  return p.type === 'call' || typeof p.callId === 'string';
}

/** Build API payload from a Task (for create/update). */
export function taskToPayload(task: Omit<Task, 'id'> & { id?: string }): Record<string, unknown> {
  return {
    type: 'generic',
    vendor: task.vendor,
    vendorLogo: task.vendorLogo,
    issue: task.issue,
    eta: task.eta,
    orderNumber: task.orderNumber,
    desiredOutcome: task.desiredOutcome,
    channel: task.channel,
    holdTime: task.holdTime,
    transcript: task.transcript,
    callSummary: task.callSummary,
  };
}

function callTaskToPayload(task: Omit<CallTask, 'id'> & { id?: string }): Record<string, unknown> {
  return {
    type: 'call',
    callId: task.callId,
    title: task.title,
    description: task.description,
    vendor: task.vendor,
    priority: task.priority,
    callSummary: task.callSummary,
  };
}

/**
 * Load and persist tasks from Supabase. Splits into tasks (generic) and callTasks (from calls).
 * When userId is null, returns empty lists and no-ops for mutations.
 */
export function useTasks(userId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [callTasks, setCallTasks] = useState<CallTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setTasks([]);
      setCallTasks([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rows = await getTasks(userId);
      const generic: Task[] = [];
      const call: CallTask[] = [];
      for (const row of rows) {
        if (isCallTaskRow(row)) {
          call.push(rowToCallTask(row));
        } else {
          generic.push(rowToTask(row));
        }
      }
      setTasks(generic);
      setCallTasks(call);
    } catch (e) {
      console.error('useTasks load failed', e);
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
      setTasks([]);
      setCallTasks([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const addTask = useCallback(
    async (task: Omit<Task, 'id'> & { id?: string }) => {
      if (!userId) return null;
      const payload = taskToPayload(task);
      const status = (task as Task).status ?? 'pending';
      const row = await createTask(userId, { status, payload });
      if (row) {
        setTasks((prev) => [rowToTask(row), ...prev]);
        return rowToTask(row);
      }
      return null;
    },
    [userId]
  );

  const updateTaskById = useCallback(
    async (taskId: string, updates: Partial<Pick<Task, 'status'>> & { payload?: Record<string, unknown> }) => {
      if (!userId) return null;
      const row = await updateTask(userId, taskId, {
        status: updates.status,
        payload: updates.payload,
      });
      if (row) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? rowToTask(row) : t)));
        return rowToTask(row);
      }
      return null;
    },
    [userId]
  );

  const addCallTask = useCallback(
    async (task: CallTask, options?: { skipCreate?: boolean }) => {
      if (!userId) return null;
      if (options?.skipCreate) {
        setCallTasks((prev) => [task, ...prev]);
        return task;
      }
      const payload = callTaskToPayload(task);
      const row = await createTask(userId, { status: task.status, payload });
      if (row) {
        const mapped = rowToCallTask(row);
        setCallTasks((prev) => [mapped, ...prev]);
        return mapped;
      }
      return null;
    },
    [userId]
  );

  const updateCallTaskByCallId = useCallback(
    async (callId: string, status: CallTask['status'], payloadPatch?: Record<string, unknown>) => {
      if (!userId) return null;
      const existing = callTasks.find((t) => t.callId === callId);
      if (!existing) return null;
      const row = await updateTask(userId, existing.id, {
        status,
        payload: payloadPatch,
      });
      if (row) {
        const mapped = rowToCallTask(row);
        setCallTasks((prev) => prev.map((t) => (t.callId === callId ? mapped : t)));
        return mapped;
      }
      return null;
    },
    [userId, callTasks]
  );

  return {
    tasks,
    callTasks,
    setTasks,
    setCallTasks,
    isLoading,
    error,
    reload: load,
    addTask,
    updateTaskById,
    addCallTask,
    updateCallTaskByCallId,
  };
}
