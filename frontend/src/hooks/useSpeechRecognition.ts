import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseSpeechRecognitionOptions {
  lang?: string;
  onTranscript?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export function useSpeechRecognition({
  lang = 'en-IN',
  onTranscript,
  onError,
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Cache callbacks using refs to prevent recreating the SpeechRecognition object
  // on every render if the callbacks are not memoized by the caller.
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    setSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = false; // Stops automatically when speech ends
    recognition.interimResults = false;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      const resultIndex = event.resultIndex;
      const transcript = event.results[resultIndex][0].transcript;
      if (onTranscriptRef.current) {
        onTranscriptRef.current(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      let msg = 'Speech recognition error';
      switch (event.error) {
        case 'not-allowed':
        case 'permission-denied':
          msg = 'Microphone permission denied';
          break;
        case 'no-speech':
          msg = 'No speech detected';
          break;
        case 'audio-capture':
          msg = 'No microphone found';
          break;
        case 'network':
          msg = 'Network error during speech recognition';
          break;
        default:
          msg = `Error: ${event.error}`;
          break;
      }
      setError(msg);
      if (onErrorRef.current) {
        onErrorRef.current(msg);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [lang]);

  const start = useCallback(() => {
    if (!supported || !recognitionRef.current) return;
    if (isListening) return;
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
    }
  }, [supported, isListening]);

  const stop = useCallback(() => {
    if (!supported || !recognitionRef.current) return;
    if (!isListening) return;
    try {
      recognitionRef.current.stop();
    } catch (e) {
      console.error('Failed to stop speech recognition:', e);
    }
  }, [supported, isListening]);

  return {
    isListening,
    supported,
    error,
    start,
    stop,
  };
}
