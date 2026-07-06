import { describe, expect, test } from "bun:test";

import { buildArgs, releaseName } from "../scripts/build";

describe("build script contract", () => {
  test("builds the exact Windows x64 compile arguments for a release", () => {
    expect(buildArgs("vot-2.4.12-r2")).toEqual([
      "build",
      "--compile",
      "--target=bun-windows-x64-baseline",
      "--define",
      "VOT_HELPER_RELEASE='vot-2.4.12-r2'",
      "src/vot-helper.ts",
      "--outfile",
      "dist/vot-helper.exe",
    ]);
  });

  test("allows development and immutable vot release names", () => {
    expect(releaseName({ VOT_HELPER_RELEASE: "development" })).toBe(
      "development",
    );
    expect(releaseName({ VOT_HELPER_RELEASE: "vot-2.4.12-r10" })).toBe(
      "vot-2.4.12-r10",
    );
  });

  test("rejects missing or malformed release names", () => {
    expect(() => releaseName({})).toThrow("VOT_HELPER_RELEASE");
    expect(() =>
      releaseName({ VOT_HELPER_RELEASE: "2.4.12" }),
    ).toThrow("VOT_HELPER_RELEASE");
  });
});
