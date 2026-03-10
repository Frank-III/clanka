/**
 * @since 1.0.0
 */
import { Array, Layer, SchemaAST, ServiceMap } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"
import * as TypeBuilder from "./TypeBuilder.ts"
import { memoize } from "effect/Function"

/**
 * @since 1.0.0
 * @category Services
 */
export class ToolkitRenderer extends ServiceMap.Service<
  ToolkitRenderer,
  {
    render<Tools extends Record<string, Tool.Any>>(
      tools: Toolkit.Toolkit<Tools>,
    ): string
  }
>()("clanka/ToolkitRenderer") {
  static readonly layer = Layer.succeed(ToolkitRenderer, {
    render: memoize(
      <Tools extends Record<string, Tool.Any>>(
        tools: Toolkit.Toolkit<Tools>,
      ) => {
        const output = Array.empty<string>()
        for (const [name, tool] of Object.entries(tools.tools)) {
          const paramName =
            SchemaAST.resolveIdentifier(tool.parametersSchema.ast) ?? "options"
          const paramType = TypeBuilder.render(tool.parametersSchema)
          const params =
            paramType === "void" ? "" : `${paramName}: ${paramType}`
          output.push(
            `/** ${tool.description} */
declare function ${name}(${params}): Promise<${TypeBuilder.render(tool.successSchema)}>`,
          )
        }
        return output.join("\n\n")
      },
    ),
  })
}
