# opencode-effort-router

An OpenCode 2 plugin that selects a reasoning effort for configured models with the OpenRouter Decisions API. It ports the cache-preserving Anthropic Messages and OpenAI Responses adapters from `pi-effort-router`.

## Configure

### Install from a local Git clone

Clone the plugin, install its build dependencies, and build it. Replace `<clone-url>` with the Git URL for this repository. The example keeps the plugin beside the project that contains `opencode.jsonc`:

```sh
git clone <clone-url> ../opencode-effort-router
cd ../opencode-effort-router
npm install --include=dev
npm run build
```

Add the local path to the `plugins` array in your project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      // Resolve this path relative to this opencode.jsonc file.
      "package": "../opencode-effort-router",
      "options": {
        "model": "inception/mercury-decide",
        "timeoutMs": 4000,
        "maxContextChars": 12000,
        "targets": [
          {
            "providerID": "anthropic",
            "modelID": "claude-opus-5-5",
            "wire": "anthropic-messages",
            "choices": ["low", "medium", "high"]
          },
          {
            "providerID": "openai",
            "modelID": "gpt-6-astra",
            "wire": "openai-responses",
            "choices": ["low", "medium", "high"]
          }
        ]
      }
    }
  ]
}
```

Use an absolute path or adjust `../opencode-effort-router` if your clone is elsewhere. After changing the plugin source, rebuild it with `npm run build`; restart OpenCode to load the change.

Use the provider IDs and model IDs from your OpenCode model catalog. `targets` is an exact allowlist: other models are untouched. `wire` selects the provider request adapter. If omitted, `choices` defaults to `low`, `medium`, `high`, `xhigh`, and `max`; set only efforts accepted by that model.

Set `OPENROUTER_API_KEY`, or pass `apiKey` in the plugin options. The API key is sent only as the bearer credential to `https://openrouter.ai/api/alpha/decisions`. `model` selects the OpenRouter Decisions model and defaults to `typesafe/jev-1.13`.

`enabled` defaults to `true`. `timeoutMs` must be from 100 to 60000. `maxContextChars` must be from 200 to 200000. Invalid options fail plugin setup.

## Cache-preserving effort changes

The plugin intercepts OpenCode 2's provider HTTP request after the provider has serialized it. It does not change the session's request-level effort setting.

- **Anthropic Messages:** keeps top-level `output_config.effort` stable and carries the selected effort in a trailing content-less system message. It merges the mid-conversation effort beta and replays earlier effort messages. Adaptive requests that cannot safely use this protocol are left unchanged.
- **OpenAI Responses:** pins top-level `reasoning.effort` to the session baseline and inserts `configuration_update` items at the correct input boundaries. It replays earlier updates. Requests using provider truncation/context management, deltas, existing updates, or unsupported reasoning are left unchanged.

The plugin stores only model IDs, effort values, and SHA-256 prefix fingerprints in OpenCode plugin storage. It does not persist prompt text, credentials, or request bodies. Retries at an already-recorded boundary reuse the same effort.

## Session commands

Use `/effort-router off` to disable routing for the current session, `/effort-router on` to enable it, or `/effort-router status` to read the stored override. Overrides are isolated by OpenCode session ID and persist through server restarts. Global `enabled: false` takes precedence.

OpenCode 2's server command API does not provide a direct toast or command-output channel. These commands update the session setting without injecting a chat message or making an extra model request.

## Data sent to OpenRouter

For configured models, the plugin sends a bounded transcript containing user and assistant text, tool names, and tool-result excerpts (up to 400 characters each). It excludes system/developer messages, images, reasoning blocks, and tool-call arguments. Tool output can contain secrets; do not enable routing if that data must not be sent to OpenRouter.

## Development

```sh
npm install
npm run check
```

Tests are offline and do not require OpenRouter credentials.
