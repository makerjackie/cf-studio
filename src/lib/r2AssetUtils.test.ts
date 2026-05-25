import { describe, expect, it } from "vitest";
import {
  buildPublicUrl,
  buildUploadPrefix,
  copyOutputLinesForKeys,
  datePrefix,
  fileNameFromKey,
  fileNameFromPath,
  fileNameFromUrl,
  formatCopyOutput,
  markdownImageLines,
  normalizePrefix,
  planUploadSources,
  prepareUploadPlan,
  publicUrlLines,
  sortR2Objects,
} from "@/lib/r2AssetUtils";
import type { R2Object } from "@/lib/r2";

const objects: R2Object[] = [
  { key: "assets/b.png", size: 20, uploaded: "2026-01-02T00:00:00Z", etag: "b" },
  { key: "assets/a.jpg", size: 10, uploaded: "2026-01-01T00:00:00Z", etag: "a" },
  { key: "assets/readme.txt", size: 5, uploaded: "2026-01-03T00:00:00Z", etag: "c" },
];

describe("r2AssetUtils", () => {
  it("builds encoded public URLs and markdown image lines", () => {
    expect(buildPublicUrl("https://assets.example.com/", "blog/hello world.png")).toBe(
      "https://assets.example.com/blog/hello%20world.png"
    );
    expect(markdownImageLines(objects, "https://assets.example.com")).toBe(
      "![b.png](https://assets.example.com/assets/b.png)\n![a.jpg](https://assets.example.com/assets/a.jpg)"
    );
    expect(publicUrlLines(objects.slice(0, 2), "https://assets.example.com")).toContain("assets/b.png");
  });

  it("formats upload copy output as URL, Markdown, or HTML", () => {
    const url = "https://assets.example.com/blog/hello world.png";
    expect(formatCopyOutput(url, "blog/hello world.png", "url")).toBe(url);
    expect(formatCopyOutput(url, "blog/hello world.png", "markdown")).toBe(
      "![hello world.png](https://assets.example.com/blog/hello world.png)"
    );
    expect(formatCopyOutput(url, "blog/hello world.png", "html")).toBe(
      '<img src="https://assets.example.com/blog/hello world.png" alt="hello world.png" />'
    );
    expect(formatCopyOutput("https://assets.example.com/readme.txt", "readme.txt", "markdown")).toBe(
      "[readme.txt](https://assets.example.com/readme.txt)"
    );
  });

  it("builds one copied upload output per successful key", () => {
    expect(copyOutputLinesForKeys(
      ["assets/a.jpg", "assets/b.png"],
      "https://assets.example.com",
      "markdown"
    )).toBe(
      "![a.jpg](https://assets.example.com/assets/a.jpg)\n![b.png](https://assets.example.com/assets/b.png)"
    );
    expect(copyOutputLinesForKeys(["assets/a.jpg"], null, "url")).toBe("");
  });

  it("normalizes prefixes and date prefixes", () => {
    expect(normalizePrefix("/blog")).toBe("blog/");
    expect(normalizePrefix("")).toBe("");
    expect(datePrefix(new Date("2026-05-25T12:00:00Z"))).toBe("2026/05/25/");
    expect(buildUploadPrefix("root/", "images", true, new Date("2026-05-25T12:00:00Z"))).toBe(
      "images/2026/05/25/"
    );
  });

  it("extracts names from keys and local paths", () => {
    expect(fileNameFromKey("a/b/c.png")).toBe("c.png");
    expect(fileNameFromPath("/Users/demo/c.png")).toBe("c.png");
    expect(fileNameFromPath("C:\\demo\\c.png")).toBe("c.png");
    expect(fileNameFromUrl("https://example.com/assets/hello%20world.png?x=1")).toBe("hello world.png");
    expect(fileNameFromUrl("not a url")).toBe("remote-file");
  });

  it("plans uploads and resolves conflicts", () => {
    const plan = planUploadSources(
      [
        { name: "a.png", contentType: "image/png" },
        { name: "a.png", contentType: "image/png" },
      ],
      "blog/",
      ""
    );

    const prepared = prepareUploadPlan(plan, new Set(["blog/a.png"]), "rename");
    expect(prepared.map((item) => item.key)).toEqual(["blog/a-1.png", "blog/a-2.png"]);
  });

  it("skips conflicting uploads when requested", () => {
    const plan = planUploadSources([{ name: "a.png" }], "blog/", "");
    expect(prepareUploadPlan(plan, new Set(["blog/a.png"]), "skip")).toEqual([]);
  });

  it("sorts R2 objects", () => {
    expect(sortR2Objects(objects, "name", "asc").map((item) => item.key)).toEqual([
      "assets/a.jpg",
      "assets/b.png",
      "assets/readme.txt",
    ]);
    expect(sortR2Objects(objects, "size", "desc").map((item) => item.key)[0]).toBe("assets/b.png");
    expect(sortR2Objects(objects, "updated", "desc").map((item) => item.key)[0]).toBe("assets/readme.txt");
  });
});
