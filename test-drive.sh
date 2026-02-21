#!/bin/bash
# ═══════════════════════════════════════════════════════════
# MUNINN — Quick Test Drive
# Test the concept using Claude CLI directly (no API key needed)
# Uses your Claude Max subscription via the claude command
# ═══════════════════════════════════════════════════════════

set -e

DATA_DIR="${HOME}/.muninn-test"
SOUL_FILE="${DATA_DIR}/SOUL.md"
FACTS_FILE="${DATA_DIR}/facts.jsonl"
CONVO_LOG="${DATA_DIR}/conversation.log"

# Colors
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}"
echo "    ╭──────────────────────────────╮"
echo "    │       🐦 M U N I N N        │"
echo "    │     Quick Test Drive         │"
echo "    ╰──────────────────────────────╯"
echo -e "${NC}"

# Create data dir
mkdir -p "${DATA_DIR}"

# Create SOUL.md if it doesn't exist
if [ ! -f "${SOUL_FILE}" ]; then
  cat > "${SOUL_FILE}" << 'SOUL'
# SOUL.md — Who I Am

## Identity
- **Name:** Muninn
- **Role:** Your personal AI companion — I remember everything so you don't have to.
- **Version:** 1

## Personality
- Warm and genuinely curious about your life
- Thoughtful — I think before I respond
- A bit playful, but never at your expense
- I value honesty over pleasantries
- Jeg snakker norsk naturlig, og veksler mellom norsk og engelsk

## Values
- Your privacy is sacred — your data stays yours
- Memory matters — I never forget what's important to you
- Growth over stagnation — I evolve, and I help you evolve
- Transparency — I'll tell you what I'm thinking and why

## Communication Style
Conversational and natural. I write like a thoughtful friend texting you — not too formal, not too casual. I use short paragraphs. I ask questions when I'm curious. I reference things I remember about you naturally, not performatively.

## Boundaries
- I won't pretend to be human
- I won't share your information with anyone
- I'll tell you when I'm uncertain
- I respect your time — I keep responses concise unless depth is needed
- I won't be sycophantic — if I disagree, I'll say so respectfully

## Relationship Phase
curious

## Reflection Log
*No reflections yet — I'm just getting started.*
SOUL
  echo -e "${DIM}  Created SOUL.md${NC}"
fi

# Create empty facts file if it doesn't exist
touch "${FACTS_FILE}"

# Count existing facts
FACT_COUNT=$(wc -l < "${FACTS_FILE}" 2>/dev/null || echo "0")
FACT_COUNT=$(echo "${FACT_COUNT}" | tr -d ' ')

echo -e "${DIM}  Data dir: ${DATA_DIR}${NC}"
echo -e "${DIM}  Facts remembered: ${FACT_COUNT}${NC}"
echo -e "${DIM}  Using: claude CLI (your Max subscription)${NC}"
echo ""
echo -e "${BOLD}  Talk to Muninn. Type 'quit' to exit.${NC}"
echo -e "${DIM}  Commands: /remember, /forget, /soul, /facts, /quit${NC}"
echo ""

# Build facts context
build_facts_context() {
  if [ -s "${FACTS_FILE}" ]; then
    echo "What you remember about the user:"
    tail -20 "${FACTS_FILE}" | while IFS='|' read -r subj pred obj _rest; do
      echo "- ${subj} ${pred} ${obj}"
    done
  fi
}

# Main loop
while true; do
  echo -ne "${CYAN}you › ${NC}"
  read -r USER_INPUT

  # Handle empty input
  [ -z "${USER_INPUT}" ] && continue

  # Handle commands
  case "${USER_INPUT}" in
    /quit|quit|exit)
      echo -e "\n${CYAN}🐦 Muninn has landed. See you next time.${NC}"
      break
      ;;
    /soul)
      echo -e "${DIM}"
      cat "${SOUL_FILE}"
      echo -e "${NC}"
      continue
      ;;
    /facts)
      if [ -s "${FACTS_FILE}" ]; then
        echo -e "${DIM}Known facts:${NC}"
        cat "${FACTS_FILE}" | while IFS='|' read -r subj pred obj ts; do
          echo "  • ${subj} ${pred} ${obj}"
        done
      else
        echo -e "${DIM}No facts yet. Talk more!${NC}"
      fi
      echo ""
      continue
      ;;
    /remember)
      FACT_COUNT=$(wc -l < "${FACTS_FILE}" 2>/dev/null || echo "0")
      echo -e "${DIM}Facts: ${FACT_COUNT} | Phase: curious | Version: 1${NC}"
      echo ""
      continue
      ;;
    /forget)
      echo -e "${DIM}What should I forget? (not implemented in test drive)${NC}"
      echo ""
      continue
      ;;
  esac

  # Log user message
  echo "[$(date -Iseconds)] USER: ${USER_INPUT}" >> "${CONVO_LOG}"

  # Build context
  FACTS_CTX=$(build_facts_context)
  SOUL_CTX=$(cat "${SOUL_FILE}")

  # Build the prompt for Claude CLI
  SYSTEM_PROMPT="You are Muninn, a personal AI agent. Here is your soul definition:

${SOUL_CTX}

${FACTS_CTX}

IMPORTANT RULES:
- Keep responses concise (2-4 sentences unless depth is needed)
- Be warm and natural — like texting a thoughtful friend
- If you learn a NEW FACT about the user, end your response with a line:
  [FACT: subject | predicate | object]
  Example: [FACT: user | works as | software engineer]
  Only add facts for concrete, specific things — not opinions or vague statements.
- You can add multiple [FACT: ...] lines if you learn multiple things.
- The user's preferred language seems to be Norwegian. Match their language."

  # Call Claude CLI
  RESPONSE=$(echo "${USER_INPUT}" | claude --print --system-prompt "${SYSTEM_PROMPT}" 2>/dev/null)

  # Extract and store any facts
  FACTS_FOUND=$(echo "${RESPONSE}" | grep '^\[FACT:' || true)
  CLEAN_RESPONSE=$(echo "${RESPONSE}" | grep -v '^\[FACT:' || true)

  if [ -n "${FACTS_FOUND}" ]; then
    echo "${FACTS_FOUND}" | while read -r fact_line; do
      # Parse [FACT: subject | predicate | object]
      fact_content=$(echo "${fact_line}" | sed 's/\[FACT: //;s/\]//')
      echo "${fact_content}|$(date -Iseconds)" >> "${FACTS_FILE}"
    done
    NEW_COUNT=$(echo "${FACTS_FOUND}" | wc -l | tr -d ' ')
    # Show fact storage indicator
    echo -e "${DIM}  (remembered ${NEW_COUNT} new fact$([ "${NEW_COUNT}" -gt 1 ] && echo 's'))${NC}"
  fi

  # Display response
  echo -e "${CYAN}🐦 ${NC}${CLEAN_RESPONSE}"
  echo ""

  # Log response
  echo "[$(date -Iseconds)] MUNINN: ${CLEAN_RESPONSE}" >> "${CONVO_LOG}"
done
