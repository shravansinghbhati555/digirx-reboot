import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { Icon } from './Icon';
import { useToast } from './primitives';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  lang?: string;
}

export function VoiceInput({ onTranscript, lang = 'en-IN' }: VoiceInputProps) {
  const toast = useToast();

  const { isListening, supported, start, stop } = useSpeechRecognition({
    lang,
    onTranscript,
    onError: (msg) => {
      toast(msg, 'error');
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent accidental form submissions or default actions
    if (!supported) {
      toast('Speech recognition is not supported in this browser.', 'error');
      return;
    }
    if (isListening) {
      stop();
    } else {
      start();
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {isListening && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--danger-500)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            animation: 'fadeIn 0.2s ease',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: 'var(--danger-500)',
              display: 'inline-block',
              animation: 'bulletPulse 1s infinite alternate',
            }}
          />
          Listening...
        </span>
      )}
      <button
        type="button"
        onClick={handleClick}
        title={isListening ? 'Stop dictation' : 'Start Dictation'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 8,
          border: isListening ? '1.5px solid var(--danger-500)' : '1.5px solid var(--border)',
          background: isListening ? 'rgba(239, 68, 68, 0.08)' : 'var(--surface)',
          color: isListening ? 'var(--danger-500)' : 'var(--text-subtle)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          animation: isListening ? 'micPulse 1.5s infinite' : 'none',
          outline: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isListening) {
            e.currentTarget.style.borderColor = 'var(--brand-400)';
            e.currentTarget.style.color = 'var(--brand-500)';
            e.currentTarget.style.background = 'var(--brand-50)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isListening) {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text-subtle)';
            e.currentTarget.style.background = 'var(--surface)';
          }
        }}
      >
        <Icon name="mic" size={14} />
      </button>
      <style>{`
        @keyframes micPulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          70% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes bulletPulse {
          from { opacity: 0.4; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1.1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(2px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
