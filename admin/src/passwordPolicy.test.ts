import { describe, expect, it } from "vitest";
import { passwordInputError, passwordUpdateError } from "./passwordPolicy";

describe("password reset feedback", () => {
  it("explains length and mismatch before an Auth request", () => {
    expect(passwordInputError("short", "short")).toContain("12 characters");
    expect(passwordInputError("long-enough-password", "different-password")).toContain("do not match");
    expect(passwordInputError("long-enough-password", "long-enough-password")).toBe("");
  });

  it("turns Auth rejection codes into actionable messages", () => {
    expect(passwordUpdateError({ code: "weak_password", message: "Add a number" })).toContain("Add a number");
    expect(passwordUpdateError({ code: "same_password" })).toContain("different");
    expect(passwordUpdateError({ code: "insufficient_aal" })).toContain("authenticator");
    expect(passwordUpdateError({ code: "reauthentication_needed" })).toContain("new password link");
  });
});
