# MicroPilot — Lightweight Edge-Only AI Assistant

A mobile-first Progressive Web Application that runs **zero-shot text classification** entirely on-device using **MobileBERT-MNLI** via Transformers.js + ONNX Runtime Web.

**No backend. No cloud inference. No external AI APIs.** All user text stays in the browser.

## Features

- **On-device zero-shot classification** with `Xenova/mobilebert-uncased-mnli` (quantized ~27 MB)
- Intent classification (Question, Technical question, Sentiment analysis, etc.)
- Sentiment detection (positive / negative / neutral)
- Local deterministic utilities: word/char/sentence counts, keyword extraction, complexity heuristic, case transforms
- Exact-match IndexedDB cache with hit/miss tracking and expiry
- Real measured performance dashboard (download time, init time, inference latency, cache stats)
- Installable PWA with offline app shell + model asset caching
- Privacy-first: never transmits prompts or conversation data

## Tech Stack

- React 19 + TypeScript + Vite 6
- `@huggingface/transformers` (Transformers.js)
- ONNX Runtime Web (managed by Transformers.js)
- IndexedDB via `idb`
- `vite-plugin-pwa` + Workbox

## Project Structure

```
micropilot/
├── public/
│   ├── models/          # reserved (models downloaded dynamically)
│   ├── manifest.webmanifest
│   └── favicon.svg
├── src/
│   ├── App.tsx          # main UI
│   ├── main.tsx
│   ├── style.css
│   ├── model.ts         # Transformers.js pipeline + metrics
│   ├── processor.ts     # analysis orchestration + local heuristics
│   └── cache.ts         # IndexedDB exact-match cache
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

## Quick Start

```bash
npm install
npm run dev
```

Open the printed local URL (preferably on a phone or with mobile emulation).

On first **Analyze**, the quantized MobileBERT model (~27 MB) is downloaded from Hugging Face and cached by the browser / service worker. Subsequent loads and offline use reuse the cache.

## Production Build

```bash
npm run build
npm run preview
```

Output is a static SPA suitable for any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, etc.).

### Vercel

```bash
npx vercel --prod
```

No serverless functions required. Ensure the project is configured as a static Vite app.

## Model Details

| Property        | Value                                      |
|-----------------|--------------------------------------------|
| Model           | MobileBERT-MNLI                            |
| ID              | `Xenova/mobilebert-uncased-mnli`           |
| Task            | Zero-shot classification                   |
| Default artifact| `onnx/model_quantized.onnx` (~27 MB)       |
| Runtime         | Transformers.js + ONNX Runtime Web (WASM)  |

**Important:** This is a classification model, not a generative LLM. It cannot produce free-form answers, summaries, or chat replies. The UI clearly labels deterministic vs AI operations.

## Offline Behaviour

1. App shell is cached by the service worker after first visit.
2. Model weights are cached (CacheFirst) on first successful download.
3. After both are present the app works offline for classification + utilities.
4. Conversation history is kept only in memory + IndexedDB (not in the service worker).

## Privacy

- User text never leaves the device for inference.
- Only network activity is the initial model download (and any CDN assets for the app itself).
- Cache and metrics live in IndexedDB / memory.

## Browser Support

Modern Chromium-based browsers (Android Chrome recommended), Safari 16.4+, Firefox with WASM support. WebGPU is not required; WASM fallback is used.

## License

MIT
