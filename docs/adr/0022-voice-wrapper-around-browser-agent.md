# D22. Voice mode wraps the browser agent (ElevenLabs, key per device)

- **Decision:** Two-way voice is a thin layer around the existing chat agent ("approach A"): ElevenLabs realtime
  transcription turns speech into an ordinary `chat.send()` (marked as a voice turn by one hidden text part,
  `VOICE_MARK`, like the dashboard snapshot), and ElevenLabs streaming text-to-speech reads the streamed reply aloud
  sentence by sentence. Both are called straight from the browser with a key pasted into the Voice card (Automations tab) and kept in
  IndexedDB (`K.voice`); without a saved key the feature is invisible. Engines sit behind two small interfaces
  (`SttEngine`, `TtsEngine` in `src/lib/voice/types.ts`); only ElevenLabs is implemented.
- **Why:** The agent loop, tools, safety gate and persistence already work and are what the product guarantees; a
  speech-to-speech agent platform (for example ElevenLabs Agents) would need its own tool wiring and would bypass the
  gate and the replayed history. Wrapping keeps one brain and changes nothing in `loop.ts`, `prompt.ts` (prompt
  caching, thinking-signature binding), `policy.ts` or `gate.ts`. The voice hint lives in the user message rather
  than the system prompt for the same reason as D10. The LLM, not speech, is the slow part of a voice turn
  (published latency: about 100 ms Flash v2.5, about 150 ms to a committed transcript), so streaming the reply into
  speech per sentence is where latency is won. ElevenLabs answers CORS for `xi-api-key` and issues single-use tokens
  for browser WebSockets, so no server is needed. A per-device developer key fits the demo use; end users are never
  asked for an ElevenLabs account.
- **Details:** PCM (`pcm_24000`) through WebAudio instead of `<audio>` with `blob:` URLs, so the CSP needs no
  `media-src`; the capture AudioWorklet is a same-origin file (`public/voice-capture.js`) because the CSP allows no
  `blob:` scripts. Production headers now allow the microphone for the app's origin and `wss://api.elevenlabs.io`.
  Hands-free is half-duplex (silence is sent while the reply plays). Questions spoken during a run get one quick,
  tool-less LLM call shown as an ephemeral "quick answer"; it is never persisted and never enters the history.
