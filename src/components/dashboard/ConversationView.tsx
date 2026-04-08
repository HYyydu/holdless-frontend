import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Plus, Send, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getChatResponse, getCallStatus, sendChatMessage } from "@/lib/chatApi";
import { useDemoAuth } from "@/contexts/DemoAuthContext";
import { useCallBackendAuth } from "@/contexts/CallBackendAuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";
interface Message {
  id: string;
  role: "user" | "assistant" | "thinking";
  content: string;
  timestamp: Date;
  buttons?: {
    label: string;
    primary?: boolean;
  }[];
  showClinicSelection?: boolean;
  searchingText?: string;
  isTyping?: boolean;
}
/** Task created from a call - matches TasksView task format */
export interface CallTask {
  id: string;
  callId: string;
  title: string;
  description: string;
  vendor: string;
  createdAt: Date;
  priority: "high" | "medium" | "low";
  status: "in_progress" | "needs_input" | "resolved";
  /** AI-generated summary of the call with respect to its purpose (e.g. price comparison). */
  callSummary?: string;
  /** Stored payload (transcript, quote, callDuration, callSummary, etc.) from API */
  payload?: Record<string, unknown>;
}

interface ConversationViewProps {
  initialMessage: string;
  onBack: () => void;
  /** When opening from History: continue this conversation (Python backend) */
  initialConversationId?: string;
  /** When opening from History: preload these messages */
  initialMessages?: { role: string; content: string }[];
  /** Called when pet check-up "Confirmed" is clicked (legacy) */
  onTaskCreated?: () => void;
  /** Called when a call is placed - create a new task with call purpose as name */
  onCallTaskCreated?: (task: CallTask) => void;
  /** Called when call status changes - update task: ongoing = in_progress, end = resolved */
  onCallTaskStatusUpdate?: (
    callId: string,
    status: "in_progress" | "resolved",
  ) => void;
  /** Remaining free call requests reported by backend after successful call creation. */
  onFreeTrialRemainingChange?: (remaining: number) => void;
}

interface Clinic {
  id: string;
  name: string;
  distance: string;
  rating: number;
  selected: boolean;
}

const initialClinics: Clinic[] = [
  {
    id: "1",
    name: "Pico Animal Hospital",
    distance: "0.8 miles away",
    rating: 4,
    selected: true,
  },
  {
    id: "2",
    name: "Downtown Vet Clinic",
    distance: "1.5 miles away",
    rating: 5,
    selected: true,
  },
  {
    id: "3",
    name: "Sunny Paws Animal Care",
    distance: "2.1 miles away",
    rating: 4,
    selected: true,
  },
  {
    id: "4",
    name: "University Pet Center",
    distance: "2.4 miles away",
    rating: 4,
    selected: true,
  },
  {
    id: "5",
    name: "Westside Pet Wellness",
    distance: "3.0 miles away",
    rating: 3,
    selected: true,
  },
];

const API_OFFLINE_MESSAGE = `I couldn't connect to the chat service. Make sure the backend is running (\`npm run server\`) and \`OPENAI_API_KEY\` is set in .env.`;

/** When Python backend is in a yes/no state, show Yes and No buttons (same style as existing action buttons). Skip when reply is the "request not placed" message (no question to answer). */
function yesNoButtonsForState(
  debug_state: string | undefined,
  reply_text?: string,
): Message["buttons"] {
  if (reply_text?.includes("Your request is not placed")) return undefined;
  if (
    debug_state === "AWAITING_PET_CONFIRM" ||
    debug_state === "AWAITING_CALL_CONFIRM"
  ) {
    return [
      { label: "Yes", primary: true },
      { label: "No", primary: false },
    ];
  }
  return undefined;
}

