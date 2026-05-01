import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft, Plus, Send, Star, Upload, Mic } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  extractBillFields,
  getChatResponse,
  getCallStatus,
  sendChatMessage,
  type ChatAttachmentPayload,
  type ChatPersonalProfilePayload,
  type ExtractedBillFields,
} from "@/lib/chatApi";
import { useDemoAuth } from "@/contexts/DemoAuthContext";
import { useCallBackendAuth } from "@/contexts/CallBackendAuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import {
  TASK_ATTACHMENT_BUCKET,
  uploadTaskAttachments,
  validateTaskAttachment,
} from "@/lib/taskAttachments";
import { supabase } from "@/integrations/supabase/client";
interface Message {
  id: string;
  role: "user" | "assistant" | "thinking";
  content: string;
  timestamp: Date;
  processSteps?: string[];
  buttons?: {
    label: string;
    primary?: boolean;
  }[];
  showClinicSelection?: boolean;
  searchingText?: string;
  isTyping?: boolean;
  parkingOptions?: ParkingOption[];
  calSlotOptions?: CalSlotOption[];
  attachments?: PendingAttachment[];
}

interface PendingAttachment extends ChatAttachmentPayload {
  previewUrl?: string;
}
interface ParkingOption {
  type: "parking_place";
  index: number;
  name: string;
  phone?: string;
  address?: string;
  rating?: number | null;
  open_now?: boolean | null;
  location_query?: string;
  note?: string;
  call_reason?: string;
  flow_tag?: string;
}

