import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Phone, PhoneOff, Mic, Volume2 } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { getCallStatus, getCallBackendUrl, getTranscripts } from '@/lib/chatApi';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';

interface TranscriptLine {
  speaker: 'clinic' | 'ai';
  text: string;
  timestamp: string;
  displayedText?: string;
  isTyping?: boolean;
}

/** Parse stored transcript string ("AI: ...\nCustomer: ...") back to TranscriptLine[]. */
function parseStoredTranscript(text: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const raw = text.trim();
  if (!raw) return lines;
  for (const line of raw.split('\n')) {
    const m = line.match(/^(AI|Customer|Holdless):\s*(.+)$/i);
    if (m) {
      const speaker = m[1].toLowerCase() === 'ai' || m[1].toLowerCase() === 'holdless' ? 'ai' : 'clinic';
      lines.push({ speaker, text: m[2].trim(), timestamp: '' });
    } else if (line.trim()) {
      lines.push({ speaker: 'clinic', text: line.trim(), timestamp: '' });
    }
  }
  return lines;
}

interface LiveTranscriptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinicName: string;
  /** When provided, polls API for real transcript (Realtime call). When omitted, uses scripted demo. */
  callId?: string | null;
  /** When provided, show this transcript immediately (e.g. from task.payload) and skip "Connecting". */
  initialTranscript?: string | null;
  /** When provided with initialTranscript, display this as the call duration (e.g. "2:15"). */
  initialCallDuration?: string | null;
  onCallComplete: (quote: string, includes: string, callDuration: string) => void;
}

/** call_ended event payload (CREATE_CALL_API.md § Getting Live Transcripts). Strong signal: call ended → update UI, stop live state. */
interface CallEndedPayload {
  call_id: string;
  outcome?: string;
  duration: number;
  ended_at?: string;
}

const transcriptScript: Omit<TranscriptLine, 'timestamp'>[] = [
  { speaker: 'clinic', text: "Thank you for calling Pet Care Center, this is Maria speaking. How may I help you today?" },
  { speaker: 'ai', text: "Hi! I want to know the price for a cat spay surgery." },
  { speaker: 'clinic', text: "Of course! Is this for a kitten or an adult cat?" },
  { speaker: 'ai', text: "It's for an adult cat, about 2 years old." },
  { speaker: 'clinic', text: "Perfect. For an adult cat spay, our price is $189." },
  { speaker: 'ai', text: "Does that include post-operative care?" },
  { speaker: 'clinic', text: "Yes, it includes bloodwork, pain meds for 3 days, and a follow-up visit." },
  { speaker: 'ai', text: "Great. What about a recovery cone?" },
  { speaker: 'clinic', text: "We provide a complimentary e-collar with the surgery." },
  { speaker: 'ai', text: "Any additional fees?" },
  { speaker: 'clinic', text: "No hidden fees. The $189 covers everything. Just fast your cat 12 hours before." },
  { speaker: 'ai', text: "Perfect, thank you so much!" },
  { speaker: 'clinic', text: "You're welcome! Have a great day!" },
];

// Typewriter component for word-by-word display
function TypewriterText({ 
  text, 
  onComplete, 
  speed = 50 
}: { 
  text: string; 
  onComplete?: () => void; 
  speed?: number;
}) {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const words = text.split(' ');

  useEffect(() => {
    if (currentIndex < words.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + (prev ? ' ' : '') + words[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timer);
    } else if (onComplete) {
      onComplete();
    }
  }, [currentIndex, words, speed, onComplete]);

  return <>{displayedText}</>;
}

function parseDurationToSeconds(s: string): number {
  const parts = String(s).trim().split(':').map(Number);
  if (parts.length >= 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] ?? 0;
  return 0;
}

