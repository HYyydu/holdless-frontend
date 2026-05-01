import { useState, useEffect, useRef } from 'react';
import { Sparkles, Upload, Plus, FileText, DollarSign, XCircle, Phone, HelpCircle, Mic, History, ChevronDown, MoreHorizontal, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getConversations, getConversationMessages, deleteConversation, type ConversationItem, type HistoryMessage } from '@/lib/chatApi';
import { useDemoAuth } from '@/contexts/DemoAuthContext';
import { format } from 'date-fns';
import { uploadTaskAttachments, validateTaskAttachment } from '@/lib/taskAttachments';
import { extractBillFields, type ChatAttachmentPayload, type ExtractedBillFields } from '@/lib/chatApi';

interface QuickAction {
  icon: typeof FileText;
  title: string;
  description: string;
}

const quickActions: QuickAction[] = [
  {
    icon: FileText,
    title: 'Save on medical costs',
    description: 'Lower bills and compare prices',
  },
  {
    icon: DollarSign,
    title: 'Understand my insurance',
    description: 'Check coverage, copays, deductibles',
  },
  {
    icon: XCircle,
    title: 'Fix claim or billing issues',
    description: 'Dispute denials or incorrect charges',
  },
  {
    icon: Phone,
    title: 'Book care for me',
    description: 'Appointments, referrals, authorizations',
  },
];

interface AIChatHomeProps {
  onStartTask: (description: string, options?: { attachments?: ChatAttachmentPayload[] }) => void;
  /** When user selects a conversation from history and clicks Continue */
  onSelectConversationToContinue?: (conversationId: string, messages: { role: string; content: string }[]) => void;
}