interface CalSlotOption {
  type: "cal_slot";
  index: number;
  label: string;
  slot_start_at: string;
  timezone: string;
  booking_url?: string;
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
  initialAttachments?: ChatAttachmentPayload[];
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
interface ChatCallResponse {
  callId?: string;
  callReason?: string;
  domain?: string;
  task_id?: string;
  queued_calls?: {
    callId: string;
    phone?: string;
    name?: string;
  }[];
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

function buildProcessSteps(userText: string, assistantText?: string): string[] {
  const zip = userText.match(/\b\d{5}\b/)?.[0];
  const blob = `${userText} ${assistantText ?? ""}`;
  const hasParkingIntent = /parking|停车|车位/i.test(blob);
  const hasMedicalIntent =
    /医院|急诊|诊所|urgent\s*care|emergency|walk\s*-?\s*in|walkin/i.test(blob);
  const hasVetIntent = /vet|宠物|兽医|动物医院|宠物医院/i.test(blob);
  const hasCallIntent = /call|phone|拨打|打电话/i.test(blob);
  let step3 = "Collecting the best matching details";
  if (hasParkingIntent) step3 = "Collecting parking options and contacts";
  else if (hasMedicalIntent) step3 = "Collecting hospital / urgent care options";
  else if (hasVetIntent) step3 = "Collecting veterinary clinic options";
  else if (hasCallIntent) step3 = "Preparing call-ready details";
  return [
    "Thinking",
    zip ? `Searching around ${zip}` : "Searching relevant sources",
    step3,
    "Showing results",
  ];
}

/** When Python backend is in a yes/no state, show Yes and No buttons (same style as existing action buttons). Skip when reply is the "request not placed" message (no question to answer). */
function yesNoButtonsForState(
  debug_state: string | undefined,
  reply_text?: string,
): Message["buttons"] {
  if (reply_text?.includes("Your request is not placed")) return undefined;
  if (
    debug_state === "AWAITING_PET_CONFIRM" ||
    debug_state === "AWAITING_CALL_CONFIRM" ||
    debug_state === "RETURN_AWAITING_PERSONAL_INFO_CONFIRM"
  ) {
    return [
      { label: "Yes", primary: true },
      { label: "No", primary: false },
    ];
  }
  return undefined;
}

function skipButtonForOptionalPrompt(reply_text?: string): Message["buttons"] {
  const text = (reply_text || "").toLowerCase();
  if (text.includes("optional") && text.includes("type 'skip'")) {
    return [{ label: "skip", primary: false }];
  }
  return undefined;
}

function actionButtonsForReply(
  debug_state: string | undefined,
  reply_text?: string,
): Message["buttons"] {
  return (
    yesNoButtonsForState(debug_state, reply_text) ||
    skipButtonForOptionalPrompt(reply_text)
  );
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

export function ConversationView({
  initialMessage,
  onBack,
  initialAttachments,
  initialConversationId,
  initialMessages,
  onTaskCreated,
  onCallTaskCreated,
  onCallTaskStatusUpdate,
  onFreeTrialRemainingChange,
}: ConversationViewProps) {
  const { user } = useDemoAuth();
  const { callBackendToken } = useCallBackendAuth();
  const { profile, isLoaded: isProfileLoaded } = useUserProfile();
  const userId = user?.id ?? "anonymous";
  const conversationIdRef = useRef<string | null>(
    initialConversationId ?? null,
  );
  const resolvedFirstName = profile?.firstName?.trim() || undefined;
  const resolvedLastName = profile?.lastName?.trim() || undefined;
  const resolvedFullName =
    [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ").trim() ||
    undefined;
  const chatOpts = {
    callBackendToken: callBackendToken ?? undefined,
    profileFirstName: resolvedFirstName,
  };
  const personalProfilePayload: ChatPersonalProfilePayload = {
    firstName: resolvedFirstName,
    lastName: resolvedLastName,
    name: resolvedFullName,
    email: profile?.email || undefined,
    phone: profile?.phone || undefined,
    address: profile?.address || undefined,
    dateOfBirth: profile?.dateOfBirth || undefined,
    state: profile?.state || undefined,
    zipCode: profile?.zipCode || undefined,
    tone: profile?.tone || undefined,
    language: profile?.language || undefined,
    timeZone:
      (typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined) || undefined,
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
          attachments: initialAttachments || undefined,
        },
      ];

  const [messages, setMessages] = useState<Message[]>(initialMsgs);
  const [inputValue, setInputValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<
    Record<string, string>
  >({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasSpeechSupport, setHasSpeechSupport] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(
    !!initialMessages?.length,
  );
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [clinics, setClinics] = useState<Clinic[]>(initialClinics);
  const [selectedParkingKeys, setSelectedParkingKeys] = useState<
    Record<string, boolean>
  >({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setHasSpeechSupport(false);
      return;
    }
    setHasSpeechSupport(true);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      const text = transcript.trim();
      if (!text) return;
      setInputValue((prev) => (prev ? `${prev.trim()} ${text}` : text));
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
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

  useEffect(() => {
    const imagePaths = Array.from(
      new Set(
        messages
          .flatMap((m) => m.attachments || [])
          .filter((f) => f.contentType.startsWith("image/") && !f.previewUrl)
          .map((f) => f.path)
          .filter((p) => !!p && !attachmentPreviewUrls[p]),
      ),
    );
    if (imagePaths.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      for (const path of imagePaths) {
        const { data } = await supabase.storage
          .from(TASK_ATTACHMENT_BUCKET)
          .createSignedUrl(path, 60 * 60);
        if (data?.signedUrl) updates[path] = data.signedUrl;
      }
      if (cancelled || Object.keys(updates).length === 0) return;
      setAttachmentPreviewUrls((prev) => ({ ...prev, ...updates }));
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, attachmentPreviewUrls]);

  const parseParkingOptions = (
    options: unknown[] | undefined,
  ): ParkingOption[] | undefined => {
    if (!Array.isArray(options)) return undefined;
    const mapped = options
      .filter((opt): opt is Record<string, unknown> => !!opt && typeof opt === "object")
      .filter((opt) => opt.type === "parking_place")
      .map((opt) => ({
        type: "parking_place" as const,
        index: Number(opt.index ?? 0),
        name: String(opt.name ?? "Parking"),
        phone: typeof opt.phone === "string" ? opt.phone : "",
        address: typeof opt.address === "string" ? opt.address : "",
        rating:
          typeof opt.rating === "number"
            ? opt.rating
            : opt.rating == null
              ? null
              : Number(opt.rating),
        open_now:
          typeof opt.open_now === "boolean"
            ? opt.open_now
            : opt.open_now == null
              ? null
              : null,
        location_query:
          typeof opt.location_query === "string" ? opt.location_query : "",
        note: typeof opt.note === "string" ? opt.note : "",
        call_reason:
          typeof opt.call_reason === "string" ? opt.call_reason : "",
        flow_tag: typeof opt.flow_tag === "string" ? opt.flow_tag : "",
      }))
      .filter((opt) => !!opt.name);
    return mapped.length > 0 ? mapped : undefined;
  };

  const parseCalSlotOptions = (
    options: unknown[] | undefined,
  ): CalSlotOption[] | undefined => {
    if (!Array.isArray(options)) return undefined;
    const mapped = options
      .filter((opt): opt is Record<string, unknown> => !!opt && typeof opt === "object")
      .filter((opt) => opt.type === "cal_slot")
      .map((opt) => ({
        type: "cal_slot" as const,
        index: Number(opt.index ?? 0),
        label: String(opt.label ?? "Appointment slot"),
        slot_start_at: String(opt.slot_start_at ?? ""),
        timezone: String(opt.timezone ?? "UTC"),
        booking_url: typeof opt.booking_url === "string" ? opt.booking_url : "",
      }))
      .filter((opt) => !!opt.slot_start_at);
    return mapped.length > 0 ? mapped : undefined;
  };

  const buildCallTasksFromResponse = (
    data: ChatCallResponse | null | undefined,
    fallbackPurpose: string,
  ): CallTask[] => {
    if (!data) return [];
    const defaultPurpose = data.callReason ?? fallbackPurpose.slice(0, 80);
    const queuedCalls = Array.isArray(data.queued_calls) ? data.queued_calls : [];
    const queuedTasks = queuedCalls
      .filter((entry) => !!entry?.callId)
      .map((entry, index) => {
        const placeName = (entry.name || '').trim();
        const taskId = queuedCalls.length === 1 && data.task_id
          ? data.task_id
          : `${data.task_id ?? 'call'}-${entry.callId}`;
        return {
          id: taskId,
          callId: entry.callId,
          title: data.domain ?? 'unknown',
          description: defaultPurpose,
          vendor: placeName || 'Phone Call',
          createdAt: new Date(),
          priority: 'high' as const,
          status: 'in_progress' as const,
          payload: {
            queue_index: index + 1,
            place_name: placeName || undefined,
            phone_number: entry.phone || undefined,
          },
        };
      });
    if (queuedTasks.length > 0) return queuedTasks;
    if (!data.callId) return [];
    return [
      {
        id: data.task_id ?? `call-${data.callId}`,
        callId: data.callId,
        title: data.domain ?? 'unknown',
        description: defaultPurpose,
        vendor: 'Phone Call',
        createdAt: new Date(),
        priority: 'high',
        status: 'in_progress',
      },
    ];
  };

  const emitCallTasksFromResponse = (
    data: ChatCallResponse | null | undefined,
    fallbackPurpose: string,
  ) => {
    const tasks = buildCallTasksFromResponse(data, fallbackPurpose);
    if (tasks.length === 0) return;
    tasks.forEach((task) => {
      onCallTaskCreated?.(task);
      onCallTaskStatusUpdate?.(task.callId, 'in_progress');
    });
  };

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
      if (!isProfileLoaded) return;
      setIsThinking(true);
      setThinkingSteps(buildProcessSteps(initialMessage));
      (async () => {
        if (import.meta.env.DEV)
          console.log("[History] First message: trying Python backend", {
            userId,
            initialMessage: initialMessage.slice(0, 50),
          });
        const pythonData = await sendChatMessage(userId, initialMessage, null, {
          callBackendToken: callBackendToken ?? undefined,
          attachments: initialAttachments,
          personalProfile: personalProfilePayload,
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
            processSteps: buildProcessSteps(
              initialMessage,
              pythonData.reply_text,
            ),
            buttons: actionButtonsForReply(
              pythonData.debug_state,
              pythonData.reply_text,
            ),
            parkingOptions: parseParkingOptions(pythonData.ui_options),
            calSlotOptions: parseCalSlotOptions(pythonData.ui_options),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setIsThinking(false);
          setThinkingSteps(null);
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
          processSteps: buildProcessSteps(initialMessage, content),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setIsThinking(false);
        setThinkingSteps(null);
        setHasInitialized(true);
        if (callId) {
          emitCallTasksFromResponse(
            { callId, callReason: apiCallReason, domain: apiDomain },
            initialMessage,
          );
        }
      })();
    }
  }, [
    hasInitialized,
    initialMessage,
    initialAttachments,
    userId,
    callBackendToken,
    isProfileLoaded,
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
    setThinkingSteps(buildProcessSteps(buttonLabel));
    const cid = conversationIdRef.current;
    if (cid) {
      const data = await sendChatMessage(userId, buttonLabel, cid, {
        callBackendToken: callBackendToken ?? undefined,
        personalProfile: personalProfilePayload,
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
        buttons: actionButtonsForReply(data?.debug_state, content),
        parkingOptions: parseParkingOptions(data?.ui_options),
        calSlotOptions: parseCalSlotOptions(data?.ui_options),
        processSteps: buildProcessSteps(buttonLabel, content),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsThinking(false);
      setThinkingSteps(null);
      if (typeof data?.free_trial_remaining === "number") {
        onFreeTrialRemainingChange?.(data.free_trial_remaining);
      }
      emitCallTasksFromResponse(data, buttonLabel);
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
      processSteps: buildProcessSteps(buttonLabel, content),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    setThinkingSteps(null);
    if (callId) {
      emitCallTasksFromResponse(
        { callId, callReason: apiCallReason, domain: apiDomain },
        buttonLabel,
      );
    }
  };
  const handleSend = async () => {
    const text = inputValue.trim();
    if ((!text && pendingAttachments.length === 0) || isThinking || isSearching) return;
    const attachmentsForSend = pendingAttachments.map(({ previewUrl: _preview, ...rest }) => rest);
    const composedText = text || "Please analyze the uploaded bill attachment.";

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: composedText,
      timestamp: new Date(),
      attachments: pendingAttachments,
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setInputValue("");
    setPendingAttachments([]);
    setIsThinking(true);
    setThinkingSteps(buildProcessSteps(composedText));

    const cid = conversationIdRef.current;
    if (cid) {
      const data = await sendChatMessage(userId, composedText, cid, {
        callBackendToken: callBackendToken ?? undefined,
        attachments: attachmentsForSend,
        personalProfile: personalProfilePayload,
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
        buttons: actionButtonsForReply(data?.debug_state, content),
        parkingOptions: parseParkingOptions(data?.ui_options),
        calSlotOptions: parseCalSlotOptions(data?.ui_options),
        processSteps: buildProcessSteps(composedText, content),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsThinking(false);
      setThinkingSteps(null);
      if (typeof data?.free_trial_remaining === "number") {
        onFreeTrialRemainingChange?.(data.free_trial_remaining);
      }
      emitCallTasksFromResponse(data, composedText);
      return;
    }

    const history: { role: "user" | "assistant"; content: string }[] = [
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: composedText },
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
      processSteps: buildProcessSteps(composedText, content),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    setThinkingSteps(null);
    if (callId) {
      emitCallTasksFromResponse(
        { callId, callReason: apiCallReason, domain: apiDomain },
        composedText,
      );
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

  const ThinkingIndicator = () => (
    <div className="flex gap-4">
      <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
        <img
          src="/lovable-uploads/554fdd18-2418-4c33-a52e-2119f3a6f315.png"
          alt="Holdless"
          className="w-full h-full object-cover"
        />
      </div>
      <div className="text-gray-700 leading-relaxed">
        <div className="flex items-center gap-2">
          <span>Thinking...</span>
          <div className="flex gap-1">
            <span
              className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
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

  const renderAttachments = (attachments: PendingAttachment[] | undefined) => {
    if (!attachments || attachments.length === 0) return null;
    return (
      <div className="mt-2 space-y-2">
        {attachments.map((file) => {
          const looksLikeImage = file.contentType.startsWith("image/");
          const previewSrc = looksLikeImage
            ? file.previewUrl ||
              (file.path ? attachmentPreviewUrls[file.path] || null : null)
            : null;
          return (
            <div key={`${file.path}-${file.fileName}`} className="rounded-lg border border-gray-200 p-2 bg-white/70">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt={file.fileName}
                  className="max-h-44 rounded-md object-contain bg-gray-50 w-full"
                />
              ) : null}
              <p className="mt-1 text-xs text-gray-600">{file.fileName}</p>
            </div>
          );
        })}
      </div>
    );
  };

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
  const ParkingSelection = ({
    messageId,
    options,
  }: {
    messageId: string;
    options: ParkingOption[];
  }) => {
    const parkingKey = (opt: ParkingOption) =>
      `${messageId}::${opt.name}::${opt.phone || ""}::${opt.address || ""}`;
    const selectedOptions = options.filter((opt) => !!opt.phone && selectedParkingKeys[parkingKey(opt)]);
    return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-600">
          Select one or more cards, then start to call.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Name</th>
              <th className="text-left px-4 py-3 font-semibold">Phone</th>
              <th className="text-left px-4 py-3 font-semibold">Address</th>
              <th className="text-left px-4 py-3 font-semibold">Rating</th>
              <th className="text-left px-4 py-3 font-semibold">Open Now</th>
              <th className="text-left px-4 py-3 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {options.map((opt, idx) => (
              <tr key={`row-${opt.name}-${idx}`} className="border-t border-gray-100 align-top">
                <td className="px-4 py-3 text-gray-900">{opt.name}</td>
                <td className="px-4 py-3 text-gray-700">{opt.phone || "N/A"}</td>
                <td className="px-4 py-3 text-gray-700">{opt.address || "Address unavailable"}</td>
                <td className="px-4 py-3 text-gray-700">
                  {opt.rating != null ? `${opt.rating}/5` : "N/A"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {opt.open_now === true ? "24h / Open now" : "Unknown"}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {opt.note || "Can ask monthly rent"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {options.map((opt, idx) => {
          const canCall = !!opt.phone;
          const key = parkingKey(opt);
          const isSelected = !!selectedParkingKeys[key];
          return (
            <div
              key={`${opt.name}-${idx}`}
              className={`border rounded-lg p-3 bg-white ${isSelected ? "border-blue-300" : "border-gray-200"}`}
            >
              <p className="font-medium text-[15px] leading-5 text-gray-900 line-clamp-1">{opt.name}</p>
              <p className="text-[13px] leading-5 text-gray-500 mt-1 line-clamp-2">
                {opt.address || "Address unavailable"}
              </p>
              <p className="text-[13px] leading-5 text-gray-600 mt-0.5 line-clamp-1">
                {opt.phone || "Phone unavailable"}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[12px] text-gray-500">
                  {opt.rating != null ? `Rating ${opt.rating}` : "No rating"}
                </span>
                <button
                  disabled={!canCall || isThinking || isSearching}
                  onClick={() => {
                    if (!canCall) return;
                    setSelectedParkingKeys((prev) => ({
                      ...prev,
                      [key]: !prev[key],
                    }));
                  }}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-40 ${
                    isSelected
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "bg-gray-900 text-white"
                  }`}
                >
                  {isSelected ? "Selected" : "Select"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          disabled={selectedOptions.length === 0 || isThinking || isSearching}
          onClick={() => void handleStartSelectedParkingCalls(messageId, options)}
          className="px-4 py-2 rounded-md text-sm font-medium bg-gray-900 text-white disabled:opacity-40"
        >
          Start to call
        </button>
      </div>
    </div>
  );
  };
  const handleStartSelectedParkingCalls = async (
    messageId: string,
    options: ParkingOption[],
  ) => {
    if (isThinking || isSearching) return;
    const keyFor = (opt: ParkingOption) =>
      `${messageId}::${opt.name}::${opt.phone || ""}::${opt.address || ""}`;
    const selected = options.filter((opt) => !!opt.phone && selectedParkingKeys[keyFor(opt)]);
    if (selected.length === 0) return;
    const callReason =
      selected.find((opt) => (opt.call_reason || "").trim())?.call_reason ||
      "monthly parking availability, monthly price, and contract/deposit requirements";
    const payload = {
      places: selected.map((opt) => ({
        name: opt.name,
        phone: opt.phone,
        address: opt.address,
      })),
      call_reason: callReason,
      flow_tag:
        selected.find((opt) => (opt.flow_tag || "").trim())?.flow_tag || undefined,
    };
    const combinedPrompt = `[[PARKING_QUEUE]] ${JSON.stringify(payload)}`;

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: "Start to call selected places",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsThinking(true);
    setThinkingSteps(
      buildProcessSteps(
        selected.map((opt) => opt.location_query || opt.name).join(" "),
      ),
    );
    const cid = conversationIdRef.current;
    const data = await sendChatMessage(userId, combinedPrompt, cid || undefined, {
      callBackendToken: callBackendToken ?? undefined,
      personalProfile: personalProfilePayload,
    });
    if (data?.conversation_id) conversationIdRef.current = data.conversation_id;
    const content = data?.reply_text ?? API_OFFLINE_MESSAGE;
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      isTyping: true,
      buttons: actionButtonsForReply(data?.debug_state, content),
      parkingOptions: parseParkingOptions(data?.ui_options),
      calSlotOptions: parseCalSlotOptions(data?.ui_options),
      processSteps: buildProcessSteps(newUserMessage.content, content),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    setThinkingSteps(null);
    if (typeof data?.free_trial_remaining === "number") {
      onFreeTrialRemainingChange?.(data.free_trial_remaining);
    }
    emitCallTasksFromResponse(data, callReason);
  };
  const handleSendParkingCall = async (opt: ParkingOption) => {
    const phone = (opt.phone || "").trim();
    if (!phone || isThinking || isSearching) return;
    const callPrompt = `Please call ${phone} and ask if they have monthly parking available, what the monthly price is, and any contract/deposit requirements.`;
    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `Call ${opt.name} (${phone})`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsThinking(true);
    setThinkingSteps(buildProcessSteps(newUserMessage.content));
    const cid = conversationIdRef.current;
    const data = await sendChatMessage(userId, callPrompt, cid || undefined, {
      callBackendToken: callBackendToken ?? undefined,
      personalProfile: personalProfilePayload,
    });
    if (data?.conversation_id) conversationIdRef.current = data.conversation_id;
    const content = data?.reply_text ?? API_OFFLINE_MESSAGE;
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      isTyping: true,
      buttons: actionButtonsForReply(data?.debug_state, content),
      parkingOptions: parseParkingOptions(data?.ui_options),
      calSlotOptions: parseCalSlotOptions(data?.ui_options),
      processSteps: buildProcessSteps(newUserMessage.content, content),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    setThinkingSteps(null);
    if (typeof data?.free_trial_remaining === "number") {
      onFreeTrialRemainingChange?.(data.free_trial_remaining);
    }
    emitCallTasksFromResponse(data, callPrompt);
  };

  const handleSelectCalSlot = async (opt: CalSlotOption) => {
    if (isThinking || isSearching) return;
    const payload = {
      slot_start_at: opt.slot_start_at,
      timezone: opt.timezone,
      booking_url: opt.booking_url || "",
    };
    const combinedPrompt = `[[CAL_BOOKING]] ${JSON.stringify(payload)}`;
    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: `Use slot: ${opt.label}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newUserMessage]);
    setIsThinking(true);
    setThinkingSteps(buildProcessSteps(newUserMessage.content));
    const cid = conversationIdRef.current;
    const data = await sendChatMessage(userId, combinedPrompt, cid || undefined, {
      callBackendToken: callBackendToken ?? undefined,
      personalProfile: personalProfilePayload,
    });
    if (data?.conversation_id) conversationIdRef.current = data.conversation_id;
    const content = data?.reply_text ?? API_OFFLINE_MESSAGE;
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      timestamp: new Date(),
      isTyping: true,
      buttons: actionButtonsForReply(data?.debug_state, content),
      parkingOptions: parseParkingOptions(data?.ui_options),
      calSlotOptions: parseCalSlotOptions(data?.ui_options),
      processSteps: buildProcessSteps(newUserMessage.content, content),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsThinking(false);
    setThinkingSteps(null);
    if (typeof data?.free_trial_remaining === "number") {
      onFreeTrialRemainingChange?.(data.free_trial_remaining);
    }
    emitCallTasksFromResponse(data, newUserMessage.content);
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
        const pending = attachments.map((item, idx) => {
          const file = accepted[idx];
          const canPreview = file?.type.startsWith("image/");
          return {
            ...item,
            extractedFields,
            previewUrl: canPreview ? URL.createObjectURL(file) : undefined,
          } satisfies PendingAttachment;
        });
        setPendingAttachments((prev) => [...prev, ...pending]);
        setUploadError(null);
      } catch (error) {
        console.warn("Bill upload/extraction failed", error);
        setUploadError("Upload failed. Please retry with a valid image/PDF.");
      }
    }
    e.target.value = "";
  };

  const handleMicClick = () => {
    if (!hasSpeechSupport || !recognitionRef.current) return;
    try {
      if (isRecording) {
        recognitionRef.current.stop();
        setIsRecording(false);
      } else {
        setIsRecording(true);
        recognitionRef.current.start();
      }
    } catch {
      setIsRecording(false);
    }
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
                      {renderAttachments(message.attachments)}
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
                      {message.parkingOptions &&
                        message.parkingOptions.length > 0 &&
                        !message.isTyping && (
                          <ParkingSelection
                            messageId={message.id}
                            options={message.parkingOptions}
                          />
                        )}
                      {message.calSlotOptions &&
                        message.calSlotOptions.length > 0 &&
                        !message.isTyping && (
                          <div className="mt-4 space-y-2">
                            {message.calSlotOptions.map((slot, idx) => (
                              <button
                                key={`${slot.slot_start_at}-${idx}`}
                                onClick={() => void handleSelectCalSlot(slot)}
                                className="block w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                              >
                                {slot.label}
                              </button>
                            ))}
                            {message.calSlotOptions[0]?.booking_url ? (
                              <a
                                href={message.calSlotOptions[0].booking_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-block text-sm text-blue-600 hover:underline"
                              >
                                Open full Cal.com scheduler
                              </a>
                            ) : null}
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {/* Searching indicator */}
            {isSearching && <SearchingIndicator />}
            {isThinking && <ThinkingIndicator />}
          </div>
        </div>

        {/* Input Area */}
        <div className="px-6 py-4 border-t border-gray-100">
          <div className="pr-6">
            {pendingAttachments.length > 0 && (
              <div className="mb-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
                <p className="text-xs text-gray-600 mb-2">Ready to send with this message:</p>
                <div className="flex flex-wrap gap-2">
                  {pendingAttachments.map((file, idx) => (
                    <div
                      key={`${file.path}-${idx}`}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1"
                    >
                      <span className="text-xs text-gray-700">{file.fileName}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAttachments((prev) => {
                            const next = [...prev];
                            const removed = next.splice(idx, 1)[0];
                            if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
                            return next;
                          })
                        }
                        className="text-xs text-gray-400 hover:text-gray-700"
                        aria-label={`Remove ${file.fileName}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="relative flex items-center rounded-xl bg-gray-50 px-4 py-3">
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
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                <Upload className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={handleMicClick}
                disabled={!hasSpeechSupport}
                className={`w-8 h-8 flex items-center justify-center transition-colors ${
                  hasSpeechSupport
                    ? isRecording
                      ? "text-red-500"
                      : "text-gray-400 hover:text-gray-600"
                    : "text-gray-300 cursor-not-allowed"
                }`}
              >
                <Mic className="w-5 h-5" />
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
            {uploadError && (
              <p className="mt-2 text-xs text-destructive">{uploadError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
