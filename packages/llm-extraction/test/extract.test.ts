import { describe, expect, it, vi } from "vitest";
import type { ExtractionClient, ExtractionMessageParams, ExtractionResponse } from "../src/client.js";
import {
  DesignParamsExtractionError,
  NeedsClarificationError,
  extractDesignParams,
  parseExtractionResponse,
} from "../src/extract.js";
import { CLARIFY_TOOL_NAME, TOOL_NAME } from "../src/prompt.js";

const VALID_PARAMS = {
  designPattern: "smb-flat",
  siteName: "Fake Client Test",
  intentSummary: "One router, one switch, one firewall.",
  router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
  accessSwitch: { count: 1, vendorHint: "cisco-ios" },
  firewall: { present: true, vendorHint: "fortinet-fortigate" },
  vlans: [{ name: "corp", purpose: "user", dhcp: true }],
  assumptions: [],
};

function fakeClient(response: ExtractionResponse): ExtractionClient & { createMessage: ReturnType<typeof vi.fn> } {
  return { createMessage: vi.fn().mockResolvedValue(response) };
}

describe("parseExtractionResponse", () => {
  it("parses a valid tool_use block into DesignParams", () => {
    const params = parseExtractionResponse({
      content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_PARAMS }],
    });
    expect(params.siteName).toBe("Fake Client Test");
    expect(params.router.count).toBe(1);
  });

  it("throws DesignParamsExtractionError when no tool_use block is present", () => {
    expect(() => parseExtractionResponse({ content: [{ type: "text", text: "I have a question first." }] })).toThrow(
      DesignParamsExtractionError,
    );
  });

  it("throws DesignParamsExtractionError with a human-readable reason when the tool input fails validation", () => {
    try {
      parseExtractionResponse({
        content: [{ type: "tool_use", name: TOOL_NAME, input: { designPattern: "dc-leaf-spine" } }],
      });
      expect.unreachable("expected parseExtractionResponse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DesignParamsExtractionError);
      expect((err as Error).message).toContain("failed validation");
    }
  });

  it("ignores tool_use blocks for a different tool name", () => {
    expect(() =>
      parseExtractionResponse({ content: [{ type: "tool_use", name: "some_other_tool", input: VALID_PARAMS }] }),
    ).toThrow(DesignParamsExtractionError);
  });

  it("throws NeedsClarificationError with the questions when Claude calls the clarify tool", () => {
    try {
      parseExtractionResponse({
        content: [
          {
            type: "tool_use",
            name: CLARIFY_TOOL_NAME,
            input: { questions: ["How many routers do you need?", "Is redundancy required?"] },
          },
        ],
      });
      expect.unreachable("expected parseExtractionResponse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NeedsClarificationError);
      expect((err as NeedsClarificationError).questions).toEqual([
        "How many routers do you need?",
        "Is redundancy required?",
      ]);
    }
  });

  it("throws DesignParamsExtractionError when the clarify tool's input fails validation", () => {
    expect(() =>
      parseExtractionResponse({ content: [{ type: "tool_use", name: CLARIFY_TOOL_NAME, input: { questions: [] } }] }),
    ).toThrow(DesignParamsExtractionError);
  });
});

describe("extractDesignParams", () => {
  it("calls the client offering both tools (some tool call forced, not a specific one) and returns the parsed params", async () => {
    const client = fakeClient({ content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_PARAMS }] });

    const result = await extractDesignParams("One router, one switch, one firewall.", { client });

    expect(result.siteName).toBe("Fake Client Test");
    expect(client.createMessage).toHaveBeenCalledTimes(1);
    const call = client.createMessage.mock.calls[0]![0] as ExtractionMessageParams;
    expect(call.toolChoice).toEqual({ type: "any" });
    expect(call.tools.map((tool) => tool.name)).toEqual([TOOL_NAME, CLARIFY_TOOL_NAME]);
    expect(call.messages).toEqual([{ role: "user", content: "One router, one switch, one firewall." }]);
  });

  it("defaults to the claude-sonnet-5 model but allows an override", async () => {
    const client = fakeClient({ content: [{ type: "tool_use", name: TOOL_NAME, input: VALID_PARAMS }] });

    await extractDesignParams("prose", { client });
    expect((client.createMessage.mock.calls[0]![0] as ExtractionMessageParams).model).toBe("claude-sonnet-5");

    await extractDesignParams("prose", { client, model: "claude-opus-4-8" });
    expect((client.createMessage.mock.calls[1]![0] as ExtractionMessageParams).model).toBe("claude-opus-4-8");
  });

  it("propagates DesignParamsExtractionError when the client's response doesn't validate", async () => {
    const client = fakeClient({ content: [{ type: "text", text: "no tool call" }] });
    await expect(extractDesignParams("prose", { client })).rejects.toThrow(DesignParamsExtractionError);
  });

  it("propagates NeedsClarificationError when Claude asks a clarifying question instead", async () => {
    const client = fakeClient({
      content: [{ type: "tool_use", name: CLARIFY_TOOL_NAME, input: { questions: ["How many sites?"] } }],
    });
    await expect(extractDesignParams("build me a network", { client })).rejects.toThrow(NeedsClarificationError);
  });
});
