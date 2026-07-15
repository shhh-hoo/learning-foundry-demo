# DeepSeek local setup

Set server-side environment variables before `npm run demo:local`:

```text
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_THINKING_MODE=disabled
```

The model is mandatory external configuration and is never hardcoded in Agent core. Never use a `VITE_` prefix for the key, store it in browser storage, commit a local environment file, or include it in traces and logs.
