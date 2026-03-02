import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Phone, FileText, CheckCircle, Clock, RefreshCw, MessageSquare } from 'lucide-react';
import { getCallStatus } from '@/lib/chatApi';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';
import type { CallTask } from './ConversationView';

interface CallTaskDetailsViewProps {
  task: CallTask;
  onBack: () => void;
  onWatchTranscript: (callId: string, label: string) => void;
  /** When call is detected as ended (e.g. via polling), update task to resolved */
  onCallEnded?: (callId: string) => void;
}

function isEndedStatus(s: string): boolean {
  return s === 'ended' || s === 'done' || s === 'completed';
}

export function CallTaskDetailsView({ task, onBack, onWatchTranscript, onCallEnded }: CallTaskDetailsViewProps) {
  const { callBackendToken } = useCallBackendAuth();
  const [isOngoing, setIsOngoing] = useState(task.status === 'in_progress');
  const onCallEndedRef = useRef(onCallEnded);
  onCallEndedRef.current = onCallEnded;

  // Poll call status when task shows in progress so we detect call_ended even if transcript modal wasn't open
  useEffect(() => {
    if (task.status !== 'in_progress' || !task.callId) return;
    const opts = { callBackendToken: callBackendToken ?? undefined };
    const intervalId = setInterval(async () => {
      const status = await getCallStatus(task.callId, opts);
      if (status && isEndedStatus(status.status)) {
        setIsOngoing(false);
        onCallEndedRef.current?.(task.callId);
      }
    }, 4000);
    return () => clearInterval(intervalId);
  }, [task.status, task.callId, callBackendToken]);

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
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-5">
              <CheckCircle className="w-5 h-5 text-gray-600" />
              <h2 className="text-lg font-semibold text-gray-900">Summary</h2>
            </div>
            <div className="min-h-[80px] text-gray-700 text-sm leading-relaxed">
              {(task.callSummary ?? task.payload?.callSummary) ? (
                (task.callSummary ?? String(task.payload?.callSummary))
              ) : (
                <span className="text-gray-400">
                  {isOngoing
                    ? 'Summary will appear after the call ends.'
                    : 'No summary available for this call.'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
