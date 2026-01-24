/**
 * Simple dataflow → WAT compiler
 *
 * Takes a dataflow graph and generates WAT text.
 * Handles pure functions (no state/effects yet).
 */

interface DataflowNode {
  id: string
  kind: 'input' | 'output' | 'const' | 'op' | 'select'
  op?: string
  value?: number
  type?: string
}

interface DataflowEdge {
  from: string
  to: string
  port?: number | string
}

interface Dataflow {
  nodes: DataflowNode[]
  edges: DataflowEdge[]
}

interface FunctionInfo {
  name: string
  params: { name: string; type: string }[]
  result: string
}

/**
 * Compile a dataflow graph to WAT
 */
export function dataflowToWat(dataflow: Dataflow, func: FunctionInfo): string {
  const { nodes, edges } = dataflow

  // Build adjacency: which nodes feed into which
  const inputs = new Map<string, { from: string; port?: number | string }[]>()
  for (const node of nodes) {
    inputs.set(node.id, [])
  }
  for (const edge of edges) {
    const list = inputs.get(edge.to)
    if (list) {
      list.push({ from: edge.from, port: edge.port })
    }
  }

  // Find output node
  const outputNode = nodes.find(n => n.kind === 'output')
  if (!outputNode) throw new Error('No output node')

  // Generate WAT
  const lines: string[] = []

  // Function signature
  const params = func.params.map(p => `(param $${p.name} ${p.type})`).join(' ')
  lines.push(`(func $${func.name} ${params} (result ${func.result})`)

  // Generate expression for output
  const expr = generateExpr(outputNode.id, nodes, inputs, func)
  lines.push(`  ${expr}`)

  lines.push(`)`)

  return lines.join('\n')
}

/**
 * Generate WAT expression for a node (recursive)
 */
function generateExpr(
  nodeId: string,
  nodes: DataflowNode[],
  inputs: Map<string, { from: string; port?: number | string }[]>,
  func: FunctionInfo
): string {
  const node = nodes.find(n => n.id === nodeId)
  if (!node) throw new Error(`Node not found: ${nodeId}`)

  const nodeInputs = inputs.get(nodeId) || []

  switch (node.kind) {
    case 'input': {
      // Input node - reference the parameter
      const param = func.params.find(p => p.name === node.id)
      if (param) {
        return `(local.get $${param.name})`
      }
      throw new Error(`Unknown input: ${node.id}`)
    }

    case 'const': {
      const type = node.type || 'i32'
      return `(${type}.const ${node.value})`
    }

    case 'op': {
      // Get inputs in port order
      const sortedInputs = [...nodeInputs].sort((a, b) => {
        const portA = typeof a.port === 'number' ? a.port : 0
        const portB = typeof b.port === 'number' ? b.port : 0
        return portA - portB
      })

      const args = sortedInputs
        .map(inp => generateExpr(inp.from, nodes, inputs, func))
        .join(' ')

      return `(${node.op} ${args})`
    }

    case 'select': {
      // Select has: condition, true, false
      const condInput = nodeInputs.find(i => i.port === 'condition')
      const trueInput = nodeInputs.find(i => i.port === 'true')
      const falseInput = nodeInputs.find(i => i.port === 'false')

      if (!condInput || !trueInput || !falseInput) {
        throw new Error('Select missing inputs')
      }

      const condExpr = generateExpr(condInput.from, nodes, inputs, func)
      const trueExpr = generateExpr(trueInput.from, nodes, inputs, func)
      const falseExpr = generateExpr(falseInput.from, nodes, inputs, func)

      // WAT select: (select <true> <false> <condition>)
      return `(select ${trueExpr} ${falseExpr} ${condExpr})`
    }

    case 'output': {
      // Output just passes through its input
      if (nodeInputs.length === 0) {
        throw new Error('Output has no input')
      }
      return generateExpr(nodeInputs[0].from, nodes, inputs, func)
    }

    default:
      throw new Error(`Unknown node kind: ${node.kind}`)
  }
}

// CLI usage
async function main() {
  const fs = await import('fs')
  const path = process.argv[2]

  if (!path) {
    console.log('Usage: npx tsx dataflow-to-wat.ts <example.json>')
    process.exit(1)
  }

  const content = fs.readFileSync(path, 'utf-8')
  const graph = JSON.parse(content)

  // Find function and dataflow nodes
  const funcNode = graph.nodes.find((n: any) => n.layer === 'function')
  const flowNode = graph.nodes.find((n: any) => n.layer === 'dataflow')

  if (!funcNode || !flowNode) {
    console.error('Need function and dataflow layers')
    process.exit(1)
  }

  // Parse function signature
  const params = funcNode.inputs.map((inp: string) => {
    const [name, type] = inp.split(':').map((s: string) => s.trim())
    return { name, type }
  })

  const func: FunctionInfo = {
    name: funcNode.title,
    params,
    result: funcNode.outputs[0]
  }

  const wat = dataflowToWat(flowNode, func)
  console.log(wat)
}

main()