export function LiveTranscriptModal({ 
  open, 
  onOpenChange, 
  clinicName,
  callId,
  initialTranscript,
  initialCallDuration,
  onCallComplete 
}: LiveTranscriptModalProps) {
  const { callBackendToken } = useCallBackendAuth();
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [isCallActive, setIsCallActive] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [isCurrentLineTyping, setIsCurrentLineTyping] = useState(false);
  /** True while we're retrying to fetch transcript after call ended (backend may delay persisting). */
  const [isLoadingTranscriptAfterEnd, setIsLoadingTranscriptAfterEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const callDurationRef = useRef(0);
  const useRealTranscript = Boolean(callId);
  const callStatusOpts = { callBackendToken: callBackendToken ?? undefined };

  callDurationRef.current = callDuration;

  // Reset state when modal opens; if we have stored transcript, show it immediately
  useEffect(() => {
    if (open) {
      const raw = initialTranscript;
      const stored = (typeof raw === 'string' ? raw : '').trim();
      if (stored) {
        setTranscript(parseStoredTranscript(stored));
        setIsCallActive(false);
        setCallDuration(initialCallDuration != null ? parseDurationToSeconds(String(initialCallDuration)) : 0);
        setCurrentLineIndex(0);
        setIsCurrentLineTyping(false);
      } else {
        setTranscript([]);
        setCurrentLineIndex(0);
        setIsCallActive(true);
        setCallDuration(0);
        setIsCurrentLineTyping(false);
      }
    }
  }, [open, initialTranscript, initialCallDuration]);

  // Call duration timer
  useEffect(() => {
    if (!open || !isCallActive) return;
    
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [open, isCallActive]);

  // Real transcript: prefer GET /api/calls/:id/transcripts when loading past call; else Socket.io + getCallStatus polling
  // Skip when we have stored transcript (viewing past record) so we don't overwrite or show "Connecting"
  useEffect(() => {
    if (!open || !callId || !useRealTranscript || (initialTranscript ?? '').trim()) return;

    let socket: Socket | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const retryTimeouts: ReturnType<typeof setTimeout>[] = [];
    const duration = () => callDurationRef.current;

    const clearRetries = () => {
      retryTimeouts.forEach(clearTimeout);
      retryTimeouts.length = 0;
    };

    const applyTranscript = (lines: TranscriptLine[]) => {
      setTranscript(lines);
    };

    const finishCall = (lines: TranscriptLine[], finalDurationSec: number) => {
      clearRetries();
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
      setIsCallActive(false);
      const summary = lines.map((l) => `${l.speaker === 'ai' ? 'AI' : 'Customer'}: ${l.text}`).join('\n');
      onCallComplete(
        summary.slice(0, 200) || 'Call completed',
        summary || 'Transcript',
        formatDuration(finalDurationSec)
      );
    };

    const toTranscriptLine = (t: { role?: string; content?: string; text?: string; message?: string; timestamp?: string; speaker?: string }): TranscriptLine => ({
      speaker: (t.role === 'user' || t.role === 'customer' || t.role === 'human' || t.speaker === 'human') ? 'clinic' : 'ai',
      text: (t.content ?? t.text ?? t.message ?? '').trim(),
      timestamp: t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : formatDuration(duration()),
    });

    const isEndedStatus = (s: string) => s === 'ended' || s === 'done' || s === 'completed';

    /** Fetch transcript after call ended; backend may need a few seconds to persist. Retries with backoff. */
    const fetchTranscriptAfterEnd = async (
      finalDurationSec: number,
    ): Promise<TranscriptLine[]> => {
      setIsLoadingTranscriptAfterEnd(true);
      const delays = [800, 2000, 4500];
      try {
        for (const delayMs of delays) {
          await new Promise((r) => setTimeout(r, delayMs));
          const transcriptsRes = await getTranscripts(callId, callStatusOpts);
          if (transcriptsRes?.success && transcriptsRes.transcripts?.length > 0) {
            return transcriptsRes.transcripts.map((t) => ({
              speaker: (t.speaker === 'human' ? 'clinic' : 'ai') as 'clinic' | 'ai',
              text: t.message,
              timestamp: t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '',
            }));
          }
          const status = await getCallStatus(callId, callStatusOpts);
          if (status?.transcript?.length) {
            return status.transcript.map((t) => toTranscriptLine(t));
          }
        }
        return [];
      } finally {
        setIsLoadingTranscriptAfterEnd(false);
      }
    };

    const poll = async () => {
      const status = await getCallStatus(callId, callStatusOpts);
      if (!status) return;
      const lines: TranscriptLine[] = (status.transcript || []).map((t) => toTranscriptLine(t));
      applyTranscript(lines);
      if (isEndedStatus(status.status)) {
        const finalDuration = status.endedAt && status.startedAt
          ? Math.floor((new Date(status.endedAt).getTime() - new Date(status.startedAt).getTime()) / 1000)
          : duration();
        setCallDuration(finalDuration);
        if (lines.length > 0) {
          finishCall(lines, finalDuration);
        } else {
          fetchTranscriptAfterEnd(finalDuration).then((retryLines) => {
            if (retryLines.length > 0) applyTranscript(retryLines);
            finishCall(retryLines.length > 0 ? retryLines : lines, finalDuration);
          });
        }
      }
    };

    (async () => {
      // Prefer GET /api/calls/:id/transcripts for past/ended calls (full conversation, ordered by timestamp).
      // For just-ended calls, backend may not have transcript yet; retry a few times.
      const tryGetTranscripts = async (attempt = 0): Promise<boolean> => {
        const transcriptsRes = await getTranscripts(callId, callStatusOpts);
        if (transcriptsRes?.success && transcriptsRes.transcripts?.length > 0) {
          const lines: TranscriptLine[] = transcriptsRes.transcripts.map((t) => ({
            speaker: t.speaker === 'human' ? 'clinic' : 'ai',
            text: t.message,
            timestamp: t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '',
          }));
          applyTranscript(lines);
          const firstTs = transcriptsRes.transcripts[0]?.timestamp;
          const lastTs = transcriptsRes.transcripts[transcriptsRes.transcripts.length - 1]?.timestamp;
          const finalDuration =
            firstTs && lastTs
              ? Math.max(0, Math.floor((new Date(lastTs).getTime() - new Date(firstTs).getTime()) / 1000))
              : duration();
          setCallDuration(finalDuration);
          setIsCallActive(false);
          return true;
        }
        if (attempt < 2) {
          retryTimeouts.push(setTimeout(() => tryGetTranscripts(attempt + 1), attempt === 0 ? 2000 : 4000));
        }
        return false;
      };
      if (await tryGetTranscripts()) return;

      // Fallback: poll getCallStatus + socket for live or legacy backend
      poll();
      retryTimeouts.push(setTimeout(() => poll(), 1500));
      retryTimeouts.push(setTimeout(() => poll(), 3500));

      (async () => {
        const baseUrl = await getCallBackendUrl();
      const token = (callBackendToken ?? '').trim();

      if (baseUrl) {
        try {
          socket = io(baseUrl, {
            auth: token ? { token } : undefined,
            transports: ['websocket', 'polling'],
          });

          // Backend expects join_call with callId string (see backend Socket.io docs)
          socket.on('connect', () => {
            socket?.emit('join_call', callId);
            socket?.emit('subscribe', { callId }); // optional; backends that use it can treat same as join_call
          });

          // Single-segment events (backend may emit transcript_line or transcript with one segment)
          const appendSegment = (t: Record<string, unknown>) => {
            setTranscript((prev) => [...prev, toTranscriptLine({
              role: t.role as string,
              content: t.content as string,
              text: t.text as string,
              message: t.message as string,
              timestamp: t.timestamp as string,
            })]);
          };

          socket.on('transcript_line', (payload: unknown) => {
            const t = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
            appendSegment(t);
          });

          // Backend emits "transcript" per segment: { id, call_id, speaker: "ai"|"human", message, timestamp }
          socket.on('transcript', (payload: unknown) => {
            if (Array.isArray(payload)) {
              const lines = payload.map((item) => toTranscriptLine(
                typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
              ));
              if (lines.length) applyTranscript(lines);
              return;
            }
            const d = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
            if (d.lines !== undefined) {
              const arr = Array.isArray(d.lines) ? d.lines : [];
              const lines = arr.map((item: unknown) => toTranscriptLine(
                typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
              ));
              if (lines.length) applyTranscript(lines);
              return;
            }
            // Single segment: backend shape { speaker, message, timestamp } (speaker "human"|"ai")
            if (d.speaker != null && d.message != null) {
              appendSegment({
                role: d.speaker,
                content: d.message as string,
                message: d.message,
                timestamp: d.timestamp as string,
              });
            }
          });

          // Backend: call_status = { call_id, status, duration? }; treat "completed" as ended
          const handleStatus = (data: unknown) => {
            const d = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
            const statusVal = (d.status as string) ?? (d.call_status as string);
            const rawTranscript = d.transcript ?? d.lines;
            const arr = Array.isArray(rawTranscript) ? rawTranscript : [];
            const lines = arr.map((item: unknown) => toTranscriptLine(
              typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
            ));
            if (lines.length) applyTranscript(lines);
            const isEnded = statusVal === 'ended' || statusVal === 'done' || statusVal === 'completed';
            if (isEnded) {
              const started = d.started_at ?? d.startedAt ?? d.start;
              const ended = d.ended_at ?? d.endedAt ?? d.end;
              const payloadDuration = typeof d.duration === 'number' ? d.duration : undefined;
              const finalDuration = started && ended
                ? Math.floor((new Date(ended as string).getTime() - new Date(started as string).getTime()) / 1000)
                : (payloadDuration ?? duration());
              if (lines.length > 0) {
                finishCall(lines, finalDuration);
              } else {
                fetchTranscriptAfterEnd(finalDuration).then((retryLines) => {
                  if (retryLines.length > 0) applyTranscript(retryLines);
                  finishCall(retryLines.length > 0 ? retryLines : [], finalDuration);
                });
              }
            }
          };

          socket.on('call_status', handleStatus);
          socket.on('status', handleStatus);

          // Strong "call ended" signal from backend (CREATE_CALL_API.md § Getting Live Transcripts).
          socket.on('call_ended', (payload?: unknown) => {
            const data = (typeof payload === 'object' && payload !== null ? payload : {}) as CallEndedPayload & Record<string, unknown>;
            const finalDuration = typeof data.duration === 'number' ? data.duration : duration();
            setCallDuration(finalDuration);
            // Apply transcript if backend included it (optional; often sent via transcript/call_status)
            const rawTranscript = data.transcript ?? data.lines;
            const arr = Array.isArray(rawTranscript) ? rawTranscript : [];
            const lines = arr.map((item: unknown) => toTranscriptLine(
              typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
            ));
            if (lines.length) applyTranscript(lines);
            if (lines.length > 0) {
              finishCall(lines, finalDuration);
            } else {
              fetchTranscriptAfterEnd(finalDuration).then((retryLines) => {
                if (retryLines.length > 0) applyTranscript(retryLines);
                finishCall(retryLines.length > 0 ? retryLines : [], finalDuration);
              });
            }
            const id = data.call_id ?? callId;
            if (id && typeof id === 'string') socket?.emit('leave_call', id);
          });

          socket.on('connect_error', () => {
            socket = null;
            intervalId = setInterval(poll, 4000);
            poll();
          });
        } catch {
          intervalId = setInterval(poll, 4000);
          poll();
        }
      } else {
        intervalId = setInterval(poll, 4000);
        poll();
      }
    })();
    })();

    return () => {
      clearRetries();
      if (intervalId) clearInterval(intervalId);
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      setIsLoadingTranscriptAfterEnd(false);
    };
  }, [open, callId, useRealTranscript, initialTranscript, onCallComplete, callBackendToken]);

  // Scripted transcript: add lines progressively (when no callId)
  useEffect(() => {
    if (!open || useRealTranscript || isCurrentLineTyping) return;
    
    if (currentLineIndex >= transcriptScript.length) {
      if (isCallActive) {
        setTimeout(() => {
          setIsCallActive(false);
          setTimeout(() => {
            onCallComplete('$189', 'Includes bloodwork, pain meds, and follow-up visit', formatDuration(callDuration));
            onOpenChange(false);
          }, 1500);
        }, 1000);
      }
      return;
    }

    const delay = currentLineIndex === 0 ? 500 : 300;
    
    const timer = setTimeout(() => {
      const line = transcriptScript[currentLineIndex];
      setTranscript(prev => [...prev, {
        ...line,
        timestamp: formatDuration(callDuration),
        isTyping: true
      }]);
      setIsCurrentLineTyping(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [open, useRealTranscript, currentLineIndex, callDuration, isCallActive, isCurrentLineTyping, onCallComplete, onOpenChange]);

  const handleLineComplete = () => {
    setTranscript(prev => prev.map((line, idx) => 
      idx === prev.length - 1 ? { ...line, isTyping: false } : line
    ));
    setIsCurrentLineTyping(false);
    setCurrentLineIndex(prev => prev + 1);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, isCurrentLineTyping]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${isCallActive ? 'bg-white/20 animate-pulse' : 'bg-red-500/50'}`}>
                {isCallActive ? (
                  <Phone className="w-5 h-5" />
                ) : (
                  <PhoneOff className="w-5 h-5" />
                )}
              </div>
              <div>
                <h2 className="font-semibold text-lg">{clinicName}</h2>
                <p className="text-sm text-blue-100">
                  {isCallActive ? 'Call in progress...' : 'Call ended'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${isCallActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                <span>{formatDuration(callDuration)}</span>
              </div>
              {isCallActive && (
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-blue-200" />
                  <Volume2 className="w-4 h-4 text-blue-200" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Transcript Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[50vh] bg-gray-50"
        >
          {transcript.map((line, index) => (
            <div
              key={index}
              className={`flex ${line.speaker === 'ai' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  line.speaker === 'ai'
                    ? 'bg-blue-500 text-white rounded-br-md'
                    : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium ${
                    line.speaker === 'ai' ? 'text-blue-100' : 'text-gray-500'
                  }`}>
                    {line.speaker === 'ai' ? '🤖 Holdless AI' : `👤 ${clinicName}`}
                  </span>
                  <span className={`text-xs ${
                    line.speaker === 'ai' ? 'text-blue-200' : 'text-gray-400'
                  }`}>
                    {line.timestamp}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">
                  {line.isTyping ? (
                    <TypewriterText 
                      text={line.text} 
                      onComplete={handleLineComplete}
                      speed={40}
                    />
                  ) : (
                    line.text
                  )}
                </p>
              </div>
            </div>
          ))}

          {/* Typing indicator - only for scripted mode */}
          {!useRealTranscript && isCallActive && !isCurrentLineTyping && currentLineIndex < transcriptScript.length && transcript.length > 0 && (
            <div className={`flex ${transcriptScript[currentLineIndex]?.speaker === 'ai' ? 'justify-end' : 'justify-start'}`}>
              <div className={`rounded-2xl px-4 py-3 ${
                transcriptScript[currentLineIndex]?.speaker === 'ai'
                  ? 'bg-blue-400 text-white'
                  : 'bg-white border border-gray-200'
              }`}>
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* Call connecting message - shows until first transcript (real) or first line (scripted) */}
          {transcript.length === 0 && isCallActive && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm">Connecting to {clinicName}...</p>
            </div>
          )}

          {/* Call ended but transcript not loaded yet - backend may still be writing */}
          {transcript.length === 0 && !isCallActive && useRealTranscript && callId && isLoadingTranscriptAfterEnd && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <div className="w-10 h-10 border-2 border-gray-300 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm">Loading transcript...</p>
              <p className="text-xs mt-1 text-gray-400">This usually takes a few seconds after the call ends.</p>
            </div>
          )}
          {/* Call ended, retries exhausted, no transcript available */}
          {transcript.length === 0 && !isCallActive && useRealTranscript && callId && !isLoadingTranscriptAfterEnd && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <p className="text-sm">Transcript not available for this call.</p>
              <p className="text-xs mt-1 text-gray-400">You can try closing and reopening the transcript.</p>
            </div>
          )}

          {/* Call ended message */}
          {!isCallActive && (
            <div className="flex flex-col items-center justify-center py-6 text-gray-500">
              <div className="p-3 bg-green-100 rounded-full mb-3">
                <Phone className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm font-medium text-green-600">Call completed successfully</p>
              <p className="text-xs text-gray-400 mt-1">Quote received: $189</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 bg-white p-4">
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>Live transcript powered by Holdless AI</span>
            <div className="flex items-center gap-3">
              {isCallActive && (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  Recording
                </span>
              )}
              {!isCallActive && (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  Close transcript
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