// Star rating component
const StarRating = ({ rating }: { rating: number }) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map((star) => (
      <Star
        key={star}
        className={`w-4 h-4 ${star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
      />
    ))}
  </div>
);

// Typewriter component for word-by-word display
function TypewriterText({
  text,
  onComplete,
  speed = 30,
}: {
  text: string;
  onComplete?: () => void;
  speed?: number;
}) {
  const [displayedText, setDisplayedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const words = text.split(" ");
  useEffect(() => {
    if (currentIndex < words.length) {
      const timer = setTimeout(() => {
        setDisplayedText(
          (prev) => prev + (prev ? " " : "") + words[currentIndex],
        );
        setCurrentIndex((prev) => prev + 1);
      }, speed);
      return () => clearTimeout(timer);
    } else if (onComplete) {
      onComplete();
    }
  }, [currentIndex, words, speed, onComplete]);
  return <>{displayedText}</>;
}

// Thinking indicator component
const ThinkingIndicator = () => (
  <div className="flex gap-4">
    <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
      <img
        src="/lovable-uploads/554fdd18-2418-4c33-a52e-2119f3a6f315.png"
        alt="Holdless"
        className="w-full h-full object-cover"
      />
    </div>
    <div className="flex items-center gap-1 py-3">
      <div className="flex gap-1">
        <span
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{
            animationDelay: "0ms",
          }}
        />
        <span
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{
            animationDelay: "150ms",
          }}
        />
        <span
          className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
          style={{
            animationDelay: "300ms",
          }}
        />
      </div>
    </div>
  </div>
);
export function ConversationView({
  initialMessage,
  onBack,
  initialConversationId,
  initialMessages,
  onTaskCreated,
  onCallTaskCreated,
  onCallTaskStatusUpdate,
  onFreeTrialRemainingChange,
}: ConversationViewProps) {
  const { user } = useDemoAuth();
  const { callBackendToken } = useCallBackendAuth();
  const { profile } = useUserProfile();
  const userId = user?.id ?? "anonymous";
  const conversationIdRef = useRef<string | null>(
    initialConversationId ?? null,
  );
  const chatOpts = {
    callBackendToken: callBackendToken ?? undefined,
    profileName: profile?.name?.trim() || undefined,
  };

  const initialMsgs: Message[] = initialMessages?.length
    ? initialMessages.map((m, i) => ({
        id: `hist-${i}`,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(),
      }))
    : [
        {
          id: "1",
          role: "user" as const,
          content: initialMessage,
          timestamp: new Date(),
        },
      ];

  const [messages, setMessages] = useState<Message[]>(initialMsgs);
  const [inputValue, setInputValue] = useState("");
  const [hasInitialized, setHasInitialized] = useState(
    !!initialMessages?.length,
  );
  const [isThinking, setIsThinking] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [clinics, setClinics] = useState<Clinic[]>(initialClinics);

  // Call / live transcript modal state
  const handleApiResponse = useCallback(
    (
      data: {
        content?: string;
        callId?: string;
        callReason?: string;
        domain?: string;
      } | null,
    ) => {
      const content = data?.content ?? API_OFFLINE_MESSAGE;
      return {
        content,
        callId: data?.callId,
        callReason: data?.callReason,
        domain: data?.domain,
      };
    },
    [],
  );

  // Initial load: try Python backend first (so conversation is saved for History), else Node/OpenAI
  useEffect(() => {
    if (!hasInitialized) {
      setIsThinking(true);
      (async () => {
        if (import.meta.env.DEV)
          console.log("[History] First message: trying Python backend", {
            userId,
            initialMessage: initialMessage.slice(0, 50),
          });
        const pythonData = await sendChatMessage(userId, initialMessage, null, {
          callBackendToken: callBackendToken ?? undefined,
        });
        if (pythonData?.reply_text != null) {
          if (import.meta.env.DEV)
            console.log("[History] First message: Python backend ok", {
              conversation_id: pythonData.conversation_id,
              debug_state: pythonData.debug_state,
            });
          if (pythonData.conversation_id)
            conversationIdRef.current = pythonData.conversation_id;
          const assistantMessage: Message = {
            id: "2",
            role: "assistant",
            content: pythonData.reply_text,
            timestamp: new Date(),
            isTyping: true,
            buttons: yesNoButtonsForState(
              pythonData.debug_state,
              pythonData.reply_text,
            ),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setIsThinking(false);
          setHasInitialized(true);
          return;
        }
        if (import.meta.env.DEV)
          console.log(
            "[History] First message: Python backend failed or unavailable, falling back to Node/OpenAI",
          );
        const data = await getChatResponse(
          [{ role: "user", content: initialMessage }],
          chatOpts,
        );
        const {
          content,
          callId,
          callReason: apiCallReason,
          domain: apiDomain,
        } = handleApiResponse(data);
        const assistantMessage: Message = {
          id: "2",
          role: "assistant",
          content,
          timestamp: new Date(),
          isTyping: true,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setIsThinking(false);
        setHasInitialized(true);
        if (callId) {
          const purpose = apiCallReason || initialMessage.slice(0, 80);
          if (onCallTaskCreated) {
            const task: CallTask = {
              id: `call-${callId}`,
              callId,
              title: apiDomain ?? "unknown",
              description: purpose,
              vendor: "Phone Call",
              createdAt: new Date(),
              priority: "high",
              status: "in_progress",
            };
            onCallTaskCreated(task);
          }
          if (onCallTaskStatusUpdate)
            onCallTaskStatusUpdate(callId, "in_progress");
        }
      })();
    }
  }, [
    hasInitialized,
    initialMessage,
    userId,
    callBackendToken,
    handleApiResponse,
    onCallTaskCreated,
    onCallTaskStatusUpdate,
  ]);
  const handleMessageTypingComplete = (messageId: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              isTyping: false,
            }
          : msg,
      ),
    );
  };
  const toggleClinicSelection = (clinicId: string) => {
    setClinics((prev) =>
      prev.map((clinic) =>
        clinic.id === clinicId
          ? {
              ...clinic,
              selected: !clinic.selected,
            }
          : clinic,
      ),
    );
  };
  const handleStartCollectingQuotes = () => {
    if (isThinking) return;
    const selectedClinics = clinics.filter((c) => c.selected);
    if (selectedClinics.length === 0) return;

    // Remove clinic selection from last message
    setMessages((prev) => {
      const updated = [...prev];
      const lastIndex = updated.length - 1;
      if (updated[lastIndex]?.showClinicSelection) {
        updated[lastIndex] = {
          ...updated[lastIndex],
          showClinicSelection: false,
        };
      }
      return updated;
    });
    setIsThinking(true);
    setTimeout(() => {
      const clinicList = selectedClinics.map((c) => `• ${c.name}`).join("\n");
      const confirmMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: `Perfect — I'll call:
${clinicList}

I'll ask each clinic:
• Total price for Rocky's full check-up
• What's included (exam, bloodwork, vaccines, etc.)
• Earliest available appointment that fits your schedule

You'll see this as a task called "Pet check-up quotes – Rocky (90007)" with a live transcript while I'm on the phone.
You don't need to stay on the line — I'll bring back a summary once I'm done.`,
        timestamp: new Date(),
        buttons: [
          {
            label: "Confirmed",
            primary: true,
          },
          {
            label: "Nevermind",
          },
        ],
        isTyping: true,
      };
      setMessages((prev) => [...prev, confirmMessage]);
      setIsThinking(false);
    }, 1000);
  };
  const handleButtonClick = async (buttonLabel: string) => {
    if (isThinking || isSearching) return;

    // Handle "Confirmed" button - create task and notify parent
    if (buttonLabel === "Confirmed") {
      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: buttonLabel,
        timestamp: new Date(),
      };

      // Remove buttons from last message and add user message
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (updated[lastIndex]?.role === "assistant") {
          updated[lastIndex] = {
            ...updated[lastIndex],
            buttons: undefined,
          };
        }
        return [...updated, userMessage];
      });
      setIsThinking(true);
      setTimeout(() => {
        const confirmationMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Perfect! I'm starting the calls now. You'll see this task in your Tasks tab.

I'll call each clinic, get pricing, check availability, and bring back a summary. This usually takes about 10–15 minutes.

Feel free to navigate away — I'll keep working in the background! 🐶`,
          timestamp: new Date(),
          isTyping: true,
        };
        setMessages((prev) => [...prev, confirmationMessage]);
        setIsThinking(false);

        // Trigger the task created callback
        if (onTaskCreated) {
          onTaskCreated();
        }
      }, 1000);
      return;
    }

    // Add user message with the button label
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: buttonLabel,
      timestamp: new Date(),
    };

    // Remove buttons from the last assistant message
    setMessages((prev) => {
      const updated = [...prev];
      const lastIndex = updated.length - 1;
      if (updated[lastIndex]?.role === "assistant") {
        updated[lastIndex] = {
          ...updated[lastIndex],
          buttons: undefined,
        };
      }
      return [...updated, userMessage];
    });

    setIsThinking(true);
    const cid = conversationIdRef.current;
    if (cid) {
      const data = await sendChatMessage(userId, buttonLabel, cid, {
        callBackendToken: callBackendToken ?? undefined,
      });
      if (data?.conversation_id)
        conversationIdRef.current = data.conversation_id;
      const content = data?.reply_text ?? API_OFFLINE_MESSAGE;
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content,
        timestamp: new Date(),
        isTyping: true,
        buttons: yesNoButtonsForState(data?.debug_state, content),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsThinking(false);
      if (data?.callId) {
        if (typeof data.free_trial_remaining === "number") {
          onFreeTrialRemainingChange?.(data.free_trial_remaining);
        }
        const purpose = data.callReason ?? buttonLabel.slice(0, 80);
        const taskId = data.task_id;
        if (onCallTaskCreated) {
          const task: CallTask = {
            id: taskId ?? `call-${data.callId}`,
            callId: data.callId,
            title: data.domain ?? "unknown",
            description: purpose,
            vendor: "Phone Call",
            createdAt: new Date(),
            priority: "high",
            status: "in_progress",
          };
          onCallTaskCreated(task);
        }
        if (onCallTaskStatusUpdate)
          onCallTaskStatusUpdate(data.callId, "in_progress");
      }
      return;
    }
    const history: { role: "user" | "assistant"; content: string }[] = [
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: buttonLabel },
    ];
    const data = await getChatResponse(history, chatOpts);
    const {
      content,
      callId,
      callReason: apiCallReason,
      domain: apiDomain,
    } = handleApiResponse(data);
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      isTyping: true,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    if (callId) {
      const purpose = apiCallReason || buttonLabel.slice(0, 80);
      if (onCallTaskCreated) {
        const task: CallTask = {
          id: `call-${callId}`,
          callId,
          title: apiDomain ?? "unknown",
          description: purpose,
          vendor: "Phone Call",
          createdAt: new Date(),
          priority: "high",
          status: "in_progress",
        };
        onCallTaskCreated(task);
      }
      if (onCallTaskStatusUpdate) onCallTaskStatusUpdate(callId, "in_progress");
    }
  };
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isThinking || isSearching) return;

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setInputValue("");
    setIsThinking(true);

    const cid = conversationIdRef.current;
    if (cid) {
      const data = await sendChatMessage(userId, text, cid, {
        callBackendToken: callBackendToken ?? undefined,
      });
      if (data?.conversation_id)
        conversationIdRef.current = data.conversation_id;
      const content = data?.reply_text ?? API_OFFLINE_MESSAGE;
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content,
        timestamp: new Date(),
        isTyping: true,
        buttons: yesNoButtonsForState(data?.debug_state, content),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsThinking(false);
      if (data?.callId) {
        if (typeof data.free_trial_remaining === "number") {
          onFreeTrialRemainingChange?.(data.free_trial_remaining);
        }
        const purpose = data.callReason ?? text.slice(0, 80);
        const taskId = data.task_id;
        if (onCallTaskCreated) {
          const task: CallTask = {
            id: taskId ?? `call-${data.callId}`,
            callId: data.callId,
            title: data.domain ?? "unknown",
            description: purpose,
            vendor: "Phone Call",
            createdAt: new Date(),
            priority: "high",
            status: "in_progress",
          };
          onCallTaskCreated(task);
        }
        if (onCallTaskStatusUpdate)
          onCallTaskStatusUpdate(data.callId, "in_progress");
      }
      return;
    }

    const history: { role: "user" | "assistant"; content: string }[] = [
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    const data = await getChatResponse(history, chatOpts);
    const {
      content,
      callId,
      callReason: apiCallReason,
      domain: apiDomain,
    } = handleApiResponse(data);
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      isTyping: true,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    if (callId) {
      const purpose = apiCallReason || text.slice(0, 80);
      if (onCallTaskCreated) {
        const task: CallTask = {
          id: `call-${callId}`,
          callId,
          title: apiDomain ?? "unknown",
          description: purpose,
          vendor: "Phone Call",
          createdAt: new Date(),
          priority: "high",
          status: "in_progress",
        };
        onCallTaskCreated(task);
      }
      if (onCallTaskStatusUpdate) onCallTaskStatusUpdate(callId, "in_progress");
    }
  };

  // Searching indicator component
  const SearchingIndicator = () => (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
        <img
          src="/lovable-uploads/554fdd18-2418-4c33-a52e-2119f3a6f315.png"
          alt="Holdless"
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex items-center gap-2 py-3 text-gray-600">
        <span>Finding nearby check-up clinics</span>
        <div className="flex gap-1">
          <span
            className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
            style={{
              animationDelay: "0ms",
            }}
          />
          <span
            className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
            style={{
              animationDelay: "150ms",
            }}
          />
          <span
            className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
            style={{
              animationDelay: "300ms",
            }}
          />
        </div>
      </div>
    </div>
  );

  // Clinic selection component
  const ClinicSelection = () => (
    <div className="mt-4 space-y-3">
      <p className="text-gray-700 font-medium">
        Select the clinics you want to contact:
      </p>
      <div className="space-y-2">
        {clinics.map((clinic) => (
          <div
            key={clinic.id}
            onClick={() => toggleClinicSelection(clinic.id)}
            className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${clinic.selected ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-white hover:border-gray-200"}`}
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium text-gray-900">{clinic.name}</span>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>{clinic.distance}</span>
                <span>–</span>
                <StarRating rating={clinic.rating} />
              </div>
            </div>
            <button
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${clinic.selected ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {clinic.selected ? "Selected" : "Select"}
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleStartCollectingQuotes}
          className="px-5 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Start collecting quotes
        </button>
        <button className="px-5 py-2.5 rounded-full bg-gray-100 text-gray-900 text-sm font-medium hover:bg-gray-200 transition-colors">
          Edit details
        </button>
        <button className="px-5 py-2.5 rounded-full bg-gray-100 text-gray-900 text-sm font-medium hover:bg-gray-200 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
  const renderMessageContent = (content: string) => {
    return content.split("\n").map((line, idx) => {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      return (
        <p key={idx} className={line === "" ? "h-3" : "mb-1.5"}>
          {parts.map((part, partIdx) =>
            partIdx % 2 === 1 ? (
              <strong key={partIdx} className="font-semibold">
                {part}
              </strong>
            ) : (
              part
            ),
          )}
        </p>
      );
    });
  };
  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Middle - Conversation */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-gray-600 hover:bg-[hsl(255_25%_92%)] hover:text-[hsl(250_50%_40%)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6 pr-6">
            {messages.map((message) => (
              <div key={message.id} className="flex gap-4">
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                    <img
                      alt="Holdless"
                      className="w-full h-full object-cover"
                      src="/lovable-uploads/554fdd18-2418-4c33-a52e-2119f3a6f315.png"
                    />
                  </div>
                )}
                <div
                  className={`flex-1 ${message.role === "user" ? "flex justify-end pl-32" : ""}`}
                >
                  {message.role === "user" ? (
                    <div className="bg-white rounded-2xl px-4 py-3 text-gray-900">
                      {message.content}
                    </div>
                  ) : (
                    <div className="text-gray-700 leading-relaxed">
                      {message.isTyping ? (
                        <TypewriterText
                          text={message.content}
                          onComplete={() =>
                            handleMessageTypingComplete(message.id)
                          }
                          speed={25}
                        />
                      ) : (
                        renderMessageContent(message.content)
                      )}
                      {/* Render clinic selection if present - only after typing completes */}
                      {message.showClinicSelection && !message.isTyping && (
                        <ClinicSelection />
                      )}
                      {/* Render interactive buttons if present - only after typing completes */}
                      {message.buttons &&
                        message.buttons.length > 0 &&
                        !message.isTyping && (
                          <div className="flex flex-wrap gap-2 mt-4">
                            {message.buttons.map((btn, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleButtonClick(btn.label)}
                                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${btn.primary ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-gray-100 text-gray-900 hover:bg-gray-200 border border-gray-200"}`}
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/* Thinking indicator */}
            {isThinking && <ThinkingIndicator />}
            {/* Searching indicator */}
            {isSearching && <SearchingIndicator />}
          </div>
        </div>

        {/* Input Area */}
        <div className="px-6 py-4 border-t border-gray-100">
          <div className="pr-6">
            <div className="relative flex items-center rounded-xl bg-gray-50 px-4 py-3">
              <button className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
                <Plus className="w-5 h-5" />
              </button>
              <Input
                placeholder="Message Holdless..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSend();
                  }
                }}
                className="flex-1 border-0 bg-transparent text-gray-700 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none focus:ring-0 focus:border-0 px-2"
              />
              <button
                onClick={handleSend}
                className="w-8 h-8 flex items-center justify-center bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
