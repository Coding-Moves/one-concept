import { describe, expect, it } from "vitest";
import { callbackUrl, emailReturn } from "./publicAccountLink";

describe("public account email callbacks", () => {
  it("accepts only its exact callback path and ignores external return destinations", () => {
    expect(emailReturn(new URL("https://example.test/account#access_token=x&refresh_token=y"))).toEqual({ kind: "none" });
    expect(emailReturn(new URL("https://example.test/account/callback#access_token=x&refresh_token=y&type=signup"))).toEqual({
      kind: "session", accessToken: "x", refreshToken: "y", type: "signup",
    });
    expect(callbackUrl("https://example.test")).toBe("https://example.test/account/callback");
  });

  it("rejects errors and incomplete or malformed callback credentials", () => {
    expect(emailReturn(new URL("https://example.test/account/callback#error=access_denied&access_token=x&refresh_token=y"))).toEqual({ kind: "error" });
    expect(emailReturn(new URL("https://example.test/account/callback#access_token=x"))).toEqual({ kind: "error" });
    expect(emailReturn(new URL("https://example.test/account/callback?code=abc"))).toEqual({ kind: "code", code: "abc", type: "" });
  });
});
