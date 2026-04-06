import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Phone, FileText, CheckCircle, Clock, RefreshCw, MessageSquare, AlertCircle } from 'lucide-react';
import {
  CALL_STATUS_SESSION_GRACE_MS,
  getCallStatusWithMeta,
  isCallEndedStatus,
} from '@/lib/chatApi';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';
import type { CallTask } from './ConversationView';

interface CallTaskDetailsViewProps {
  task: CallTask;
  onBack: () => void;
  onWatchTranscript: (callId: string, label: string) => void;
  /** When call is detected as ended (e.g. via polling), update task to resolved */
  onCallEnded?: (callId: string) => void;
  /** Retry the call with same purpose (once). Called when user clicks Retry after no useful info was obtained. */
  onRetryCall?: (callId: string, purpose: string) => Promise<{ newCallId: string } | null>;
}

const NO_TRANSCRIPT_MSG =
  'No transcript available for this call. Summary will appear after the call is processed.';

/** After this many consecutive failed status polls (e.g. TLS ECONNRESET to call backend), treat task as ended. */
const STATUS_POLL_FAILURES_BEFORE_RESOLVE = 3;

function SummarySection({
  task,
  isOngoing,
  onRetryCall,
}: {
  task: CallTask;
  isOngoing: boolean;
  onRetryCall?: (callId: string, purpose: string) => Promise<{ newCallId: string } | null>;
}) {
  const [retrying, setRetrying] = useState(false);
  const summary = task.callSummary ?? task.payload?.callSummary;
  const summaryStr = typeof summary === 'string' ? summary : '';
  const usefulInfoObtained = task.payload?.usefulInfoObtained !== false;
  const hasRetried = task.payload?.hasRetried === true;
  const showRetry =
    !isOngoing &&
    summaryStr &&
    summaryStr !== NO_TRANSCRIPT_MSG &&
    usefulInfoObtained === false &&
    hasRetried !== true &&
    onRetryCall;

  const handleRetry = async () => {
    if (!onRetryCall || !task.callId) return;
    setRetrying(true);
    try {
      await onRetryCall(task.callId, task.description || task.title || '');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-5">
        <CheckCircle className="w-5 h-5 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
      </div>
      <div className="min-h-[80px] text-gray-700 text-sm leading-relaxed space-y-4">
        {summaryStr ? (
          summaryStr
        ) : (
          <span className="text-gray-400">
            {isOngoing
              ? 'Summary will appear after the call ends.'
              : 'No summary available for this call.'}
          </span>
        )}
        {showRetry && (
          <div className="pt-2 border-t border-gray-100">
            <p className="flex items-center gap-2 text-amber-700 text-sm mb-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              We didn’t get the information we needed during this call. Do you want to retry?
            </p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'Retrying…' : 'Retry call'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CallTaskDetailsView({ task, onBack, onWatchTranscript, onCallEnded, onRetryCall }: CallTaskDetailsViewProps) {
  const { callBackendToken } = useCallBackendAuth();
  const [isOngoing, setIsOngoing] = useState(task.status === 'in_progress');
  const onCallEndedRef = useRef(onCallEnded);
  onCallEndedRef.current = onCallEnded;
  const statusPollFailuresRef = useRef(0);

  // Poll call status when task shows in progress so we detect call_ended even if transcript modal wasn't open
  useEffect(() => {
    if (task.status !== 'in_progress' || !task.callId) return;
    statusPollFailuresRef.current = 0;
    const openedAtMs = Date.now();
    const taskCreatedMs =
      task.createdAt instanceof Date && !Number.isNaN(task.createdAt.getTime())
        ? task.createdAt.getTime()
        : openedAtMs;
    const pastSessionGrace = () => Date.now() - openedAtMs >= CALL_STATUS_SESSION_GRACE_MS;
    const taskOlderThanGrace = () => Date.now() - taskCreatedMs >= CALL_STATUS_SESSION_GRACE_MS;

    const opts = { callBackendToken: callBackendToken ?? undefined };
    const tick = async () => {
      const meta = await getCallStatusWithMeta(task.callId, opts);
      if (meta.ok) {
        statusPollFailuresRef.current = 0;
        if (isCallEndedStatus(meta.data.status)) {
          setIsOngoing(false);
          onCallEndedRef.current?.(task.callId);
        }
        return;
      }
      // 404 can appear before the call row exists; only trust "not found" for an older task or after grace.
      if (meta.callNotFound) {
        statusPollFailuresRef.current = 0;
        if (taskOlderThanGrace() || pastSessionGrace()) {
          setIsOngoing(false);
          onCallEndedRef.current?.(task.callId);
        }
        return;
      }
      // Unreachable call backend: count only after grace (or stale task) so we don't resolve a brand-new call on blips.
      if (!pastSessionGrace() && !taskOlderThanGrace()) return;
      statusPollFailuresRef.current += 1;
      if (statusPollFailuresRef.current >= STATUS_POLL_FAILURES_BEFORE_RESOLVE) {
        statusPollFailuresRef.current = 0;
        setIsOngoing(false);
        onCallEndedRef.current?.(task.callId);
      }
    };
    void tick();
    const intervalId = setInterval(() => void tick(), 4000);
    return () => clearInterval(intervalId);
  }, [
    task.status,
    task.callId,
    callBackendToken,
    task.createdAt instanceof Date ? task.createdAt.getTime() : 0,
  ]);

  // Sync isOngoing when task prop changes (e.g. after parent updated from modal's onCallComplete)
  useEffect(() => {
    setIsOngoing(task.status === 'in_progress');
  }, [task.status]);
  // Title is intent domain (e.g. pet_services); format for display as Issue Type
  const issueType =
    typeof task.title === 'string'
      ? task.title.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : task.title ?? 'Unknown';
  const callLabel = task.vendor === 'Phone Call' ? issueType : `${task.vendor} - Billing Department`;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[hsl(250_30%_99%)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Call"
          >
            <Phone className="w-5 h-5" />
          </button>
        </div>
        <h1 className="text-lg font-semibold text-gray-900 truncate max-w-[calc(100%-6rem)]">
          Task Details - {issueType.slice(0, 40)}{issueType.length > 40 ? '...' : ''}
        </h1>
        <div className="w-[4.5rem]" />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* 1. Client Request */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <FileText className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Client Request</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Issue Type</p>
                <p className="font-medium text-gray-900">{issueType}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Provider</p>
                <p className="font-medium text-gray-900">{task.vendor}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Description</p>
                <p className="font-medium text-gray-900">{task.description}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${
                    isOngoing
                      ? 'bg-blue-50 text-blue-600 border-blue-200'
                      : 'bg-green-50 text-green-600 border-green-200'
                  }`}
                >
                  {isOngoing ? (
                    <>
                      <Clock className="w-3.5 h-3.5" />
                      In Progress
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      Resolved
                    </>
                  )}
                </span>
              </div>
              <div>
                <p className="text-sm text-gray-500">Created Time</p>
                <p className="font-medium text-gray-900">
                  {task.createdAt instanceof Date && !Number.isNaN(task.createdAt.getTime())
                    ? task.createdAt.toLocaleString(undefined, {
                        month: 'numeric',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* 2. Call Record */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <Phone className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Call Record</h2>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Department</p>
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-400" />
                  {callLabel}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">Call Status</p>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${
                    isOngoing
                      ? 'bg-blue-50 text-blue-600 border-blue-200'
                      : 'bg-green-50 text-green-600 border-green-200'
                  }`}
                >
                  {isOngoing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Ongoing
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      Resolved
                    </>
                  )}
                </span>
              </div>
              {isOngoing && (
                <p className="text-sm text-gray-600">Currently on the line with billing support...</p>
              )}
              {isOngoing && (
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full animate-pulse"
                    style={{ width: '45%' }}
                  />
                </div>
              )}
              <button
                onClick={() => onWatchTranscript(task.callId, callLabel)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                Transcript record
              </button>
            </div>
          </div>

          {/* 3. AI call summary (with respect to purpose) */}
          <SummarySection
            task={task}
            isOngoing={isOngoing}
            onRetryCall={onRetryCall}
          />
        </div>
      </div>
    </div>
  );
}
