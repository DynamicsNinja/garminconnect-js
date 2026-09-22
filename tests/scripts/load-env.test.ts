import { describe, it, expect } from "vitest";
import { parseDotEnv } from "../../scripts/load-env.js";

describe("parseDotEnv", () => {

  it("returns empty object when given empty content", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("", testEnv);
    expect(result).toEqual({});
    expect(testEnv).toEqual({});
  });

  it("loads a simple KEY=value pair", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("TEST_KEY=test_value", testEnv);
    expect(result).toEqual({ TEST_KEY: "test_value" });
    expect(testEnv.TEST_KEY).toBe("test_value");
  });

  it("handles a value containing =", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("TEST_KEY=value=with=equals", testEnv);
    expect(result).toEqual({ TEST_KEY: "value=with=equals" });
    expect(testEnv.TEST_KEY).toBe("value=with=equals");
  });

  it("strips double quotes from values", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv('TEST_KEY="quoted value"', testEnv);
    expect(result).toEqual({ TEST_KEY: "quoted value" });
    expect(testEnv.TEST_KEY).toBe("quoted value");
  });

  it("strips single quotes from values", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("TEST_KEY='quoted value'", testEnv);
    expect(result).toEqual({ TEST_KEY: "quoted value" });
    expect(testEnv.TEST_KEY).toBe("quoted value");
  });

  it("does not strip partial quotes", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv('TEST_KEY="unmatched', testEnv);
    expect(result).toEqual({ TEST_KEY: '"unmatched' });
    expect(testEnv.TEST_KEY).toBe('"unmatched');
  });

  it("skips blank lines", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("KEY1=value1\n\n\nKEY2=value2", testEnv);
    expect(result).toEqual({ KEY1: "value1", KEY2: "value2" });
    expect(testEnv.KEY1).toBe("value1");
    expect(testEnv.KEY2).toBe("value2");
  });

  it("skips comment lines", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("# This is a comment\nKEY=value\n# Another comment", testEnv);
    expect(result).toEqual({ KEY: "value" });
    expect(testEnv.KEY).toBe("value");
  });

  it("skips lines with # at the start after whitespace", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("  # indented comment\nKEY=value", testEnv);
    expect(result).toEqual({ KEY: "value" });
    expect(testEnv.KEY).toBe("value");
  });

  it("does not override already-set env variables", () => {
    const testEnv: Record<string, string | undefined> = {
      EXISTING_KEY: "original",
    };

    const result = parseDotEnv("EXISTING_KEY=new_value\nNEW_KEY=new_value", testEnv);

    expect(result).toEqual({ NEW_KEY: "new_value" });
    expect(testEnv.EXISTING_KEY).toBe("original");
    expect(testEnv.NEW_KEY).toBe("new_value");
  });

  it("ignores malformed lines with no =", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("MALFORMED_LINE\nVALID_KEY=valid_value", testEnv);
    expect(result).toEqual({ VALID_KEY: "valid_value" });
    expect(testEnv.VALID_KEY).toBe("valid_value");
    expect(testEnv.MALFORMED_LINE).toBeUndefined();
  });

  it("trims whitespace around keys and values", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("  KEY_WITH_SPACES  =  value with spaces  ", testEnv);
    expect(result).toEqual({ KEY_WITH_SPACES: "value with spaces" });
    expect(testEnv.KEY_WITH_SPACES).toBe("value with spaces");
  });

  it("handles empty keys gracefully", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv("=value\nVALID_KEY=valid_value", testEnv);
    expect(result).toEqual({ VALID_KEY: "valid_value" });
    expect(testEnv.VALID_KEY).toBe("valid_value");
  });

  it("preserves quotes that are not matched", () => {
    const testEnv: Record<string, string | undefined> = {};
    const result = parseDotEnv('TEST_KEY=value"with"quotes', testEnv);
    expect(result).toEqual({ TEST_KEY: 'value"with"quotes' });
    expect(testEnv.TEST_KEY).toBe('value"with"quotes');
  });

  it("handles multiple variables", () => {
    const testEnv: Record<string, string | undefined> = {};
    const content = "KEY1=value1\nKEY2=value2\nKEY3=value3";
    const result = parseDotEnv(content, testEnv);
    expect(result).toEqual({
      KEY1: "value1",
      KEY2: "value2",
      KEY3: "value3",
    });
  });

  it("handles multiple keys with comments and blank lines", () => {
    const testEnv: Record<string, string | undefined> = {};
    const content = "# Setup env\nKEY1=value1\n\n# More vars\nKEY2=value2";
    const result = parseDotEnv(content, testEnv);
    expect(result).toEqual({
      KEY1: "value1",
      KEY2: "value2",
    });
  });
});
