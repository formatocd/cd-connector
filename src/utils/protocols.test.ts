import { describe, expect, it } from "vitest";
import {
  defaultPortForProtocol,
  isFtpLike,
  isProtocol,
  protocolLabel,
} from "./protocols";

describe("protocols utilities", () => {
  it("validates protocol strings at runtime", () => {
    expect(isProtocol("sftp")).toBe(true);
    expect(isProtocol("ftps_implicit")).toBe(true);
    expect(isProtocol("ssh")).toBe(true);
    expect(isProtocol("http")).toBe(false);
    expect(isProtocol(123)).toBe(false);
    expect(isProtocol(null)).toBe(false);
  });

  it("returns expected default ports", () => {
    expect(defaultPortForProtocol("ftp")).toBe(21);
    expect(defaultPortForProtocol("ftps_explicit")).toBe(21);
    expect(defaultPortForProtocol("ftps_implicit")).toBe(990);
    expect(defaultPortForProtocol("sftp")).toBe(22);
    expect(defaultPortForProtocol("ssh")).toBe(22);
  });

  it("distinguishes FTP-like protocols from SFTP/SSH", () => {
    expect(isFtpLike("ftp")).toBe(true);
    expect(isFtpLike("ftps_explicit")).toBe(true);
    expect(isFtpLike("ftps_implicit")).toBe(true);
    expect(isFtpLike("sftp")).toBe(false);
    expect(isFtpLike("ssh")).toBe(false);
  });

  it("formats consistent protocol badges", () => {
    expect(protocolLabel("ftps_explicit")).toBe("FTPS");
    expect(protocolLabel("ftps_implicit")).toBe("FTPS-I");
    expect(protocolLabel("sftp")).toBe("SFTP");
  });
});
