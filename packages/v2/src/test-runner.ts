/**
 * Test runner: compiles dataflow → WAT → WASM and runs tests
 */

import { dataflowToWat } from './dataflow-to-wat'
import wabt from 'wabt'

const output = document.getElementById('output')!

function log(html: string) {
  output.innerHTML += html + '\n'
}

async function runTests() {
  const wabtModule = await wabt()

  // Load examples
  const examples = ['00_max', '01_abs']

  for (const name of examples) {
    log(`<h2>Testing: ${name}</h2>`)

    try {
      // Fetch example JSON
      const response = await fetch(`/examples/${name}.json`)
      const graph = await response.json()

      // Find function and dataflow nodes
      const funcNode = graph.nodes.find((n: any) => n.layer === 'function')
      const flowNode = graph.nodes.find((n: any) => n.layer === 'dataflow')

      if (!funcNode || !flowNode) {
        log(`<span class="fail">✗ Missing function or dataflow layer</span>`)
        continue
      }

      // Parse function signature
      const params = funcNode.inputs.map((inp: string) => {
        const [paramName, type] = inp.split(':').map((s: string) => s.trim())
        return { name: paramName, type }
      })

      const func = {
        name: funcNode.title,
        params,
        result: funcNode.outputs[0]
      }

      // Generate WAT
      const watBody = dataflowToWat(flowNode, func)

      // Wrap in module
      const wat = `(module
  ${watBody}
  (export "${func.name}" (func $${func.name}))
)`

      log(`<pre class="wat">${escapeHtml(wat)}</pre>`)

      // Compile WAT → WASM
      const wasmModule = wabtModule.parseWat('test.wat', wat)
      const { buffer } = wasmModule.toBinary({})

      // Instantiate WASM
      const { instance } = await WebAssembly.instantiate(buffer)
      const wasmFunc = instance.exports[func.name] as Function

      // Run tests
      if (funcNode.tests) {
        for (const test of funcNode.tests) {
          const args = params.map((p: { name: string }) => test.in[p.name])
          const result = wasmFunc(...args)
          const pass = result === test.out

          const status = pass
            ? `<span class="pass">✓ PASS</span>`
            : `<span class="fail">✗ FAIL</span>`

          log(`<pre>${status} ${func.name}(${args.join(', ')}) = ${result} (expected: ${test.out})</pre>`)
        }
      }

    } catch (err) {
      log(`<span class="fail">✗ Error: ${err}</span>`)
      console.error(err)
    }
  }

  log(`<h2>Done!</h2>`)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

runTests()
