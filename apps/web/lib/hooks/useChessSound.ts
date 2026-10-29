import { useCallback, useRef, useEffect, useState } from 'react';
import { mediaUrl } from '@/lib/media';

type SoundType = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'game-start' | 'game-end' | 'illegal' | 'tenseconds' | 'notify';

const SOUND_FILES: Record<SoundType, string> = {
  'move': mediaUrl('/sounds/move.webm'),
  'capture': mediaUrl('/sounds/capture.webm'),
  'check': mediaUrl('/sounds/check.webm'),
  'castle': mediaUrl('/sounds/castle.webm'),
  'promote': mediaUrl('/sounds/promote.webm'),
  'game-start': mediaUrl('/sounds/game-start.webm'),
  'game-end': mediaUrl('/sounds/game-end.webm'),
  'illegal': mediaUrl('/sounds/illegal.webm'),
  'tenseconds': mediaUrl('/sounds/tenseconds.webm'),
  'notify': mediaUrl('/sounds/notify.webm'),
};

const MUTE_STORAGE_KEY = 'chess-sound-muted';

export function useChessSound() {
  const audioCache = useRef<Map<SoundType, HTMLAudioElement>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const hasPlayedTenSecondWarning = useRef(false);

  // Load mute preference from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const stored = localStorage.getItem(MUTE_STORAGE_KEY);
    if (stored === 'true') {
      setIsMuted(true);
      isMutedRef.current = true;
    }
  }, []);

  // Preload all sounds on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    Object.entries(SOUND_FILES).forEach(([type, src]) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audioCache.current.set(type as SoundType, audio);
    });

    return () => {
      audioCache.current.clear();
    };
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newValue = !prev;
      isMutedRef.current = newValue;
      if (typeof window !== 'undefined') {
        localStorage.setItem(MUTE_STORAGE_KEY, String(newValue));
      }
      return newValue;
    });
  }, []);

  const playSound = useCallback((type: SoundType) => {
    if (typeof window === 'undefined') return;
    if (isMutedRef.current) return;

    const audio = audioCache.current.get(type);
    if (audio) {
      // Reset to start if already playing
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Ignore autoplay errors (user hasn't interacted yet)
      });
    }
  }, []);

  // Helper to determine which sound to play based on SAN notation
  // Priority: Check → Capture → Castle → Promote → Move
  const playSoundForMove = useCallback((san: string) => {
    // Check for check or checkmate (+ or #)
    if (san.includes('+') || san.includes('#')) {
      playSound('check');
      return;
    }

    // Check for capture (x in notation)
    if (san.includes('x')) {
      playSound('capture');
      return;
    }

    // Check for castling (O-O or O-O-O)
    if (san === 'O-O' || san === 'O-O-O') {
      playSound('castle');
      return;
    }

    // Check for promotion (= in notation)
    if (san.includes('=')) {
      playSound('promote');
      return;
    }

    // Regular move
    playSound('move');
  }, [playSound]);

  // Check if ten second warning should play
  const checkTenSecondWarning = useCallback((timeInSeconds: number) => {
    if (timeInSeconds < 10 && !hasPlayedTenSecondWarning.current) {
      hasPlayedTenSecondWarning.current = true;
      playSound('tenseconds');
    }
  }, [playSound]);

  // Reset the ten second warning (call when game starts or resets)
  const resetTenSecondWarning = useCallback(() => {
    hasPlayedTenSecondWarning.current = false;
  }, []);

  return {
    playSound,
    playSoundForMove,
    checkTenSecondWarning,
    resetTenSecondWarning,
    toggleMute,
    isMuted,
  };
}
