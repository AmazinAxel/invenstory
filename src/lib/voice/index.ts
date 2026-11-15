// Picks the engines for a saved voice config. Only ElevenLabs exists today; another provider adds
// a case here plus its own file implementing SttEngine / TtsEngine (see types.ts).

import { elevenStt, elevenTts } from './elevenlabs.ts';
import type { SttEngine, TtsEngine, VoiceConfig } from './types.ts';

export function createEngines(cfg: VoiceConfig): { stt: SttEngine; tts: TtsEngine } {
  switch (cfg.provider) {
    case 'elevenlabs':
      return { stt: elevenStt(cfg), tts: elevenTts(cfg) };
  }
}
