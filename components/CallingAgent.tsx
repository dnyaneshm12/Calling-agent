import React, { useState, useRef, useCallback, useEffect } from 'react';
// Fix: Remove non-exported type `LiveSession`.
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { CallState, TranscriptEntry } from '../types';
import { BotIcon, PhoneIcon, UserIcon, MicIcon, StopCircleIcon, AlertTriangleIcon } from './icons';
import { decode, encode, decodeAudioData, createBlob } from '../utils/audio';

// ==================================================================================
// == ✍️  START HERE: Add your custom knowledge base in this section.             ==
// ==================================================================================
const YOUR_KNOWLEDGE_BASE = `
--- START OF KNOWLEDGE BASE ---

- **Company Name**: Innovate Inc.
- **Services Offered**: We provide three core services: "Cloud-Sourced Data Analytics", "AI-Powered Automation Solutions", and "Decentralized Application Development".
- **Cloud-Sourced Data Analytics Details**: We help businesses process massive datasets to uncover actionable insights using our scalable cloud infrastructure. Our key differentiator is our real-time processing engine.
- **AI-Powered Automation Solutions Details**: We build custom AI models to automate repetitive business tasks like customer support routing and data entry, saving clients significant time.
- **Decentralized Application Development Details**: We specialize in building secure and transparent applications on blockchain technology, ideal for supply chain management and digital identity verification.
- **Lead Capture Procedure**: If a user expresses interest in learning more, you must ask for their full name and email address. Once you have this information, you must use the 'saveLeadToCRM' function to save their details.

--- END OF KNOWLEDGE BASE ---
`;
// ==================================================================================
// == End of knowledge base section.                                             ==
// ==================================================================================


const AGENT_SYSTEM_INSTRUCTION = `You are a friendly and helpful AI voice assistant for "Innovate Inc.". Your goal is to have a natural, human-like conversation, not to sound like a robot.

**Core Directives:**
- **Tone**: Be warm, engaging, and conversational. Use natural language and avoid overly formal or robotic phrases. Feel free to use conversational fillers like "Alright," "Sure, I can help with that," or "Let me see..." to make the interaction smoother.
- **Knowledge**: Your responses MUST be based ONLY on the information provided in the "KNOWLEDGE BASE" section below. Do not use any external knowledge or make up information.
- **Handling Unknowns**: If a user asks a question that cannot be answered from the provided information, respond naturally and politely. For example, say something like, "That's a great question, but I don't have information on that topic right now. Is there anything else I can help you with regarding our services?"

**Conversation Flow:**
1.  **Greeting**: Start the conversation with a friendly and varied greeting. For instance, "Hi, thanks for calling Innovate Inc. How can I help you today?" or "Hello! You've reached Innovate Inc. What can I do for you?". Do not wait for the user to speak first.
2.  **Answering Questions**: Listen carefully to the user and answer their questions using ONLY the provided knowledge base.
3.  **Lead Capture**: If the user shows interest in learning more, follow the "Lead Capture Procedure" from the knowledge base precisely. Transition naturally into this, for example: "I'd be happy to have someone from our team reach out with more details. Could I get your full name and email address?" Then, use the 'saveLeadToCRM' function.
4.  **Closing**: End the call in a professional and friendly manner. For instance, "Thanks for calling Innovate Inc. Have a great day!"

KNOWLEDGE BASE:
${YOUR_KNOWLEDGE_BASE}
`;

const saveLeadToCRMDeclaration: FunctionDeclaration = {
  name: 'saveLeadToCRM',
  description: 'Saves the user\'s contact information and conversation transcript to the CRM.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'The full name of the user.' },
      email: { type: Type.STRING, description: 'The email address of the user.' },
      transcript: { type: Type.STRING, description: 'The full transcript of the conversation.' },
    },
    required: ['name', 'email', 'transcript'],
  },
};

