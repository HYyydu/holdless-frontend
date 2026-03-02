// GPT-4o-Realtime Media Stream Handler
import { WebSocket } from "ws";
import { Call } from "../types";
import {
  CallService,
  TranscriptService,
} from "../database/services/call-service";
import {
  decodeTwilioAudio,
  encodeTwilioAudio,
  resampleAudio,
} from "../utils/audio";
import { v4 as uuidv4 } from "uuid";
import { io } from "../server";
import { config } from "../config";
import { RealtimeAPIConnection } from "../services/realtime-api";
import { endCall } from "../services/telephony";
import {
  isQuoteCall,
  getQuoteCallerInstructions,
} from "../quote/caller-instructions";

// Constants for audio processing and timing thresholds
const AUDIO_THRESHOLDS = {
  SPEECH_DETECTION: 2000,
  HIGH_ENERGY: 4000,
  HIGH_ENERGY_AVG: 3000,
  INTERRUPTION_HIGH_ENERGY: 3500,
  BASELINE_MULTIPLIER: 2.0,
  ECHO_SUPPRESSION_MIN: 2500,
  MIN_AVG_ENERGY_RATIO: 0.7,
  ECHO_AVG_ENERGY_RATIO: 0.75,
} as const;

const TIMING_THRESHOLDS = {
  ECHO_PERIOD_MS: 800,
  ECHO_SUPPRESSION_MS: 2000, // Extended to catch more echo during AI speech
  ECHO_SUPPRESSION_EXTENDED_MS: 3000, // Extended to catch more echo during AI speech
  POST_RESPONSE_ECHO_MS: 5000, // Increased to 5000ms - any speech without interruption phrases is treated as echo
  SUSPECTED_SPEECH_TIMEOUT_MS: 2000,
  SPEECH_SUSPECTED_LOG_THROTTLE_MS: 2000,
  MIN_SPEECH_INTERVAL_MS: 100,
  MIN_TRANSCRIPT_LENGTH: 2,
  CONVERSATION_WINDOW_MS: 1000, // Wait 1 second of silence before responding to accumulated user speech
} as const;

const AUDIO_BUFFER_LIMITS = {
  ENERGY_HISTORY_SIZE: 5,
  BASELINE_HISTORY_SIZE: 20,
  BASELINE_MIN_SAMPLES: 10,
  CONSECUTIVE_SPEECH_FRAMES_NORMAL: 2,
  CONSECUTIVE_SPEECH_FRAMES_HIGH_ENERGY: 1,
} as const;

const INTERRUPTION_PHRASES = [
  "oh wait",
  "wait",
  "wait a sec",
  "wait a second",
  "stop",
  "hold on",
  "hang on",
  "actually",
  "no wait",
  "wait a minute",
  "hold up",
  "excuse me",
  "sorry",
  "pardon",
  "what",
  "huh",
  "can you repeat",
  "say that again",
] as const;

// Common polite phrases that are often mis-transcribed or could be echo
// These should be treated with extra caution if they appear shortly after AI finishes speaking
const COMMON_POLITE_PHRASES = [
  "thank you for your time",
  "thanks for your time",
  "thank you for calling",
  "thanks for calling",
  "i appreciate your time",
  "appreciate your time",
] as const;

const CLOSING_PHRASES = [
  "thank you, goodbye",
  "thank you goodbye",
  "thanks, goodbye",
  "thanks goodbye",
  "goodbye, thank you",
  "goodbye thank you",
  "thank you, bye",
  "thank you bye",
  "thanks, bye",
  "thanks bye",
  "have a great day",
  "have a good day",
  "goodbye",
  "bye",
  "good bye",
] as const;

const INTRODUCTION_KEYWORDS = [
  "my name is",
  "i'm calling",
  "i'm calling because",
  "calling because",
  "need help with",
  "order number is",
] as const;

const GREETING_PHRASES = [
  "hello",
  "hi",
  "good morning",
  "good afternoon",
  "good evening",
  "how can I help",
  "how can I help you",
  "how may I help",
  "how may I help you",
  "thank you for calling",
  "thanks for calling",
  "this is",
  "speaking",
] as const;

/**
 * GPT-4o-Realtime Handler for bidirectional audio streaming
 *
 * 🚨 CRITICAL INTERRUPTION LOGIC:
 * - Once AI starts speaking, ONLY explicit interruption phrases can stop it
 * - Interruption phrases are detected via transcription (not VAD or echo)
 * - VAD events (client-side or server-side) do NOT cancel responses
 * - Echo suppression does NOT cancel responses
 * - Regular user speech during AI response does NOT interrupt the AI
 * - The AI will NOT interrupt itself (no automatic response cancellation)
 *
 * Only `handleInterruptionPhrase()` can cancel responses, and only when:
 * 1. A transcription confirms an interruption phrase (e.g., "wait", "stop")
 * 2. The phrase is detected AFTER the AI started speaking (responseStartTime > 0)
 *
 * IMPORTANT: Interruption phrases detected BEFORE the AI starts speaking are IGNORED
 * - If user says "wait" before AI starts, it's not an interruption
 * - Only interruptions DURING the AI's response will stop it
 *
 * ⚠️ KNOWN TRANSCRIPTION ACCURACY ISSUE:
 * GPT-4o Realtime's transcription API (`conversation.item.input_audio_transcription.completed`)
 * can be less accurate than its language understanding, especially with:
 * - Accents or non-native speakers
 * - Audio quality issues
 * - Background noise
 * - Similar-sounding words (e.g., "phone response" vs "full refund")
 *
 * The AI may correctly understand what the user said (evidenced by its response) but the
 * raw transcription may be inaccurate. The `validateTranscriptionAgainstResponse()` method
 * attempts to detect these mismatches by comparing the transcription with the AI's response.
 *
 * Example: User says "issue a full refund" but transcription shows "issue a phone response".
 * The AI correctly understands "full refund" (as shown in its response) but the transcription
 * is wrong. This is a known limitation of GPT-4o Realtime's transcription service.
 */
export class GPT4oRealtimeHandler {
  private ws: WebSocket;
  private call!: Call;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private isInitialized: boolean = false;
  private realtimeConnection: RealtimeAPIConnection | null = null;
  private audioBuffer: Buffer[] = [];
  private hasSentGreeting: boolean = false;
  private pendingAudioChunks: Buffer[] = [];
  private isProcessingResponse: boolean = false;
  private pendingResponseRequest: NodeJS.Timeout | null = null;
  private hasPendingResponseRequest: boolean = false; // Track if we've already queued a response request
  private responseStartTime: number = 0; // Track when AI response started (to ignore false positives from echo)
  private latestUserSpeechTimestamp: number = 0; // Track timestamp of latest user speech to ensure we only respond to newest input
  private shouldStopAudio: boolean = false; // Flag to immediately stop sending audio when user speaks (only set for interruption phrases)
  private lastAudioEnergy: number = 0; // Track audio energy for client-side VAD
  private audioEnergyHistory: number[] = []; // History of audio energy levels
  private consecutiveSpeechFrames: number = 0; // Count consecutive frames with speech
  private hasClosedCall: boolean = false; // Track if AI has closed the call (said goodbye)
  private baselineEnergy: number = 0; // Baseline audio energy (for echo detection)
  private baselineEnergyHistory: number[] = []; // History for calculating baseline
  private isInterrupted: boolean = false; // Track if user has interrupted (said "wait", etc.) - don't respond until they finish
  private suspectedSpeech: boolean = false; // Track if VAD detected speech (but not confirmed by transcription yet)
  private suspectedSpeechTimestamp: number = 0; // When suspected speech was detected
  private hasGivenIntroduction: boolean = false; // Track if AI has already given the introduction
  private lastAIResponse: string = ""; // Track last AI response to prevent duplicates
  private lastSpeechSuspectedLogTime: number = 0; // Track when we last logged speech suspected (for throttling)
  private lastResponseEndTime: number = 0; // Track when AI response ended (for echo suppression)
  private currentResponseHasAudio: boolean = false; // Track if current response has generated audio (for echo suppression)
  private currentResponseAudioDone: boolean = false; // Track if audio generation is complete for current response (prevents cancelling mid-stream)
  private lastProcessedUserTranscript: string = ""; // Track the last user transcript that was processed (not ignored)
  private lastUserTranscriptForResponse: string = ""; // Track which user transcript triggered the current response
  private respondedToTranscripts: Set<string> = new Set(); // Track which transcripts we've already responded to (prevent loops)
  private pendingTranscriptionValidation: Map<
    string,
    { transcript: string; timestamp: number }
  > = new Map(); // Track transcriptions awaiting validation from AI response
  private accumulatedTranscript: string = ""; // Accumulate consecutive user speech into one semantic request
  private conversationWindowTimer: NodeJS.Timeout | null = null; // Timer to wait for 1 second of silence before responding
  private lastTranscriptTime: number = 0; // Timestamp of the last transcript received

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupWebSocket();
  }

  private async initializeCall(callSid: string): Promise<boolean> {
    this.callSid = callSid;

    const foundCall = await CallService.getCallByCallSid(callSid);

    if (!foundCall) {
      console.error(`❌ Call not found for SID: ${callSid}`);
      this.ws.close();
      return false;
    }

    this.call = foundCall;
    this.isInitialized = true;

    console.log(
      `✅ GPT-4o-Realtime handler initialized for call: ${this.call.id}`
    );

    // Initialize Realtime API connection
    this.initializeRealtimeConnection().catch((error) => {
      console.error("❌ Failed to initialize Realtime API:", error);
      this.ws.close();
    });

    return true;
  }

  private async initializeRealtimeConnection() {
    try {
      console.log("🔌 Connecting to OpenAI Realtime API...");

      this.realtimeConnection = new RealtimeAPIConnection({
        model:
          config.openai.realtimeModel || "gpt-4o-realtime-preview-2024-12-17",
        voice: this.getVoiceFromPreference(),
        temperature: config.openai.temperature,
        max_response_output_tokens: 4096,
      });

      const ws = await this.realtimeConnection.connect();

      // Register message handlers
      this.realtimeConnection.onMessageType("*", (message: any) => {
        this.handleRealtimeMessage(message);
      });

      // Set system prompt and send configuration
      const systemPrompt = this.buildSystemPrompt();
      this.realtimeConnection.sendConfig(systemPrompt);

      console.log("✅ OpenAI Realtime API connected and configured");

      // DO NOT trigger any greeting - the AI must wait for customer service to speak first
      // Customer service will answer the phone and greet the customer
      // Only then should the AI respond as the customer
    } catch (error) {
      console.error("❌ Failed to connect to OpenAI Realtime API:", error);
      throw error;
    }
  }

  private getVoiceFromPreference(): string {
    // OpenAI Realtime API supported voices: 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
    const voiceMap: Record<string, string> = {
      professional_female: "shimmer", // Changed from 'nova' (not supported) to 'shimmer'
      professional_male: "echo", // Changed from 'onyx' (not supported) to 'echo'
      friendly_female: "coral", // Changed from 'shimmer' to 'coral' for variety
      friendly_male: "echo",
    };
    return (
      voiceMap[this.call.voice_preference || "professional_female"] || "shimmer"
    );
  }

  private buildSystemPrompt(): string {
    if (isQuoteCall(this.call.additional_instructions)) {
      return this.buildQuoteCallSystemPrompt();
    }
    const purpose = this.call.purpose || "";
    const additionalContext = this.call.additional_instructions || "";
    const fullText = (purpose + " " + additionalContext).toLowerCase();

    // Parse tone preference
    const toneMatch = additionalContext.match(/tone[:\s]+(polite|firm)/i);
    const communicationTone = toneMatch ? toneMatch[1].toLowerCase() : "polite";

    // Extract user name
    const nameMatch = (purpose + " " + additionalContext).match(
      /(?:user|name|customer)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
    );
    // Filter out common phrases that shouldn't be names (like "need help", "help with", etc.)
    const extractedName = nameMatch ? nameMatch[1] : null;
    const invalidNamePatterns =
      /need|help|with|assistance|request|refund|order|issue|problem/i;
    const userName =
      extractedName && !invalidNamePatterns.test(extractedName)
        ? extractedName
        : "Holdless";

    // Extract order number (look for patterns like "Order Number: 12345", "order number 12345", "order #12345")
    const orderNumberMatch = (purpose + " " + additionalContext).match(
      /order\s*(?:number|#)?\s*:?\s*([A-Z0-9\-]+)/i
    );
    const orderNumber = orderNumberMatch ? orderNumberMatch[1].trim() : null;

    // Extract company name (look for patterns like "Customer needs help with Amazon", "Company: Amazon", etc.)
    const companyMatch = (purpose + " " + additionalContext).match(
      /(?:customer needs help with|company|with)\s+([A-Z][a-zA-Z\s]+?)(?:\s*\.|,|Issue|Order|Desired|$)/i
    );
    let companyName = companyMatch ? companyMatch[1].trim() : null;
    // Clean up company name (remove trailing spaces, common words)
    if (companyName) {
      companyName = companyName
        .replace(/\s+$/, "")
        .replace(/\s+an\s+order$/i, "");
    }

    // Extract desired outcome
    const outcomeMatch = (purpose + " " + additionalContext).match(
      /(?:desired outcome|outcome)[:\s]+(.+?)(?:\s*\.|,|$|Order)/i
    );
    let desiredOutcome = outcomeMatch ? outcomeMatch[1].trim() : null;

    // Extract item description from desired outcome (e.g., "strawberries" from "Full refund for damaged strawberries")
    let issueDescription = null;
    if (desiredOutcome) {
      // Look for "for [item]" or "for damaged [item]" pattern
      const itemMatch = desiredOutcome.match(
        /(?:for|with|on)\s+(?:damaged|defective|broken|wrong)?\s*([a-z\s]+?)(?:\s*\.|,|$)/i
      );
      if (itemMatch) {
        issueDescription = itemMatch[1].trim();
        // Remove common words like "damaged", "defective" from the item name
        issueDescription = issueDescription
          .replace(/^(damaged|defective|broken|wrong)\s+/i, "")
          .trim();
        // Clean up the desired outcome to just the action (e.g., "Full refund")
        desiredOutcome = desiredOutcome
          .replace(/\s+for\s+.+$/i, "")
          .replace(/\s+with\s+.+$/i, "")
          .trim();
      }
    }

    // If no issue description found, try to extract from purpose directly
    if (!issueDescription) {
      const issueMatch = (purpose + " " + additionalContext).match(
        /(?:issue|item|product)[:\s]+(.+?)(?:\s*\.|,|Order|Desired|$)/i
      );
      issueDescription = issueMatch ? issueMatch[1].trim() : null;
    }

    // Build order number spelling for introduction
    const orderNumberSpelled = orderNumber
      ? orderNumber
          .split("")
          .map((char) => {
            if (/\d/.test(char)) {
              const words = [
                "zero",
                "one",
                "two",
                "three",
                "four",
                "five",
                "six",
                "seven",
                "eight",
                "nine",
              ];
              return words[parseInt(char)];
            }
            return char.toUpperCase();
          })
          .join(", ")
      : null;

    // Extract email address
    const emailMatch = (purpose + " " + additionalContext).match(
      /email\s*(?:address)?\s*:?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i
    );
    const emailAddress = emailMatch ? emailMatch[1].trim() : null;

    // Extract phone number
    const phoneMatch = (purpose + " " + additionalContext).match(
      /phone\s*(?:number)?\s*:?\s*([+]?[\d\s\-()]+)/i
    );
    const phoneNumber = phoneMatch ? phoneMatch[1].trim() : null;

    // Build list of available information
    const availableInfo: string[] = [];
    if (orderNumber) availableInfo.push(`- Order number: ${orderNumber}`);
    if (emailAddress) availableInfo.push(`- Email address: ${emailAddress}`);
    if (phoneNumber) availableInfo.push(`- Phone number: ${phoneNumber}`);

    // Build system prompt for customer role
    return `YOU ARE THE CUSTOMER - CRITICAL ROLE DEFINITION:
You are ${userName}, a CUSTOMER who wants a refund/help. You are NOT customer service.
The HUMAN on the call is the CUSTOMER SERVICE REPRESENTATIVE who will help you.

ROLE BREAKDOWN:
- YOU (AI): CUSTOMER - You request refunds, ask for help, need assistance. You say things like "I need", "I'd like", "Can you help", "My order arrived damaged"
- THE HUMAN: CUSTOMER SERVICE REPRESENTATIVE - They process refunds, look things up, provide help. They say things like "I can help you", "I'll process that", "Let me look that up"

NEVER act like customer service:
- NEVER say "I'll process", "I'll look that up", "I can help you", "How can I help you today?"
- NEVER ask "What can I do for you?" or "How may I assist you?"
- NEVER act like you're providing service to someone
- NEVER say customer service phrases when ending: "Is there anything else I can assist you with?", "Is there anything else I can help you with today?", "Have a great day", or similar service provider phrases
- When ending the call, say simple customer phrases like "Thank you for your help", "Thanks", or "Thank you, goodbye" - NEVER use phrases that sound like you're the service provider

ALWAYS act like a customer:
- You NEED help, REQUEST things, ASK for assistance
- You REQUEST refunds, you don't process them
- You ASK for help, you don't provide it
- You are the one who wants something (refund, replacement, etc.) 

🚨🚨🚨 CRITICAL GOODBYE RULE - READ THIS FIRST 🚨🚨🚨:
- ONLY say "Thank you for your help. Goodbye" when you hear EXPLICIT goodbye/ending phrases from the representative
- Explicit goodbye phrases: "That's all I need", "No, that's all", "I have everything I need", "That's all the information I need", "That's all", "No, that's all information I will need"
- NEVER say goodbye when:
  * They ask for information (order number, email, etc.)
  * They ask you to repeat information
  * They say polite phrases like "Thank you for your time"
  * They ask questions
  * You provide information
- If you're not 100% certain the representative explicitly said goodbye, DO NOT say goodbye - continue the conversation

CRITICAL: Distinguish acknowledgments from requests/questions.

SIMPLE ACKNOWLEDGMENTS (standalone: "Okay", "Got it", "I see", "Alright", "Sure", "Perfect", "Great", "That works", "Sounds good"):
→ Respond with 1-2 words: "Great", "Perfect", "Thanks", "Thank you". DO NOT mention missing information or make up scenarios.
→ NEVER respond with "I'm here", "Oh, great", or similar phrases - these are typically echo/feedback, not real acknowledgments

REQUESTS/QUESTIONS ("I need...", "Can you provide...", "What's your...", "Could you..."):
→ Handle normally - answer questions, fulfill requests. DO NOT respond with just "Great".

INTERRUPTIONS - CRITICAL:
CRITICAL RULE: You MUST finish your current response UNLESS you hear a clear interruption signal.

CLEAR INTERRUPTION SIGNALS (these are the ONLY phrases that should stop you mid-response):
- "oh wait"
- "wait"
- "stop"
- "hold on"
- "hang on"
- "actually"
- "no wait"
- "wait a minute"
- "hold up"
- "excuse me"

DEFAULT BEHAVIOR - ALWAYS FINISH YOUR RESPONSE:
→ When you start speaking, you MUST complete your full response/sentence
→ Do NOT stop speaking unless you hear one of the clear interruption signals above
→ Do NOT stop for regular user speech during your response - only stop for clear interruption phrases
→ Finish your thought completely - the representative will wait for you to finish
→ If user speaks while you're talking (but doesn't say an interruption phrase), continue speaking and finish your response

WHEN INTERRUPTED (only for clear signals like "oh wait", "wait", "stop"):
→ STOP talking IMMEDIATELY - do NOT say "Okay", "Sure", "I'm here", or anything else
→ Remain COMPLETELY SILENT and listen carefully to what they're saying
→ DO NOT respond to interruption signals - just stop and remain silent
→ After they finish speaking completely, respond appropriately to what they actually said
→ ONLY ask "Can you repeat that again?" if the transcription is garbled/nonsensical (words that don't make sense together, like "purple elephant refrigerator" when discussing an order)
→ DO NOT ask for repetition for interruption phrases - these are clear and intentional
→ NEVER respond to interruptions with acknowledgments like "Sure", "I'm here", "Okay" - just stop and listen silently

ECHO/FEEDBACK DETECTION - CRITICAL:
CRITICAL: You MUST NEVER respond to your own voice or echo/feedback.

→ If you hear your own words repeated back (echo/feedback), IGNORE it completely - do NOT respond
→ Do NOT respond to echo/feedback with ANY words or acknowledgments - remain completely silent
→ Echo/feedback often sounds like: your own words, "Oh, great", "I'm here", "Sure", "Okay", "Thanks", or other short phrases
→ If you just finished speaking and hear something immediately after (< 3 seconds), it's likely echo - IGNORE it completely and remain silent
→ Only respond to NEW, MEANINGFUL speech from the representative that comes AFTER enough time has passed (> 3 seconds after you finished)
→ NEVER generate responses to your own speech - you cannot respond to yourself
→ NEVER generate responses like "I'm here", "Oh, great", "Sure", "Okay", "Thanks" - these are typically echo/feedback, not real speech
→ If you're unsure whether something is echo or real speech, ALWAYS assume it's echo and remain completely silent
→ The representative will speak clearly and meaningfully with proper timing - short phrases right after you speak are usually echo
→ CRITICAL: If you hear ANY words right after you speak (especially "I'm here", "Oh, great", "Sure", "Okay"), it's echo - DO NOT respond, remain silent
→ CRITICAL: You are NEVER allowed to respond to your own voice - if you hear words similar to what you just said, it's echo - remain silent

WAIT for representative to greet you first. 

RESPONDING TO GREETINGS:
- If they say "Hello", "Hi", "How are you?", or similar greetings: Respond with a friendly greeting and your introduction
- If they ask "How can I help you?" or "What can I do for you?": Respond with your full introduction including the order number
- Do NOT jump straight to the order number when they just say "Hello" or "Hi" - that's just a greeting, not a request for information

INTRODUCTION FORMAT:
When introducing yourself, use this natural format:

${
  orderNumber && orderNumberSpelled
    ? `Example for greeting response: "Hi! My name is ${userName}. I'm calling because I need help with ${
        companyName ? `a ${companyName} order` : "an order"
      }. ${
        issueDescription
          ? `My ${issueDescription} arrived damaged,`
          : "I have an issue with my order,"
      } and I'd like to ${
        desiredOutcome ? desiredOutcome.toLowerCase() : "request a refund"
      }."\n\nIf they ask for the order number or say "How can I help you?", then add: "The order number is ${orderNumberSpelled}."`
    : `Example format: "Hi! My name is ${userName}. I'm calling because I need help with ${
        companyName ? `a ${companyName} order` : "an order"
      }. ${
        issueDescription
          ? `My ${issueDescription} arrived damaged,`
          : "I have an issue with my order,"
      } and I'd like to ${
        desiredOutcome ? desiredOutcome.toLowerCase() : "request a refund"
      }."`
}

