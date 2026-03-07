import { createServer } from "node:http"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Deferred, Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  AgentToolHandlers,
  AgentTools,
  CurrentDirectory,
  TaskCompleteDeferred,
} from "./AgentTools.ts"
import { Executor } from "./Executor.ts"
import { ToolkitRenderer } from "./ToolkitRenderer.ts"

describe("AgentTools", () => {
  it("renders python and httpGet tool signatures", async () => {
    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const renderer = yield* ToolkitRenderer
        return renderer.render(AgentTools)
      }).pipe(
        Effect.provide([
          AgentToolHandlers,
          Executor.layer,
          ToolkitRenderer.layer,
        ]),
        Effect.provideService(CurrentDirectory, process.cwd()),
        Effect.provideServiceEffect(
          TaskCompleteDeferred,
          Deferred.make<string>(),
        ),
      ),
    )

    expect(output).toContain("/** Run Python code and return the output. */")
    expect(output).toContain(
      "declare function python(script: string): Promise<string>",
    )
    expect(output).toContain("/** Fetch a URL and return its text response. */")
    expect(output).toContain(
      "declare function httpGet(url: string): Promise<string>",
    )
  })

  it("runs multiline python scripts in the current directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "clanka-python-"))
    const cwd = join(tempRoot, "tool cwd")
    await mkdir(cwd)
    await writeFile(join(cwd, "value.txt"), "14\n")

    try {
      const output = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor
          const tools = yield* AgentTools

          return yield* executor
            .execute({
              tools,
              script: [
                "const output = await python(`",
                "from pathlib import Path",
                'print(Path("value.txt").read_text().strip())',
                "print(Path.cwd().name)",
                "`)",
                "console.log(output.trimEnd())",
              ].join("\n"),
            })
            .pipe(Stream.mkString)
        }).pipe(
          Effect.provide([
            AgentToolHandlers,
            Executor.layer,
            ToolkitRenderer.layer,
          ]),
          Effect.provideService(CurrentDirectory, cwd),
          Effect.provideServiceEffect(
            TaskCompleteDeferred,
            Deferred.make<string>(),
          ),
        ),
      )

      expect(output).toContain(`14\n${basename(cwd)}\n`)
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it("fetches text responses with httpGet", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "clanka-http-get-"))
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.end("Hello from httpGet!\n")
    })

    try {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve())
      })

      const address = server.address()
      if (address === null || typeof address === "string") {
        throw new Error("Expected httpGet test server to listen on a TCP port")
      }

      const output = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor
          const tools = yield* AgentTools

          return yield* executor
            .execute({
              tools,
              script: [
                `const output = await httpGet("http://127.0.0.1:${address.port}/message")`,
                "console.log(output.trimEnd())",
              ].join("\n"),
            })
            .pipe(Stream.mkString)
        }).pipe(
          Effect.provide([
            AgentToolHandlers,
            Executor.layer,
            ToolkitRenderer.layer,
          ]),
          Effect.provideService(CurrentDirectory, tempRoot),
          Effect.provideServiceEffect(
            TaskCompleteDeferred,
            Deferred.make<string>(),
          ),
        ),
      )

      expect(output).toContain("Hello from httpGet!")
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})