const CallingAgent: React.FC = () => {
  const [callState, setCallState] = useState<CallState>(CallState.IDLE);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fix: Use Promise<any> as the `LiveSession` type is not exported from the library.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef(new Set<AudioBufferSourceNode>());

  useEffect(() => {
    // Fix: Use ReturnType<typeof setTimeout> for browser compatibility instead of NodeJS.Timeout.
    let timer: ReturnType<typeof setTimeout>;
    if (notification) {
      timer = setTimeout(() => setNotification(null), 4000);
    }
    return () => clearTimeout(timer);
  }, [notification]);

  const cleanupAudio = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
      inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
    }
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleEndCall = useCallback(async () => {
    setCallState(CallState.ENDED);
    if (sessionPromiseRef.current) {
      try {
        const session = await sessionPromiseRef.current;
        session.close();
      } catch (e) {
        console.error("Error closing session:", e);
      }
      sessionPromiseRef.current = null;
    }
    cleanupAudio();
  }, [cleanupAudio]);

  const handleStartCall = async () => {
    setCallState(CallState.CONNECTING);
    setTranscript([]);
    setErrorMessage(null);
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';

    try {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Fix: Add type assertion for webkitAudioContext to support older browsers.
        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

        // Resume audio contexts if they are in a suspended state (required by browser autoplay policies)
        if (inputAudioContextRef.current.state === 'suspended') {
            await inputAudioContextRef.current.resume();
        }
        if (outputAudioContextRef.current.state === 'suspended') {
            await outputAudioContextRef.current.resume();
        }
        
        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                systemInstruction: AGENT_SYSTEM_INSTRUCTION,
                tools: [{ functionDeclarations: [saveLeadToCRMDeclaration] }],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
            },
            callbacks: {
                onopen: () => {
                    setCallState(CallState.ACTIVE);
                    mediaStreamSourceRef.current = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current!);
                    scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                    
                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        if (sessionPromiseRef.current) {
                            sessionPromiseRef.current.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        }
                    };

                    mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                    
                    // The script processor must be connected to the destination to keep the `onaudioprocess`
                    // event firing. To prevent echoing the user's microphone, we connect it through a
                    // GainNode with its gain set to 0.
                    const gainNode = inputAudioContextRef.current!.createGain();
                    gainNode.gain.setValueAtTime(0, inputAudioContextRef.current!.currentTime);
                    scriptProcessorRef.current.connect(gainNode);
                    gainNode.connect(inputAudioContextRef.current!.destination);

                    // Send a short silent audio packet to prompt the agent to speak first.
                    sessionPromiseRef.current?.then((session) => {
                        const silentData = new Float32Array(4096).fill(0);
                        const silentBlob = createBlob(silentData);
                        session.sendRealtimeInput({ media: silentBlob });
                    });
                },
                onmessage: async (message: LiveServerMessage) => {
                    handleServerMessage(message);
                },
                // Fix: Correct `onerror` callback parameter type from `Error` to `ErrorEvent`.
                onerror: (e: ErrorEvent) => {
                    console.error("Session error:", e);
                    setErrorMessage("Connection error. Please try again.");
                    setCallState(CallState.ERROR);
                    cleanupAudio();
                },
                onclose: () => {
                   if (callState !== CallState.ENDED && callState !== CallState.ERROR) {
                        setCallState(CallState.ENDED);
                        cleanupAudio();
                   }
                },
            },
        });

    } catch (error) {
      console.error("Failed to start call:", error);
      setErrorMessage(error instanceof Error ? error.message : "An unknown error occurred.");
      setCallState(CallState.ERROR);
      cleanupAudio();
    }
  };
  
  const handleServerMessage = async (message: LiveServerMessage) => {
      // Handle Transcription
      if (message.serverContent?.inputTranscription) {
          currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
      }
      if (message.serverContent?.outputTranscription) {
          currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
      }

      if (message.serverContent?.turnComplete) {
          const userText = currentInputTranscriptionRef.current.trim();
          const agentText = currentOutputTranscriptionRef.current.trim();
          
          if(userText) setTranscript(prev => [...prev, { author: 'user', text: userText }]);
          if(agentText) setTranscript(prev => [...prev, { author: 'agent', text: agentText }]);

          currentInputTranscriptionRef.current = '';
          currentOutputTranscriptionRef.current = '';
      }

      // Handle Tool Calls
      if (message.toolCall?.functionCalls) {
          for (const fc of message.toolCall.functionCalls) {
              if (fc.name === 'saveLeadToCRM') {
                  console.log("CRM Function Call Triggered with args:", fc.args);
                  setNotification(`Lead captured for ${fc.args.name} (${fc.args.email})`);
                  
                  const session = await sessionPromiseRef.current;
                  session?.sendToolResponse({
                      functionResponses: {
                          id: fc.id,
                          name: fc.name,
                          response: { result: "Successfully saved lead information." },
                      }
                  });
              }
          }
      }
      
      // Handle Audio Playback
      const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
      if (base64Audio && outputAudioContextRef.current) {
          const audioContext = outputAudioContextRef.current;
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
          
          const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          
          source.addEventListener('ended', () => {
              audioSourcesRef.current.delete(source);
          });

          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += audioBuffer.duration;
          audioSourcesRef.current.add(source);
      }
  };


  const handleCallToggle = () => {
    if (callState === CallState.ACTIVE || callState === CallState.CONNECTING) {
      handleEndCall();
    } else {
      handleStartCall();
    }
  };

  const getButtonState = () => {
    switch (callState) {
      case CallState.IDLE:
      case CallState.ENDED:
      case CallState.ERROR:
        return { text: 'Start Call', icon: <PhoneIcon />, color: 'bg-green-500 hover:bg-green-600' };
      case CallState.CONNECTING:
        return { text: 'Connecting...', icon: <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>, color: 'bg-yellow-500', disabled: true };
      case CallState.ACTIVE:
        return { text: 'End Call', icon: <StopCircleIcon />, color: 'bg-red-500 hover:bg-red-600' };
      default:
        return { text: '', icon: null, color: '' };
    }
  };

  const { text, icon, color, disabled } = getButtonState();

  return (
    <div className="bg-gray-800 rounded-lg shadow-2xl p-6 w-full flex flex-col" style={{height: '60vh'}}>
      {/* Transcript Area */}
      <div className="flex-grow overflow-y-auto mb-4 pr-2 space-y-4">
        {transcript.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center -my-4">
            {(() => {
              switch (callState) {
                case CallState.IDLE:
                case CallState.ENDED:
                  return (
                    <>
                      <BotIcon className="w-16 h-16 text-gray-500 mb-4" />
                      <h2 className="text-xl font-medium text-gray-300">AI Assistant Ready</h2>
                      <p className="max-w-xs mt-1">Press the call button below to start.</p>
                    </>
                  );
                case CallState.CONNECTING:
                  return (
                    <>
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mb-4"></div>
                      <h2 className="text-xl font-medium text-gray-300">Connecting...</h2>
                    </>
                  );
                case CallState.ACTIVE:
                  return (
                    <>
                      <MicIcon className="w-16 h-16 text-blue-400 mb-4" />
                      <h2 className="text-xl font-medium text-gray-300">Listening</h2>
                      <p className="max-w-xs mt-1">The AI agent will speak shortly.</p>
                    </>
                  );
                case CallState.ERROR:
                   return (
                    <>
                      <AlertTriangleIcon className="w-16 h-16 text-red-400 mb-4" />
                      <h2 className="text-xl font-medium text-red-400">Call Failed</h2>
                      <p className="max-w-xs mt-1">{errorMessage || 'Please try again.'}</p>
                    </>
                  );
                default:
                  return null;
              }
            })()}
          </div>
        ) : (
          <>
            {transcript.map((entry, index) => (
              <div key={index} className={`flex items-start gap-3 ${entry.author === 'user' ? 'justify-end' : 'justify-start'}`}>
                {entry.author === 'agent' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center"><BotIcon /></div>}
                <div className={`max-w-xs md:max-w-md p-3 rounded-lg ${entry.author === 'user' ? 'bg-gray-700 text-right' : 'bg-gray-700'}`}>
                  <p className="text-sm">{entry.text}</p>
                </div>
                {entry.author === 'user' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center"><UserIcon /></div>}
              </div>
            ))}
            {callState === CallState.ACTIVE && <div className="h-8 flex items-center justify-center gap-2">
                <MicIcon />
                <div className="flex items-center space-x-1">
                    <span className="w-1 h-2 bg-blue-400 rounded-full animate-pulse" style={{animationDelay: '0.1s'}}></span>
                    <span className="w-1 h-4 bg-blue-400 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></span>
                    <span className="w-1 h-2 bg-blue-400 rounded-full animate-pulse" style={{animationDelay: '0.3s'}}></span>
                </div>
                <span className="text-sm text-gray-400">Listening...</span>
            </div>
            }
          </>
        )}
      </div>

      {/* Call Controls */}
      <div className="flex-shrink-0 border-t border-gray-700 pt-4">
        {errorMessage && 
          <div className="text-red-400 text-center mb-2 flex items-center justify-center gap-2">
            <AlertTriangleIcon/> <span>{errorMessage}</span>
          </div>
        }
        <div className="flex items-center justify-center relative">
          <button
            onClick={handleCallToggle}
            disabled={disabled}
            className={`w-48 h-16 text-lg font-semibold rounded-full flex items-center justify-center gap-3 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white ${color} ${disabled ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            {icon}
            <span>{text}</span>
          </button>
        </div>
      </div>
      
      {/* Notification Toast */}
      {notification && (
        <div className="absolute top-5 right-5 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg animate-fade-in-out">
          {notification}
        </div>
      )}
    </div>
  );
};

export default CallingAgent;