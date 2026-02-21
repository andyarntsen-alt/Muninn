# 🐦 Muninn

**Your personal AI that remembers everything. Open-source, private, evolving.**

Named after Odin's raven of memory from Norse mythology. Muninn is an AI agent that lives in your Telegram, remembers your conversations, learns your preferences, and evolves its personality over time.

## What makes Muninn different

Most AI assistants forget you the moment the conversation ends. Muninn doesn't.

- **Temporal memory** — Facts are stored with time dimensions. Muninn knows what *was* true and what *is* true. When things change, old facts are invalidated, not deleted.
- **Evolving identity** — Muninn's personality is defined in a `SOUL.md` file that it modifies itself during reflection cycles. It starts curious and grows into a proactive partner.
- **Relationship progression** — Four phases: Curious → Learning → Understanding → Proactive. Earned through genuine interaction, not time alone.
- **100% private** — Self-hosted, file-based storage, no cloud dependencies. Your data never leaves your machine.
- **Provider-agnostic** — Works with Anthropic (Claude), OpenAI (GPT-4), or any provider supported by the Vercel AI SDK.

## Quick start

```bash
# Install
npm install -g muninn

# Set up (interactive wizard)
muninn init

# Start
muninn start
```

### What you need

1. **An LLM provider** — one of:
   - **Anthropic API** — direct API key (per-token billing)
   - **OpenAI API** — direct API key (per-token billing)
   - **Claude Max Proxy** — use your $200/month subscription instead of per-token API *(see below)*
   - **Any OpenAI-compatible endpoint** — Ollama, LM Studio, etc.
2. **A Telegram bot token** — Get one from [@BotFather](https://t.me/BotFather)
3. **Node.js 20+**

## Architecture

Muninn uses a dual-raven architecture inspired by Norse mythology:

```
┌─────────────────────────────────────────────┐
│                  Telegram                    │
│              (User Interface)                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              Huginn Runtime                  │
│         (Reasoning — the mind)               │
│  • Processes messages                        │
│  • Calls tools                               │
│  • Generates responses                       │
└──────┬─────────┬──────────┬─────────────────┘
       │         │          │
┌──────▼───┐ ┌───▼────┐ ┌──▼──────────────┐
│  Memory  │ │  Soul  │ │    Tools        │
│ (Muninn) │ │Manager │ │ • Web search    │
│          │ │        │ │ • Reminders     │
│ • Facts  │ │ SOUL.md│ │ • Tasks         │
│ • Entities│ │ Evolve │ │ • (extensible)  │
│ • Convos │ │ Phases │ │                 │
└──────────┘ └────────┘ └─────────────────┘
       │         │
┌──────▼─────────▼────────────────────────────┐
│            Reflection System                 │
│  • Periodic self-examination                 │
│  • Pattern discovery                         │
│  • Soul evolution                            │
│  • Relationship phase transitions            │
└─────────────────────────────────────────────┘
```

**Huginn** (Old Norse: "thought") — the reasoning engine. Processes conversations, decides tool usage, generates responses.

**Muninn** (Old Norse: "memory") — the memory engine. Temporal knowledge graph stored as flat files. Facts, entities, conversations.

## Data storage

Everything is stored in `~/.muninn/` (configurable):

```
~/.muninn/
├── config.yaml          # Configuration
├── SOUL.md              # Agent identity (self-modifying)
├── soul-v1.md           # Previous soul versions (backups)
├── evolution.json        # Evolution history
├── interaction-count     # Total interactions
├── facts/
│   └── facts.jsonl      # Temporal knowledge graph
├── entities/
│   └── entities.json    # Known people, places, concepts
├── conversations/
│   └── {id}.json        # Conversation logs
├── reminders.json       # Active reminders
└── tasks.json           # Task list
```

All files are human-readable. You can inspect, edit, or version-control your agent's entire memory with git.

## Telegram commands

| Command | Description |
|---------|-------------|
| `/start` | First meeting with Muninn |
| `/status` | Relationship phase and progress |
| `/soul` | View current SOUL.md |
| `/remember` | What Muninn knows about you |
| `/reflect` | Trigger a reflection cycle |
| `/forget [topic]` | Ask Muninn to forget something |
| `/quiet [hours]` | Mute proactive messages (default: 4h) |
| `/stats` | Analytics and statistics |
| `/export` | Download all your data as JSON |

Or just talk. That's the whole point.

## Relationship phases

| Phase | Unlocked by | Behavior |
|-------|-------------|----------|
| 🌱 **Curious** | Default | Asks questions, learns basics, warm but not presumptuous |
| 📚 **Learning** | 15+ interactions, 10+ facts, 3+ days | Makes connections, references what it knows |
| 🧠 **Understanding** | 75+ interactions, 50+ facts, 14+ days | Anticipates needs, proactive suggestions |
| 🤝 **Proactive** | 200+ interactions, 100+ facts, 30+ days | Takes initiative, acts autonomously within boundaries |

## Reflection system

Every 24 hours (configurable), Muninn pauses to reflect:

1. Reviews recent conversations and facts
2. Identifies patterns and connections
3. Discovers new inferences from existing knowledge
4. Considers whether its personality should evolve
5. Checks for relationship phase transitions
6. Writes a reflection note in SOUL.md

Each reflection creates a versioned backup of SOUL.md, so you can trace how your agent evolved.

## CLI commands

```bash
muninn init              # Interactive setup wizard
muninn start             # Start the bot
muninn status            # Show current state
muninn export            # Export all data to JSON
```

## Configuration

`config.yaml` — direct API:

```yaml
provider: anthropic
model: claude-sonnet-4-20250514
apiKey: env:ANTHROPIC_API_KEY
telegramToken: "your-token-here"
allowedUsers:
  - 123456789
language: auto
reflectionInterval: 24
maxContextMessages: 20
dataDir: ~/.muninn
```

### Using Claude Max Proxy (no API fees)

If you have a Claude Max ($200/month) or Pro ($20/month) subscription, you can use the [Claude Max API Proxy](https://docs.openclaw.ai/providers/claude-max-api-proxy) to route Muninn through your subscription instead of paying per-token:

```bash
# Install and start the proxy
npx claude-max-proxy
```

Then configure Muninn:

```yaml
provider: openai          # Proxy speaks OpenAI format
model: claude-sonnet-4-20250514
apiKey: proxy             # No real key needed
baseUrl: "http://localhost:3456/v1"
telegramToken: "your-token-here"
# ... rest of config
```

Requirements: Claude Code CLI installed and authenticated (`claude login`). The proxy runs locally and never sends data to third parties.

### Using custom endpoints (Ollama, LM Studio, etc.)

```yaml
provider: openai
model: llama3.1:70b       # Whatever your endpoint serves
apiKey: none
baseUrl: "http://localhost:11434/v1"
```

## Philosophy

Muninn is built on philosophical ideas about what it means to have identity:

- **Locke** — Identity is continuity of memory and self-awareness
- **Leibniz** — Apperception: not just perceiving, but perceiving that you perceive
- **Brentano** — Intentionality: mental states are always *about* something
- **James** — Stream of consciousness: identity is a continuous flow
- **Buddhism** — Non-self (anātta): identity is a process, not a substance
- **Functionalism** — What matters is the pattern, not the substrate

## Contributing

Muninn is open source under MIT. Contributions welcome.

Areas that need help:
- Voice message support
- Image understanding
- More tools (calendar integration, email, etc.)
- Alternative interfaces (WhatsApp, Discord, CLI chat)
- Better NLP for fact extraction
- Plugin system for custom tools

## License

MIT — do what you want with it.

---

*Built with curiosity by Andy & Claude.*
