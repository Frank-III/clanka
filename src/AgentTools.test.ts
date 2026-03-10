import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { Deferred, Effect, FileSystem, Stream } from "effect"
import { describe, it } from "@effect/vitest"
import { expect } from "vitest"
import {
  AgentToolHandlers,
  AgentTools,
  CurrentDirectory,
  makeContextNoop,
  TaskCompleteDeferred,
} from "./AgentTools.ts"
import { Executor } from "./Executor.ts"
import { ToolkitRenderer } from "./ToolkitRenderer.ts"

const makeTempRoot = (prefix: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.makeTempDirectoryScoped({
      directory: tmpdir(),
      prefix,
    })
  })

describe("AgentTools", () => {
  it.effect("renders the tool signatures", () =>
    Effect.gen(function* () {
      const renderer = yield* ToolkitRenderer
      const output = renderer.render(AgentTools)

      expect(output).toContain(
        "/** Read a file and optionally filter the lines to return. Returns null if the file doesn't exist. */",
      )
      expect(output).toContain("declare function readFile(options: {")
      expect(output).toContain("readonly path: string;")
      expect(output).toContain("readonly startLine?: number | undefined;")
      expect(output).toContain("readonly endLine?: number | undefined;")
      expect(output).toContain(
        "/** Apply a git diff / unified diff patch across one or more files. */",
      )
      expect(output).toContain(
        "declare function applyPatch(patch: string): Promise<string>",
      )
      expect(output).not.toContain("declare function python(")
    }).pipe(
      Effect.provide([
        AgentToolHandlers,
        Executor.layer,
        ToolkitRenderer.layer,
      ]),
      Effect.provide(NodeServices.layer),
      Effect.provideService(CurrentDirectory, process.cwd()),
      Effect.provideServiceEffect(
        TaskCompleteDeferred,
        Deferred.make<string>(),
      ),
    ),
  )

  it.effect("applies multi-file patches with add, move, and delete", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const tempRoot = yield* makeTempRoot("clanka-apply-patch-")
      yield* fs.makeDirectory(join(tempRoot, "src"), { recursive: true })
      yield* fs.writeFileString(join(tempRoot, "src", "app.txt"), "old\n")
      yield* fs.writeFileString(join(tempRoot, "obsolete.txt"), "remove me\n")

      const executor = yield* Executor
      const tools = yield* AgentTools
      const output = yield* executor
        .execute({
          tools,
          script: [
            "const output = await applyPatch(`",
            "diff --git a/src/app.txt b/src/main.txt",
            "similarity index 100%",
            "rename from src/app.txt",
            "rename to src/main.txt",
            "--- a/src/app.txt",
            "+++ b/src/main.txt",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "diff --git a/obsolete.txt b/obsolete.txt",
            "deleted file mode 100644",
            "--- a/obsolete.txt",
            "+++ /dev/null",
            "diff --git a/dev/null b/notes/hello.txt",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/notes/hello.txt",
            "@@ -0,0 +1 @@",
            "+hello",
            "`)",
            "console.log(output)",
          ].join("\n"),
        })
        .pipe(
          Stream.mkString,
          Effect.provideServices(makeContextNoop(tempRoot)),
        )

      expect(output).toContain("A notes/hello.txt")
      expect(output).toContain("M src/main.txt")
      expect(output).toContain("D obsolete.txt")
      expect(
        yield* fs.readFileString(join(tempRoot, "notes", "hello.txt")),
      ).toBe("hello\n")
      expect(yield* fs.readFileString(join(tempRoot, "src", "main.txt"))).toBe(
        "new\n",
      )
      yield* Effect.flip(fs.readFileString(join(tempRoot, "obsolete.txt")))
      yield* Effect.flip(fs.readFileString(join(tempRoot, "src", "app.txt")))
    }).pipe(
      Effect.provide([
        AgentToolHandlers,
        Executor.layer,
        ToolkitRenderer.layer,
      ]),
      Effect.provide(NodeServices.layer),
    ),
  )

  it.effect("plans later hunks against in-memory file state", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const tempRoot = yield* makeTempRoot("clanka-apply-patch-state-")
      yield* fs.makeDirectory(join(tempRoot, "src"), { recursive: true })
      yield* fs.writeFileString(join(tempRoot, "src", "app.txt"), "old\n")

      const executor = yield* Executor
      const tools = yield* AgentTools
      const output = yield* executor
        .execute({
          tools,
          script: [
            "const output = await applyPatch(`",
            "diff --git a/dev/null b/notes/hello.txt",
            "new file mode 100644",
            "--- /dev/null",
            "+++ b/notes/hello.txt",
            "@@ -0,0 +1 @@",
            "+hello",
            "diff --git a/notes/hello.txt b/notes/hello.txt",
            "--- a/notes/hello.txt",
            "+++ b/notes/hello.txt",
            "@@ -1 +1 @@",
            "-hello",
            "+hello again",
            "diff --git a/src/app.txt b/src/main.txt",
            "similarity index 100%",
            "rename from src/app.txt",
            "rename to src/main.txt",
            "--- a/src/app.txt",
            "+++ b/src/main.txt",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "diff --git a/src/main.txt b/src/main.txt",
            "--- a/src/main.txt",
            "+++ b/src/main.txt",
            "@@ -1 +1 @@",
            "-new",
            "+newer",
            "`)",
            "console.log(output)",
          ].join("\n"),
        })
        .pipe(
          Stream.mkString,
          Effect.provideServices(makeContextNoop(tempRoot)),
        )

      expect(output).toContain("A notes/hello.txt")
      expect(output).toContain("M notes/hello.txt")
      expect(output).toContain("M src/main.txt")
      expect(
        yield* fs.readFileString(join(tempRoot, "notes", "hello.txt")),
      ).toBe("hello again\n")
      expect(yield* fs.readFileString(join(tempRoot, "src", "main.txt"))).toBe(
        "newer\n",
      )
      yield* Effect.flip(fs.readFileString(join(tempRoot, "src", "app.txt")))
    }).pipe(
      Effect.provide([
        AgentToolHandlers,
        Executor.layer,
        ToolkitRenderer.layer,
      ]),
      Effect.provide(NodeServices.layer),
    ),
  )

  it.effect("renames a file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const tempRoot = yield* makeTempRoot("clanka-rename-file-")
      yield* fs.makeDirectory(join(tempRoot, "src"), { recursive: true })
      yield* fs.writeFileString(join(tempRoot, "src", "app.txt"), "hello\n")

      const executor = yield* Executor
      const tools = yield* AgentTools
      yield* executor
        .execute({
          tools,
          script: [
            "await renameFile({",
            '  from: "src/app.txt",',
            '  to: "src/main.txt",',
            "})",
            'console.log("renamed")',
          ].join("\n"),
        })
        .pipe(
          Stream.mkString,
          Effect.provideServices(makeContextNoop(tempRoot)),
        )

      expect(yield* fs.readFileString(join(tempRoot, "src", "main.txt"))).toBe(
        "hello\n",
      )
      yield* Effect.flip(fs.readFileString(join(tempRoot, "src", "app.txt")))
    }).pipe(
      Effect.provide([
        AgentToolHandlers,
        Executor.layer,
        ToolkitRenderer.layer,
        NodeFileSystem.layer,
      ]),
      Effect.provide(NodeServices.layer),
    ),
  )
})
