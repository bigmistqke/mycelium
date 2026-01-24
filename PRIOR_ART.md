# Prior Art

Research and existing systems relevant to mycelium's vision.

## 1. Neuro-Symbolic Program Synthesis

Combines neural networks with symbolic reasoning for code generation.

**Key ideas:**
- Neurosymbolic programs invoke neural nets as library routines
- Symbolic structures (graphs, constraints, types) + neural models share state
- GNNs (Graph Neural Networks) for program analysis and synthesis
- Neural guides symbolic search; symbolic constrains neural output

**References:**
- [Neurosymbolic Programming (UT Austin)](https://www.cs.utexas.edu/~swarat/pubs/PGL-049-Plain.pdf)
- [SIGPLAN Blog: Synthesizing Neurosymbolic Programs](https://blog.sigplan.org/2020/04/15/synthesizing-neurosymbolic-programs/)
- [NSF Foundations & Trends](https://par.nsf.gov/servlets/purl/10428593)
- [MIT CSAIL Neuro-Symbolic Visual Reasoning](http://nscv.csail.mit.edu/)

**Relevance to mycelium:** The graph is the symbolic layer; LLMs provide the neural layer. Division of labor: LLMs reason, tools verify.

---

## 2. Dataflow / Visual Programming

Block diagrams with wires representing data flow between operations.

**Key ideas:**
- Operations are black boxes with explicit inputs/outputs
- Execution when all inputs available (inherently parallel)
- No shared state, no side effects between blocks
- Pioneered by Jack Dennis at MIT (1960s)

**Notable systems:**
- **LabVIEW** (1986) - Graphical dataflow for engineers/scientists
- **Node-RED** - Flow-based rapid development for IoT
- **Pure Data** - Visual programming for multimedia/audio
- **Unreal Blueprints** - Node-based visual scripting for games
- **KNIME** - Data analytics and integration

**References:**
- [Dataflow Programming (Wikipedia)](https://en.wikipedia.org/wiki/Dataflow_programming)
- [Flow-based Programming (Wikipedia)](https://en.wikipedia.org/wiki/Flow-based_programming)
- [Visual Programming Languages (Wikipedia)](https://en.wikipedia.org/wiki/Visual_programming_language)

**Relevance to mycelium:** The recursive box model with ports is essentially dataflow. Nodes have inputs/outputs, edges connect ports.

---

## 3. Model-Driven Architecture (MDA)

OMG standard for generating code from platform-independent models.

**Key ideas:**
- Platform-Independent Model (PIM) → Platform-Specific Model (PSM) → Code
- Models are the primary artifact, code is derived
- Executable UML / fUML - models that execute directly
- QVT (Query/View/Transformation) for model transformations

**Notable systems:**
- **Eclipse Modeling Framework (EMF)**
- **MetaEdit+**
- **Xtext** - DSL development

**References:**
- [OMG Model-Driven Architecture](https://www.omg.org/mda/)
- [Executable UML in MDA](https://www.informit.com/articles/article.aspx?p=28274&seqNum=6)
- [MDA Books](https://modeling-languages.com/list-mddmda-books/)

**Relevance to mycelium:** Same thesis - models are primary, code is derived. MDA attempted this with UML; we attempt it with intent graphs.

---

## 4. Content-Addressed Code (Unison)

Code identified by hash of its AST, not by names or file paths.

**Key ideas:**
- Each definition has a unique 512-bit SHA3 hash
- Hash based on structure, not variable names or formatting
- Names are pointers to hashes (like Git tags)
- Immutable definitions - contents at an address never change
- Eliminates builds, dependency conflicts, diamond dependency problem

**Benefits:**
- Distributed programming simplified (ship bytecode tree, sync missing hashes)
- No "which version" conflicts - both versions coexist
- Code stored in database, not text files
- Already type-checked and parsed

**References:**
- [Unison: The Big Idea](https://www.unison-lang.org/docs/the-big-idea/)
- [Unison GitHub](https://github.com/unisonweb/unison)
- [LWN: Programming in Unison](https://lwn.net/Articles/978955/)
- [SoftwareMill: Unison Code as Hashes](https://softwaremill.com/trying-out-unison-part-1-code-as-hashes/)

**Relevance to mycelium:** Content-addressing could apply to graph nodes. Hash the structure, not the names. Enables distributed collaboration, no merge conflicts on structure.

---

## 5. Synchronous Reactive Languages

Formal languages for safety-critical embedded systems.

**Key ideas:**
- Synchronous hypothesis: outputs conceptually simultaneous with inputs
- Formal semantics enable verification and correct-by-construction compilation
- Deterministic concurrency
- Compile to finite state machines or efficient sequential code

**Notable languages:**
- **Lustre** (1984) - Declarative dataflow, basis of SCADE
- **Esterel** (1983) - Imperative synchronous language
- **Signal** - Dataflow with multi-clock
- **Statecharts** - Hierarchical state machines

**Applications:**
- Aerospace (Airbus fly-by-wire)
- Automotive (engine control)
- Nuclear plants
- Railway signaling

**References:**
- [Lustre (Wikipedia)](https://en.wikipedia.org/wiki/Lustre_(programming_language))
- [Lustre IEEE Paper](https://ieeexplore.ieee.org/document/97300/)
- [Esterel Paper](http://www.inf.fu-berlin.de/lehre/SS13/Sem-Prog/material/ESTEREL.pdf)

**Relevance to mycelium:** Formal semantics, simulation before deployment, hierarchical abstraction. SCADE proves industrial viability of graph → code.

---

## 6. Industrial Block Diagram Tools

Production tools for embedded code generation from block diagrams.

**Notable systems:**

### Simulink (MathWorks)
- Block diagram environment for Model-Based Design
- Generates C, C++, CUDA, PLC, Verilog, VHDL
- Embedded Coder for production-quality code
- Used in automotive, aerospace, robotics

### SCADE (Ansys)
- Based on Lustre synchronous language
- Qualified for DO-178C (aerospace), ISO 26262 (automotive)
- Formal verification integrated
- Used by Airbus, Boeing, automotive OEMs

**References:**
- [Simulink](https://www.mathworks.com/products/simulink.html)
- [Embedded Coder](https://www.mathworks.com/help/ecoder/gs/code-generation-workflows-with-embedded-coder.html)

**Relevance to mycelium:** Proves the model: block diagrams → production code works at scale. Hierarchical, simulatable, verifiable.

---

## Key Patterns Across Prior Art

| Pattern | Systems | Relevance |
|---------|---------|-----------|
| Graph/block → code | Simulink, SCADE, LabVIEW, MDA | Core thesis |
| Simulation before commitment | Simulink, Lustre, Esterel | Catch errors early |
| Formal semantics | Lustre, Esterel, fUML | Enable verification |
| Hierarchical abstraction | All | Zoom in/out |
| Content-addressed | Unison | No dependency hell |
| Neuro + symbolic | Program synthesis research | LLMs + graphs |

---

## What's Different About Mycelium

Prior art largely focused on:
- Domain-specific (embedded, control systems)
- Visual-first (drag and drop blocks)
- Single direction (model → code)

Mycelium aims for:
- General-purpose (via WAT/WASM)
- Dual-mode (words + graphs, not just visual)
- Bidirectional (graph ↔ code)
- AI as peer (not just code generator)
- Constraints as first-class citizens
- Recursive box model (same structure at all levels)
