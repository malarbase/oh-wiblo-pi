---
name: onboard-provider
description: Onboard a new model provider from an endpoint URL and API key
---

When the user asks to add a provider from a secrets file, endpoint URL, or API key:

1. If given a file path, read it and extract `base_url`/`baseUrl` and `api_key`/`apiKey`. Common formats:
   - Python: `base_url = "..."`, `api_key = "..."`
   - .env: `BASE_URL=...`, `API_KEY=...`
   - curl: `-H "Authorization: Bearer ..."`, URL argument
   - YAML/JSON: `baseUrl`/`base_url`, `apiKey`/`api_key`
   - Markdown code blocks with any of the above

2. Infer a provider name from the URL hostname or file context (e.g., `integrate.api.nvidia.com` → `nvidia`).

3. Run the probe script:
   ```
   bun run .omp/skills/onboard-provider/probe-provider.ts <inferred-name> <baseUrl> <apiKey>
   ```
   The script probes the endpoint's `/models` endpoint to auto-detect the API shape (openai-completions, anthropic-messages, etc.), auth mode, and available models, then writes the config to `~/.omp/agent/models.yml`.

4. Report the result to the user. If warnings were returned, explain them. The script outputs JSON with `providerName`, `modelsFound`, and `warnings`.

If the user provides only a URL (no key), ask for the API key. If they provide only a key, ask for the endpoint URL.
