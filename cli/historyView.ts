import type { ModelMessage } from "../src/core/model";
import { quoteTerminal } from "./quote";

const DEFAULT_TURNS = 10;
const MAX_TURNS = 25;
const MAX_SEARCH_RESULTS = 10;
const MAX_QUERY_CHARS = 80;
const MAX_PREVIEW_CHARS = 120;
const USAGE = "Usage: /history | /history last <1-25> | /history find <text up to 80 characters>\n";

interface CompletedTurn {
  index: number;
  user: string;
  assistant: string;
}

function completedTurns(messages: readonly ModelMessage[]): CompletedTurn[] {
  const turns: CompletedTurn[] = [];
  for (let offset = 0; offset + 1 < messages.length; offset += 2) {
    const user = messages[offset];
    const assistant = messages[offset + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant" ||
        typeof user.content !== "string" || typeof assistant.content !== "string") continue;
    turns.push({ index: offset / 2 + 1, user: user.content, assistant: assistant.content });
  }
  return turns;
}

function preview(text: string): string {
  const characters = Array.from(text);
  const bounded = characters.length > MAX_PREVIEW_CHARS
    ? characters.slice(0, MAX_PREVIEW_CHARS).join("") + "…"
    : text;
  return quoteTerminal(bounded);
}

function displayTurns(turns: readonly CompletedTurn[]): string {
  return turns.map(turn =>
    `Turn ${turn.index}\n  User: ${preview(turn.user)}\n  Assistant: ${preview(turn.assistant)}\n`
  ).join("");
}

/**
 * Read-only inspection of complete local CLI conversation turns.
 * Never sends history to a model or uses filesystem, network, or tool privileges.
 * Quote all persisted content before displaying it in a terminal.
 */
export function renderHistoryCommand(input: string, messages: readonly ModelMessage[]): string | null {
  const command = input.trim();
  if (!/^\/history(?:\s|$)/.test(command)) return null;

  const turns = completedTurns(messages);
  if (command === "/history") {
    if (!turns.length) return "No completed turns in this session.\n";
    const visible = turns.slice(-DEFAULT_TURNS);
    return `History: ${turns.length} completed turns (showing last ${visible.length}):\n${displayTurns(visible)}`;
  }

  const last = /^\/history last (\d+)$/.exec(command);
  if (last) {
    const count = Number(last[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TURNS) return USAGE;
    if (!turns.length) return "No completed turns in this session.\n";
    const visible = turns.slice(-count);
    return `History: ${turns.length} completed turns (showing last ${visible.length}):\n${displayTurns(visible)}`;
  }

  const search = /^\/history find (.+)$/.exec(command);
  if (search) {
    const query = search[1].trim();
    if (!query || Array.from(query).length > MAX_QUERY_CHARS) return USAGE;
    const needle = query.toLowerCase();
    const matches = turns.filter(turn =>
      turn.user.toLowerCase().includes(needle) || turn.assistant.toLowerCase().includes(needle));
    if (!matches.length) return `No matching turns for ${quoteTerminal(query)}.\n`;
    const visible = matches.slice(-MAX_SEARCH_RESULTS);
    return `History search ${quoteTerminal(query)}: ${matches.length} matching turns (showing last ${visible.length}):\n${displayTurns(visible)}`;
  }

  return USAGE;
}
