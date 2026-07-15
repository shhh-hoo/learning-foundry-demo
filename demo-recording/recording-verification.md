# Recording verification

## Artifact

- File: `demo-recording/learning-foundry-product-demo-zh.mp4`
- Duration: 184.000 seconds (3:04)
- Video codec: H.264
- Pixel format: yuv420p
- Resolution: 1920 × 1080
- Frame rate: 30 fps
- Audio: none
- Subtitles: complete Simplified Chinese captions burned into the video
- Size: 11,232,698 bytes
- SHA-256: `cd43f7ac95c31cf77f590ff9473591164681408c8523723a209fe10367ab326e`

Metadata was verified with `ffprobe`. Subtitle rendering and scene alignment were checked from decoded frames at 00:05, 01:00, 01:25, 02:30, 02:45, and 03:00.

## Recording method

1. `npm run demo:local` started Foundry on 4173 and Standard Trainer on 4174.
2. Playwright drove local Google Chrome at a 1920 × 1080 viewport.
3. One continuous Playwright video recorded the real clicks, scrolling, navigation, state changes, and transition from Foundry to Trainer.
4. ffmpeg trimmed the capture to 3:04, converted it to 30 fps, burned the Chinese captions with the system Heiti SC font, encoded H.264/yuv420p, and moved the MP4 metadata to the beginning for playback.

This is a local interaction-state walkthrough rather than a GitHub Pages recording. It has no narration because a quality-controlled Chinese TTS voice was not available; `narration-zh.md` preserves the full voiceover script.

## Verified interaction sequence

1. Open Product Experience Chat.
2. Confirm the learner’s 4.00 g MgO message.
3. Confirm CAIE 9701 retrieval, capability route, published component, routing reason, and local Trainer URL.
4. Diagnose and receive `FORMULA / WRONG_STOICHIOMETRIC_RATIO`.
5. Open Library and confirm evidence plus worked correction.
6. Open Schedule, mark the delayed retry complete, then reopen it.
7. Open Component Lifecycle and confirm three seeded evidence traces.
8. Promote the pattern and navigate to Governance.
9. Confirm the `1.1.0` draft, source IDs, `NOT RUN`, and disabled approval.
10. Run all 15 checks and confirm `PASSED`.
11. Approve and publish the component.
12. Return to Library and confirm `stoichiometric-product-mass@1.1.0`.
13. Open local Standard Trainer.
14. Select the MASS component, enter ratio `0.5` and value `4 g`, and confirm `FORMULA / WRONG_STOICHIOMETRIC_RATIO`.

## Browser health

- Foundry: meaningful content, no Vite overlay, no console errors.
- Standard Trainer: meaningful content, no Vite overlay, deterministic diagnosis present. The sibling app requests no favicon asset, producing one harmless favicon 404; no runtime or interaction failed.
