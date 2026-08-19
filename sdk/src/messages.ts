/**
 * Builders for the richer Grok Bot `SendMessage` payloads.
 *
 * `SendMessage` takes a `type` that decides what the user actually sees, and
 * the interesting ones carry structure the host validates. Hand-writing that
 * object is easy to get subtly wrong, and the failure is silent: an unknown
 * `type`, or a shape the host rejects, is discarded without an error and the
 * user simply sees nothing.
 *
 * These builders return the exact object `SendMessage` expects, and throw on
 * the constraints the host enforces, so a mistake surfaces where it was made.
 */

/** Message types the host renders. An unknown type is dropped silently. */
export const SEND_MESSAGE_TYPES = [
  "text",
  "attachment",
  "widget",
  "cursor-agent",
  "secret-request",
] as const;

export type SendMessageType = (typeof SEND_MESSAGE_TYPES)[number];

/** Visual weight of a choice. `danger` is for the destructive option. */
export type ChoiceStyle = "default" | "primary" | "danger";

export type ChoiceOption = {
  /** Button text. */
  label: string;
  /**
   * What is sent back as the user's reply when this is picked. Defaults to the
   * label; write it as something they would naturally say, because it becomes
   * their message in the transcript.
   */
  value?: string;
  /** Optional second line under the label. */
  description?: string;
  style?: ChoiceStyle;
};

export type ChoiceInput = {
  /** The question. Phrase it as a question, not a menu instruction. */
  prompt: string;
  /** 1-6 options. */
  options: ReadonlyArray<ChoiceOption | string>;
  /** Optional help line under the prompt. */
  helpText?: string;
  /** Let the user type their own answer instead of picking. */
  allowCustom?: boolean;
  /**
   * Auto-dismiss the card if the user sends a newer message without answering.
   * Only for low-stakes questions that go moot; leave it off for a decision you
   * still need an answer to.
   */
  dismissOnMoveOn?: boolean;
};

export type ChoiceMessage = {
  type: "widget";
  widget: {
    prompt: string;
    helpText?: string;
    options: Array<{ label: string; value?: string; description?: string; style?: ChoiceStyle }>;
    allowCustom?: boolean;
    dismissOnMoveOn?: boolean;
  };
};

export type CursorAgentMessage = { type: "cursor-agent"; bcId: string };

export type SecretRequestInput = {
  /**
   * What credential to ask for. Shown as the card title and echoed in the
   * field placeholder ("Paste your …"), e.g. "Slack bot token".
   */
  label: string;
  /**
   * The connector the secret belongs to. The value is written to that
   * connector's per-agent credential file.
   */
  connector: string;
  /** The credential field to store the value under, e.g. "token". */
  field: string;
  /** Optional short help under the label. */
  description?: string;
};

export type SecretRequestMessage = {
  type: "secret-request";
  secret: { label: string; connector: string; field: string; description?: string };
};

/** The host accepts at most this many options on one card. */
export const MAX_CHOICE_OPTIONS = 6;

const CHOICE_STYLES: ReadonlySet<string> = new Set<ChoiceStyle>(["default", "primary", "danger"]);
const BC_ID = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

/**
 * Build a multiple-choice card.
 *
 * The user picks one option and its `value` comes back as their reply, so this
 * replaces asking a multiple-choice question in prose and then parsing the
 * answer. A dismissal is reported as a decline: treat it as "no" and do not
 * re-ask.
 *
 * ```ts
 * choice({ prompt: "Ship it?", options: ["Ship", "Hold"] });
 * choice({
 *   prompt: "Enable the remaining tools?",
 *   helpText: "CreateAgent lets an agent sign on a new crewmate.",
 *   options: [
 *     { label: "Enable", value: "Enable them", style: "primary" },
 *     { label: "Leave blocked", style: "danger" },
 *   ],
 *   allowCustom: true,
 * });
 * ```
 */
