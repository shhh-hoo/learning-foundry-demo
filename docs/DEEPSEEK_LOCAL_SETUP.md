# DeepSeek local setup

Export server-side environment variables before `npm run demo:local`:

```bash
export DEEPSEEK_API_KEY='replace-with-a-new-private-key'
export DEEPSEEK_MODEL='deepseek-chat'
export DEEPSEEK_BASE_URL='https://api.deepseek.com'
export DEEPSEEK_THINKING_MODE='disabled'
npm run demo:local
```

Alternatively, copy `.env.local.example` to `.env.local`. `demo:local` reads that gitignored file, accepts only the documented server-side keys, and gives shell exports precedence. It never prints the key.

The model is mandatory external configuration and is never hardcoded in Agent core. Never use a `VITE_` prefix for the key, store it in browser storage, commit `.env.local`, or include it in traces and logs. Revoke any key that has been pasted into chat or another exposed channel before live validation.

Agent runs default to `.local-data/agent-runs/`; Trainer diagnoses default to the sibling Trainer checkout’s `.local-data/diagnosis-traces/`; AgentEval runs default to `.local-data/agent-eval-runs/`. Override these with `TRACE_STORE_DIR`, `DIAGNOSIS_TRACE_STORE_DIR`, and `AGENT_EVAL_STORE_DIR` respectively.