CRITICAL INTRODUCTION RULES:
- Make it natural and conversational - speak like a real customer, not a robot listing fields
- Do NOT say: "Customer needs help with... Issue Type:... Order Number:... Desired Outcome:..."
- DO say: "Hi, my name is [name]. I'm calling because I need help with [company] order. My [item] arrived damaged. I'd like to request a [outcome]."
- If you have an order number, include it ONLY when:
  1. They ask "How can I help you?" or similar questions
  2. They explicitly ask for the order number
  3. They ask for verification information
- Do NOT say "Sure, the order number is..." unless they actually asked for it
- Make the issue description natural: "My strawberries arrived damaged" not "Issue Type: Return/Refund"
- After first introduction, NEVER repeat it - especially NOT after saying goodbye/thank you

YOUR INFORMATION:
- Purpose: ${purpose}
${additionalContext ? `- Additional context: ${additionalContext}` : ""}
- Name: ${userName}
- Tone: ${communicationTone}
${
  availableInfo.length > 0
    ? `\nAvailable info: ${availableInfo.join(
        ", "
      )}. When asked, you MUST share it.`
    : ""
}

${
  orderNumber
    ? `\nCRITICAL: Order number ${orderNumber} found. 
- DO NOT provide it unless explicitly asked (e.g., "What's your order number?", "How can I help you?", "Can I have your order number?")
- When asked, SPELL IT OUT character by character: ${orderNumber
        .split("")
        .map((char) => {
          if (/\d/.test(char)) {
            const words = [
              "zero",
              "one",
              "two",
              "three",
              "four",
              "five",
              "six",
              "seven",
              "eight",
              "nine",
            ];
            return words[parseInt(char)];
          }
          return char.toUpperCase();
        })
        .join(", ")}
- For simple greetings like "Hello" or "Hi", do NOT include the order number - just introduce yourself and explain why you're calling`
    : ""
}

You ONLY have information explicitly stated above. NEVER invent, guess, or fabricate information.

PRIORITIES:
1. REQUEST the desired outcome (refund, reship, appointment, etc.) - ASK for it, don't process it yourself (you're the customer, not customer service)
2. Minimize time and friction
3. Protect privacy - only share explicitly allowed data
4. Work WITH the customer service representative (the human) to resolve your issue

REMEMBER: You are the CUSTOMER. You REQUEST help. The REPRESENTATIVE provides help.

RESPONDING TO DIFFERENT SITUATIONS:

1. SIMPLE GREETINGS ("Hello", "Hi", "How are you?", "This is [name]"):
   → Respond with: "Hi! My name is [your name]. I'm calling because [reason]."
   → Do NOT provide order number or other details unless asked
   → Wait for them to ask "How can I help you?" or similar before providing full details

2. WHEN ASKED "How can I help you?" or "What can I do for you?":
   → Provide your full introduction including the issue and desired outcome
   → Include order number if you have one and they ask for it

3. WHEN ASKED FOR SPECIFIC INFORMATION (order number, email, etc.):
   → Provide it immediately (order numbers must be spelled character by character)
   → 🚨🚨🚨 CRITICAL: When providing information, ONLY provide the information requested - do NOT add any closing phrases like "Thank you for your help", "Thanks", "Goodbye", or any other acknowledgments
   → 🚨🚨🚨 NEVER say "Goodbye" or "Thank you for your help" after providing information - the conversation is NOT ending, you're just answering a question
   → Just give the information directly: "The order number is [spelled out]" or "My email is [email]" - that's it, nothing more
   → Example CORRECT response: "The order number is A, D, F, A, S, D, G, A, S, D, G."
   → Example WRONG response: "The order number is A, D, F, A, S, D, G, A, S, D, G. Thank you for your help. Goodbye." ❌ NEVER DO THIS
   → If they ask you to repeat information (e.g., "Could you repeat the order number slowly?"), just repeat it - do NOT say goodbye
   → If you don't have it: "I'm sorry, I don't have that information with me right now. I'll need to confirm that with the user and call you back with that information. Is there any other information you'll need when I call back?"

VERIFICATION & PRIVACY:
- ONLY provide information explicitly stated in purpose/instructions above
- Look for patterns: "Order Number: X", "order number X", "order #X", "Email: X", "Phone: X", etc.
- If they ask for info you HAVE: provide it (order numbers must be spelled character by character: "12345" → "one, two, three, four, five")
- 🚨🚨🚨 CRITICAL: When providing information, ONLY state the information - do NOT add "Thank you for your help", "Thanks", "Goodbye", or any other phrases after providing information
- 🚨🚨🚨 NEVER say goodbye after providing information - asking for information or asking you to repeat information is NOT a signal to end the call
- Example CORRECT: If asked "What's your order number?", respond with ONLY "The order number is [spelled out]" - nothing else
- Example WRONG: "The order number is [spelled out]. Thank you for your help. Goodbye." ❌ NEVER DO THIS
- If they ask you to repeat information (e.g., "Could you repeat that?", "Can you say that again?", "Could you repeat the order number slowly?"), just repeat the information - do NOT add goodbye or closing phrases
- If they ask for info you DON'T have: "I'm sorry, I don't have that information with me right now. I'll need to confirm that with the user and call you back with that information. Is there any other information you'll need when I call back?"
- Track multiple requests: After first apology, just confirm list: "Okay, let me confirm you need [list]. Is there anything else?"
- NEVER use "I don't have information" pattern for acknowledgments - only for explicit questions about missing info
- NEVER invent, guess, or fabricate information
- NEVER say "Sure, the order number is..." unless they explicitly asked for the order number

TONE & INTERACTION:
- Stay calm, polite, professional. ${
      communicationTone === "firm"
        ? "Be concise and assertive, never rude."
        : ""
    }
- Avoid small talk; keep call outcome-focused
- If agent proposes weaker outcome, push back once: "I appreciate that, but I was hoping for [desired outcome]. Is that possible?"
- If they can't change it, accept best realistic outcome
- 🚨🚨🚨 CRITICAL: Do NOT end the call or say goodbye until your goal is achieved (refund confirmed, case number received, etc.)
- 🚨🚨🚨 CRITICAL: Do NOT say goodbye when providing information or repeating information - asking for information is NOT a signal to end the call
- 🚨🚨🚨 CRITICAL: Only say goodbye when your goal is actually achieved OR when the representative explicitly says goodbye/ending phrases - NOT when they ask for information
- 🚨🚨🚨 CRITICAL: NEVER say "Thank you for your help. Goodbye" unless you hear a CLEAR, EXPLICIT signal from the representative that the conversation is ending
- 🚨🚨🚨 CRITICAL: The ONLY clear signals that the conversation is ending are:
  1. Representative says explicit goodbye/ending phrases like "That's all I need", "No, that's all", "I have everything I need", "That's all the information I need"
  2. Representative says "Is there anything else I can help you with?" and you respond "No, that's all" (only then say goodbye)
  3. Your goal is FULLY achieved (refund confirmed with case number, appointment scheduled with confirmation, etc.) AND the representative acknowledges completion
- 🚨🚨🚨 CRITICAL: Asking for information, repeating information, or saying polite phrases like "Thank you for your time" are NOT signals to end the call - NEVER say goodbye in response to these

REQUESTS TO REPEAT INFORMATION - CRITICAL:
- When the representative asks you to repeat information (e.g., "Could you repeat the order number slowly?", "Can you say that again?", "Could you repeat that?"), they are asking for clarification, NOT ending the call
- 🚨🚨🚨 CRITICAL: When asked to repeat information, provide ONLY the repeated information - do NOT add "Thank you for your help", "Thanks", "Goodbye", or any closing phrases
- Example CORRECT: If asked "Could you repeat the order number slowly?", respond with ONLY "The order number is [spelled out]" - nothing else
- Example WRONG: "The order number is [spelled out]. Thank you for your help. Goodbye." ❌ NEVER DO THIS
- Requests to repeat information mean the conversation is CONTINUING, not ending - just repeat the information and wait for their next question

POLITE PHRASES FROM REPRESENTATIVE - CRITICAL:
- When the representative says "Thank you for your time", "Thanks for calling", "I appreciate your patience", or similar polite phrases, this is just a POLITE ACKNOWLEDGMENT, NOT a request to end the call
- 🚨🚨🚨 CRITICAL: Do NOT respond with "Goodbye" or end the conversation when you hear these phrases
- 🚨🚨🚨 CRITICAL: Do NOT say "Thank you, goodbye" or any closing phrase when responding to "Thank you for your time"
- Respond politely with something like "Thank you" or "I appreciate it" and continue with your request or wait for them to help you
- These are just common customer service politeness phrases - the representative is still helping you
- 🚨🚨🚨 CRITICAL: NEVER say goodbye in response to polite phrases - polite phrases are NOT signals to end the call
- 🚨🚨🚨 CRITICAL: Only say goodbye when you hear a CLEAR, EXPLICIT signal that the conversation is ending:
  1. Representative says explicit goodbye/ending phrases: "That's all I need", "No, that's all", "I have everything I need", "That's all the information I need", "That's all", "No, that's all information I will need"
  2. Representative says "Is there anything else I can help you with?" AND you respond "No, that's all" (only then say goodbye)
  3. Your issue is FULLY resolved (refund confirmed with case number, appointment scheduled with confirmation, etc.) AND the representative explicitly acknowledges completion
- 🚨🚨🚨 CRITICAL: If you're not sure whether to end the call, DON'T end it - continue the conversation until you hear a CLEAR signal that it's ending
- 🚨🚨🚨 CRITICAL: Asking questions, requesting information, or saying polite phrases are NEVER signals to end the call - NEVER say goodbye in response to these

WHEN THE REPRESENTATIVE SAYS GOODBYE/ENDING PHRASES - CRITICAL:
- 🚨🚨🚨 CRITICAL: ONLY say goodbye when you hear EXPLICIT goodbye/ending phrases from the representative
- Explicit goodbye/ending phrases include: "No, that's all information I will need", "That's all I need", "That's all", "No, that's all", "I have everything I need", "That's all the information I need", "That's all I will need"
- 🚨🚨🚨 CRITICAL: These are the ONLY phrases that signal the call is ending - if you don't hear one of these exact phrases, DO NOT say goodbye
- When you hear these EXPLICIT phrases, respond with a SIMPLE, BRIEF goodbye like "Thank you" or "Thank you for your help" (1-2 words max)
- NEVER reintroduce yourself when the representative says goodbye - the call is ending, not starting
- NEVER say "Hi, my name is..." or "I'm calling because..." after the representative says goodbye/ending phrases
- NEVER use your introduction greeting when responding to goodbye/ending phrases - just say "Thank you" or "Thanks" and end
- The representative saying explicit goodbye phrases means the call is OVER - respond with minimal acknowledgment only
- CRITICAL: After the representative says goodbye/ending phrases, you have ALREADY introduced yourself earlier in the call - do NOT repeat your introduction
- 🚨🚨🚨 CRITICAL: If the representative says anything OTHER than explicit goodbye/ending phrases, DO NOT say goodbye - continue the conversation

DURING CALL:
- IVR/hold: System handles button presses automatically. Wait through hold music without complaining
- Ask clarifying questions: "To confirm, will the refund be $X back to original payment method?"
- Secure proof: Always ask for case number, refund amount, effective date, appointment time, or email confirmation

