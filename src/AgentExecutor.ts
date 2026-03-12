/**
 * @since 1.0.0
 */
import {
  Cause,
  Console,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Queue,
  Schema,
  Scope,
  ServiceMap,
  Stream,
} from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import * as NodeConsole from "node:console"
import * as NodeVm from "node:vm"
import { Writable } from "node:stream"
import { AgentTools, CurrentDirectory, TaskCompleter } from "./AgentTools.ts"
import { ToolkitRenderer } from "./ToolkitRenderer.ts"

/**
 * @since 1.0.0
 * @category Services
 */
export class AgentExecutor extends ServiceMap.Service<
  AgentExecutor,
  {
    readonly toolsDts: Effect.Effect<string>
    readonly agentsMd: Effect.Effect<Option.Option<string>>
    execute(script: string): Stream.Stream<string, AgentFinished>
  }
>()("clanka/AgentExecutor") {}

/**
 * @since 1.0.0
 * @category Services
 */
export const layerLocal = <Toolkit extends Toolkit.Any = never>(options: {
  readonly directory: string
  readonly tools?: Toolkit | undefined
}) =>
  Layer.effect(
    AgentExecutor,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const pathService = yield* Path.Path
      const renderer = yield* ToolkitRenderer
      const AllTools = Toolkit.merge(
        AgentTools,
        (options.tools as unknown as Toolkit.Toolkit<{}>) ?? Toolkit.empty,
      )
      const tools = yield* AllTools
      const toolsDts = Effect.succeed(renderer.render(AllTools))

      const services = (yield* Effect.services()).pipe(
        ServiceMap.add(CurrentDirectory, options.directory),
      )

      const toolEntries = Object.entries(tools.tools).map(([name, tool]) => {
        const handler = services.mapUnsafe.get(tool.id) as Tool.Handler<string>
        return {
          name,
          services: ServiceMap.merge(services, handler.services),
          handler: handler.handler,
        }
      })

      const execute = Effect.fnUntraced(function* (script: string) {
        const output = yield* Queue.unbounded<
          string,
          AgentFinished | Cause.Done
        >()
        const console = yield* makeConsole(output)
        const handlerScope = Scope.makeUnsafe("parallel")
        const trackFiber = Fiber.runIn(handlerScope)

        const completer = TaskCompleter.of((summary) =>
          Queue.fail(output, new AgentFinished({ summary })),
        )

        yield* Effect.gen(function* () {
          const console = yield* Console.Console
          let running = 0

          const vmScript = new NodeVm.Script(`async function main() {
${script}
}`)
          const sandbox: ScriptSandbox = {
            main: defaultMain,
            console,
            fetch,
            process: undefined,
          }

          for (let i = 0; i < toolEntries.length; i++) {
            const { name, handler, services } = toolEntries[i]!
            const runFork = Effect.runForkWith(
              ServiceMap.add(services, TaskCompleter, completer),
            )

            // oxlint-disable-next-line typescript/no-explicit-any
            sandbox[name] = function (params: any) {
              running++
              const fiber = trackFiber(runFork(handler(params, {})))
              return new Promise((resolve, reject) => {
                fiber.addObserver((exit) => {
                  running--
                  if (exit._tag === "Success") {
                    return resolve(exit.value)
                  }
                  if (Cause.hasInterruptsOnly(exit.cause)) return
                  reject(Cause.squash(exit.cause))
                })
              })
            }
          }

          vmScript.runInNewContext(sandbox, {
            timeout: 1000,
          })
          yield* Effect.promise(sandbox.main)
          while (true) {
            yield* Effect.yieldNow
            if (running === 0) break
          }
        }).pipe(
          Effect.ensuring(Scope.close(handlerScope, Exit.void)),
          Effect.catchCause(Effect.logFatal),
          Effect.provideService(Console.Console, console),
          Effect.ensuring(Queue.end(output)),
          Effect.forkScoped,
        )

        return Stream.fromQueue(output)
      }, Stream.unwrap)

      return AgentExecutor.of({
        toolsDts,
        agentsMd: fs
          .readFileString(pathService.join(options.directory, "AGENTS.md"))
          .pipe(Effect.option),
        execute,
      })
    }),
  ).pipe(Layer.provide(ToolkitRenderer.layer))

/**
 * @since 1.0.0
 * @category Output
 */
export class AgentFinished extends Schema.TaggedErrorClass<AgentFinished>()(
  "AgentFinished",
  {
    summary: Schema.String,
  },
) {}

interface ScriptSandbox {
  main: () => Promise<void>
  console: Console.Console
  [toolName: string]: unknown
}

const defaultMain = () => Promise.resolve()

const makeConsole = Effect.fn(function* (
  queue: Queue.Queue<string, AgentFinished | Cause.Done>,
) {
  const writable = new QueueWriteStream(queue)
  const newConsole = new NodeConsole.Console(writable)
  yield* Effect.addFinalizer(() => {
    writable.end()
    return Effect.void
  })
  return newConsole
})

class QueueWriteStream extends Writable {
  readonly queue: Queue.Enqueue<string, Cause.Done>
  constructor(queue: Queue.Enqueue<string, Cause.Done>) {
    super()
    this.queue = queue
  }
  _write(
    // oxlint-disable-next-line typescript/no-explicit-any
    chunk: any,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    Queue.offerUnsafe(this.queue, chunk.toString())
    callback()
  }
}
