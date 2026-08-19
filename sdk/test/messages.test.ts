/**
 * The host discards a malformed or unknown SendMessage payload without an
 * error, so the builders have to reject at the call site instead.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CHOICE_OPTIONS,
  SEND_MESSAGE_TYPES,
  choice,
  confirm,
  cursorAgent,
} from "../src/messages.js";

const BC_ID = "bc-bc53f4d2-8a37-4ca7-8e2e-4c2ef4e67852";

test("a bare string list becomes a valid widget payload", () => {
  assert.deepEqual(choice({ prompt: "Ship it?", options: ["Ship", "Hold"] }), {
    type: "widget",
    widget: { prompt: "Ship it?", options: [{ label: "Ship" }, { label: "Hold" }] },
  });
});

test("optional fields are omitted rather than sent as undefined", () => {
  // The host validates the object it receives; explicit undefined keys are not
  // the same as an absent key once this crosses JSON.
  const message = choice({ prompt: "Pick one", options: ["A"] });
  assert.deepEqual(Object.keys(message.widget), ["prompt", "options"]);
  assert.deepEqual(Object.keys(message.widget.options[0]), ["label"]);
});

test("every documented field survives in the order the host expects", () => {
  const message = choice({
    prompt: "Enable the remaining tools?",
    helpText: "CreateAgent signs on a new crewmate.",
    options: [
      { label: "Enable", value: "Enable them", description: "All three", style: "primary" },
      { label: "Leave blocked", style: "danger" },
    ],
    allowCustom: true,
    dismissOnMoveOn: false,
  });
  assert.equal(message.type, "widget");
  assert.equal(message.widget.helpText, "CreateAgent signs on a new crewmate.");
  assert.equal(message.widget.allowCustom, true);
  assert.equal(message.widget.dismissOnMoveOn, false);
  assert.deepEqual(message.widget.options[0], {
    label: "Enable",
    value: "Enable them",
    description: "All three",
    style: "primary",
  });
});

test("the option ceiling the host enforces is enforced here", () => {
  const options = Array.from({ length: MAX_CHOICE_OPTIONS }, (_, i) => `o${i}`);
  assert.equal(choice({ prompt: "p", options }).widget.options.length, MAX_CHOICE_OPTIONS);
  assert.throws(() => choice({ prompt: "p", options: [...options, "one too many"] }), RangeError);
});

test("empty and malformed input is refused, not silently shipped", () => {
  assert.throws(() => choice({ prompt: "", options: ["A"] }), TypeError);
  assert.throws(() => choice({ prompt: "p", options: [] }), TypeError);
  assert.throws(() => choice({ prompt: "p", options: [""] }), TypeError);
  assert.throws(() => choice({ prompt: "p", options: [{ label: "A", style: "loud" as never }] }), TypeError);
});

test("confirm is a yes/no card with the affirmative weighted", () => {
  const yes = confirm("Restart the host?");
  assert.deepEqual(yes.widget.options, [{ label: "Yes", style: "primary" }, { label: "No" }]);

  const destructive = confirm("Delete the branch?", { yes: "Delete", no: "Keep", danger: true });
  assert.deepEqual(destructive.widget.options, [
    { label: "Delete", style: "danger" },
    { label: "Keep" },
  ]);
});

test("cursorAgent only accepts a real run id", () => {
  assert.deepEqual(cursorAgent(BC_ID), { type: "cursor-agent", bcId: BC_ID });
  assert.deepEqual(cursorAgent(` ${BC_ID} `), { type: "cursor-agent", bcId: BC_ID });
  assert.throws(() => cursorAgent("bc-123"), TypeError);
  assert.throws(() => cursorAgent("https://cursor.com/agents/" + BC_ID), TypeError);
});

test("the exported type list matches what the host renders", () => {
  assert.deepEqual([...SEND_MESSAGE_TYPES], [
    "text",
    "attachment",
    "widget",
    "cursor-agent",
    "secret-request",
  ]);
});
