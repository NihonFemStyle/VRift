import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseThread, POST_SEPARATOR as SEP, validateThread } from "../messageBoard";

describe("message board threads", () => {
  it("parses like Hacknet", () => {
    const t = parseThread(`my\r\nthread\r\n${SEP}\r\n#Snake\r\nhello\n>implying\n${SEP}\n\n${SEP}\n#Nope\ntext\n${SEP}\n#Mod`);
    expect(t.id).toBe("mythread");
    expect(t.posts.map((p) => p.img)).toEqual(["Snake", "None", "None"]);
    expect(t.posts[0].text).toBe("hello\n>implying\n");
    expect(t.posts[1].text).toBe("#Nope\ntext\n");
    expect(t.posts[2].text).toBe("#Mod"); // no line break after the image name: shown as text
    expect(t.posts[0].line).toBe(4);
  });
  it("accepts numeric image values like Enum.Parse", () => {
    expect(parseThread(`x\n${SEP}\n#3\nhi`).posts[0].img).toBe("Sun");
  });
  it("warns about wrong separators and image names", () => {
    const issues = validateThread(`id\n${SEP}\n#snake\nhi\n${"-".repeat(41)}\nmore`);
    expect(issues.map((i) => i.line)).toEqual([5, 3]);
    expect(issues[1].message).toContain("#Snake");
    expect(validateThread("id\nno separator")[0].message).toContain("42 dashes");
  });
  const dir = "/mnt/user-data/uploads/2123630193/Docs/MessageBoardThreads";
  it.skipIf(!existsSync(dir))("reads every System Rift thread", () => {
    for (const f of readdirSync(dir)) {
      const t = parseThread(readFileSync(`${dir}/${f}`, "utf8"));
      expect(t.posts.length, f).toBeGreaterThan(0);
    }
  });
});
