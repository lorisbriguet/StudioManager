import { describe, it, expect } from "vitest";
import { bambuCodeSecret, bambuPasswordSecret, parseBambuError } from "../lib/upkeep/bambu";

describe("Bambu Lab setup helpers", () => {
  it("recognises a needed or wrong emailed code", () => {
    expect(parseBambuError("code_required")).toEqual({ kind: "code", invalid: false });
    expect(parseBambuError(new Error("code_invalid"))).toEqual({ kind: "code", invalid: true });
  });

  it("recognises an expired sign-in", () => {
    expect(parseBambuError("token_expired")).toEqual({ kind: "signin" });
  });

  it("recognises a refused password, an authenticator-app account and a too-long history", () => {
    expect(parseBambuError("password_invalid")).toEqual({ kind: "password" });
    expect(parseBambuError("tfa_unsupported")).toEqual({ kind: "tfa" });
    expect(parseBambuError("history_too_long")).toEqual({ kind: "history" });
  });

  it("passes other errors through", () => {
    expect(parseBambuError("Bambu Lab refused the email or password")).toEqual({
      kind: "other", message: "Bambu Lab refused the email or password",
    });
  });

  it("builds the one-time Keychain secrets: the password or the code, never both", () => {
    expect(JSON.parse(bambuPasswordSecret("pw"))).toEqual({ password: "pw" });
    expect(JSON.parse(bambuCodeSecret(" 123 456 "))).toEqual({ code: "123456" });
  });
});
