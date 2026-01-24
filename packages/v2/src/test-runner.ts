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
  const examples = ['00_max', '01_abs', '02_calculator']

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
        results: funcNode.outputs as string[]
      }

      // Generate WAT
      const watBody = dataflowToWat(flowNode, func)

      // Wrap in module (note: multi-value returns are supported in modern WASM)
      const wat = `(module
  ${watBody}
  (export "${func.name}" (func $${func.name}))
)`

      const isMultiValue = func.results.length > 1

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

          // Compare results (handle both single and multi-value returns)
          let pass: boolean
          let resultStr: string
          let expectedStr: string

          if (isMultiValue) {
            // Multi-value: result is an array
            const resultArr = Array.isArray(result) ? result : [result]
            const expectedArr = test.out as number[]
            pass = resultArr.length === expectedArr.length &&
                   resultArr.every((v: number, i: number) => v === expectedArr[i])
            resultStr = `[${resultArr.join(', ')}]`
            expectedStr = `[${expectedArr.join(', ')}]`
          } else {
            // Single value
            pass = result === test.out
            resultStr = String(result)
            expectedStr = String(test.out)
          }

          const status = pass
            ? `<span class="pass">✓ PASS</span>`
            : `<span class="fail">✗ FAIL</span>`

          log(`<pre>${status} ${func.name}(${args.join(', ')}) = ${resultStr} (expected: ${expectedStr})</pre>`)
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