RESPONSE GUIDELINES:
- Keep responses concise (1-3 sentences)
- CRITICAL: ALWAYS finish your current response completely - do NOT stop mid-sentence unless you hear a clear interruption signal ("oh wait", "wait", "stop", etc.)
- NEVER stop speaking just because you hear the representative start talking - only stop for clear interruption phrases
- Complete your thought fully - the representative will wait for you to finish your response
- NEVER volunteer information - only answer what was asked
- Answer EXACTLY what was asked: if they ask for order number, give number (spelled character by character), NOT name
- 🚨🚨🚨 CRITICAL: When answering information requests (order number, email, phone, etc.), provide ONLY the information - do NOT add "Thank you for your help", "Thanks", "Goodbye", or any closing phrases
- 🚨🚨🚨 NEVER say goodbye when providing information - the conversation continues after you provide information
- Information requests should be answered with just the information: "The order number is [spelled]" or "My email is [email]" - nothing more
- If they ask you to repeat information (e.g., "Could you repeat the order number slowly?"), respond with ONLY the repeated information - do NOT add goodbye or closing phrases
- Order/account numbers: ALWAYS spell character by character ("12345" → "one, two, three, four, five", NOT "twelve thousand...")
- If interrupted by clear signal ("oh wait", "wait", "stop"): STOP talking IMMEDIATELY, remain SILENT, listen carefully
- ONLY ask "Can you repeat that again?" if the transcription is garbled/nonsensical (words that don't make sense together)
- DO NOT ask for repetition for clear interruption phrases - these are intentional
- DO NOT ask for repetition just because context is unclear - only when actual words are nonsensical
- If meaning is clear: Respond correctly to what was said
- Respond directly to what was actually said, not assumptions
- NEVER generate responses like "I'm here", "Oh, great", "Sure", "Okay" - these are typically echo/feedback, not real speech
- If you just finished speaking and immediately hear something (< 3 seconds), it's likely echo - IGNORE it completely, remain silent, do NOT respond
- CRITICAL: You CANNOT respond to your own voice - if you hear words similar to what you just said, remain silent

AVOID REPETITION - CRITICAL:
- NEVER repeat your introduction - you only introduce yourself ONCE at the beginning of the call
- If you've already said "Hi, my name is [name]. I'm calling because...", NEVER say it again, even if asked
- NEVER repeat information you've already provided in the same call
- NEVER repeat closing phrases - say "Thank you" ONCE, then just acknowledge briefly if they respond
- Prevent acknowledgment loops: if you said "Great" and they say "Okay", don't respond again - wait for actual content
- If you're unsure whether you've already said something, assume you have and don't repeat it
- Each piece of information should be stated only ONCE per call
- CRITICAL: If the representative says goodbye/ending phrases (like "No, that's all", "That's all I need"), NEVER reintroduce yourself - just say "Thank you" or "Thanks" (1-2 words max)
- NEVER use your introduction greeting ("Hi, my name is...") when responding to goodbye/ending phrases from the representative

CALL ENDING - CRITICAL:
- 🚨🚨🚨 CRITICAL: ONLY say goodbye when you hear a CLEAR, EXPLICIT signal from the representative that the conversation is ending
- 🚨🚨🚨 CRITICAL: The ONLY clear signals are explicit goodbye/ending phrases like "That's all I need", "No, that's all", "I have everything I need", "That's all the information I need"
- 🚨🚨🚨 CRITICAL: If you don't hear one of these explicit phrases, DO NOT say goodbye - continue the conversation
- When ending the call (ONLY after hearing explicit goodbye phrases), you are the CUSTOMER saying goodbye, NOT customer service
- Say simple customer phrases like: "Thank you for your help", "Thanks", "Thank you, goodbye", or "Goodbye"
- NEVER say customer service phrases when ending: "Is there anything else I can assist you with?", "Is there anything else I can help you with today?", "Have a great day", or any phrase that sounds like you're the service provider
- You are the customer receiving help, so keep your ending simple and grateful - just "Thank you for your help" is perfect
- After you say "Thank you", "Thank you, goodbye", "Goodbye", or any closing phrase, the call is ENDING
- NEVER introduce yourself again after saying goodbye - the call is over
- If representative responds after your goodbye (e.g., "You're welcome", "Have a great day"), just say "Thanks" or "You too" (1-2 words max) - do NOT reintroduce yourself
- NEVER say "Hi, I am..." or "My name is..." after you've already closed the call
- Once you've closed, stay silent or give minimal acknowledgment only - do NOT restart the conversation
- 🚨🚨🚨 CRITICAL REMINDER: NEVER say goodbye unless you hear explicit goodbye/ending phrases from the representative - all other phrases (questions, requests, polite acknowledgments) mean the conversation continues`;
  }

  private buildQuoteCallSystemPrompt(): string {
    const purpose = this.call.purpose || "";
    const callerRules = getQuoteCallerInstructions();
    return `${callerRules}

YOUR SCRIPT (follow this when they answer):
${purpose}

- Wait for the clinic to greet you, then deliver the script naturally.
- Only state facts from the script above. For any missing detail, say "not specified" or "the owner isn't sure."
- Your role is only to ask for pricing. When they give a price, thank them and end the call.`;
  }

  private setupWebSocket() {
    console.log(
      `🎙️  GPT-4o-Realtime Media stream WebSocket connected, waiting for start event...`
    );

    this.ws.on("message", async (message: string) => {
      try {
        const data = JSON.parse(message);
        await this.handleMessage(data);
      } catch (error) {
        console.error(
          "❌ Error handling GPT-4o-Realtime media stream message:",
          error
        );
      }
    });

    this.ws.on("close", () => {
      if (this.call) {
        console.log(
          `🔴 GPT-4o-Realtime Media stream closed for call: ${this.call.id}`
        );
      } else {
        console.log(
          `🔴 GPT-4o-Realtime Media stream closed (call not yet initialized)`
        );
      }
      this.cleanup();
    });

    this.ws.on("error", (error) => {
      console.error("❌ GPT-4o-Realtime WebSocket error:", error);
    });
  }

  private async handleMessage(data: any) {
    switch (data.event) {
      case "connected":
        console.log("✅ GPT-4o-Realtime Media stream connected");
        break;

      case "start":
        this.streamSid = data.streamSid;
        console.log(
          `🎬 GPT-4o-Realtime Media stream started: ${this.streamSid}`
        );

        let callSid = data.start?.callSid || data.callSid;

        // Fallback: try to get from WebSocket query parameter
        if (!callSid && (this.ws as any).callSidFromQuery) {
          callSid = (this.ws as any).callSidFromQuery;
          console.log(`📞 Using CallSid from query parameter: ${callSid}`);
        }

        if (!callSid) {
          console.error("❌ No callSid in start event or query params");
          this.ws.close();
          return;
        }

        // Initialize the call
        const initialized = await this.initializeCall(callSid);
        if (!initialized) {
          return;
        }

        console.log(
          `🚀 GPT-4o-Realtime handler ready for call: ${this.call.id}`
        );
        console.log(`   Provider: GPT-4o Realtime`);
        break;

      case "media":
        // Handle incoming audio from Twilio
        if (this.isInitialized && data.media?.payload) {
          await this.handleAudioData(data.media.payload);
        }
        break;

      case "stop":
        console.log(`🛑 GPT-4o-Realtime Media stream stopped`);
        this.cleanup();
        break;

      default:
        console.log(`ℹ️  GPT-4o-Realtime Unknown event: ${data.event}`);
    }
  }

  /**
   * Calculate audio energy (RMS) from PCM buffer
   */
  private calculateAudioEnergy(pcmBuffer: Buffer): number {
    if (!pcmBuffer || pcmBuffer.length < 2) return 0;

    const samples = new Int16Array(
      pcmBuffer.buffer,
      pcmBuffer.byteOffset,
      pcmBuffer.length / 2
    );

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / samples.length);
  }

  /**
   * Calculate time since response started
   */
  private getTimeSinceResponseStart(): number {
    return this.responseStartTime > 0
      ? Date.now() - this.responseStartTime
      : Infinity;
  }

  /**
   * Check if we're in an echo period (AI just started speaking)
   */
  private isInEchoPeriod(): boolean {
    const timeSinceResponseStart = this.getTimeSinceResponseStart();
    return (
      this.isProcessingResponse ||
      timeSinceResponseStart < TIMING_THRESHOLDS.ECHO_PERIOD_MS
    );
  }

  /**
   * Check if audio should be blocked due to interruption
   * Only blocks if interruption phrase was detected (isInterrupted flag)
   */
  private shouldBlockAudio(): boolean {
    // Only block if interruption phrase was explicitly detected
    if (this.isInterrupted) {
      return true;
    }

    // If shouldStopAudio is set but isInterrupted is false, clear the stale flag
    // This ensures we don't block for non-interruption phrases
    if (this.shouldStopAudio && !this.isInterrupted) {
      this.shouldStopAudio = false;
    }

    return false;
  }

  /**
   * Check if text contains an interruption phrase
   */
  private isInterruptionPhrase(text: string): boolean {
    const lowerText = text.toLowerCase().trim();
    return INTERRUPTION_PHRASES.some((phrase) => lowerText.includes(phrase));
  }

  /**
   * Check if text contains a user goodbye/ending phrase
   * These are phrases the representative (user) might say to end the call
   */
  private isUserGoodbyePhrase(text: string): boolean {
    const lowerText = text.toLowerCase().trim();
    const userGoodbyePhrases = [
      "that's all",
      "thats all",
      "that is all",
      "that's all i need",
      "thats all i need",
      "that's all information",
      "thats all information",
      "that's all the information",
      "thats all the information",
      "no, that's all",
      "no thats all",
      "no that's all",
      "that's all i will need",
      "thats all i will need",
      "i have everything i need",
      "i have all the information",
      "i have all i need",
      "that's everything",
      "thats everything",
      "bye",
      "bye-bye",
      "bye bye",
      "goodbye",
      "good bye",
    ];
    return userGoodbyePhrases.some((phrase) => lowerText.includes(phrase));
  }

  /**
   * Check if text contains a closing phrase
   * Only triggers if closing phrases appear at the END of the response,
   * not just anywhere in the text. This prevents false positives when
   * the AI mentions these words in the middle of a conversation.
   */
  private isClosingPhrase(text: string): boolean {
    const lowerText = text.toLowerCase().trim();

    // If the text is very short (< 50 chars), check if it contains closing phrases
    // Short responses with closing phrases are likely actual closings
    if (lowerText.length < 50) {
      return (
        CLOSING_PHRASES.some((phrase) => lowerText.includes(phrase)) ||
        (lowerText.includes("thank you") &&
          (lowerText.includes("goodbye") || lowerText.includes("bye")))
      );
    }

    // For longer responses, only check the last 100 characters
    // Closing phrases should appear at the END of a response, not in the middle
    const lastPortion = lowerText.slice(-100);

    // Check if any closing phrase appears in the last portion
    const hasClosingPhrase = CLOSING_PHRASES.some((phrase) =>
      lastPortion.includes(phrase)
    );

    // Check if "thank you" and "goodbye/bye" both appear in the last portion
    const hasThankYouAndGoodbye =
      lastPortion.includes("thank you") &&
      (lastPortion.includes("goodbye") || lastPortion.includes("bye"));

    // Also check if the response ends with a closing phrase (last 30 chars)
    const endsWithClosing = CLOSING_PHRASES.some(
      (phrase) =>
        lowerText.endsWith(phrase) ||
        lowerText.endsWith(phrase + ".") ||
        lowerText.endsWith(phrase + "!")
    );

    return hasClosingPhrase || hasThankYouAndGoodbye || endsWithClosing;
  }

  /**
   * Check if text is an introduction
   */
  private isIntroduction(text: string): boolean {
    const normalizedText = text.toLowerCase().trim();
    return INTRODUCTION_KEYWORDS.some((keyword) =>
      normalizedText.includes(keyword)
    );
  }

  /**
   * Check if text is a nonsensical/garbled phrase (likely mis-transcribed echo)
   * Examples: "any of us needing help", "the order number is", "my name is needs help"
   */
  private isNonsensicalPhrase(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }
    const lowerText = text.toLowerCase().trim();

    // Patterns that indicate garbled/nonsensical phrases
    const nonsensicalPatterns = [
      /^any of (us|you|them) (needing|needs|need) (help|assistance)/i, // "any of us needing help"
      /^(the|my|your) (order|name|email|phone) (number|is|are)/i, // Incomplete phrases like "the order number is" (without completion)
      /^my name is (needs|need|needing) (help|assistance)/i, // "my name is needs help"
      /^(i|we|you|they) (need|needs|needing) (help|assistance) (with|for|to)/i, // Fragments like "I need help with" without completion
    ];

    // Check if it matches nonsensical patterns
    for (const pattern of nonsensicalPatterns) {
      if (pattern.test(lowerText)) {
        return true;
      }
    }

    // Check for grammatically odd constructions
    // Phrases that start with "any of" followed by verb forms are often garbled
    if (
      /^any of (us|you|them)/i.test(lowerText) &&
      /(needing|needs|need)/i.test(lowerText)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if text contains a question (question mark or question words)
   */
  private containsQuestion(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }
    const lowerText = text.toLowerCase();
    // Check for question mark
    if (text.includes("?")) {
      return true;
    }
    // Check for question words at the start of sentences
    const questionWords = [
      "could you",
      "can you",
      "would you",
      "will you",
      "may i",
      "should i",
      "what",
      "when",
      "where",
      "why",
      "how",
      "who",
      "which",
      "is there",
      "are there",
      "do you",
      "does",
      "did",
    ];
    return questionWords.some(
      (word) => lowerText.includes(word + " ") || lowerText.startsWith(word)
    );
  }

  /**
   * Check if text is a greeting phrase (from customer service representative)
   * Greetings should be allowed through even if they happen shortly after AI starts speaking
   */
  private isGreetingPhrase(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }
    const lowerText = text.toLowerCase().trim();
    return GREETING_PHRASES.some((phrase) => lowerText.includes(phrase));
  }

  /**
   * Check if text is a common polite phrase that could be echo/mis-transcription
   * These phrases are often mis-transcribed or could be echo when they appear shortly after AI finishes speaking
   */
  private isCommonPolitePhrase(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }
    const lowerText = text.toLowerCase().trim();
    return COMMON_POLITE_PHRASES.some((phrase) => lowerText.includes(phrase));
  }

  /**
   * Check if text is a name introduction that could be mis-transcribed echo
   * Name introductions like "My name is Kate" are often mis-transcribed echo when they appear
   * shortly after AI finishes speaking, especially if the AI mentioned a name or similar words
   */
  private isNameIntroduction(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }
    const lowerText = text.toLowerCase().trim();
    // Match patterns like "My name is [Name]" or "I'm [Name]" or "This is [Name]"
    const nameIntroductionPatterns = [
      /^my name is\s+\w+/i,
      /^i'm\s+\w+/i,
      /^i am\s+\w+/i,
      /^this is\s+\w+/i,
      /^it's\s+\w+/i,
      /^it is\s+\w+/i,
    ];
    return nameIntroductionPatterns.some((pattern) => pattern.test(lowerText));
  }

  /**
   * Extract error message from unknown error type
   */
  private getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Check if error is a harmless cancellation error
   */
  private isHarmlessCancellationError(errorMsg: string): boolean {
    return (
      errorMsg.includes("response_cancel_not_active") ||
      errorMsg.includes("no active response") ||
      errorMsg.includes("response_cancel")
    );
  }

  /**
   * Cancel AI response safely, handling errors gracefully
   */
  private cancelResponseSafely(): void {
    if (!this.realtimeConnection?.isConnectedToAPI()) return;

    try {
      const cancelled = this.realtimeConnection.cancelResponse();
      if (cancelled) {
        console.log("✅ AI response cancelled successfully");
      }
      this.isProcessingResponse = false;
    } catch (err: unknown) {
      const errorMsg = this.getErrorMessage(err);
      if (this.isHarmlessCancellationError(errorMsg)) {
        console.log(
          "ℹ️  Response already finished or not active - no need to cancel"
        );
      } else {
        console.error("❌ Error canceling response:", err);
      }
      this.isProcessingResponse = false;
    }
  }

  /**
   * Clear pending response request
   */
  private clearPendingResponseRequest(): void {
    if (this.pendingResponseRequest) {
      clearTimeout(this.pendingResponseRequest);
      this.pendingResponseRequest = null;
    }
    this.hasPendingResponseRequest = false;
  }

  /**
   * Clear conversation window timer and accumulated transcript
   */
  private clearConversationWindow(): void {
    this.clearConversationWindowTimer();
    this.accumulatedTranscript = "";
    this.lastTranscriptTime = 0;
  }

  /**
   * Clear conversation window timer
   */
  private clearConversationWindowTimer(): void {
    if (this.conversationWindowTimer) {
      clearTimeout(this.conversationWindowTimer);
      this.conversationWindowTimer = null;
    }
  }

  /**
   * Handle accumulated transcript response after 1 second of silence
   */
  private handleAccumulatedTranscriptResponse(): void {
    if (!this.accumulatedTranscript.trim()) {
      console.log("⚠️  No accumulated transcript to respond to");
      return;
    }

    const finalTranscript = this.accumulatedTranscript.trim();
    console.log(
      `📝📝📝 RESPONDING TO ACCUMULATED TRANSCRIPT (1s silence detected): "${finalTranscript}" 📝📝📝`
    );

    // 🚨 CRITICAL: Verify this is still the most recent user input
    // Check if user spoke again after this transcript timer started
    const timeSinceLastTranscript =
      this.lastTranscriptTime > 0
        ? Date.now() - this.lastTranscriptTime
        : Infinity;

    // If there's been new speech very recently (< 1 second), this accumulated transcript may be stale
    // But if it's been 3+ seconds (our conversation window), it should be safe to respond
    // The timer only fires after 1 second of silence, so if lastTranscriptTime is recent,
    // it means new speech came in after the timer started but before it fired
    if (timeSinceLastTranscript < 1000 && this.lastTranscriptTime > 0) {
      console.log(
        `⚠️⚠️⚠️ POTENTIALLY STALE ACCUMULATED TRANSCRIPT - User spoke ${timeSinceLastTranscript}ms ago ⚠️⚠️⚠️`
      );
      console.log(
        `   New speech detected after timer started - verifying this is still the latest...`
      );
      // If lastProcessedUserTranscript is different and more recent, this is stale
      if (
        this.lastProcessedUserTranscript &&
        this.lastProcessedUserTranscript !== finalTranscript &&
        !finalTranscript.includes(this.lastProcessedUserTranscript)
      ) {
        console.log(
          `   ⚠️  Last processed transcript is different: "${this.lastProcessedUserTranscript}"`
        );
        console.log(`   ⚠️  Accumulated transcript: "${finalTranscript}"`);
        console.log(
          `   🚫 Skipping response - accumulated transcript appears stale`
        );
        // Clear the stale accumulated transcript
        this.accumulatedTranscript = "";
        return;
      }
    }

    // Clear accumulated transcript before processing
    this.accumulatedTranscript = "";

    // Check if we've already responded to this exact transcript
    if (this.respondedToTranscripts.has(finalTranscript)) {
      console.log(
        `⚠️⚠️⚠️ SKIPPING LOOP - Already responded to accumulated transcript: "${finalTranscript}" ⚠️⚠️⚠️`
      );
      return;
    }

    // Don't respond if AI is currently speaking
    if (this.isProcessingResponse) {
      console.log(
        `⚠️  AI is currently speaking - deferring accumulated transcript response`
      );
      // Restore accumulated transcript for later
      this.accumulatedTranscript = finalTranscript;
      return;
    }

    // Track which transcript is triggering this response
    this.lastUserTranscriptForResponse = finalTranscript;
    // Note: We'll mark this transcript as responded to AFTER the response is created
    // (in response.created handler) to avoid false duplicate detection

    // Store transcription for validation against AI response
    const transcriptId = uuidv4();
    const transcriptionTimestamp = Date.now();
    this.pendingTranscriptionValidation.set(transcriptId, {
      transcript: finalTranscript,
      timestamp: transcriptionTimestamp,
    });

    console.log(
      `🔄🔄🔄 REQUESTING AI RESPONSE TO ACCUMULATED TRANSCRIPT: "${finalTranscript}" 🔄🔄🔄`
    );
    console.log(`📋 Stored transcription for validation (ID: ${transcriptId})`);

    // Check if user said goodbye/ending phrases
    if (this.isUserGoodbyePhrase(finalTranscript)) {
      console.log(
        `🚪🚪🚪 USER SAID GOODBYE/ENDING PHRASE: "${finalTranscript}" 🚪🚪🚪`
      );
      console.log(
        `   AI should respond with simple goodbye (e.g., "Thank you"), NOT reintroduce itself`
      );
    }

    // Request AI response
    this.requestAIResponse(finalTranscript);
  }

  /**
   * Request AI response with validation and delay
   */
  private requestAIResponse(userTranscript: string): void {
    // 🚨 CRITICAL: Don't request a response if AI just finished speaking
    // This prevents echo/feedback from triggering new responses
    // BUT: Allow legitimate questions and longer phrases (not echo)
    const timeSinceResponseEnd =
      this.lastResponseEndTime > 0
        ? Date.now() - this.lastResponseEndTime
        : Infinity;

    // Check if this is a legitimate question or longer phrase (not echo)
    const isQuestion = this.containsQuestion(userTranscript);
    const wordCount = userTranscript.trim().split(/\s+/).length;
    const isLongPhrase = wordCount >= 5; // Phrases with 5+ words are likely legitimate

    // Allow response if:
    // 1. It's a question (legitimate user input)
    // 2. It's a longer phrase (5+ words, likely not echo)
    // 3. Enough time has passed (original behavior)
    const isLegitimateInput = isQuestion || isLongPhrase;

    if (
      timeSinceResponseEnd < TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS &&
      !isLegitimateInput
    ) {
      console.log(
        `⚠️  Skipping response request - AI just finished speaking ${timeSinceResponseEnd}ms ago (likely echo/feedback)`
      );
      console.log(
        `   Transcript: "${userTranscript}" (${wordCount} words, isQuestion: ${isQuestion})`
      );
      return;
    }

    if (
      isLegitimateInput &&
      timeSinceResponseEnd < TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS
    ) {
      console.log(
        `✅ Allowing response to legitimate input (${timeSinceResponseEnd}ms after AI finished)`
      );
      console.log(
        `   Transcript: "${userTranscript}" (${wordCount} words, isQuestion: ${isQuestion})`
      );
    }

    // Check if we should skip requesting a response
    if (this.isProcessingResponse || this.hasPendingResponseRequest) {
      console.log(
        "⚠️  Skipping response request - already processing or pending"
      );
      console.log(
        `   State: isProcessingResponse=${this.isProcessingResponse}, hasPendingResponseRequest=${this.hasPendingResponseRequest}`
      );
      console.log(
        `   Response state: hasAudio=${this.currentResponseHasAudio}, audioDone=${this.currentResponseAudioDone}`
      );
      console.log(
        `   Time since last response end: ${
          this.lastResponseEndTime > 0
            ? Date.now() - this.lastResponseEndTime
            : "N/A"
        }ms`
      );
      console.log(
        `   User transcript: "${userTranscript.substring(0, 100)}${
          userTranscript.length > 100 ? "..." : ""
        }"`
      );
      // 🚨 SAFETY CHECK: If these flags are stuck, clear them to allow response
      // This is a safeguard against state corruption from errors
      const timeSinceLastResponseEnd =
        this.lastResponseEndTime > 0
          ? Date.now() - this.lastResponseEndTime
          : Infinity;
      const isStuckState =
        !this.currentResponseHasAudio &&
        !this.currentResponseAudioDone &&
        (timeSinceLastResponseEnd > 5000 || this.lastResponseEndTime === 0);

      if (isStuckState) {
        console.warn(
          "🔧🔧🔧 STATE STUCK DETECTED - Clearing flags to allow response 🔧🔧🔧"
        );
        console.warn(
          "   This may indicate a previous error left the state in an inconsistent state"
        );
        console.warn(
          `   Clearing flags: isProcessingResponse=${this.isProcessingResponse} -> false, hasPendingResponseRequest=${this.hasPendingResponseRequest} -> false`
        );
        this.isProcessingResponse = false;
        this.hasPendingResponseRequest = false;
        this.clearPendingResponseRequest();
        // Continue to request response below (don't return)
      } else {
        console.log(
          "   State appears valid - response is actually in progress, skipping"
        );
        return;
      }
    }

    // Clear any existing pending response request
    this.clearPendingResponseRequest();

    // Mark that we're about to request a response
    this.hasPendingResponseRequest = true;

    // Get response delay from environment or use 0 for immediate response
    const responseDelay = parseInt(
      process.env.OPENAI_RESPONSE_DELAY_MS || "0",
      10
    );
    console.log(
      `⏱️  Response delay: ${responseDelay}ms (0 = immediate response)`
    );

    this.pendingResponseRequest = setTimeout(() => {
      this.pendingResponseRequest = null;

      // 🚨 CRITICAL: Verify this is still the latest user speech before responding
      // This ensures we only respond to the most recent user input, not old transcripts
      const now = Date.now();
      if (
        this.latestUserSpeechTimestamp > 0 &&
        now < this.latestUserSpeechTimestamp
      ) {
        const timeDiff = this.latestUserSpeechTimestamp - now;
        console.log(
          `⚠️⚠️⚠️ USER SPOKE AGAIN DURING DELAY - CANCELLING RESPONSE ⚠️⚠️⚠️`
        );
        console.log(
          `   User spoke ${timeDiff}ms after transcription - will wait for new transcription`
        );
        console.log(
          `   This ensures we only respond to the MOST RECENT user input`
        );
        this.hasPendingResponseRequest = false;
        return;
      }

      // 🚨 CRITICAL: Verify the transcript we're responding to is still valid
      // For accumulated transcripts, they should include the last processed transcript
      // If lastProcessedUserTranscript exists and is NOT part of userTranscript, it's likely stale
      if (
        this.lastProcessedUserTranscript &&
        this.lastProcessedUserTranscript.trim() &&
        userTranscript !== this.lastProcessedUserTranscript &&
        !userTranscript.includes(this.lastProcessedUserTranscript)
      ) {
        // Check if this is a timing issue - if lastProcessedUserTranscript is very recent,
        // the accumulated transcript might be stale
        const timeSinceLastProcessed =
          this.lastTranscriptTime > 0
            ? Date.now() - this.lastTranscriptTime
            : Infinity;

        // If last processed transcript is very recent (< 1 second) and not in accumulated,
        // this is likely a stale accumulated transcript
        if (timeSinceLastProcessed < 1000) {
          console.log(
            `⚠️⚠️⚠️ POTENTIALLY STALE TRANSCRIPT - Last processed transcript not in accumulated ⚠️⚠️⚠️`
          );
          console.log(`   Transcript to respond to: "${userTranscript}"`);
          console.log(
            `   Last processed transcript: "${this.lastProcessedUserTranscript}"`
          );
          console.log(
            `   Time since last processed: ${timeSinceLastProcessed}ms`
          );
          console.log(
            `   This may be a stale accumulated transcript - verifying...`
          );
          // Don't cancel yet - let it proceed but log the warning
          // The timestamp check above should catch truly stale transcripts
        }
      }

      // Check again before requesting (race condition protection)
      if (
        !this.realtimeConnection?.isConnectedToAPI() ||
        this.isProcessingResponse
      ) {
        console.log(
          "⚠️  Skipping response request in setTimeout - connection lost or already processing"
        );
        this.hasPendingResponseRequest = false;
        return;
      }

      // Clear the pending flag right before requesting
      this.hasPendingResponseRequest = false;

      console.log(
        `🔄🔄🔄 REQUESTING AI RESPONSE - ONLY TO LATEST USER INPUT: "${userTranscript}" 🔄🔄🔄`
      );
      this.realtimeConnection.requestResponse();
    }, responseDelay);
  }

  /**
   * Handle interruption phrase detection
   *
   * 🚨 CRITICAL: This is the ONLY place where AI responses are cancelled
   * Only explicit interruption phrases (detected via transcription) can stop the AI
   * VAD events, echo, or regular user speech will NOT stop the AI
   *
   * IMPORTANT: Only interrupts if the phrase was detected AFTER the AI started speaking
   * Interruption phrases BEFORE the AI starts speaking are ignored (not true interruptions)
   */
  private handleInterruptionPhrase(
    userTranscript: string,
    transcriptionTime: number
  ): void {
    const timeSinceResponseStart = this.getTimeSinceResponseStart();
    const aiHasStartedSpeaking = this.responseStartTime > 0;

    console.log(
      `🚨🚨🚨 INTERRUPTION PHRASE DETECTED: "${userTranscript}" 🚨🚨🚨`
    );
    console.log(`   Time since AI response start: ${timeSinceResponseStart}ms`);
    console.log(`   AI is processing: ${this.isProcessingResponse}`);
    console.log(`   AI has started speaking: ${aiHasStartedSpeaking}`);

    // 🚨 CRITICAL: Only interrupt if the AI has already started speaking
    // If the interruption phrase was detected BEFORE the AI started speaking,
    // it's not a true interruption - just the user speaking before the AI responds
    if (!aiHasStartedSpeaking) {
      console.log(
        `⚠️  Interruption phrase detected BEFORE AI started speaking - NOT interrupting (AI hasn't started yet)`
      );
      // Don't cancel - the AI hasn't started speaking yet, so there's nothing to interrupt
      // Just update the timestamp and continue normally
      this.latestUserSpeechTimestamp = transcriptionTime;
      this.suspectedSpeech = false;
      return; // Exit early - don't treat as interruption
    }

    // If AI has started speaking, this is a true interruption
    console.log(
      `✅ Interruption phrase detected AFTER AI started speaking - WILL interrupt`
    );

    // 🚨 ONLY interruption phrases AFTER AI starts speaking can stop the AI mid-response
    // This is the ONLY cancellation point - all other code paths must NOT cancel responses
    this.shouldStopAudio = true;
    this.isInterrupted = true; // Mark as interrupted - don't respond until user finishes
    this.suspectedSpeech = false; // Clear suspected flag
    this.latestUserSpeechTimestamp = transcriptionTime;
    // Clear conversation window since user interrupted - start fresh
    this.clearConversationWindow();

    // Cancel the response immediately - this is the ONLY place responses are cancelled
    this.cancelResponseSafely();
    this.isProcessingResponse = false;

    console.log(
      "🛑 Cancelled AI response due to interruption phrase - will remain silent"
    );
  }

  /**
   * Smart client-side VAD: detect speech by analyzing audio energy
   * This catches speech BEFORE OpenAI's server-side VAD, making interruption faster
   *
   * Uses adaptive thresholds during echo periods to distinguish real speech from echo
   */
  private detectSpeechClientSide(pcmBuffer: Buffer): boolean {
    if (!pcmBuffer || pcmBuffer.length < 2) return false;

    const energy = this.calculateAudioEnergy(pcmBuffer);

    // Update baseline energy when AI is NOT speaking (for echo detection)
    if (!this.isProcessingResponse && this.responseStartTime === 0) {
      this.baselineEnergyHistory.push(energy);
      if (
        this.baselineEnergyHistory.length >
        AUDIO_BUFFER_LIMITS.BASELINE_HISTORY_SIZE
      ) {
        this.baselineEnergyHistory.shift();
      }
      // Calculate baseline as median of recent history
      if (
        this.baselineEnergyHistory.length >=
        AUDIO_BUFFER_LIMITS.BASELINE_MIN_SAMPLES
      ) {
        const sorted = [...this.baselineEnergyHistory].sort((a, b) => a - b);
        this.baselineEnergy = sorted[Math.floor(sorted.length / 2)];
      }
    }

    // Keep history of last N frames (for smoothing)
    this.audioEnergyHistory.push(energy);
    if (
      this.audioEnergyHistory.length > AUDIO_BUFFER_LIMITS.ENERGY_HISTORY_SIZE
    ) {
      this.audioEnergyHistory.shift();
    }

    // Calculate average energy
    const avgEnergy =
      this.audioEnergyHistory.reduce((a, b) => a + b, 0) /
      this.audioEnergyHistory.length;

    // 🚨 SMART ECHO SUPPRESSION: Use adaptive thresholds during echo periods
    const isInEchoPeriod = this.isInEchoPeriod();

    let threshold: number;
    let minAvgEnergy: number;

    if (isInEchoPeriod) {
      // During echo period: use MODERATELY higher threshold to detect real speech
      // Echo is typically quieter than real user speech, but we want to catch interruptions like "oh wait"
      // Use 2x baseline or ECHO_SUPPRESSION_MIN, whichever is higher
      // This makes us more sensitive to interruptions while still filtering echo
      threshold = Math.max(
        this.baselineEnergy * AUDIO_THRESHOLDS.BASELINE_MULTIPLIER,
        AUDIO_THRESHOLDS.ECHO_SUPPRESSION_MIN
      );
      minAvgEnergy = threshold * AUDIO_THRESHOLDS.ECHO_AVG_ENERGY_RATIO;

      // If energy is HIGH (likely real speech), allow it through even during echo period
      // Reduced threshold to catch quieter interruptions like "oh wait"
      if (
        energy > AUDIO_THRESHOLDS.HIGH_ENERGY &&
        avgEnergy > AUDIO_THRESHOLDS.HIGH_ENERGY_AVG
      ) {
        console.log(
          `🎤 HIGH ENERGY DETECTED during echo period (${energy.toFixed(
            0
          )}) - likely real speech/interruption`
        );
        this.consecutiveSpeechFrames++;
        if (
          this.consecutiveSpeechFrames >=
          AUDIO_BUFFER_LIMITS.CONSECUTIVE_SPEECH_FRAMES_HIGH_ENERGY
        ) {
          this.lastAudioEnergy = energy;
          return true;
        }
      }
    } else {
      // Normal period: standard threshold
      threshold = AUDIO_THRESHOLDS.SPEECH_DETECTION;
      minAvgEnergy = threshold * AUDIO_THRESHOLDS.MIN_AVG_ENERGY_RATIO;
    }

    const isSpeech = energy > threshold && avgEnergy > minAvgEnergy;

    if (isSpeech) {
      this.consecutiveSpeechFrames++;
      // Require fewer frames during echo period if energy is high enough
      // More lenient: if energy > INTERRUPTION_HIGH_ENERGY during echo period, only need 1 frame
      const requiredFrames =
        isInEchoPeriod && energy > AUDIO_THRESHOLDS.INTERRUPTION_HIGH_ENERGY
          ? AUDIO_BUFFER_LIMITS.CONSECUTIVE_SPEECH_FRAMES_HIGH_ENERGY
          : AUDIO_BUFFER_LIMITS.CONSECUTIVE_SPEECH_FRAMES_NORMAL;
      if (this.consecutiveSpeechFrames >= requiredFrames) {
        this.lastAudioEnergy = energy;
        return true;
      }
    } else {
      this.consecutiveSpeechFrames = 0;
    }

    this.lastAudioEnergy = energy;
    return false;
  }

  private async handleAudioData(payload: string) {
    try {
      // Validate payload
      if (!payload || payload.length === 0) {
        return; // Skip empty payloads
      }

      // Decode Twilio audio FIRST for client-side VAD detection
      // This allows us to detect speech BEFORE sending to OpenAI
      let pcmBuffer: Buffer;
      try {
        pcmBuffer = decodeTwilioAudio(payload);
        if (!pcmBuffer || pcmBuffer.length === 0) {
          return; // Skip empty buffers
        }
      } catch (error) {
        console.warn("⚠️  Error decoding Twilio audio:", error);
        return; // Skip malformed audio
      }

      // 🚨 CLIENT-SIDE VAD: Detect speech from incoming audio
      // This is a PRELIMINARY detection - we don't stop immediately to avoid false positives
      // We wait for transcription confirmation before actually stopping
      // CRITICAL: This does NOT cancel AI responses - only marks suspected speech
      // Only interruption phrases (detected via transcription) can stop the AI
      if (this.detectSpeechClientSide(pcmBuffer)) {
        const now = Date.now();
        // Only mark as suspected if it's been a while since last speech (avoid duplicates)
        if (
          this.latestUserSpeechTimestamp === 0 ||
          now - this.latestUserSpeechTimestamp >
            TIMING_THRESHOLDS.MIN_SPEECH_INTERVAL_MS
        ) {
          // Mark as suspected speech, but don't stop yet - wait for transcription confirmation
          this.suspectedSpeech = true;
          this.suspectedSpeechTimestamp = now;
          // Throttle logging to avoid spam
          if (
            now - this.lastSpeechSuspectedLogTime >
            TIMING_THRESHOLDS.SPEECH_SUSPECTED_LOG_THROTTLE_MS
          ) {
            console.log(
              "🎤 CLIENT-SIDE SPEECH SUSPECTED - will confirm with transcription before stopping"
            );
            this.lastSpeechSuspectedLogTime = now;
          }

          // 🚨 CRITICAL: Don't cancel response based on energy alone
          // Only cancel when transcription confirms an interruption phrase
          // Let the AI finish its response unless it's a meaningful interruption
          // For lower energy, continue - transcription will confirm if it's real
        }
      }

      if (!this.realtimeConnection?.isConnectedToAPI()) {
        // Buffer audio if connection isn't ready
        if (pcmBuffer && pcmBuffer.length > 0) {
          this.audioBuffer.push(pcmBuffer);
        }
        return;
      }

      // OpenAI Realtime API expects PCM16 at 24kHz
      // Resample from 16kHz → 24kHz
      let resampledPcm: Buffer;
      try {
        resampledPcm = resampleAudio(pcmBuffer, 16000, 24000);
        if (!resampledPcm || resampledPcm.length === 0) {
          return; // Skip empty resampled buffers
        }
      } catch (error) {
        console.warn("⚠️  Error resampling audio:", error);
        return; // Skip if resampling fails
      }

      // Send audio to OpenAI Realtime API
      if (!this.realtimeConnection.sendAudio(resampledPcm)) {
        console.warn("⚠️  Failed to send audio to Realtime API");
      } else {
        // Log audio stats occasionally for debugging
        if (Math.random() < 0.01) {
          // 1% of the time
          console.log(
            `🎵 Audio sent to OpenAI: ${resampledPcm.length} bytes (24kHz PCM16)`
          );
        }
      }

      // Process buffered audio if any
      if (this.audioBuffer.length > 0) {
        for (const bufferedAudio of this.audioBuffer) {
          if (bufferedAudio && bufferedAudio.length > 0) {
            try {
              const resampled = resampleAudio(bufferedAudio, 16000, 24000);
              if (resampled && resampled.length > 0) {
                this.realtimeConnection.sendAudio(resampled);
              }
            } catch (error) {
              console.warn("⚠️  Error processing buffered audio:", error);
            }
          }
        }
        this.audioBuffer = [];
      }

      // Note: We don't manually commit audio here because we're using server_vad (Voice Activity Detection)
      // OpenAI's Realtime API will automatically commit the audio buffer when it detects speech
      // Manual commits are only needed if you want to force processing before VAD detects speech
    } catch (error) {
      console.error("❌ Error handling audio data:", error);
    }
  }

  private async handleRealtimeMessage(message: any) {
    try {
      const messageType = message.type || "unknown";

      switch (messageType) {
        case "session.created":
          console.log("✅ Realtime API session created");
          break;

        case "session.updated":
          console.log("✅ Realtime API session updated");
          break;

        case "response.created":
          // Log what the AI is responding to
          const respondingTo =
            this.lastUserTranscriptForResponse ||
            this.lastProcessedUserTranscript ||
            "(unknown - no transcript tracked)";
          console.log(
            "📝📝📝 AI RESPONSE CREATED - WILL RESPOND TO USER INPUT 📝📝📝"
          );
          console.log(`💬 AI IS RESPONDING TO: "${respondingTo}"`);
          console.log(
            `📅 Latest user speech timestamp: ${this.latestUserSpeechTimestamp}`
          );

          // 🚨 CRITICAL: Check if we've already responded to this transcript
          // This prevents duplicate responses when OpenAI creates a response after we've already handled it
          // This can happen due to race conditions where response.done hasn't cleared the transcript yet
          if (
            respondingTo !== "(unknown - no transcript tracked)" &&
            this.respondedToTranscripts.has(respondingTo)
          ) {
            console.log(
              `🚨🚨🚨 DUPLICATE RESPONSE DETECTED - Already responded to: "${respondingTo}" 🚨🚨🚨`
            );
            console.log(
              "   This is likely a race condition where OpenAI queued a response before we could clear the transcript"
            );

            // 🚨 CRITICAL FIX: Don't cancel if a response is already being processed
            // This prevents cancelling responses that are mid-stream, even if audio hasn't started yet
            // Audio chunks may arrive after response.created, so we need to check isProcessingResponse
            // Cancelling at this point would interrupt audio playback that's already in progress or about to start
            if (this.isProcessingResponse || this.currentResponseHasAudio) {
              console.log(
                "   ⚠️  WARNING: First response is already processing - NOT cancelling to avoid interrupting playback"
              );
              console.log(
                `   Response status: isProcessing=${this.isProcessingResponse}, hasAudio=${this.currentResponseHasAudio}, audioDone=${this.currentResponseAudioDone}`
              );
              console.log(
                "   This duplicate response.created is harmless - first response is already in progress"
              );
              // Just return without cancelling - let the first response finish naturally
              return; // Exit early - don't process this duplicate response
            }

            console.log(
              "   Cancelling this duplicate response to prevent AI from repeating itself"
            );
            if (this.realtimeConnection) {
              this.realtimeConnection.cancelResponse();
              // Reset flags
              this.isProcessingResponse = false;
              this.hasPendingResponseRequest = false;
              this.shouldStopAudio = false;
              // Clear the transcript to prevent future duplicates
              if (this.lastProcessedUserTranscript === respondingTo) {
                this.lastProcessedUserTranscript = "";
              }
              if (this.lastUserTranscriptForResponse === respondingTo) {
                this.lastUserTranscriptForResponse = "";
              }
              return; // Exit early - don't process this duplicate response
            }
          }

          // 🚨 WARNING: If there's no valid user input, this might be an auto-generated response
          // This can happen when OpenAI's Realtime API detects audio or generates a response automatically
          // OR when transcription fails (e.g., due to rate limiting)
          // BUT: If we have a transcript (even if timestamp wasn't set due to echo suppression),
          // we should allow the response to proceed
          if (
            this.latestUserSpeechTimestamp === 0 &&
            !this.lastUserTranscriptForResponse &&
            !this.lastProcessedUserTranscript
          ) {
            console.log(
              "⚠️⚠️⚠️ WARNING: Response created without valid user input - might be auto-generated or echo ⚠️⚠️⚠️"
            );
            console.log(
              "   This is likely caused by a failed transcription (rate limiting) or echo detection"
            );

            // 🚨 CRITICAL: Cancel this response immediately - we have no user input to respond to
            // This commonly happens when transcription fails due to rate limiting (429 errors)
            // BUT: Only cancel if we haven't sent the greeting yet (allow initial greeting)
            if (this.realtimeConnection && !this.hasSentGreeting) {
              console.log(
                "🛑 CANCELLING INVALID RESPONSE - No valid user input detected"
              );
              console.log(
                "   This prevents the AI from speaking without knowing what the user said"
              );
              this.realtimeConnection.cancelResponse();
              // Reset flags
              this.isProcessingResponse = false;
              this.hasPendingResponseRequest = false;
              this.shouldStopAudio = false;
              return; // Exit early - don't process this response
            } else if (!this.hasSentGreeting) {
              console.log(
                "   ⚠️  Cannot cancel response - this might be the initial greeting"
              );
              console.log(
                "   Response will be checked for duplicate introductions before being saved"
              );
            } else {
              // After greeting is sent, if we have no transcript but response was created,
              // it might be a legitimate response that was triggered by audio detection
              // Allow it to proceed but log a warning
              console.log(
                "   ⚠️  Response created without tracked transcript, but allowing to proceed (might be legitimate audio-triggered response)"
              );
            }
          }
          // 🚨 CRITICAL: DO NOT cancel previous responses automatically
          // OpenAI may create multiple response objects for the same response (continuation)
          // Only interruption phrases (detected via transcription) should cancel responses
          // Let OpenAI handle response management - we only cancel on explicit user interruptions
          if (this.isProcessingResponse) {
            const timeSinceLastResponseStart = this.getTimeSinceResponseStart();
            console.log(
              `ℹ️  Response created while already processing (${timeSinceLastResponseStart}ms ago) - allowing both to continue (likely continuation or OpenAI internal management)`
            );
            // DO NOT cancel - this is likely a continuation or OpenAI's internal response management
            // The previous response will complete naturally, or OpenAI will handle it
          }
          this.isProcessingResponse = true;
          this.hasPendingResponseRequest = false; // Clear pending flag since we now have an active response
          this.responseStartTime = Date.now(); // Track when response started
          this.currentResponseHasAudio = false; // Reset audio flag for new response
          this.currentResponseAudioDone = false; // Reset audio done flag for new response
          // Reset stop audio flag - new response is starting, allow audio to flow
          this.shouldStopAudio = false;
          // Safety: Clear interruption flag when new response starts (should already be cleared, but be safe)
          if (this.isInterrupted) {
            console.log(
              "⚠️  Clearing stale isInterrupted flag - new response starting"
            );
            this.isInterrupted = false;
          }

          // 🚨 CRITICAL: Mark transcript as responded to NOW (after passing duplicate check)
          // This prevents future duplicate responses to the same transcript
          if (
            respondingTo !== "(unknown - no transcript tracked)" &&
            !this.respondedToTranscripts.has(respondingTo)
          ) {
            this.respondedToTranscripts.add(respondingTo);
            console.log(
              `✅ Marked transcript as responded to: "${respondingTo}"`
            );
          }

          console.log(`⏱️  AI response start time: ${this.responseStartTime}`);
          break;

        case "response.audio_transcript.delta":
          // Partial transcript from AI - don't log (too verbose, only log final transcript)
          // The final transcript will be logged in response.audio_transcript.done
          break;

        case "response.audio_transcript.done":
          // Final transcript from AI
          const transcriptText = message.transcript || "";
          if (transcriptText.trim()) {
            const respondedTo =
              this.lastUserTranscriptForResponse ||
              this.lastProcessedUserTranscript ||
              "(unknown)";
            console.log(`🤖🤖🤖 AI RESPONDED: "${transcriptText}" 🤖🤖🤖`);
            console.log(`💬 AI WAS RESPONDING TO: "${respondedTo}"`);
            console.log(
              `📅 This response is for user speech at: ${this.latestUserSpeechTimestamp}`
            );

            // 🚨 PREVENT DUPLICATE RESPONSES: Check if this is similar to the last response
            const normalizedText = transcriptText.toLowerCase().trim();
            const normalizedLastResponse = this.lastAIResponse
              .toLowerCase()
              .trim();

            // Check for duplicate introductions
            const isIntroduction = this.isIntroduction(transcriptText);

            // 🚨 PREVENT DUPLICATE INTRODUCTIONS: Check if this is a duplicate introduction
            if (isIntroduction && this.hasGivenIntroduction) {
              // Check if it's substantially similar to the last response
              const similarity = this.calculateSimilarity(
                normalizedText,
                normalizedLastResponse
              );

              // Also check if they start with the same introduction phrase
              // This catches cases where the second response is longer but starts the same way
              const firstWords = normalizedText
                .split(/\s+/)
                .slice(0, 10)
                .join(" ");
              const lastFirstWords = normalizedLastResponse
                .split(/\s+/)
                .slice(0, 10)
                .join(" ");
              const startsSimilar = firstWords === lastFirstWords;

              // Lower threshold for similarity (0.6 instead of 0.7) to catch more duplicates
              // Also check if they start the same way (even if overall similarity is lower)
              if (similarity > 0.6 || startsSimilar) {
                console.log(
                  `⚠️⚠️⚠️ DUPLICATE INTRODUCTION DETECTED - similarity: ${similarity.toFixed(
                    2
                  )}, starts similar: ${startsSimilar} ⚠️⚠️⚠️`
                );
                console.log(`   Last response: "${this.lastAIResponse}"`);
                console.log(`   New response: "${transcriptText}"`);
                console.log(`   Skipping duplicate - not saving transcript`);
                break; // Don't save duplicate
              }
            }

            // 🚨 PREVENT INTRODUCTIONS WITHOUT VALID USER INPUT:
            // If this is an introduction and there's no valid user input, it's likely auto-generated
            // Don't save it if we've already given an introduction
            if (
              isIntroduction &&
              this.hasGivenIntroduction &&
              this.latestUserSpeechTimestamp === 0
            ) {
              console.log(
                `⚠️⚠️⚠️ DUPLICATE INTRODUCTION DETECTED (no valid user input) ⚠️⚠️⚠️`
              );
              console.log(`   Last response: "${this.lastAIResponse}"`);
              console.log(`   New response: "${transcriptText}"`);
              console.log(
                `   No valid user input - skipping duplicate introduction`
              );
              break; // Don't save duplicate
            }

            // 🚨 PREVENT INTRODUCTIONS AFTER USER GOODBYE:
            // If the user (representative) said goodbye/ending phrases, the AI should NOT reintroduce itself
            const userSaidGoodbye = this.lastUserTranscriptForResponse
              ? this.isUserGoodbyePhrase(this.lastUserTranscriptForResponse)
              : false;
            if (
              isIntroduction &&
              this.hasGivenIntroduction &&
              userSaidGoodbye
            ) {
              console.log(
                `⚠️⚠️⚠️ DUPLICATE INTRODUCTION DETECTED (user said goodbye) ⚠️⚠️⚠️`
              );
              console.log(
                `   User transcript: "${this.lastUserTranscriptForResponse}"`
              );
              console.log(`   New response: "${transcriptText}"`);
              console.log(
                `   User said goodbye - AI should NOT reintroduce itself, skipping duplicate introduction`
              );
              break; // Don't save duplicate
            }

            if (isIntroduction) {
              this.hasGivenIntroduction = true;
            }

            // Check if AI has closed the call (said goodbye/thank you)
            // 🚨 CRITICAL: Only mark as closed if user explicitly said goodbye/ending phrases OR goal is achieved
            if (this.isClosingPhrase(transcriptText)) {
              // 🚨 CRITICAL: Validate that user actually signaled the end before AI said goodbye
              const userSaidGoodbye = this.lastUserTranscriptForResponse
                ? this.isUserGoodbyePhrase(this.lastUserTranscriptForResponse)
                : false;

              // Check if goal is achieved (this would require tracking goal completion, which is complex)
              // For now, we'll be strict: only close if user explicitly said goodbye

              // If the current response contains a question, don't close the call
              // The AI is asking for something and expecting a response
              const currentResponseHasQuestion =
                this.containsQuestion(transcriptText);

              // Also check if the previous response contained a question
              // If AI just asked a question and then says goodbye, it's likely a mistake
              const previousResponseHasQuestion =
                this.lastAIResponse &&
                this.containsQuestion(this.lastAIResponse);

              // 🚨 CRITICAL: Only close if user explicitly said goodbye/ending phrases
              if (!userSaidGoodbye) {
                console.log(
                  "⚠️⚠️⚠️ AI SAID GOODBYE BUT USER DIDN'T SIGNAL END - NOT CLOSING CALL ⚠️⚠️⚠️"
                );
                console.log(`   AI said: "${transcriptText}"`);
                console.log(
                  `   User said: "${
                    this.lastUserTranscriptForResponse || "nothing"
                  }"`
                );
                console.log(
                  `   User did NOT say explicit goodbye/ending phrases - AI should NOT have said goodbye`
                );
                console.log(`   This is likely a mistake - call will continue`);
                // Don't mark as closed - the AI shouldn't have said goodbye
              } else if (
                currentResponseHasQuestion ||
                previousResponseHasQuestion
              ) {
                console.log(
                  "⚠️ AI said goodbye but also asked a question - NOT closing call (expecting response)"
                );
                if (currentResponseHasQuestion) {
                  console.log(
                    `   Current response contains question: "${transcriptText}"`
                  );
                }
                if (previousResponseHasQuestion) {
                  console.log(
                    `   Previous response contained question: "${this.lastAIResponse}"`
                  );
                }
              } else {
                // User explicitly said goodbye AND AI didn't ask a question - valid closing
                this.hasClosedCall = true;
                console.log(
                  "🚪 Call marked as closed - AI said goodbye (user explicitly signaled end)"
                );
                console.log(
                  `   User said: "${this.lastUserTranscriptForResponse}"`
                );
              }
            }

            // 🚨 TRANSCRIPTION VALIDATION: Check if AI's response suggests transcription was incorrect
            // GPT-4o Realtime's transcription API can be less accurate than its understanding,
            // especially with accents or audio quality issues. The AI may correctly understand
            // what the user said (evidenced by its response) but the raw transcription may be wrong.
            this.validateTranscriptionAgainstResponse(
              respondedTo,
              transcriptText
            );

            // Update last response
            this.lastAIResponse = transcriptText;
            await this.saveTranscript("ai", transcriptText);

            // 🚨 CRITICAL: If AI just asked a question, clear accumulated transcript
            // The old accumulated transcript was already addressed - we need to wait for NEW user input
            const aiJustAskedQuestion = this.containsQuestion(transcriptText);
            if (aiJustAskedQuestion) {
              console.log(
                `❓ AI just asked a question - clearing accumulated transcript to wait for NEW user response`
              );
              console.log(
                `   Question: "${transcriptText.substring(0, 100)}${
                  transcriptText.length > 100 ? "..." : ""
                }"`
              );

              // Clear accumulated transcript (old user input already addressed)
              if (this.accumulatedTranscript.trim()) {
                console.log(
                  `   Old accumulated transcript (being cleared): "${this.accumulatedTranscript}"`
                );
              }
              this.accumulatedTranscript = "";
              this.lastTranscriptTime = 0;

              // Clear conversation window timer (don't respond to old transcript)
              this.clearConversationWindowTimer();

              // Clear last processed transcript (don't respond to old input)
              this.lastProcessedUserTranscript = "";

              console.log(
                `   ✅ Cleared accumulated transcript and timers - waiting for NEW user input in response to question`
              );
            }
          }
          break;

        case "response.audio.delta":
          // Audio chunk from AI
          // 🚨 CRITICAL: Stop processing audio ONLY if interruption phrase was detected
          // Do NOT block for regular speech or echo - only for explicit interruptions
          if (this.shouldBlockAudio()) {
            console.log(
              `🛑 BLOCKING audio chunk - interruption detected (isInterrupted: ${this.isInterrupted}, shouldStopAudio: ${this.shouldStopAudio})`
            );
            return; // Don't process or send this audio
          }

          const audioBase64 = message.delta || "";
          if (audioBase64) {
            this.currentResponseHasAudio = true; // Mark that this response has audio
            await this.handleRealtimeAudio(audioBase64);
          }
          break;

        case "response.audio.done":
          console.log("✅ AI audio response complete");
          this.currentResponseAudioDone = true; // Mark that audio generation is complete for current response
          // Don't set isProcessingResponse to false here - wait for response.done
          break;

        case "response.done":
          console.log("✅ AI response completed");
          this.isProcessingResponse = false;
          this.hasPendingResponseRequest = false;
          // Reset the stop audio flag when response is done
          this.shouldStopAudio = false;
          // Track when response ended for echo suppression
          // 🚨 CRITICAL: Only set lastResponseEndTime if audio was actually generated
          // Cancelled responses that never produced audio should NOT trigger echo suppression
          if (this.currentResponseHasAudio) {
            this.lastResponseEndTime = Date.now();
            console.log("   ✅ Response had audio - echo suppression active");
          } else {
            console.log(
              "   ⚠️  Response had no audio (cancelled before audio generation) - NOT triggering echo suppression"
            );
          }
          // Reset audio tracking flags for next response
          this.currentResponseHasAudio = false;
          this.currentResponseAudioDone = false;

          // 🚨 CRITICAL: After AI finishes speaking, check if there's accumulated user speech to respond to
          // If user spoke while AI was talking (and it wasn't an interruption), now we can respond
          // Note: hasClosedCall no longer prevents responses - AI can say goodbye but call continues

          // 🚨 SOLUTION 2: If we have accumulated transcript, start the conversation window timer
          // BUT: Only if AI didn't just ask a question (questions need NEW user input, not old accumulated transcript)
          const aiJustAskedQuestion =
            this.lastAIResponse && this.containsQuestion(this.lastAIResponse);

          if (this.accumulatedTranscript.trim() && !aiJustAskedQuestion) {
            console.log(
              `📝 AI finished speaking - starting 1-second timer for accumulated transcript: "${this.accumulatedTranscript}"`
            );
            // Clear any existing timer
            this.clearConversationWindowTimer();
            // Start the 1-second timer
            this.conversationWindowTimer = setTimeout(() => {
              this.conversationWindowTimer = null;
              console.log(
                `⏱️  1 second of silence detected after AI finished - processing accumulated transcript`
              );
              this.handleAccumulatedTranscriptResponse();
            }, TIMING_THRESHOLDS.CONVERSATION_WINDOW_MS);
            break; // Exit early - don't use old logic
          } else if (this.accumulatedTranscript.trim() && aiJustAskedQuestion) {
            console.log(
              `❓ AI just asked a question - NOT responding to old accumulated transcript`
            );
            console.log(
              `   Old accumulated transcript (ignored): "${this.accumulatedTranscript}"`
            );
            console.log(
              `   AI's question: "${this.lastAIResponse?.substring(0, 100)}${
                this.lastAIResponse && this.lastAIResponse.length > 100
                  ? "..."
                  : ""
              }"`
            );
            console.log(
              `   ✅ Waiting for NEW user input in response to the question`
            );
            // Clear the old accumulated transcript since AI asked a question
            this.accumulatedTranscript = "";
            this.lastTranscriptTime = 0;
            break; // Exit early - don't process old transcript
          }

          // Fallback to old behavior if no accumulated transcript (for backward compatibility)
          if (this.lastProcessedUserTranscript) {
            // Fallback to old behavior if no accumulated transcript (for backward compatibility)
            const pendingTranscript = this.lastProcessedUserTranscript;
            const timeSinceResponseEnd = Date.now() - this.lastResponseEndTime;

            // 🚨 PREVENT MULTIPLE RESPONSES TO SAME TRANSCRIPT:
            // If we're currently responding to the same transcript that's pending, don't request another response
            // The Realtime API may split responses into multiple parts, but we should only respond once per user input
            if (this.lastUserTranscriptForResponse === pendingTranscript) {
              console.log(
                `⚠️⚠️⚠️ SKIPPING - Already responding to this transcript: "${pendingTranscript}" ⚠️⚠️⚠️`
              );
              console.log(
                `   This is likely a continuation of the current response (Realtime API split response into parts)`
              );
              console.log(
                `   Clearing lastProcessedUserTranscript to prevent duplicate responses`
              );
              this.lastProcessedUserTranscript = ""; // Clear to prevent duplicate response
              break; // Exit early - don't respond again
            }

            // 🚨 PREVENT INFINITE LOOPS: Check if we've already responded to this transcript
            if (this.respondedToTranscripts.has(pendingTranscript)) {
              console.log(
                `⚠️⚠️⚠️ SKIPPING LOOP - Already responded to transcript: "${pendingTranscript}" ⚠️⚠️⚠️`
              );
              console.log(
                `   Clearing lastProcessedUserTranscript to prevent infinite loop`
              );
              this.lastProcessedUserTranscript = ""; // Clear to prevent loop
              break; // Exit early - don't respond again
            }

            // Wait a moment to avoid echo, then check if we should respond to pending transcript
            // Only respond if enough time has passed (to avoid echo) and user hasn't spoken again
            setTimeout(() => {
              // 🚨 CRITICAL: Double-check that we're not already responding to this transcript
              // The Realtime API may split responses into multiple parts, but we should only respond once
              if (this.lastUserTranscriptForResponse === pendingTranscript) {
                console.log(
                  `⚠️  Skipping deferred response - already responding to this transcript: "${pendingTranscript}"`
                );
                console.log(
                  `   This is likely a continuation of the current response (Realtime API split response)`
                );
                // Clear the pending transcript since we're already responding to it
                if (pendingTranscript === this.lastProcessedUserTranscript) {
                  this.lastProcessedUserTranscript = "";
                }
                return; // Don't request another response
              }

              // Verify this is still the latest user speech and we haven't responded to it yet
              if (
                pendingTranscript === this.lastProcessedUserTranscript &&
                !this.respondedToTranscripts.has(pendingTranscript) &&
                !this.isProcessingResponse &&
                !this.hasPendingResponseRequest &&
                !this.isInterrupted
              ) {
                console.log(
                  `🔄 AI finished speaking - now responding to pending user transcript: "${pendingTranscript}"`
                );
                // Note: We'll mark this transcript as responded to AFTER the response is created
                // (in response.created handler) to avoid false duplicate detection
                this.lastUserTranscriptForResponse = pendingTranscript;
                this.requestAIResponse(pendingTranscript);
                // Clear lastProcessedUserTranscript after responding to prevent loops
                // Only clear if this is still the latest transcript (user hasn't spoken again)
                if (pendingTranscript === this.lastProcessedUserTranscript) {
                  this.lastProcessedUserTranscript = "";
                }
              } else {
                if (this.respondedToTranscripts.has(pendingTranscript)) {
                  console.log(
                    `⚠️  Skipping deferred response - already responded to this transcript`
                  );
                  // Clear if we've already responded
                  if (pendingTranscript === this.lastProcessedUserTranscript) {
                    this.lastProcessedUserTranscript = "";
                  }
                } else {
                  console.log(
                    `⚠️  Skipping deferred response - conditions changed (new speech, interruption, or call closed)`
                  );
                }
              }
            }, Math.max(TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS - timeSinceResponseEnd, 100));
          }

          // 🚨 DISABLED: AI can no longer hang up the call - only the user can hang up
          // If AI said goodbye, log it but don't hang up - let the user decide when to end the call
          if (this.hasClosedCall && this.callSid) {
            console.log(
              "🚪 AI said goodbye, but call will continue - only user can hang up"
            );
            console.log(
              "   User can continue the conversation or hang up when ready"
            );
          }
          break;

        case "response.cancelled":
          console.log("🛑 AI response cancelled");
          this.isProcessingResponse = false;
          this.hasPendingResponseRequest = false;
          // Reset the stop audio flag when response is cancelled
          this.shouldStopAudio = false;
          // Reset audio tracking flags
          this.currentResponseHasAudio = false;
          this.currentResponseAudioDone = false;
          break;

        case "conversation.item.created":
          console.log("💬 Conversation item created");
          break;

        case "conversation.item.input_audio_transcription.failed":
          // Transcription failed - log the error and investigate
          console.error("❌ ❌ ❌ INPUT AUDIO TRANSCRIPTION FAILED ❌ ❌ ❌");

          // Check if this is a rate limiting error (429)
          const isRateLimitError =
            message.error?.message?.includes("429") ||
            message.error?.message?.includes("Too Many Requests");

          if (isRateLimitError) {
            console.error(
              "🚨🚨🚨 RATE LIMIT ERROR (429 Too Many Requests) 🚨🚨🚨"
            );
            console.error("   Your OpenAI API key has hit rate limits!");
            console.error("   Possible solutions:");
            console.error(
              "   1. Wait a few minutes for the rate limit to reset"
            );
            console.error(
              "   2. Upgrade your OpenAI API plan for higher limits"
            );
            console.error("   3. Check your OpenAI dashboard for usage/quotas");
            console.error("   4. Reduce the number of concurrent calls");
          } else {
            console.error("   This means OpenAI couldn't transcribe the audio");
            console.error("   Possible causes:");
            console.error("   1. Audio format mismatch");
            console.error("   2. Audio is too quiet or corrupted");
            console.error("   3. Audio duration is too short");
            console.error("   4. Network issues");
          }

          console.error(
            "   Message details:",
            JSON.stringify(message, null, 2)
          );

          // If there's an error field, log it
          if (message.error) {
            console.error(
              "   Error from OpenAI:",
              JSON.stringify(message.error, null, 2)
            );
          }

          // 🚨 CRITICAL: Clear state to prevent AI from responding without valid input
          console.log("🔧 Clearing state flags to prevent empty response...");
          this.suspectedSpeech = false;
          this.clearPendingResponseRequest();

          // 🚨 CRITICAL: Cancel any active response that might have been triggered
          // This prevents the AI from speaking without knowing what the user said
          if (this.isProcessingResponse && this.realtimeConnection) {
            console.log(
              "🛑 Cancelling AI response - no valid transcription available"
            );
            this.realtimeConnection.cancelResponse();
          }

          // Reset the processed transcript tracking to prevent responses
          // If this transcription failed, we should NOT respond to it
          this.lastUserTranscriptForResponse = "";

          console.log(
            "✅ State cleared - AI will not respond without valid transcription"
          );
          break;

        case "conversation.item.input_audio_transcription.completed":
          // User speech transcription completed - now we can safely request a response
          const userTranscript = message.transcript || "";

          // 🚨 LOG ALL TRANSCRIPTIONS FIRST (even if we'll ignore them)
          console.log(
            `📨📨📨 RAW USER TRANSCRIPTION RECEIVED: "${userTranscript}" 📨📨📨`
          );
          console.log(
            `   ⚠️  Note: GPT-4o Realtime transcription may be less accurate than its understanding.`
          );
          console.log(
            `   💡 The AI's response will be validated against this transcription to detect accuracy issues.`
          );

          // 🚨 VALIDATION: Ignore empty or very short transcriptions (likely false positives or echo)
          if (
            !userTranscript.trim() ||
            userTranscript.trim().length <
              TIMING_THRESHOLDS.MIN_TRANSCRIPT_LENGTH
          ) {
            console.log(
              `⚠️⚠️⚠️ IGNORING TRANSCRIPTION (too short): "${userTranscript}" ⚠️⚠️⚠️`
            );
            break;
          }

          // 🚨 TRANSCRIPTION QUALITY VALIDATION: Check for completely nonsensical transcriptions
          // These often indicate poor audio quality, echo, or encoding issues
          const transcriptionQuality =
            this.assessTranscriptionQuality(userTranscript);
          if (!transcriptionQuality.isValid) {
            console.error(
              `🚨🚨🚨 REJECTING TRANSCRIPTION - POOR QUALITY DETECTED 🚨🚨🚨`
            );
            console.error(`   Transcription: "${userTranscript}"`);
            console.error(
              `   Quality Score: ${(transcriptionQuality.score * 100).toFixed(
                1
              )}%`
            );
            console.error(
              `   Issues: ${transcriptionQuality.issues.join(", ")}`
            );
            console.error(`   💡 This transcription appears to be:`);
            if (transcriptionQuality.isNonsensical) {
              console.error(
                `      - Completely nonsensical (random words/phrases)`
              );
            }
            if (transcriptionQuality.hasUnusualPatterns) {
              console.error(`      - Contains unusual/unlikely word patterns`);
            }
            console.error(`   🔧 LIKELY CAUSES:`);
            console.error(`      - Poor audio quality or encoding issues`);
            console.error(`      - Echo/feedback in audio stream`);
            console.error(
              `      - Audio sample rate conversion artifacts (8kHz → 16kHz → 24kHz)`
            );
            console.error(`      - Background noise or interference`);
            console.error(
              `   📝 This transcription will be REJECTED to prevent AI from responding incorrectly`
            );
            break; // Don't process this transcription
          } else if (transcriptionQuality.score < 0.7) {
            console.warn(
              `⚠️  Low-quality transcription detected (score: ${(
                transcriptionQuality.score * 100
              ).toFixed(1)}%): "${userTranscript}"`
            );
            console.warn(
              `   Issues: ${transcriptionQuality.issues.join(", ")}`
            );
            console.warn(
              `   ⚠️  Proceeding with caution - AI response will be validated`
            );
          }

          // 🚨 FILTER VOICEMAIL/SYSTEM MESSAGES: Reject transcriptions that look like voicemail greetings or system messages
          // These are often transcribed from the customer service side's automated systems
          const voicemailPatterns = [
            /please leave your message/i,
            /leave your message/i,
            /please leave a message/i,
            /leave a message/i,
            /after the tone/i,
            /after the beep/i,
            /voicemail/i,
            /mailbox/i,
            /this mailbox/i,
            /this voicemail/i,
            /unavailable/i,
            /not available/i,
            /please call back/i,
            /call back later/i,
          ];
          const isVoicemailMessage = voicemailPatterns.some((pattern) =>
            pattern.test(userTranscript)
          );
          if (isVoicemailMessage) {
            console.log(
              `⚠️⚠️⚠️ IGNORING TRANSCRIPTION (voicemail/system message): "${userTranscript}" ⚠️⚠️⚠️`
            );
            console.log(
              `   This appears to be a voicemail greeting or system message, not user speech`
            );
            break; // Don't save, don't trigger response
          }

          // 🚨 SMART ECHO SUPPRESSION: Check for meaningful interruption phrases
          // These phrases bypass echo suppression because they indicate real user intent
          const isInterruptionPhrase =
            this.isInterruptionPhrase(userTranscript);

          // 🚨 ECHO SUPPRESSION: Ignore transcriptions that happen during or right after AI speech
          // BUT: Allow interruption phrases through even during echo period
          const timeSinceAIResponseStart = this.getTimeSinceResponseStart();
          const transcriptionTimeSinceResponseEnd =
            this.lastResponseEndTime > 0
              ? Date.now() - this.lastResponseEndTime
              : Infinity;

          // 🚨 TRANSCRIPTION-BASED INTERRUPTION: This is the RELIABLE way to detect real speech
          // Transcription confirms actual words, not just noise/echo

          // Check if this transcription confirms suspected speech from VAD
          const transcriptionTime = Date.now();
          const timeSinceSuspectedSpeech =
            this.suspectedSpeechTimestamp > 0
              ? transcriptionTime - this.suspectedSpeechTimestamp
              : Infinity;

          // If we had suspected speech and transcription confirms it within timeout, it's real
          const isConfirmedSpeech =
            this.suspectedSpeech &&
            timeSinceSuspectedSpeech <
              TIMING_THRESHOLDS.SUSPECTED_SPEECH_TIMEOUT_MS;

          // If it's an interruption phrase, allow it through immediately (bypass echo suppression)
          // This works even during echo periods because interruption phrases indicate real user intent
          if (isInterruptionPhrase) {
            this.handleInterruptionPhrase(userTranscript, transcriptionTime);
            // Save transcript but DO NOT request a response - wait for user to finish speaking
            await this.saveTranscript("human", userTranscript);
            console.log(
              "🔇 Interruption detected - remaining silent and waiting for user to finish"
            );
            break; // Exit early - don't request a response
          }

          // For non-interruption phrases: Check if this is real user speech or echo
          // 🚨 CRITICAL: Do NOT cancel response for non-interruption phrases
          // The AI MUST finish its current response - only explicit interruption phrases ("oh wait", "wait", "stop") should stop it
          // Regular user speech during AI response should NOT interrupt the AI - the AI will finish its response first
          // This ensures the AI completes its thought before responding to new input

          // Apply echo suppression checks to determine if this is real speech
          let isLikelyEcho = false;

          // If VAD confirmed it, it's definitely real speech
          if (isConfirmedSpeech) {
            console.log(
              `✅ Transcription confirms suspected speech: "${userTranscript}" (${timeSinceSuspectedSpeech}ms after VAD) - will wait for AI to finish response (NOT interrupting)`
            );
            // Mark that user is speaking, but DON'T cancel response
            // The AI should finish its current sentence/response
            // Only explicit interruption phrases (handled above) can stop the AI
            this.suspectedSpeech = false; // Clear suspected flag
            // Continue to process transcription normally - don't interrupt AI
            // Skip echo checks since VAD confirmed it's real
          } else {
            // VAD didn't confirm it - check if it's echo
            // Apply echo suppression checks

            // 🚨 CRITICAL: During AI speech, ONLY interruption phrases are allowed
            // Anything else (including greetings) is treated as echo to prevent false positives
            const isGreeting = this.isGreetingPhrase(userTranscript);

            // 🚨 STRICT ECHO DETECTION: During AI speech, treat ANY transcription as echo UNLESS it's an interruption phrase
            // This includes greetings, regular speech, and any other phrases - ONLY clear interruption signals are allowed
            if (
              timeSinceAIResponseStart < TIMING_THRESHOLDS.ECHO_PERIOD_MS &&
              !isInterruptionPhrase
            ) {
              // During early AI speech, reject ALL transcriptions unless they're interruption phrases
              // This prevents echo from being accepted as real user speech
              console.log(
                `⚠️⚠️⚠️ LIKELY ECHO (AI just started ${timeSinceAIResponseStart}ms ago, no interruption phrase): "${userTranscript}" ⚠️⚠️⚠️`
              );
              console.log(
                `   All speech during AI response (without clear interruption signals like 'wait', 'wait a sec') is treated as echo`
              );
              if (isGreeting) {
                console.log(
                  `   Even greeting phrases are treated as echo during AI speech - only clear interruption signals are allowed`
                );
              }
              console.log(
                `   This transcription will NOT be saved (likely AI echo)`
              );
              isLikelyEcho = true;
            }

            // Also check if AI is currently processing a response
            // 🚨 CRITICAL: During AI speech, ONLY interruption phrases are allowed - everything else is echo
            // 🚨 STRICT ECHO DETECTION: During AI speech, treat ANY transcription as echo UNLESS it's an interruption phrase
            if (
              !isLikelyEcho &&
              this.isProcessingResponse &&
              timeSinceAIResponseStart <
                TIMING_THRESHOLDS.ECHO_SUPPRESSION_MS &&
              !isInterruptionPhrase
            ) {
              // During AI speech, reject ALL transcriptions unless they're interruption phrases
              // This prevents echo from being accepted as real user speech
              // Only clear interruption signals like 'wait', 'wait a sec', 'stop' are allowed
              console.log(
                `⚠️⚠️⚠️ LIKELY ECHO (AI is speaking, ${timeSinceAIResponseStart}ms since start, no interruption phrase): "${userTranscript}" ⚠️⚠️⚠️`
              );
              console.log(
                `   All speech during AI response (without clear interruption signals like 'wait', 'wait a sec') is treated as echo`
              );
              if (this.lastAIResponse) {
                console.log(`   AI is saying: "${this.lastAIResponse}"`);
              }
              if (isGreeting) {
                console.log(
                  `   Even greeting phrases are treated as echo during AI speech - only clear interruption signals are allowed`
                );
              }
              console.log(
                `   This transcription will NOT be saved (likely AI echo)`
              );
              isLikelyEcho = true;
            } else if (
              !isLikelyEcho &&
              this.isProcessingResponse &&
              timeSinceAIResponseStart <
                TIMING_THRESHOLDS.ECHO_SUPPRESSION_EXTENDED_MS &&
              !isInterruptionPhrase
            ) {
              // Extended echo suppression period - still reject unless interruption phrase
              // Only clear interruption signals like 'wait', 'wait a sec', 'stop' are allowed
              // Check for garbled echo (contains words from AI's speech)
              if (this.lastAIResponse) {
                const aiWords = this.lastAIResponse.toLowerCase().split(/\s+/);
                const transcriptWords = userTranscript
                  .toLowerCase()
                  .split(/\s+/);
                const commonWords = aiWords.filter(
                  (word) =>
                    word.length > 3 && // Only check meaningful words (length > 3)
                    transcriptWords.includes(word)
                );

                // If transcription contains multiple words from AI's speech, it's likely garbled echo
                const isGarbledEcho =
                  commonWords.length >= 2 ||
                  (commonWords.length >= 1 &&
                    userTranscript.trim().split(/\s+/).length <= 5);

                if (isGarbledEcho) {
                  console.log(
                    `⚠️⚠️⚠️ LIKELY GARBLED ECHO (contains ${commonWords.length} words from AI's speech during AI speech): "${userTranscript}" ⚠️⚠️⚠️`
                  );
                  console.log(`   AI is saying: "${this.lastAIResponse}"`);
                  console.log(
                    `   Common words found: ${commonWords.join(", ")}`
                  );
                  console.log(
                    `   This transcription will NOT be saved (likely garbled AI echo)`
                  );
                  isLikelyEcho = true;
                } else {
                  // Still reject during extended echo suppression unless it's an interruption phrase
                  console.log(
                    `⚠️⚠️⚠️ LIKELY ECHO (AI recently finished, ${timeSinceAIResponseStart}ms since start, no interruption phrase): "${userTranscript}" ⚠️⚠️⚠️`
                  );
                  console.log(
                    `   All speech during extended echo suppression period (without clear interruption signals) is treated as echo`
                  );
                  console.log(
                    `   This transcription will NOT be saved (likely AI echo)`
                  );
                  isLikelyEcho = true;
                }
              } else {
                // No AI response to compare yet - reject conservatively
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (AI recently finished, ${timeSinceAIResponseStart}ms since start, no interruption phrase): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              }
            } else if (
              !isLikelyEcho &&
              this.isProcessingResponse &&
              timeSinceAIResponseStart >=
                TIMING_THRESHOLDS.ECHO_SUPPRESSION_EXTENDED_MS &&
              !isGreeting
            ) {
              // Later in response but still processing - check for garbled echo
              if (this.lastAIResponse) {
                const aiWords = this.lastAIResponse.toLowerCase().split(/\s+/);
                const transcriptWords = userTranscript
                  .toLowerCase()
                  .split(/\s+/);
                const commonWords = aiWords.filter(
                  (word) =>
                    word.length > 3 && // Only check meaningful words (length > 3)
                    transcriptWords.includes(word)
                );

                // If transcription contains multiple words from AI's speech, it's likely garbled echo
                const isGarbledEcho =
                  commonWords.length >= 2 ||
                  (commonWords.length >= 1 &&
                    userTranscript.trim().split(/\s+/).length <= 5);

                if (isGarbledEcho && this.isProcessingResponse) {
                  console.log(
                    `⚠️⚠️⚠️ LIKELY GARBLED ECHO (contains ${commonWords.length} words from AI's speech during AI speech): "${userTranscript}" ⚠️⚠️⚠️`
                  );
                  console.log(`   AI is saying: "${this.lastAIResponse}"`);
                  console.log(
                    `   Common words found: ${commonWords.join(", ")}`
                  );
                  console.log(
                    `   This transcription will NOT be saved (likely garbled AI echo)`
                  );
                  isLikelyEcho = true;
                } else {
                  // Later in response but no AI text to compare yet
                  // Still check if it's a nonsensical phrase or goodbye phrase that might be garbled echo
                  const isGoodbyePhrase =
                    this.isUserGoodbyePhrase(userTranscript) ||
                    userTranscript.toLowerCase().includes("bye") ||
                    userTranscript.toLowerCase().includes("goodbye") ||
                    userTranscript.toLowerCase().includes("have a good") ||
                    userTranscript.toLowerCase().includes("have a great");

                  if (
                    (this.isNonsensicalPhrase(userTranscript) ||
                      isGoodbyePhrase) &&
                    this.isProcessingResponse
                  ) {
                    const reason = this.isNonsensicalPhrase(userTranscript)
                      ? "nonsensical phrase"
                      : "goodbye phrase";
                    console.log(
                      `⚠️⚠️⚠️ LIKELY ECHO (${reason} during AI speech, ${timeSinceAIResponseStart}ms since start, no AI text yet): "${userTranscript}" ⚠️⚠️⚠️`
                    );
                    console.log(
                      `   ${
                        reason === "goodbye phrase"
                          ? "Goodbye phrases"
                          : "Nonsensical phrases"
                      } during AI speech are almost always echo/feedback - rejecting`
                    );
                    console.log(
                      `   This transcription will NOT be saved (likely AI echo)`
                    );
                    isLikelyEcho = true;
                  } else if (
                    this.isProcessingResponse &&
                    !isInterruptionPhrase
                  ) {
                    // AI is still processing - treat any non-interruption phrase as echo
                    // Only clear interruption signals like 'wait', 'wait a sec', 'stop' are allowed during AI speech
                    console.log(
                      `⚠️⚠️⚠️ LIKELY ECHO (AI is still speaking, ${timeSinceAIResponseStart}ms since start, no interruption phrase): "${userTranscript}" ⚠️⚠️⚠️`
                    );
                    console.log(
                      `   All speech during AI response (without clear interruption signals) is treated as echo`
                    );
                    console.log(
                      `   This transcription will NOT be saved (likely AI echo)`
                    );
                    isLikelyEcho = true;
                  } else {
                    // Accept it only if AI is not processing or it's an interruption phrase
                    console.log(
                      `✅ Accepting transcription (${timeSinceAIResponseStart}ms since AI started, AI not processing or interruption phrase): "${userTranscript}"`
                    );
                  }
                }
              }
            }
            // Note: Greeting phrases during AI speech are now treated as echo - only interruption phrases are allowed

            // 🚨 CRITICAL: Reject short transcriptions during AI speech (likely false positives/mis-transcribed echo)
            // Even if not similar to AI's response, short phrases during AI speech are likely echo that got transcribed incorrectly
            if (
              !isLikelyEcho &&
              this.isProcessingResponse &&
              userTranscript.trim().split(/\s+/).length <= 3 &&
              !isInterruptionPhrase
            ) {
              console.log(
                `⚠️⚠️⚠️ LIKELY FALSE POSITIVE (short phrase during AI speech, ${timeSinceAIResponseStart}ms since start): "${userTranscript}" ⚠️⚠️⚠️`
              );
              console.log(
                `   Short transcriptions during AI speech are likely echo/false positives - rejecting`
              );
              isLikelyEcho = true;
            }

            // 🚨 CRITICAL: Reject nonsensical/garbled phrases during AI speech (likely mis-transcribed echo)
            // Examples: "any of us needing help" (garbled version of AI's "need help")
            if (
              !isLikelyEcho &&
              this.isProcessingResponse &&
              this.isNonsensicalPhrase(userTranscript)
            ) {
              console.log(
                `⚠️⚠️⚠️ LIKELY GARBLED ECHO (nonsensical phrase during AI speech, ${timeSinceAIResponseStart}ms since start): "${userTranscript}" ⚠️⚠️⚠️`
              );
              console.log(
                `   This phrase is grammatically odd/nonsensical and appeared during AI speech - likely garbled echo`
              );
              console.log(
                `   This transcription will NOT be saved (likely garbled AI echo)`
              );
              isLikelyEcho = true;
            }

            // 🚨 SMART ECHO DETECTION: Check multiple factors to detect echo
            // 1. Similarity to AI's response
            // 2. Short phrases that appear very soon after AI finishes (likely mis-transcribed echo)
            // 3. Goodbye/polite phrases that appear very soon after (likely echo)
            // 4. Name introductions that appear soon after AI finishes (likely mis-transcribed echo)
            if (!isLikelyEcho && this.lastAIResponse) {
              const similarity = this.calculateSimilarity(
                userTranscript.toLowerCase(),
                this.lastAIResponse.toLowerCase()
              );

              const isShortPhrase =
                userTranscript.trim().split(/\s+/).length <= 2;
              const lowerTranscript = userTranscript.toLowerCase();
              const isGoodbyePhrase =
                this.isUserGoodbyePhrase(userTranscript) ||
                lowerTranscript.includes("bye") ||
                lowerTranscript.includes("goodbye");
              // Check for "thank you" + "bye" combinations (common echo pattern)
              const hasThankYouAndBye =
                (lowerTranscript.includes("thank you") ||
                  lowerTranscript.includes("thanks")) &&
                (lowerTranscript.includes("bye") ||
                  lowerTranscript.includes("goodbye"));
              const isPolitePhrase = this.isCommonPolitePhrase(userTranscript);
              const isNameIntroduction =
                this.isNameIntroduction(userTranscript);
              const isVerySoonAfter = transcriptionTimeSinceResponseEnd < 1000; // Less than 1 second
              const isWithinEchoWindow =
                transcriptionTimeSinceResponseEnd <
                TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS;

              // 🚨 CRITICAL: Reject short phrases, goodbye phrases, or name introductions that appear very soon after AI finishes
              // These are almost certainly mis-transcribed echo, even if similarity is low
              // Echo can get mis-transcribed as different words (e.g., "Thank you" → "Bye-bye", or AI speech → "My name is Kate")
              if (
                isVerySoonAfter &&
                (isShortPhrase ||
                  isGoodbyePhrase ||
                  isPolitePhrase ||
                  isNameIntroduction) &&
                !isInterruptionPhrase
              ) {
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (${transcriptionTimeSinceResponseEnd}ms after AI finished, ${
                    isShortPhrase
                      ? "short phrase"
                      : isGoodbyePhrase
                      ? "goodbye phrase"
                      : isPolitePhrase
                      ? "polite phrase"
                      : "name introduction"
                  }): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(`   AI said: "${this.lastAIResponse}"`);
                console.log(
                  `   Short/goodbye/polite/name introduction phrases appearing < 1s after AI finishes are likely mis-transcribed echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                // 🚨 CRITICAL FIX: Reject "thank you + bye" combinations within echo window
                // These are almost always echo, even if they're 3+ words
                hasThankYouAndBye &&
                isWithinEchoWindow &&
                !isInterruptionPhrase
              ) {
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (${transcriptionTimeSinceResponseEnd}ms after AI finished, "thank you + bye" combination): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(`   AI said: "${this.lastAIResponse}"`);
                console.log(
                  `   Phrases containing both "thank you" and "bye" within ${TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS}ms after AI finishes are almost always echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                // 🚨 CRITICAL FIX: Also reject goodbye phrases within the full echo window (not just 1 second)
                isGoodbyePhrase &&
                isWithinEchoWindow &&
                userTranscript.trim().split(/\s+/).length <= 4 && // Allow longer phrases if they're clearly not echo
                !isInterruptionPhrase
              ) {
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (${transcriptionTimeSinceResponseEnd}ms after AI finished, goodbye phrase within echo window): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(`   AI said: "${this.lastAIResponse}"`);
                console.log(
                  `   Goodbye phrases appearing within ${TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS}ms after AI finishes are likely echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                similarity > 0.3 && // Lower threshold - catch more echo (was 0.6, now 0.3)
                transcriptionTimeSinceResponseEnd <
                  TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS &&
                !isInterruptionPhrase
              ) {
                // Also reject if it's similar to AI's response AND happened very soon after
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (${(similarity * 100).toFixed(
                    0
                  )}% similar to AI's response, ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(`   AI said: "${this.lastAIResponse}"`);
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                isNameIntroduction &&
                isWithinEchoWindow &&
                !isInterruptionPhrase
              ) {
                // 🚨 CRITICAL: Reject name introductions within echo window
                // Name introductions like "My name is Kate" are often mis-transcribed echo
                // when they appear within POST_RESPONSE_ECHO_MS after AI finishes speaking
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (name introduction ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(`   AI said: "${this.lastAIResponse}"`);
                console.log(
                  `   Name introductions appearing within ${TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS}ms after AI finishes are likely mis-transcribed echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                transcriptionTimeSinceResponseEnd <
                TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS
              ) {
                // Happened soon after AI finished, but NOT similar and NOT a short/goodbye/name introduction phrase
                // This is likely real user speech
                console.log(
                  `✅ Accepting transcription (${transcriptionTimeSinceResponseEnd}ms after AI finished, ${(
                    similarity * 100
                  ).toFixed(0)}% similarity - not echo): "${userTranscript}"`
                );
              }
            } else if (
              !isLikelyEcho &&
              transcriptionTimeSinceResponseEnd <
                TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS &&
              !isInterruptionPhrase
            ) {
              // No AI response to compare, but happened soon after - be conservative
              const lowerTranscript = userTranscript.toLowerCase();
              const isPolitePhrase = this.isCommonPolitePhrase(userTranscript);
              const isNameIntroduction =
                this.isNameIntroduction(userTranscript);
              const isGoodbyePhrase =
                this.isUserGoodbyePhrase(userTranscript) ||
                lowerTranscript.includes("bye") ||
                lowerTranscript.includes("goodbye");
              // Check for "thank you" + "bye" combinations (common echo pattern)
              const hasThankYouAndBye =
                (lowerTranscript.includes("thank you") ||
                  lowerTranscript.includes("thanks")) &&
                (lowerTranscript.includes("bye") ||
                  lowerTranscript.includes("goodbye"));

              // 🚨 CRITICAL FIX: Reject "thank you + bye" combinations within echo window
              if (hasThankYouAndBye) {
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO ("thank you + bye" combination ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(
                  `   Phrases containing both "thank you" and "bye" within ${TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS}ms after AI finishes are almost always echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                // Reject goodbye phrases within echo window
                isGoodbyePhrase &&
                userTranscript.trim().split(/\s+/).length <= 4
              ) {
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (goodbye phrase ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(
                  `   Goodbye phrases appearing within ${TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS}ms after AI finishes are likely echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (isNameIntroduction) {
                // 🚨 CRITICAL: Reject name introductions within echo window (even without AI response to compare)
                // Name introductions are often mis-transcribed echo
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (name introduction ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(
                  `   Name introductions appearing within ${TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS}ms after AI finishes are likely mis-transcribed echo`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (userTranscript.trim().split(/\s+/).length <= 3) {
                // Reject if it's a very short phrase (likely echo)
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (short phrase ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}" ⚠️⚠️⚠️`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo)`
                );
                isLikelyEcho = true;
              } else if (
                isPolitePhrase &&
                transcriptionTimeSinceResponseEnd < 2000
              ) {
                // Common polite phrases that appear very soon after AI finishes (< 2 seconds) are likely echo/mis-transcription
                // These phrases are often mis-transcribed from echo or background noise
                console.log(
                  `⚠️⚠️⚠️ LIKELY ECHO (common polite phrase "${userTranscript}" ${transcriptionTimeSinceResponseEnd}ms after AI finished - likely echo/mis-transcription) ⚠️⚠️⚠️`
                );
                console.log(
                  `   This transcription will NOT be saved (likely AI echo or mis-transcription)`
                );
                isLikelyEcho = true;
              } else {
                // Longer phrase - likely real user speech
                console.log(
                  `✅ Accepting transcription (longer phrase, ${transcriptionTimeSinceResponseEnd}ms after AI finished): "${userTranscript}"`
                );
              }
            }

            // 🚨 FINAL SAFETY CHECK: If AI is currently speaking, reject ANY non-interruption phrase as echo
            // This ensures nothing can interrupt AI speaking except clear signals like 'wait', 'wait a sec', 'stop'
            // BUT: Allow legitimate questions and longer phrases even during AI speech (user might be responding to a question)
            if (
              !isLikelyEcho &&
              this.isProcessingResponse &&
              this.responseStartTime > 0 &&
              !isInterruptionPhrase
            ) {
              // Check if this is a legitimate question or longer phrase
              const isQuestion = this.containsQuestion(userTranscript);
              const wordCount = userTranscript.trim().split(/\s+/).length;
              const isLongPhrase = wordCount >= 5; // Phrases with 5+ words are likely legitimate
              const isLegitimateInput = isQuestion || isLongPhrase;

              if (isLegitimateInput) {
                const timeSinceStart = Date.now() - this.responseStartTime;
                console.log(
                  `⚠️  Transcription during AI speech BUT allowing through (legitimate ${
                    isQuestion ? "question" : "longer phrase"
                  }, ${timeSinceStart}ms since AI started): "${userTranscript}"`
                );
                console.log(
                  `   Word count: ${wordCount}, isQuestion: ${isQuestion}`
                );
                // Allow it through - user might be responding to a question
              } else {
                const timeSinceStart = Date.now() - this.responseStartTime;
                console.log(
                  `🚫🚫🚫 FINAL SAFETY CHECK: Rejecting transcription during AI speech (${timeSinceStart}ms since AI started): "${userTranscript}" 🚫🚫🚫`
                );
                console.log(
                  `   AI is currently speaking - only clear interruption signals like 'wait', 'wait a sec', 'stop' are allowed`
                );
                console.log(
                  `   All other speech during AI response is treated as echo`
                );
                isLikelyEcho = true;
              }
            }

            // 🚨 CRITICAL: DO NOT save transcriptions that are likely echo
            // This prevents the AI's own voice from being saved as user speech
            // BUT: Allow legitimate questions and longer phrases even if they might be echo
            // This ensures the AI can still respond to real user input
            if (isLikelyEcho) {
              // Check if this is a legitimate question or longer phrase
              const isQuestion = this.containsQuestion(userTranscript);
              const wordCount = userTranscript.trim().split(/\s+/).length;
              const isLongPhrase = wordCount >= 5; // Phrases with 5+ words are likely legitimate
              const isLegitimateInput = isQuestion || isLongPhrase;

              if (isLegitimateInput) {
                console.log(
                  `⚠️  Transcription marked as echo BUT allowing through (legitimate ${
                    isQuestion ? "question" : "longer phrase"
                  }): "${userTranscript}"`
                );
                console.log(
                  `   Word count: ${wordCount}, isQuestion: ${isQuestion}`
                );
                // Allow it through - treat as legitimate user input
                isLikelyEcho = false;
              } else {
                console.log(
                  `🚫 REJECTING TRANSCRIPTION (likely echo/feedback): "${userTranscript}"`
                );
                this.suspectedSpeech = false; // Clear suspected flag
                break; // Don't save, don't trigger response
              }
            }

            // If we get here, it passed all echo checks - it's likely real user speech
            // VAD might have missed it, but it's not echo, so save it
            console.log(
              `✅ Accepting transcription (passed echo checks, VAD didn't confirm): "${userTranscript}"`
            );
            this.suspectedSpeech = false;
          }

          console.log(
            `👤👤👤 USER TRANSCRIPTION COMPLETED (WILL PROCESS): "${userTranscript}" 👤👤👤`
          );
          console.log(
            `💾💾💾 SAVING USER TRANSCRIPTION AS "human": "${userTranscript}" 💾💾💾`
          );
          await this.saveTranscript("human", userTranscript);
          console.log(
            `✅✅✅ USER TRANSCRIPTION SAVED SUCCESSFULLY AS "human" ✅✅✅`
          );

          // Track this as the last processed transcript
          this.lastProcessedUserTranscript = userTranscript;

          // Get the timestamp when this transcription was completed
          const transcriptionTimestamp = Date.now();
          // Update latest user speech timestamp to track the most recent speech
          this.latestUserSpeechTimestamp = transcriptionTimestamp;
          console.log(`📝 Transcription timestamp: ${transcriptionTimestamp}`);
          console.log(
            `📅 Latest user speech timestamp updated to: ${this.latestUserSpeechTimestamp}`
          );

          // CRITICAL: Only respond if this is the latest user speech
          // If user spoke again after this transcription started, ignore this old transcription
          if (
            this.latestUserSpeechTimestamp > 0 &&
            transcriptionTimestamp < this.latestUserSpeechTimestamp
          ) {
            const timeDiff =
              this.latestUserSpeechTimestamp - transcriptionTimestamp;
            console.log(`⚠️⚠️⚠️ IGNORING OLD TRANSCRIPTION ⚠️⚠️⚠️`);
            console.log(
              `   User spoke again ${timeDiff}ms AFTER this transcription started`
            );
            console.log(
              `   Latest speech: ${this.latestUserSpeechTimestamp}, This transcription: ${transcriptionTimestamp}`
            );
            console.log(
              "🔄 Will wait for newer transcription to complete before responding"
            );
            break;
          }

          console.log(
            `✅ This is the latest user speech - proceeding with response`
          );

          // 🚨 NOTE: AI can say goodbye, but the call continues - user can still speak and AI will respond
          // The hasClosedCall flag is kept for tracking purposes, but doesn't prevent responses
          // Only the user can actually hang up the call
          if (this.hasClosedCall) {
            console.log(
              "ℹ️  AI previously said goodbye, but call continues - responding to user input"
            );
            // Don't break - allow the conversation to continue
          }

          // 🚨 CRITICAL: If user interrupted (said "wait", etc.), clear the flag and proceed
          // This means the user has finished their interruption and is now speaking normally
          if (this.isInterrupted) {
            console.log(
              "✅ User has finished interruption - clearing interruption flag and proceeding"
            );
            this.isInterrupted = false;
            // Also clear shouldStopAudio to allow new AI response audio to flow
            this.shouldStopAudio = false;
            console.log("✅ Cleared shouldStopAudio flag - AI can now speak");
          }

          // 🚨 CRITICAL: If AI is currently speaking/processing a response, DO NOT request a new response
          // The AI MUST finish its current response first - only explicit interruption phrases should stop it
          // Regular user speech during AI response should wait until AI finishes
          if (this.isProcessingResponse) {
            const timeSinceResponseStart = this.getTimeSinceResponseStart();
            console.log(
              `⚠️⚠️⚠️ AI IS CURRENTLY SPEAKING - ACCUMULATING TRANSCRIPT FOR LATER ⚠️⚠️⚠️`
            );
            console.log(
              `   AI started speaking ${timeSinceResponseStart}ms ago - will wait for AI to finish`
            );
            console.log(
              `   User said: "${userTranscript}" - will accumulate and respond AFTER AI finishes`
            );
            console.log(
              `   📝 This transcription will be accumulated and processed after AI response completes`
            );
            // Accumulate transcript but don't start timer yet (will start after AI finishes)
            // Check if this is a continuation of previous speech
            const timeSinceLastTranscript =
              this.lastTranscriptTime > 0
                ? Date.now() - this.lastTranscriptTime
                : Infinity;

            if (
              timeSinceLastTranscript < TIMING_THRESHOLDS.CONVERSATION_WINDOW_MS
            ) {
              // This is a continuation - accumulate it
              if (this.accumulatedTranscript) {
                this.accumulatedTranscript += " " + userTranscript;
              } else {
                this.accumulatedTranscript = userTranscript;
              }
            } else {
              // New conversation - start fresh accumulation
              this.accumulatedTranscript = userTranscript;
            }
            this.lastTranscriptTime = Date.now();
            // Update last processed transcript so we know what to respond to later
            // This will be used in response.done handler to respond after AI finishes
            this.lastProcessedUserTranscript = userTranscript;
            // Don't start timer yet - will start after AI finishes speaking
            break; // Exit early - don't request response while AI is speaking
          }

          // 🚨 CRITICAL: If AI just asked a question, this is NEW user input responding to that question
          // Clear any old accumulated transcript and start fresh
          const aiAskedQuestion =
            this.lastAIResponse && this.containsQuestion(this.lastAIResponse);
          if (aiAskedQuestion && this.accumulatedTranscript.trim()) {
            console.log(
              `❓ User responding to AI's question - clearing old accumulated transcript and starting fresh`
            );
            console.log(
              `   Old accumulated transcript (cleared): "${this.accumulatedTranscript}"`
            );
            console.log(`   New user input: "${userTranscript}"`);
            // Cancel any pending response to old accumulated transcript
            this.clearPendingResponseRequest();
            this.clearConversationWindowTimer();
            this.accumulatedTranscript = "";
            this.lastTranscriptTime = 0;
          }

          // 🚨 CRITICAL: Cancel any pending response requests when new speech comes in
          // This ensures we only respond to the most recent user input
          if (this.hasPendingResponseRequest || this.conversationWindowTimer) {
            console.log(
              `🔄 New user speech detected - cancelling pending response to ensure we only respond to most recent input`
            );
            this.clearPendingResponseRequest();
            this.clearConversationWindowTimer();
          }

          // 🚨 SOLUTION 2: CONVERSATION WINDOW - Accumulate consecutive speech and respond after 3s silence
          // Check if this is a continuation of previous speech (within conversation window)
          const timeSinceLastTranscript =
            this.lastTranscriptTime > 0
              ? Date.now() - this.lastTranscriptTime
              : Infinity;

          if (
            timeSinceLastTranscript < TIMING_THRESHOLDS.CONVERSATION_WINDOW_MS
          ) {
            // This is a continuation - accumulate it
            console.log(
              `📝📝📝 ACCUMULATING TRANSCRIPT (${timeSinceLastTranscript}ms since last): "${userTranscript}" 📝📝📝`
            );
            if (this.accumulatedTranscript) {
              this.accumulatedTranscript += " " + userTranscript;
            } else {
              this.accumulatedTranscript = userTranscript;
            }
            console.log(
              `📚 Accumulated transcript so far: "${this.accumulatedTranscript}"`
            );
          } else {
            // New conversation - start fresh accumulation
            console.log(
              `🆕 NEW CONVERSATION - Starting fresh accumulation: "${userTranscript}"`
            );
            // Clear old accumulated transcript to ensure we only respond to new input
            if (this.accumulatedTranscript.trim()) {
              console.log(
                `   Clearing old accumulated transcript: "${this.accumulatedTranscript}"`
              );
              // Remove from respondedToTranscripts so we can respond to new input
              this.respondedToTranscripts.delete(this.accumulatedTranscript);
            }
            this.accumulatedTranscript = userTranscript;
          }

          // Update last transcript time
          this.lastTranscriptTime = Date.now();

          // Clear any existing conversation window timer
          this.clearConversationWindowTimer();

          // Start/reset the 1-second timer
          console.log(
            `⏱️  Starting 1-second silence timer (will respond if no more speech)`
          );
          this.conversationWindowTimer = setTimeout(() => {
            this.conversationWindowTimer = null;
            console.log(
              `⏱️  1 second of silence detected - processing accumulated transcript`
            );
            this.handleAccumulatedTranscriptResponse();
          }, TIMING_THRESHOLDS.CONVERSATION_WINDOW_MS);

          // Don't request response immediately - wait for 1 second of silence
          console.log(
            `⏸️  Waiting for 1 second of silence before responding to accumulated speech`
          );
          break;

        case "input_audio_buffer.speech_started":
          // 🚨 SMART ECHO SUPPRESSION: Don't immediately stop on VAD events
          // VAD can have false positives from echo/noise - wait for transcription confirmation
          const timeSinceResponseStart = this.getTimeSinceResponseStart();

          // 🚨 CRITICAL: OpenAI's server-side VAD can have false positives from echo
          // Ignore speech_started events during echo periods - they're likely false positives
          if (timeSinceResponseStart < TIMING_THRESHOLDS.ECHO_SUPPRESSION_MS) {
            console.log(
              `⚠️  Ignoring speech_started event - AI started ${timeSinceResponseStart}ms ago (likely echo/noise)`
            );
            return; // Don't process this speech event - it's likely echo
          }

          // Also ignore if AI is currently processing a response
          if (
            this.isProcessingResponse &&
            timeSinceResponseStart <
              TIMING_THRESHOLDS.ECHO_SUPPRESSION_EXTENDED_MS
          ) {
            console.log(
              `⚠️  Ignoring speech_started event - AI is speaking (${timeSinceResponseStart}ms ago) - likely echo`
            );
            return; // Don't interrupt - AI is speaking, likely echo
          }

          // Mark as suspected speech, but DON'T stop immediately
          // Wait for transcription to confirm it's real words, not just noise
          this.suspectedSpeech = true;
          this.suspectedSpeechTimestamp = Date.now();
          console.log(
            "🎤 Server-side VAD detected speech - marking as suspected, waiting for transcription confirmation"
          );
          console.log(
            "   Will only stop if transcription confirms meaningful words"
          );

          // Don't set shouldStopAudio or cancel response here
          // Let transcription handler decide if it's real speech
          return; // Exit - don't process further until transcription confirms

        case "input_audio_buffer.speech_stopped":
          // 🚨 ECHO SUPPRESSION: Ignore speech_stopped events that happen shortly after AI finishes speaking
          // This prevents false positives from echo/feedback of AI's own voice
          const timeSinceLastResponseEnd =
            this.lastResponseEndTime > 0
              ? Date.now() - this.lastResponseEndTime
              : Infinity;

          // If AI just finished speaking (within threshold), this is likely echo
          if (
            timeSinceLastResponseEnd < TIMING_THRESHOLDS.POST_RESPONSE_ECHO_MS
          ) {
            console.log(
              `⚠️  Ignoring speech_stopped event - AI just finished speaking ${timeSinceLastResponseEnd}ms ago (likely echo/feedback)`
            );
            break; // Don't process - it's echo
          }

          console.log(
            "🔇 User stopped speaking - waiting for transcription to complete"
          );
          // Cancel any pending response request (in case transcription completes very quickly)
          this.clearPendingResponseRequest();

          // If we were interrupted, clear the flag now that user has stopped speaking
          // The next transcription will be processed normally
          if (this.isInterrupted) {
            console.log(
              "✅ User finished speaking after interruption - will process next transcription normally"
            );
            // Don't clear the flag here - let the transcription handler clear it
            // This ensures we only respond to actual content, not just silence
          }

          // CRITICAL: Don't request response immediately - wait for transcription to complete
          // This ensures we don't interrupt the user and only respond after they finish speaking
          // The response will be requested after transcription.completed event
          // The transcription.completed handler will check if this is the latest user speech
          // before requesting a response, ensuring we only respond to the newest input
          console.log(
            "⏳ Waiting for transcription to complete before requesting response"
          );
          break;

        case "error":
          // Ignore "response_cancel_not_active" errors - they're harmless
          const errorCode = message.error?.code || "";
          const errorMessage = message.error?.message || "";
          const errorMsg = errorCode || errorMessage;
          if (this.isHarmlessCancellationError(errorMsg)) {
            console.log(
              "ℹ️  Ignoring harmless cancellation error - response was not active"
            );
            // Even for harmless errors, clear state flags if they're stuck
            // This ensures the AI can respond even after a cancelled response
            if (this.isProcessingResponse || this.hasPendingResponseRequest) {
              console.log(
                "🔧 Clearing state flags after cancellation error to allow future responses"
              );
              this.isProcessingResponse = false;
              this.hasPendingResponseRequest = false;
              this.clearPendingResponseRequest();
              this.currentResponseHasAudio = false;
              this.currentResponseAudioDone = false;
            }
          } else {
            console.error("❌ OpenAI Realtime API error:", message.error);
            // 🚨 CRITICAL: Clear state flags on non-harmless errors
            // This prevents the AI from getting stuck in a non-responsive state
            console.log(
              "🔧 Clearing response state flags due to error to allow recovery"
            );
            this.isProcessingResponse = false;
            this.hasPendingResponseRequest = false;
            this.clearPendingResponseRequest();
            this.currentResponseHasAudio = false;
            this.currentResponseAudioDone = false;
            // Reset the stop audio flag in case it's stuck
            this.shouldStopAudio = false;
          }
          break;

        default:
          // Log unknown message types for debugging (but not audio deltas to reduce spam)
          if (
            !messageType.includes("audio.delta") &&
            !messageType.includes("audio_transcript.delta")
          ) {
            console.log(`ℹ️  Realtime API message: ${messageType}`);
          }
      }
    } catch (error) {
      console.error("❌ Error handling Realtime API message:", error);
    }
  }

  private async handleRealtimeAudio(base64Audio: string) {
    // 🚨 IMMEDIATELY stop if interruption phrase was detected - always block
    // Only blocks if isInterrupted flag is true (explicit interruption phrase detected)
    if (this.shouldBlockAudio()) {
      console.log(
        `🛑 BLOCKING audio send to Twilio - interruption detected (isInterrupted: ${this.isInterrupted}, shouldStopAudio: ${this.shouldStopAudio})`
      );
      return;
    }

    try {
      if (!base64Audio || base64Audio.length === 0) {
        return; // Skip empty audio
      }

      // Decode base64 PCM16 audio (24kHz from OpenAI)
      // OpenAI sends PCM16 as base64, which is already in the correct format
      let rawBuffer: Buffer;
      try {
        rawBuffer = Buffer.from(base64Audio, "base64");
        if (!rawBuffer || rawBuffer.length === 0) {
          return; // Skip empty buffers
        }
      } catch (error) {
        console.warn("⚠️  Error decoding base64 audio:", error);
        return; // Skip malformed audio
      }

      // Ensure we have the correct byte length for PCM16 (2 bytes per sample)
      // If the buffer length is odd, truncate to even length
      const evenLength = rawBuffer.length - (rawBuffer.length % 2);
      if (evenLength === 0) {
        return; // Skip if no valid samples
      }

      const pcmBuffer =
        evenLength !== rawBuffer.length
          ? rawBuffer.slice(0, evenLength)
          : rawBuffer;

      // OpenAI sends 24kHz PCM16, Twilio needs 8kHz μ-law
      // encodeTwilioAudio will handle normalization and resampling
      let encodedAudio: string;
      try {
        encodedAudio = encodeTwilioAudio(pcmBuffer, 24000);
        if (!encodedAudio || encodedAudio.length === 0) {
          return; // Skip empty encoded audio
        }
      } catch (error) {
        console.warn("⚠️  Error encoding audio for Twilio:", error);
        return; // Skip if encoding fails
      }

      // Send to Twilio
      this.sendAudioToTwilio(encodedAudio);
    } catch (error) {
      console.error("❌ Error handling Realtime audio:", error);
    }
  }

  private sendAudioToTwilio(base64MulawAudio: string) {
    if (!this.streamSid || !this.ws) return;

    // Check WebSocket is open before sending
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.error("❌ Cannot send audio - WebSocket not ready");
      return;
    }

    try {
      const message = {
        event: "media",
        streamSid: this.streamSid,
        media: {
          payload: base64MulawAudio,
        },
      };

      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error("❌ Error sending audio to Twilio:", error);
    }
  }

  private async saveTranscript(speaker: "ai" | "human", text: string) {
    if (!text.trim()) return;

    try {
      const transcript = {
        id: uuidv4(),
        call_id: this.call.id,
        speaker,
        message: text,
        timestamp: new Date(),
      };

      console.log(
        `💾 SAVING TRANSCRIPT - Speaker: "${speaker}", Message: "${text.substring(
          0,
          100
        )}${text.length > 100 ? "..." : ""}"`
      );
      await TranscriptService.addTranscript(transcript);
      io.to(`call:${this.call.id}`).emit("transcript", transcript);
      console.log(
        `✅ TRANSCRIPT SAVED AND EMITTED - Speaker: "${speaker}", ID: ${transcript.id}`
      );
    } catch (error) {
      console.error("❌ Error saving transcript:", error);
      console.error(`   Speaker: "${speaker}", Message: "${text}"`);
    }
  }

  private async sendInitialGreeting() {
    try {
      if (!this.realtimeConnection?.isConnectedToAPI()) {
        console.warn("⚠️  Cannot send greeting: Realtime API not connected");
        return;
      }

      if (this.hasSentGreeting) {
        return; // Already sent
      }

      console.log("👋 GPT-4o-Realtime: Requesting initial greeting...");

      // Request AI to generate and speak the greeting
      // The greeting content is defined in the system prompt
      this.hasSentGreeting = true;

      // Trigger the AI to create a response (which will include the greeting based on system prompt)
      this.realtimeConnection.requestResponse();

      console.log("✅ GPT-4o-Realtime: Initial greeting requested");
    } catch (error) {
      console.error("❌ Error sending initial greeting:", error);
    }
  }

  /**
   * Calculate similarity between two strings (0-1, where 1 is identical)
   * Uses word overlap and length similarity
   */
  private calculateSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    // Normalize: remove punctuation, lowercase, split into words
    const words1 = text1
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const words2 = text2
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (words1.length === 0 || words2.length === 0) return 0;

    // Calculate word overlap
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    const jaccardSimilarity = intersection.size / union.size;

    // Also consider length similarity
    const lengthRatio =
      Math.min(words1.length, words2.length) /
      Math.max(words1.length, words2.length);

    // Weighted average: 70% Jaccard, 30% length
    return jaccardSimilarity * 0.7 + lengthRatio * 0.3;
  }

  /**
   * Validate transcription against AI response to detect accuracy issues
   *
   * GPT-4o Realtime's transcription API can be less accurate than its understanding,
   * especially with accents or audio quality issues. This method checks if the AI's
   * response suggests it understood something different from what was transcribed.
   *
   * Known issue: The transcription might say "issue a phone response" but the AI
   * correctly understands "issue a full refund" (as evidenced by its response).
   */
  private validateTranscriptionAgainstResponse(
    userTranscript: string,
    aiResponse: string
  ): void {
    if (!userTranscript || !aiResponse) return;

    // Extract key phrases from AI response that suggest what it understood
    const responseLower = aiResponse.toLowerCase();
    const transcriptLower = userTranscript.toLowerCase();

    // 🚨 CRITICAL: Check for COMPLETE CONTEXT MISMATCH
    // If AI response has NO semantic relation to the transcription, it's likely responding to system prompt context
    const transcriptWords = transcriptLower
      .split(/\s+/)
      .filter((w) => w.length > 3); // Only meaningful words (length > 3)
    const responseWords = responseLower
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // Extract key semantic terms from both
    const transcriptKeyTerms = this.extractKeyTerms(userTranscript);
    const responseKeyTerms = this.extractKeyTerms(aiResponse);

    // Check for semantic overlap (common words or related concepts)
    const commonWords = transcriptWords.filter((w) =>
      responseWords.includes(w)
    );

    // Calculate semantic similarity
    const semanticSimilarity = this.calculateSemanticSimilarity(
      transcriptKeyTerms,
      responseKeyTerms
    );

    // 🚨 DETECT COMPLETE CONTEXT MISMATCH
    // If there's no semantic overlap and no common words, AI is likely responding to system prompt, not transcription
    if (
      commonWords.length === 0 &&
      semanticSimilarity < 0.1 &&
      transcriptWords.length > 0 &&
      responseWords.length > 5
    ) {
      console.error(
        `🚨🚨🚨 CRITICAL: COMPLETE CONTEXT MISMATCH DETECTED 🚨🚨🚨`
      );
      console.error(`   User Transcription: "${userTranscript}"`);
      console.error(`   AI Response: "${aiResponse.substring(0, 200)}..."`);
      console.error(
        `   📊 Semantic similarity: ${(semanticSimilarity * 100).toFixed(1)}%`
      );
      console.error(`   📊 Common words: ${commonWords.length}`);
      console.error(
        `   ⚠️  WARNING: AI response has NO relation to the transcription!`
      );
      console.error(`   💡 This likely means:`);
      console.error(
        `      1. The transcription is completely wrong (poor audio quality/echo)`
      );
      console.error(
        `      2. The AI is responding to system prompt context instead of user speech`
      );
      console.error(
        `      3. There may be audio encoding/resampling issues causing transcription errors`
      );
      console.error(`   🔧 RECOMMENDED ACTIONS:`);
      console.error(`      - Check audio quality and encoding pipeline`);
      console.error(
        `      - Verify audio sample rate conversion (8kHz → 16kHz → 24kHz)`
      );
      console.error(`      - Check for echo/feedback in audio stream`);
      console.error(
        `      - Consider adjusting VAD threshold if speech detection is poor`
      );

      // Store this as a critical error for later analysis
      // In production, you might want to emit this as an event or log to monitoring system
    }

    // Check for common transcription errors that might be corrected by AI understanding
    const commonMismatches = [
      { wrong: "phone response", correct: "full refund" },
      { wrong: "phone refund", correct: "full refund" },
      { wrong: "partial refund", correct: "full refund" },
      { wrong: "no refund", correct: "full refund" },
      { wrong: "order number", correct: "order number" }, // This one is usually correct
    ];

    // Check if AI response contains phrases that suggest it understood something different
    let potentialMismatch = false;
    let suggestedCorrection = "";

    for (const mismatch of commonMismatches) {
      // If transcription contains the "wrong" phrase but AI response suggests the "correct" phrase
      if (
        transcriptLower.includes(mismatch.wrong) &&
        responseLower.includes(mismatch.correct)
      ) {
        potentialMismatch = true;
        suggestedCorrection = mismatch.correct;
        break;
      }
    }

    // Also check if AI response directly addresses something not in the transcription
    // For example, if AI says "I can issue a full refund" but transcription says "phone response"
    if (
      responseLower.includes("refund") &&
      !transcriptLower.includes("refund") &&
      (transcriptLower.includes("response") ||
        transcriptLower.includes("phone"))
    ) {
      potentialMismatch = true;
      suggestedCorrection = "refund";
    }

    if (potentialMismatch) {
      console.log(
        `⚠️⚠️⚠️ POTENTIAL TRANSCRIPTION ACCURACY ISSUE DETECTED ⚠️⚠️⚠️`
      );
      console.log(`   Raw Transcription: "${userTranscript}"`);
      console.log(`   AI Response: "${aiResponse}"`);
      console.log(
        `   💡 The AI's response suggests it understood: "${suggestedCorrection}"`
      );
      console.log(
        `   📝 This may indicate a transcription accuracy issue (accent, audio quality, etc.)`
      );
      console.log(
        `   ✅ The AI correctly understood the user's intent despite transcription inaccuracy`
      );
      console.log(
        `   🔍 Note: GPT-4o Realtime's understanding is often more accurate than its transcription`
      );
    } else if (commonWords.length > 0 && semanticSimilarity > 0.3) {
      // Log when transcription and response align well (for debugging)
      console.log(
        `✅ Transcription validation: AI response aligns with transcription`
      );
      console.log(
        `   Common context words: ${commonWords.slice(0, 5).join(", ")}`
      );
      console.log(
        `   Semantic similarity: ${(semanticSimilarity * 100).toFixed(1)}%`
      );
    }

    // Clean up old validation entries (older than 30 seconds)
    const now = Date.now();
    for (const [id, entry] of this.pendingTranscriptionValidation.entries()) {
      if (now - entry.timestamp > 30000) {
        this.pendingTranscriptionValidation.delete(id);
      }
    }
  }

  /**
   * Extract key semantic terms from text (removes common stop words)
   */
  private extractKeyTerms(text: string): string[] {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "is",
      "was",
      "are",
      "were",
      "been",
      "be",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "should",
      "could",
      "may",
      "might",
      "must",
      "can",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
      "me",
      "him",
      "her",
      "us",
      "them",
      "my",
      "your",
      "his",
      "her",
      "its",
      "our",
      "their",
      "what",
      "which",
      "who",
      "whom",
      "whose",
      "where",
      "when",
      "why",
      "how",
      "all",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "now",
      "then",
      "here",
      "there",
      "about",
      "after",
      "before",
      "during",
      "into",
      "through",
      "until",
      "while",
      "up",
      "down",
      "out",
      "off",
      "over",
      "under",
      "again",
      "further",
      "once",
      "also",
      "well",
      "say",
      "said",
      "get",
      "got",
      "go",
      "went",
      "come",
      "came",
      "know",
      "think",
      "see",
      "look",
      "want",
      "need",
      "take",
      "give",
      "make",
      "help",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));
  }

  /**
   * Calculate semantic similarity between two sets of key terms
   * Returns a value between 0 (no similarity) and 1 (identical)
   */
  private calculateSemanticSimilarity(
    terms1: string[],
    terms2: string[]
  ): number {
    if (terms1.length === 0 || terms2.length === 0) return 0;

    // Simple word overlap similarity
    const set1 = new Set(terms1);
    const set2 = new Set(terms2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    // Jaccard similarity
    return intersection.size / union.size;
  }

  /**
   * Assess transcription quality to detect nonsensical or poor transcriptions
   * Returns quality score and issues found
   */
  private assessTranscriptionQuality(transcript: string): {
    isValid: boolean;
    score: number;
    issues: string[];
    isNonsensical: boolean;
    hasUnusualPatterns: boolean;
  } {
    const issues: string[] = [];
    let score = 1.0;
    const transcriptLower = transcript.toLowerCase().trim();

    // Check for completely nonsensical patterns
    // Common patterns that indicate transcription errors:
    const nonsensicalPatterns = [
      // Unusual phrase patterns that don't make sense in customer service context
      /walk.*down.*chamber/i,
      /can i walk/i,
      /right down the/i,
    ];

    // Check for sequences of very short words, but exclude common valid phrases
    const shortWordSequencePattern = /\b\w{1,2}\s+\w{1,2}\s+\w{1,2}\b/;
    const hasShortWordSequence = shortWordSequencePattern.test(transcript);

    // Valid phrases that might match the short word pattern but are actually correct
    const validShortPhrases = [
      /it\s+to\s+be/i,
      /to\s+be/i,
      /i\s+am/i,
      /i\s+am\s+[a-z]/i,
      /so\s+you\s+want/i,
      /if\s+you\s+want/i,
      /as\s+you\s+can/i,
      /is\s+it\s+[a-z]/i,
      /do\s+you\s+want/i,
      /we\s+can\s+[a-z]/i,
      /we\s+will\s+[a-z]/i,
      /i\s+will\s+[a-z]/i,
      /i\s+can\s+[a-z]/i,
      /it\s+is\s+[a-z]/i,
      /it\s+was\s+[a-z]/i,
      /at\s+the\s+[a-z]/i,
      /in\s+the\s+[a-z]/i,
      /on\s+the\s+[a-z]/i,
      /of\s+the\s+[a-z]/i,
      /to\s+the\s+[a-z]/i,
      /for\s+the\s+[a-z]/i,
      /by\s+the\s+[a-z]/i,
      /or\s+the\s+[a-z]/i,
      /as\s+the\s+[a-z]/i,
      /if\s+the\s+[a-z]/i,
      /is\s+the\s+[a-z]/i,
      /are\s+the\s+[a-z]/i,
      /was\s+the\s+[a-z]/i,
      /were\s+the\s+[a-z]/i,
    ];

    const isValidShortPhrase = validShortPhrases.some((pattern) =>
      pattern.test(transcript)
    );

    // Only flag as nonsensical if it has short word sequence AND it's not a valid phrase
    const hasNonsensicalPattern =
      nonsensicalPatterns.some((pattern) => pattern.test(transcript)) ||
      (hasShortWordSequence && !isValidShortPhrase);

    // Check for unusual word patterns
    const words = transcriptLower.split(/\s+/);
    const unusualWordCount = words.filter((w) => {
      // Very short words (1-2 chars) that aren't common
      if (
        w.length <= 2 &&
        ![
          "i",
          "a",
          "an",
          "to",
          "of",
          "in",
          "on",
          "at",
          "it",
          "is",
          "as",
          "be",
          "we",
          "he",
          "me",
          "my",
          "up",
          "go",
          "no",
          "so",
          "do",
          "if",
          "or",
          "us",
          "am",
        ].includes(w)
      ) {
        return true;
      }
      return false;
    }).length;

    // Check for repetition of the same word (indicates stuttering or echo)
    const wordFreq: Record<string, number> = {};
    words.forEach((w) => {
      if (w.length > 3) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });
    const hasExcessiveRepetition = Object.values(wordFreq).some(
      (count) => count > 3
    );

    // Check for common English phrases vs random word combinations
    // Valid greetings/phrases in customer service context
    const validGreetings = [
      /hello/i,
      /hi/i,
      /hey/i,
      /good morning/i,
      /good afternoon/i,
      /good evening/i,
      /how can i help/i,
      /how may i help/i,
      /what can i do/i,
      /how are you/i,
      /thank you/i,
      /thanks/i,
      /you're welcome/i,
      /sure/i,
      /okay/i,
      /ok/i,
      /yes/i,
      /no/i,
      /please/i,
    ];

    const isCommonPhrase = validGreetings.some((pattern) =>
      pattern.test(transcript)
    );

    // Calculate score based on various factors
    if (hasNonsensicalPattern && !isCommonPhrase) {
      score -= 0.5;
      issues.push("Contains nonsensical patterns");
    }

    if (unusualWordCount > words.length * 0.3) {
      score -= 0.2;
      issues.push(
        `Too many unusual short words (${unusualWordCount}/${words.length})`
      );
    }

    if (hasExcessiveRepetition) {
      score -= 0.2;
      issues.push("Excessive word repetition (possible echo/stuttering)");
    }

    // Check if transcript makes semantic sense
    // If it's a greeting or common phrase, it's more likely valid
    if (!isCommonPhrase && words.length > 3) {
      // Check if words form a coherent sentence structure
      // Very basic check: common English words should be present
      const commonWords = [
        "the",
        "a",
        "an",
        "and",
        "or",
        "but",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "from",
        "is",
        "was",
        "are",
        "were",
        "this",
        "that",
        "what",
        "which",
        "who",
        "where",
        "when",
        "why",
        "how",
        "can",
        "could",
        "will",
        "would",
        "should",
        "may",
        "might",
        "must",
      ];

      const hasCommonWords = commonWords.some((cw) =>
        transcriptLower.includes(cw)
      );

      // If it's a longer phrase without common words, it might be nonsensical
      if (!hasCommonWords && words.length > 5) {
        score -= 0.3;
        issues.push("Lacks common English words (may be nonsensical)");
      }
    }

    // Check for extremely unlikely combinations
    // Example: "Can I walk right down the chamber, please?" when user likely said "hello, how can I help you"
    const unlikelyCombinations = [
      /walk.*chamber/i,
      /walk.*down/i,
      /chamber.*please/i,
    ];

    if (
      unlikelyCombinations.some((pattern) => pattern.test(transcript)) &&
      !isCommonPhrase
    ) {
      score -= 0.4;
      issues.push("Contains unlikely word combinations");
    }

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    // Transcription is invalid if score is very low (< 0.4) or has critical issues
    const isValid = score >= 0.4 && !hasNonsensicalPattern;

    return {
      isValid,
      score,
      issues,
      isNonsensical: hasNonsensicalPattern,
      hasUnusualPatterns: unusualWordCount > words.length * 0.2,
    };
  }

  private cleanup() {
    console.log("🧹 GPT-4o-Realtime: Cleaning up...");

    try {
      // Close Realtime API connection
      if (this.realtimeConnection) {
        // Just close the connection directly - don't send invalid session update
        this.realtimeConnection.close();
        this.realtimeConnection = null;
      }

      // Clear buffers
      this.audioBuffer = [];
      this.pendingAudioChunks = [];

      console.log("✅ GPT-4o-Realtime cleanup complete");
    } catch (error) {
      console.error("❌ Error during cleanup:", error);
    }
  }
}