export function AIChatHome({ onStartTask, onSelectConversationToContinue }: AIChatHomeProps) {
  const [inputValue, setInputValue] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachmentPayload[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<{ id: string; messages: HistoryMessage[] } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasSpeechSupport, setHasSpeechSupport] = useState(false);
  const recognitionRef = useRef<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { user } = useDemoAuth();
  const userId = user?.id ?? 'anonymous';

  useEffect(() => {
    if (historyOpen && userId) {
      if (import.meta.env.DEV) console.log('[History] Opening history panel', { userId });
      getConversations(userId).then((list) => {
        if (import.meta.env.DEV) console.log('[History] Loaded conversations', { userId, count: list.length, ids: list.map((c) => c.id) });
        setConversations(list);
      });
    }
  }, [historyOpen, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setHasSpeechSupport(false);
      if (import.meta.env.DEV) {
        console.warn('[Voice] This browser does not support SpeechRecognition.');
      }
      return;
    }

    setHasSpeechSupport(true);
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      const text = transcript.trim();
      if (!text) return;
      setInputValue((prev) => (prev ? `${prev.trim()} ${text}` : text));
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleSelectConversation = async (conv: ConversationItem) => {
    const messages = await getConversationMessages(conv.id);
    setSelectedConversation({ id: conv.id, messages });
    setHistoryOpen(false);
  };

  const handleContinueConversation = () => {
    if (!selectedConversation || !onSelectConversationToContinue) return;
    onSelectConversationToContinue(
      selectedConversation.id,
      selectedConversation.messages.map((m) => ({ role: m.role, content: m.content }))
    );
    setSelectedConversation(null);
  };

  const handleBackFromHistory = () => {
    setSelectedConversation(null);
  };

  const handleDeleteConversation = async (conv: ConversationItem) => {
    if (!userId) return;
    const ok = await deleteConversation(userId, conv.id);
    if (ok) {
      setConversations((prev) => prev.filter((c) => c.id !== conv.id));
      if (selectedConversation?.id === conv.id) {
        setSelectedConversation(null);
      }
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    onStartTask(action.title);
  };

  const handleSubmit = () => {
    const text = inputValue.trim();
    if (text || pendingAttachments.length > 0) {
      onStartTask(text || 'Please analyze the uploaded bill attachment.', {
        attachments: pendingAttachments,
      });
      setInputValue('');
      setPendingAttachments([]);
    }
  };

  const handleMicClick = () => {
    if (!hasSpeechSupport || !recognitionRef.current) {
      if (typeof window !== 'undefined') {
        window.alert('Voice input is not supported in this browser.');
      }
      return;
    }

    try {
      if (isRecording) {
        recognitionRef.current.stop();
        setIsRecording(false);
      } else {
        setIsRecording(true);
        recognitionRef.current.start();
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Voice] Error starting/stopping recognition', err);
      }
      setIsRecording(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const accepted: File[] = [];
    for (const file of files) {
      const validationError = validateTaskAttachment(file);
      if (validationError) {
        setUploadError(validationError);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      try {
        const attachments = await uploadTaskAttachments(userId, accepted);
        const extracted = await extractBillFields(
          userId,
          attachments as unknown as Array<Record<string, unknown>>,
        );
        const extractedFields: ExtractedBillFields | null = extracted ?? null;
        const next = attachments.map((item) => ({
          ...item,
          extractedFields,
        }));
        setPendingAttachments((prev) => [...prev, ...next]);
        setUploadError(null);
      } catch (error) {
        console.warn('Bill upload/extraction failed', error);
        setUploadError('Upload failed. Please retry with a valid image/PDF.');
      }
    }
    e.target.value = '';
  };

  if (selectedConversation) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-[hsl(250_30%_99%)]">
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[hsl(240_30%_92%)] bg-white/80">
          <button
            onClick={handleBackFromHistory}
            className="text-sm font-medium text-[hsl(240_20%_40%)] hover:text-[hsl(250_60%_50%)]"
          >
            ← Back to home
          </button>
          <button
            onClick={handleContinueConversation}
            disabled={!onSelectConversationToContinue}
            className="px-4 py-2 rounded-full text-sm font-medium bg-[hsl(250_60%_55%)] text-white hover:bg-[hsl(250_60%_50%)] disabled:opacity-50"
          >
            Continue conversation
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 max-w-2xl mx-auto w-full space-y-4">
          {selectedConversation.messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-[hsl(250_60%_55%)] text-white'
                    : 'bg-white border border-[hsl(240_30%_92%)] text-[hsl(240_20%_25%)]'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[hsl(250_30%_99%)] relative">

      {/* History button - upper right, pill style like reference */}
      <div className="absolute top-6 right-6 z-10">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[hsl(250_60%_85%)] text-[hsl(240_20%_25%)] hover:bg-[hsl(250_60%_98%)] hover:border-[hsl(250_60%_75%)] shadow-sm transition-all duration-200"
        >
          <History className="w-4 h-4 text-[hsl(250_60%_55%)]" />
          <span className="text-sm font-medium">History</span>
        </button>
      </div>

      {/* History sidebar - ChatGPT style */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="left"
          className="w-[320px] sm:max-w-[320px] p-0 flex flex-col"
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement).closest?.('[role="menu"]')) {
              e.preventDefault();
            }
          }}
        >
          <SheetTitle className="sr-only">Your chats</SheetTitle>
          <div className="flex items-center justify-between px-4 py-4 border-b border-[hsl(240_30%_92%)]">
            <span className="text-sm font-medium text-[hsl(240_15%_55%)]">Your chats</span>
            <ChevronDown className="w-4 h-4 text-[hsl(240_15%_55%)]" />
          </div>
          <div className="flex-1 overflow-auto">
            {conversations.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[hsl(240_15%_55%)]">No chats yet.</p>
            ) : (
              <ul className="py-2">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <div className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-[hsl(240_20%_25%)] hover:bg-[hsl(240_30%_96%)] group">
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(conv)}
                        className="flex-1 truncate text-left min-w-0"
                      >
                        Chat · {format(new Date(conv.updated_at), 'MMM d, yyyy')}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          asChild
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 p-1 rounded hover:bg-[hsl(240_30%_90%)] text-[hsl(240_15%_55%)] hover:text-[hsl(240_20%_25%)]"
                        >
                          <button type="button" aria-label="Chat options">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="right" className="z-[100]">
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
                            onSelect={() => handleDeleteConversation(conv)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-24 pt-16">
        {/* Sparkle icon */}
        <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm border border-[hsl(240_30%_92%)]">
          <Sparkles className="w-6 h-6 text-[hsl(250_60%_65%)]" />
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-semibold text-[hsl(240_20%_20%)] mb-3 text-center">
          Today, what can I help you handle?
        </h1>
        
        {/* Subheading */}
        <p className="text-[hsl(240_15%_50%)] text-center max-w-lg mb-10">
          Your AI can call customer service, wait on hold, and get things done for you.
        </p>

        {/* Input area - refined styling */}
        <div className="w-full max-w-2xl mb-10">
          {pendingAttachments.length > 0 && (
            <div className="mb-2 rounded-xl border border-[hsl(240_30%_90%)] bg-white p-2">
              <p className="text-xs text-[hsl(240_15%_55%)] mb-2">Ready to send:</p>
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((file, idx) => (
                  <div
                    key={`${file.path}-${idx}`}
                    className="flex items-center gap-2 rounded-lg border border-[hsl(240_30%_90%)] px-2 py-1"
                  >
                    <span className="text-xs text-[hsl(240_20%_25%)]">{file.fileName}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="text-xs text-[hsl(240_15%_55%)] hover:text-[hsl(240_20%_25%)]"
                      aria-label={`Remove ${file.fileName}`}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="relative border border-[hsl(240_30%_90%)] rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow duration-200">
            <Textarea
              placeholder="Upload a bill, screenshot, or describe what you need help with..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="min-h-[100px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none px-5 pt-5 pb-16 text-[hsl(240_20%_25%)] placeholder:text-[hsl(240_15%_60%)] rounded-2xl"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            {/* Buttons inside input at bottom right */}
            <div className="absolute bottom-4 right-4 flex items-center gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                className="hidden"
                onChange={handleUploadFiles}
              />
              <button
                type="button"
                onClick={handleUploadClick}
                className="w-9 h-9 flex items-center justify-center text-[hsl(240_15%_55%)] hover:text-[hsl(250_60%_55%)] hover:bg-[hsl(250_60%_97%)] rounded-xl transition-all duration-200"
              >
                <Upload className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleMicClick}
                disabled={!hasSpeechSupport}
                className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 ${
                  hasSpeechSupport
                    ? isRecording
                      ? 'bg-red-50 text-red-600 hover:bg-red-100'
                      : 'text-[hsl(240_15%_55%)] hover:text-[hsl(250_60%_55%)] hover:bg-[hsl(250_60%_97%)]'
                    : 'text-[hsl(240_15%_80%)] cursor-not-allowed'
                }`}
              >
                <Mic className="w-5 h-5" />
              </button>
              <button 
                onClick={handleSubmit}
                className="w-9 h-9 flex items-center justify-center bg-[hsl(250_60%_55%)] hover:bg-[hsl(250_60%_50%)] rounded-xl transition-all duration-200 shadow-sm"
              >
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
          {uploadError && (
            <p className="mt-2 text-xs text-destructive">{uploadError}</p>
          )}
        </div>

        {/* Quick actions */}
        <div className="w-full max-w-2xl">
          <p className="text-xs font-medium text-[hsl(240_15%_55%)] uppercase tracking-wider mb-4">
            Or try one of these
          </p>
          
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action, index) => {
              const Icon = action.icon;
              return (
                <button
                  key={index}
                  onClick={() => handleQuickAction(action)}
                  className="flex items-start gap-3 p-4 bg-white hover:bg-[hsl(250_60%_99%)] border border-[hsl(240_30%_92%)] hover:border-[hsl(250_60%_85%)] rounded-2xl transition-all duration-200 text-left shadow-sm hover:shadow-md"
                >
                  <div className="w-10 h-10 bg-[hsl(250_60%_97%)] rounded-xl flex items-center justify-center flex-shrink-0 border border-[hsl(250_60%_92%)]">
                    <Icon className="w-4 h-4 text-[hsl(250_60%_55%)]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[hsl(240_20%_20%)]">{action.title}</p>
                    <p className="text-xs text-[hsl(240_15%_55%)] mt-0.5">{action.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer text */}
        <p className="text-sm text-[hsl(240_15%_60%)] mt-10">
          Just describe the problem. Your AI will take it from here.
        </p>
      </div>

      {/* Help button */}
      <div className="fixed bottom-6 right-6">
        <button className="w-10 h-10 bg-white border border-[hsl(240_30%_90%)] rounded-full flex items-center justify-center text-[hsl(240_15%_55%)] hover:text-[hsl(250_60%_55%)] hover:border-[hsl(250_60%_80%)] shadow-sm hover:shadow-md transition-all duration-200">
          <HelpCircle className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