export function choice(input: ChoiceInput): ChoiceMessage {
  const prompt = requireText(input?.prompt, "choice prompt");
  if (!Array.isArray(input?.options) || input.options.length === 0) {
    throw new TypeError("choice requires at least one option.");
  }
  if (input.options.length > MAX_CHOICE_OPTIONS) {
    throw new RangeError(
      `choice accepts at most ${MAX_CHOICE_OPTIONS} options; got ${input.options.length}.`,
    );
  }

  const options = input.options.map((option, index) => {
    if (typeof option === "string") return { label: requireText(option, `option ${index} label`) };
    const label = requireText(option?.label, `option ${index} label`);
    const value = optionalText(option?.value, `option ${index} value`);
    const description = optionalText(option?.description, `option ${index} description`);
    if (option?.style !== undefined && !CHOICE_STYLES.has(option.style)) {
      throw new TypeError(
        `option ${index} style must be one of: ${[...CHOICE_STYLES].join(", ")}.`,
      );
    }
    return {
      label,
      ...(value === undefined ? {} : { value }),
      ...(description === undefined ? {} : { description }),
      ...(option?.style === undefined ? {} : { style: option.style }),
    };
  });

  const helpText = optionalText(input.helpText, "choice helpText");
  return {
    type: "widget",
    widget: {
      prompt,
      ...(helpText === undefined ? {} : { helpText }),
      options,
      ...(input.allowCustom === undefined ? {} : { allowCustom: Boolean(input.allowCustom) }),
      ...(input.dismissOnMoveOn === undefined
        ? {}
        : { dismissOnMoveOn: Boolean(input.dismissOnMoveOn) }),
    },
  };
}

/** Shorthand for a yes/no card. The affirmative is styled `primary`. */
export function confirm(
  prompt: string,
  options: { yes?: string; no?: string; helpText?: string; danger?: boolean } = {},
): ChoiceMessage {
  return choice({
    prompt,
    helpText: options.helpText,
    options: [
      { label: options.yes ?? "Yes", style: options.danger ? "danger" : "primary" },
      { label: options.no ?? "No" },
    ],
  });
}

/**
 * Ask the user for a credential through a masked secure input.
 *
 * The value goes straight to the connector's per-agent credential file: it
 * never reaches the agent, the transcript, or the chat. You only learn that it
 * was provided. That is the whole point of this type, and the reason there is
 * deliberately no parameter here for the secret itself — this builder describes
 * what to ask for, and cannot carry a value even by mistake.
 *
 * Use it instead of asking for a token in a normal message. A secret pasted
 * into chat is stored in the transcript, is readable by anything that can read
 * the transcript, and cannot be un-sent.
 *
 * ```ts
 * secretRequest({
 *   label: "Slack bot token",
 *   connector: "slack",
 *   field: "token",
 *   description: "Starts with xoxb-",
 * });
 * ```
 */
export function secretRequest(input: SecretRequestInput): SecretRequestMessage {
  const label = requireText(input?.label, "secretRequest label");
  const connector = requireText(input?.connector, "secretRequest connector");
  const field = requireText(input?.field, "secretRequest field");
  const description = optionalText(input?.description, "secretRequest description");
  return {
    type: "secret-request",
    secret: {
      label,
      connector,
      field,
      ...(description === undefined ? {} : { description }),
    },
  };
}

/**
 * Reference a Cursor cloud agent so it renders as a card that opens the run in
 * Cursor. Launching one does not emit this: send it yourself once the launch
 * returns a bcId, or the user is left with a bare URL.
 */
export function cursorAgent(bcId: string): CursorAgentMessage {
  const id = requireText(bcId, "cursorAgent bcId");
  if (!BC_ID.test(id.trim())) {
    throw new TypeError(`cursorAgent expects a bc-<uuid> id; got ${JSON.stringify(bcId)}.`);
  }
  return { type: "cursor-agent", bcId: id.trim() };
}
